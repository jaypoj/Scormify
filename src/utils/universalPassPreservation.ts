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

/**
 * Harden the legacy UniversalSCORM/SafeSCORM assessment runtime without
 * replacing the package's assessment implementation.
 *
 * Invariants for SCORM 1.2:
 * - a prior passing result is never downgraded by a later retake;
 * - the LMS raw score never decreases below the prior/best score;
 * - retake setup does not temporarily reset an already-passed learner to incomplete.
 */
export function hardenUniversalAssessmentRuntime(originalCode: string): UniversalPassTransformResult {
  let code = originalCode;
  const changes: string[] = [];
  const audits: UniversalPassTransformResult['audits'] = [];

  const submitPattern = /(?:window\.)?submitAssessment\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{|(?:async\s+)?function\s+submitAssessment\s*\([^)]*\)\s*\{/i;
  const submitBlock = findFunctionBlock(code, submitPattern);
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

  let body = submitBlock.block.body;
  let changed = false;

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
    const retakeReset = /if\s*\(\s*window\.assessmentData\.attempts\s*>\s*1\s*\)\s*\{/;
    if (retakeReset.test(body) && !/attempts\s*>\s*1\s*&&\s*!__scormifyPriorPassed/.test(body)) {
      body = body.replace(retakeReset, 'if (window.assessmentData.attempts > 1 && !__scormifyPriorPassed) {');
      changed = true;
      changes.push('Prevented retake setup from resetting an already-passed learner to incomplete');
      audits.push({ patternExpected: 'retake incomplete reset', matchFound: true, replacementApplied: true });
    }

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

  if (changed) {
    code = code.slice(0, submitBlock.block.contentStart) + body + code.slice(submitBlock.block.contentEnd);
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

  // Some older UniversalSCORM packages use a simpler quiz implementation with no
  // submitAssessment/retake state machine. In that family this invariant is not
  // applicable; existing Universal exit/relaunch/threshold rules remain authoritative.
  if (!candidate) {
    return {
      passed: true,
      file: 'scripts/navigation.js',
      details: 'PASS — no legacy submitAssessment retake runtime detected; prior-pass retake invariant is not applicable to this Universal package',
    };
  }

  const [file, content] = candidate;
  const block = findFunctionBlock(
    content,
    /(?:window\.)?submitAssessment\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{|(?:async\s+)?function\s+submitAssessment\s*\([^)]*\)\s*\{/i
  );
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
