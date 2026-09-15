import { findFunctionBlock } from './braceScanner';

export interface UniversalPassTransformResult {
  code: string;
  modified: boolean;
  changes: string[];
  audits: Array<{
    patternExpected: string;
    matchFound: boolean;
    replacementApplied: boolean;
    reason?: string;
  }>;
}

const SUBMIT_PATTERN = /(?:window\.)?submitAssessment\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{|(?:async\s+)?function\s+submitAssessment\s*\([^)]*\)\s*\{/i;
const RETRY_PATTERN = /(?:window\.)?retryAssessment\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{|(?:async\s+)?function\s+retryAssessment\s*\([^)]*\)\s*\{/i;

const FULL_RETAKE_MARKER = 'SCORMIFY UNIVERSAL WORKDAY: full assessment retake reset';
const SHOW_RETAKE_MARKER = 'SCORMIFY UNIVERSAL WORKDAY: explicit full-retake gate';
const SHOW_RETAKE_HELPER_DEFINITION = 'window.__scormifyShowFullRetake = function';

const SHOW_RETAKE_HELPER = `
// ${SHOW_RETAKE_MARKER}
window.__scormifyShowFullRetake = function() {
    var retryButton = document.getElementById('retry-assessment') || document.querySelector('.retry-assessment');
    var submitButton = document.querySelector('.submit-assessment') || document.getElementById('submit-assessment');

    if (!retryButton && document.createElement) {
        retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.id = 'retry-assessment';
        retryButton.className = 'retry-assessment';
        retryButton.textContent = 'Retake Assessment';

        var host = (submitButton && submitButton.parentElement) ||
            document.getElementById('assessment-results') ||
            document.getElementById('assessment-result') ||
            document.body;
        if (host && host.appendChild) host.appendChild(retryButton);
    }

    if (retryButton) {
        retryButton.textContent = 'Retake Assessment';
        retryButton.style.display = '';
        retryButton.onclick = function(event) {
            if (event && event.preventDefault) event.preventDefault();
            if (typeof window.retryAssessment === 'function') window.retryAssessment();
        };
    }

    if (submitButton) submitButton.style.display = 'none';
    return retryButton;
};
`;

const FULL_RETAKE_FUNCTION = `
window.retryAssessment = function() {
    // ${FULL_RETAKE_MARKER}
    var questions = document.querySelectorAll('.question-container');
    var allInputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');

    allInputs.forEach(function(input) {
        input.checked = false;
        if (input.removeAttribute) input.removeAttribute('aria-invalid');
    });

    questions.forEach(function(container) {
        if (container.classList) {
            container.classList.remove('correct-answer', 'incorrect-answer', 'correct', 'incorrect');
        }

        if (container.querySelectorAll) {
            container.querySelectorAll('.correct-answer, .incorrect-answer, .correct, .incorrect').forEach(function(el) {
                if (el.classList) el.classList.remove('correct-answer', 'incorrect-answer', 'correct', 'incorrect');
            });
        }

        var feedback = container.querySelector ? container.querySelector('.feedback') : null;
        if (feedback) {
            feedback.textContent = '';
            if ('innerHTML' in feedback) feedback.innerHTML = '';
            if (feedback.style) feedback.style.display = 'none';
            if (feedback.classList) feedback.classList.remove('correct', 'incorrect', 'correct-feedback', 'incorrect-feedback');
            if (feedback.removeAttribute) feedback.removeAttribute('aria-live');
        }
    });

    document.querySelectorAll('.feedback').forEach(function(feedback) {
        feedback.textContent = '';
        if ('innerHTML' in feedback) feedback.innerHTML = '';
        if (feedback.style) feedback.style.display = 'none';
        if (feedback.classList) feedback.classList.remove('correct', 'incorrect', 'correct-feedback', 'incorrect-feedback');
        if (feedback.removeAttribute) feedback.removeAttribute('aria-live');
    });

    var results = document.getElementById('assessment-results') || document.getElementById('assessment-result');
    if (results) {
        if (results.style) results.style.display = 'none';
        if (results.classList) results.classList.remove('passed', 'failed', 'success', 'error');
    }

    var scoreMessage = document.getElementById('score-message');
    if (scoreMessage) scoreMessage.textContent = '';

    var scorePercentage = document.getElementById('score-percentage');
    if (scorePercentage) scorePercentage.textContent = '0%';

    var completionMessage = document.getElementById('completion-message');
    if (completionMessage && completionMessage.style) completionMessage.style.display = 'none';

    var retryButton = document.getElementById('retry-assessment') || document.querySelector('.retry-assessment');
    if (retryButton && retryButton.style) retryButton.style.display = 'none';

    var submitButton = document.querySelector('.submit-assessment') || document.getElementById('submit-assessment');
    if (submitButton) {
        if (submitButton.style) submitButton.style.display = '';
        submitButton.disabled = false;
        submitButton.textContent = 'Submit Assessment';
    }

    if (window.assessmentData) {
        window.assessmentData.lastAnswers = {};
    }

    if (typeof window.scrollTo === 'function') {
        try {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (_) {
            window.scrollTo(0, 0);
        }
    }
};
`;

function hasUnsafeDirectResubmit(body: string): boolean {
  return /Submit Again/i.test(body) ||
    /adjust your answers and submit again/i.test(body) ||
    /Never show retry button\s*-?\s*we allow direct resubmission/i.test(body);
}

function hasUnsafeSelectiveRetry(body: string): boolean {
  return /lastAnswers[\s\S]{0,1000}isCorrect/i.test(body) ||
    /Keep incorrect answers/i.test(body) ||
    /only clear correct/i.test(body);
}

function hasFullRetakeReset(body: string): boolean {
  const clearsAllAnswers = /input\[type=["']radio["']\][\s\S]{0,100}input\[type=["']checkbox["']\]/i.test(body) &&
    /checked\s*=\s*false/.test(body);
  const clearsFeedback = /\.feedback/.test(body) && /textContent\s*=\s*['"]['"]/.test(body);
  const clearsState = /lastAnswers\s*=\s*\{\s*\}/.test(body);
  const restoresSubmit = /Submit Assessment/.test(body) && /submitButton[\s\S]{0,200}style\.display\s*=\s*['"]['"]/.test(body);
  return body.includes(FULL_RETAKE_MARKER) && clearsAllAnswers && clearsFeedback && clearsState && restoresSubmit;
}

function replaceFailureDirectResubmit(body: string): { body: string; changed: boolean } {
  let updated = body;
  let changed = false;

  const submitAgainPattern = /submitButton\.textContent\s*=\s*['"]Submit Again['"]\s*;?/i;
  if (submitAgainPattern.test(updated)) {
    updated = updated.replace(
      submitAgainPattern,
      `submitButton.textContent = 'Submit Assessment';\n                submitButton.style.display = 'none';\n                window.__scormifyShowFullRetake();`
    );
    changed = true;
  }

  const directResubmitCommentAndHide = /\/\/\s*Never show retry button[^\n]*\n\s*if\s*\(\s*retryButton\s*\)\s*retryButton\.style\.display\s*=\s*['"]none['"]\s*;?/i;
  if (directResubmitCommentAndHide.test(updated)) {
    updated = updated.replace(
      directResubmitCommentAndHide,
      `// ${SHOW_RETAKE_MARKER}\n                window.__scormifyShowFullRetake();`
    );
    changed = true;
  }

  const guidancePatterns = [
    /You can adjust your answers and submit again\./gi,
    /Review the feedback above to help improve your score\./gi,
  ];
  for (const pattern of guidancePatterns) {
    if (pattern.test(updated)) {
      pattern.lastIndex = 0;
      updated = updated.replace(pattern, 'Select Retake Assessment to start a new attempt. All answers will be cleared.');
      changed = true;
    }
  }

  return { body: updated, changed };
}

/**
 * Harden the legacy UniversalSCORM/SafeSCORM assessment runtime without
 * replacing the package's assessment implementation.
 *
 * This is additive to the historical Universal repairs. It keeps all previous
 * Workday protections and adds one more invariant: after a failed assessment,
 * the next attempt must begin with a completely blank assessment rather than
 * allowing direct correction of only the missed questions.
 *
 * Invariants for SCORM 1.2:
 * - a prior passing result is never downgraded by a later retake;
 * - the LMS raw score never decreases below the prior/best score;
 * - retake setup does not temporarily reset an already-passed learner to incomplete;
 * - failed-attempt feedback may be reviewed, but a new retake clears every answer,
 *   answer-state class, per-question feedback, and prior result display.
 */
export function hardenUniversalAssessmentRuntime(originalCode: string): UniversalPassTransformResult {
  let code = originalCode;
  const changes: string[] = [];
  const audits: UniversalPassTransformResult['audits'] = [];

  const submitBlock = findFunctionBlock(code, SUBMIT_PATTERN);
  if (!submitBlock) {
    return {
      code,
      modified: false,
      changes,
      audits: [{
        patternExpected: 'submitAssessment function',
        matchFound: false,
        replacementApplied: false,
        reason: 'Legacy Universal assessment submission function not found',
      }],
    };
  }

  const originalRetryBlock = findFunctionBlock(code, RETRY_PATTERN);
  const originalUnsafeDirectResubmit = hasUnsafeDirectResubmit(submitBlock.block.body);
  const originalUnsafeSelectiveRetry = Boolean(originalRetryBlock && hasUnsafeSelectiveRetry(originalRetryBlock.block.body));
  const originalRetryAlreadyFullReset = Boolean(originalRetryBlock && hasFullRetakeReset(originalRetryBlock.block.body));

  let body = submitBlock.block.body;
  let changed = false;

  // Historical Universal fix #1: capture prior authoritative Workday result.
  if (!body.includes('__scormifyPriorLessonStatus')) {
    const attemptAnchor = /window\.assessmentData\.attempts\+\+\s*;/;
    const attemptMatch = attemptAnchor.exec(body);
    if (attemptMatch) {
      const stateCapture = `
        // SCORMIFY UNIVERSAL WORKDAY: capture authoritative prior LMS result before retake mutations
        const __scormifyPriorLessonStatus = String(SafeSCORM.getValue('cmi.core.lesson_status') || '').toLowerCase();
        const __scormifyPriorRawScoreParsed = parseFloat(SafeSCORM.getValue('cmi.core.score.raw'));
        const __scormifyPriorRawScore = Number.isFinite(__scormifyPriorRawScoreParsed) ? __scormifyPriorRawScoreParsed : 0;
        const __scormifyPriorPassed = __scormifyPriorLessonStatus === 'passed' || __scormifyPriorRawScore >= passingScore;
`;
      body = body.slice(0, attemptMatch.index) + stateCapture + body.slice(attemptMatch.index);
      changed = true;
      changes.push('Captured prior LMS lesson_status and raw score before retake mutations');
      audits.push({ patternExpected: 'assessment attempt increment anchor', matchFound: true, replacementApplied: true });
    } else {
      audits.push({
        patternExpected: 'window.assessmentData.attempts++',
        matchFound: false,
        replacementApplied: false,
        reason: 'Could not safely insert prior LMS state capture',
      });
    }
  } else {
    audits.push({
      patternExpected: 'prior LMS state capture',
      matchFound: true,
      replacementApplied: false,
      reason: 'Already hardened',
    });
  }

  if (body.includes('__scormifyPriorLessonStatus')) {
    // Historical Universal fix #2: do not reset an already-passed learner to incomplete.
    const retakeReset = /if\s*\(\s*window\.assessmentData\.attempts\s*>\s*1\s*\)\s*\{/;
    if (retakeReset.test(body) && !/attempts\s*>\s*1\s*&&\s*!__scormifyPriorPassed/.test(body)) {
      body = body.replace(retakeReset, 'if (window.assessmentData.attempts > 1 && !__scormifyPriorPassed) {');
      changed = true;
      changes.push('Prevented retake setup from resetting an already-passed learner to incomplete');
      audits.push({ patternExpected: 'retake incomplete reset', matchFound: true, replacementApplied: true });
    }

    // Historical Universal fix #3: preserve authoritative best LMS raw score.
    const bestScorePattern = /const\s+bestScore\s*=\s*Math\.max\s*\(\s*\.\.\.window\.assessmentData\.scores\s*\)\s*;/;
    if (bestScorePattern.test(body)) {
      body = body.replace(
        bestScorePattern,
        'const bestScore = Math.max(...window.assessmentData.scores, __scormifyPriorRawScore);'
      );
      changed = true;
      changes.push('Included authoritative prior LMS raw score in best-score reporting');
      audits.push({ patternExpected: 'bestScore from assessmentData.scores', matchFound: true, replacementApplied: true });
    } else if (body.includes('__scormifyPriorRawScore') && /Math\.max\([^)]*__scormifyPriorRawScore/.test(body)) {
      audits.push({ patternExpected: 'best score includes prior LMS score', matchFound: true, replacementApplied: false, reason: 'Already hardened' });
    }

    // Historical Universal fix #4: a later lower retake cannot downgrade a prior pass.
    const failStatusPattern = /SafeSCORM\.setStatus\s*\(\s*\{\s*success\s*:\s*['"]failed['"]\s*\}\s*\)\s*;/;
    if (failStatusPattern.test(body) && !body.includes('SCORMIFY UNIVERSAL WORKDAY: preserve prior pass')) {
      const replacement = `if (__scormifyPriorPassed || bestScore >= passingScore) {
                    // SCORMIFY UNIVERSAL WORKDAY: preserve prior pass/best score after a lower retake
                    SafeSCORM.setStatus({ completion: 'completed', success: 'passed' });
                    console.log('[Scormify] Lower retake did not downgrade prior passing LMS status');
                } else {
                    SafeSCORM.setStatus({ success: 'failed' });
                }`;
      body = body.replace(failStatusPattern, replacement);
      changed = true;
      changes.push('Guarded failed retake status so a prior/best passing result remains passed');
      audits.push({ patternExpected: "SafeSCORM.setStatus({ success: 'failed' })", matchFound: true, replacementApplied: true });
    } else if (body.includes('SCORMIFY UNIVERSAL WORKDAY: preserve prior pass')) {
      audits.push({ patternExpected: 'prior-pass preservation guard', matchFound: true, replacementApplied: false, reason: 'Already hardened' });
    }
  }

  // New additive Universal fix: direct resubmission after failure is not a new full attempt.
  if (originalUnsafeDirectResubmit && !body.includes(SHOW_RETAKE_MARKER)) {
    const directFix = replaceFailureDirectResubmit(body);
    if (directFix.changed) {
      body = directFix.body;
      changed = true;
      changes.push('Replaced failed-attempt direct resubmission with an explicit Retake Assessment gate');
      audits.push({ patternExpected: 'failed attempt direct resubmission', matchFound: true, replacementApplied: true });
    } else {
      audits.push({
        patternExpected: 'failed attempt direct resubmission',
        matchFound: true,
        replacementApplied: false,
        reason: 'Unsafe direct-resubmit behavior was detected but no known safe replacement anchor matched',
      });
    }
  } else {
    audits.push({
      patternExpected: 'failed attempt direct resubmission',
      matchFound: originalUnsafeDirectResubmit || body.includes(SHOW_RETAKE_MARKER),
      replacementApplied: false,
      reason: originalUnsafeDirectResubmit ? 'Already hardened' : 'Unsafe direct resubmission not detected',
    });
  }

  if (changed) {
    code = code.slice(0, submitBlock.block.contentStart) + body + code.slice(submitBlock.block.contentEnd);
  }

  // Add the explicit retake-button helper only for the known direct-resubmission family.
  if (originalUnsafeDirectResubmit && !code.includes(SHOW_RETAKE_HELPER_DEFINITION)) {
    const refreshedSubmit = findFunctionBlock(code, SUBMIT_PATTERN);
    if (refreshedSubmit) {
      code = code.slice(0, refreshedSubmit.block.end) + '\n' + SHOW_RETAKE_HELPER + code.slice(refreshedSubmit.block.end);
      changed = true;
      changes.push('Added deterministic Retake Assessment button helper');
    }
  }

  // A retake in this Universal family must always start blank. Replace selective
  // retry behavior, or inject the reset handler when direct resubmission had bypassed it.
  const retryBlock = findFunctionBlock(code, RETRY_PATTERN);
  if (retryBlock) {
    const retryNeedsRepair = originalUnsafeSelectiveRetry || !hasFullRetakeReset(retryBlock.block.body);
    if (retryNeedsRepair) {
      const fullRetryBody = findFunctionBlock(FULL_RETAKE_FUNCTION, RETRY_PATTERN);
      if (!fullRetryBody) throw new Error('Internal full-retake template could not be parsed');
      code = code.slice(0, retryBlock.block.contentStart) + fullRetryBody.block.body + code.slice(retryBlock.block.contentEnd);
      changed = true;
      changes.push('Normalized retryAssessment to clear every response, feedback item, answer style, and prior result');
      audits.push({ patternExpected: 'full blank retryAssessment reset', matchFound: true, replacementApplied: true });
    } else {
      audits.push({ patternExpected: 'full blank retryAssessment reset', matchFound: true, replacementApplied: false, reason: 'Already safe' });
    }
  } else if (originalUnsafeDirectResubmit) {
    const refreshedSubmit = findFunctionBlock(code, SUBMIT_PATTERN);
    if (refreshedSubmit) {
      code = code.slice(0, refreshedSubmit.block.end) + '\n' + FULL_RETAKE_FUNCTION + code.slice(refreshedSubmit.block.end);
      changed = true;
      changes.push('Added full blank retryAssessment handler for direct-resubmission Universal runtime');
      audits.push({ patternExpected: 'retryAssessment function', matchFound: false, replacementApplied: true, reason: 'Injected deterministic full-retake handler' });
    }
  } else if (originalRetryAlreadyFullReset) {
    audits.push({ patternExpected: 'full blank retryAssessment reset', matchFound: true, replacementApplied: false, reason: 'Already safe' });
  }

  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after Universal assessment hardening: ${err.message}`);
  }

  return { code, modified: changed, changes, audits };
}

export function validateUniversalPassPreservation(
  updatedFilesMap: Record<string, string>
): { passed: boolean; file: string; details: string } {
  const candidate = Object.entries(updatedFilesMap).find(([, content]) =>
    Boolean(content && /submitAssessment\s*=\s*(?:async\s+)?function|function\s+submitAssessment/.test(content))
  );

  if (!candidate) {
    return {
      passed: true,
      file: 'scripts/navigation.js',
      details: 'PASS — no legacy submitAssessment retake runtime detected; prior-pass retake invariant is not applicable to this Universal package',
    };
  }

  const [file, content] = candidate;
  const block = findFunctionBlock(content, SUBMIT_PATTERN);
  if (!block) {
    return { passed: false, file, details: 'FAIL — submitAssessment function could not be structurally parsed' };
  }

  const body = block.block.body;
  const hasPriorStatus = body.includes("SafeSCORM.getValue('cmi.core.lesson_status')") && body.includes('__scormifyPriorPassed');
  const hasPriorScore = body.includes("SafeSCORM.getValue('cmi.core.score.raw')") && /Math\.max\([^)]*__scormifyPriorRawScore/.test(body);
  const resetGuarded = /attempts\s*>\s*1\s*&&\s*!__scormifyPriorPassed/.test(body);
  const failGuarded = /__scormifyPriorPassed\s*\|\|\s*bestScore\s*>=\s*passingScore/.test(body) &&
    body.includes("SafeSCORM.setStatus({ completion: 'completed', success: 'passed' })");

  const passed = hasPriorStatus && hasPriorScore && resetGuarded && failGuarded;
  return {
    passed,
    file,
    details: passed
      ? 'PASS — Universal assessment preserves prior passed status and authoritative best score across lower retakes'
      : `FAIL — Universal retake preservation incomplete (priorStatus=${hasPriorStatus}, priorScore=${hasPriorScore}, resetGuard=${resetGuarded}, failedRetakeGuard=${failGuarded})`,
  };
}

/**
 * Additive validation for the newer tester finding. This does not replace any
 * historic validator rule. It applies only when the legacy Universal
 * submitAssessment runtime is present.
 */
export function validateUniversalFullRetakeReset(
  updatedFilesMap: Record<string, string>
): { passed: boolean; file: string; details: string } {
  const candidate = Object.entries(updatedFilesMap).find(([, content]) =>
    Boolean(content && /submitAssessment\s*=\s*(?:async\s+)?function|function\s+submitAssessment/.test(content))
  );

  if (!candidate) {
    return {
      passed: true,
      file: 'scripts/navigation.js',
      details: 'PASS — no legacy Universal submitAssessment retake runtime detected; full-retake reset rule is not applicable',
    };
  }

  const [file, content] = candidate;
  const submitBlock = findFunctionBlock(content, SUBMIT_PATTERN);
  if (!submitBlock) {
    return { passed: false, file, details: 'FAIL — submitAssessment function could not be structurally parsed for full-retake validation' };
  }

  const retryBlock = findFunctionBlock(content, RETRY_PATTERN);
  const submitBody = submitBlock.block.body;
  const retryBody = retryBlock?.block.body || '';

  const unsafeDirectResubmit = hasUnsafeDirectResubmit(submitBody);
  const unsafeSelectiveRetry = retryBlock ? hasUnsafeSelectiveRetry(retryBody) : false;
  const explicitRetakeGate = content.includes(SHOW_RETAKE_MARKER) && /Retake Assessment/.test(content);
  const fullReset = Boolean(retryBlock && hasFullRetakeReset(retryBody));
  const requiresAllAnswers = /answered\s*<\s*questions\.length|answered\s*!==?\s*questions\.length|answered\s*!=\s*questions\.length/.test(submitBody);

  // Some Universal packages expose no retry/direct-resubmit behavior at all. Do not
  // manufacture a new UX for those older variants; their historical rules remain authoritative.
  const retakeBehaviorDetected = explicitRetakeGate || retryBlock !== null || unsafeDirectResubmit;
  if (!retakeBehaviorDetected) {
    return {
      passed: true,
      file,
      details: 'PASS — no Universal retake/direct-resubmit behavior detected; full-retake reset rule is not applicable',
    };
  }

  const passed = !unsafeDirectResubmit && !unsafeSelectiveRetry && explicitRetakeGate && fullReset && requiresAllAnswers;
  return {
    passed,
    file,
    details: passed
      ? 'PASS — failed Universal assessment requires Retake Assessment; all prior answers/feedback are cleared and every question must be answered again'
      : `FAIL — Universal full-retake reset incomplete (directResubmit=${unsafeDirectResubmit}, selectiveRetry=${unsafeSelectiveRetry}, retakeGate=${explicitRetakeGate}, fullReset=${fullReset}, allAnswersRequired=${requiresAllAnswers})`,
  };
}
