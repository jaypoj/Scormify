import {
  CodeChange,
  CrossProfileWorkdayFindings,
  PatchPatternAudit,
  RepairProfile,
  ValidationItem,
} from '../types';
import { findFunctionBlock } from './braceScanner';

const KNOWN_PROFILES: RepairProfile[] = [
  'KNOWN_SCORM12_COMPACT_QUIZ_80_V1',
  'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1',
  'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1',
];

const EXIT_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: exit-course integrity';
const COMPACT_RETAKE_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: full final-assessment retake';
const FEEDBACK_PROTECTION_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: failed-final-assessment feedback protected';
const UNIVERSAL_FULL_RETAKE_MARKER = 'SCORMIFY UNIVERSAL WORKDAY: full assessment retake reset';
const UNIVERSAL_RETAKE_GATE_MARKER = 'SCORMIFY UNIVERSAL WORKDAY: explicit full-retake gate';

const SUBMIT_ASSESSMENT_PATTERN = /(?:window\.)?submitAssessment\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{|(?:async\s+)?function\s+submitAssessment\s*\([^)]*\)\s*\{/i;
const SUBMIT_QUIZ_PATTERN = /(?:window\.)?submitQuiz\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{|(?:async\s+)?function\s+submitQuiz\s*\([^)]*\)\s*\{/i;

export interface CrossProfileHardeningResult {
  updatedContents: Record<string, string>;
  filesModified: string[];
  codeChanges: CodeChange[];
  audits: PatchPatternAudit[];
  logs: string[];
  before: CrossProfileWorkdayFindings;
  after: CrossProfileWorkdayFindings;
}

function isKnownProfile(profile: RepairProfile): boolean {
  return KNOWN_PROFILES.includes(profile);
}

function getLaunchHtmlPath(
  fileContents: Record<string, string>,
  launchResource?: string | null
): string | null {
  if (launchResource && fileContents[launchResource]) return launchResource;
  const exactIndex = Object.keys(fileContents).find((p) => p.toLowerCase() === 'index.html');
  if (exactIndex) return exactIndex;
  const nestedIndex = Object.keys(fileContents).find((p) => p.toLowerCase().endsWith('/index.html'));
  if (nestedIndex) return nestedIndex;
  return Object.keys(fileContents).find((p) => /\.html?$/i.test(p)) || null;
}

function getNavigationCandidates(fileContents: Record<string, string>): string[] {
  const js = Object.keys(fileContents).filter((p) => p.toLowerCase().endsWith('.js'));
  const navigation = js.filter((p) => p.toLowerCase().includes('nav'));
  return navigation.length ? navigation : js.filter((p) => !p.toLowerCase().includes('scorm-api'));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isExitLikeControl(openingTag: string, innerHtml: string): boolean {
  const descriptor = `${openingTag} ${stripHtml(innerHtml)}`.toLowerCase();
  return (
    descriptor.includes('exit course') ||
    descriptor.includes('save & exit') ||
    descriptor.includes('save &amp; exit') ||
    descriptor.includes('close course') ||
    descriptor.includes('exit-course') ||
    descriptor.includes('save-exit') ||
    descriptor.includes('btn-quiz-exit') ||
    descriptor.includes('scorm-header-save-exit') ||
    descriptor.includes('scormify-exit-course')
  );
}

function hasVisibleExitControl(html: string): boolean {
  const tagPattern = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const opening = `<${match[1]}${match[2]}>`;
    if (!isExitLikeControl(opening, match[3])) continue;
    if (/\bdisabled\b/i.test(opening)) continue;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(opening)) continue;
    return true;
  }
  return html.includes(EXIT_MARKER) && html.includes('scormify-exit-course');
}

function findExitFunctionBody(source: string): string | null {
  const patterns = [
    /function\s+scormifyExitCourse\s*\([^)]*\)\s*\{/i,
    /function\s+saveAndExitCourse\s*\([^)]*\)\s*\{/i,
    /function\s+exitCourse\s*\([^)]*\)\s*\{/i,
    /window\.scormifyExitCourse\s*=\s*function\s*\([^)]*\)\s*\{/i,
    /window\.exitCourse\s*=\s*function\s*\([^)]*\)\s*\{/i,
  ];
  for (const pattern of patterns) {
    const block = findFunctionBlock(source, pattern);
    if (block) return block.block.body;
  }
  return null;
}

function exitBodyIsSafe(body: string | null): boolean {
  if (!body) return false;
  const setsSuspend = /cmi\.core\.exit[\s\S]{0,180}['"]suspend['"]/i.test(body);
  const commits = /(?:\.commit\s*\(|LMSCommit\s*\()/i.test(body);
  const finishes = /(?:\.finish\s*\(|LMSFinish\s*\()/i.test(body);
  const writesStatus = /(?:cmi\.core\.lesson_status|cmi\.completion_status|cmi\.success_status)[\s\S]{0,140}(?:completed|passed|failed)/i.test(body);
  return setsSuspend && commits && finishes && !writesStatus;
}

function hasSafeExitHandler(fileContents: Record<string, string>): boolean {
  for (const source of Object.values(fileContents)) {
    if (!source) continue;
    if (source.includes(EXIT_MARKER) && source.includes('scormifyExitCourse')) return true;
    const body = findExitFunctionBody(source);
    if (exitBodyIsSafe(body)) return true;
  }
  return false;
}

function hasExitWiring(fileContents: Record<string, string>, launchHtmlPath: string | null): boolean {
  const html = launchHtmlPath ? (fileContents[launchHtmlPath] || '') : '';
  if (/onclick\s*=\s*['"][^'"]*(?:exitCourse|saveAndExitCourse|scormifyExitCourse)\s*\(/i.test(html)) return true;
  if (html.includes(EXIT_MARKER) && html.includes('scormifyExitCourse')) return true;

  const combined = Object.values(fileContents).join('\n');
  return (
    /(?:exit-course|save-exit|btn-quiz-exit)[\s\S]{0,500}addEventListener\s*\(\s*['"]click['"]/i.test(combined) &&
    /(?:exitCourse|saveAndExitCourse|scormifyExitCourse)\s*\(/i.test(combined)
  );
}

function hasFinalAssessmentRuntime(fileContents: Record<string, string>): boolean {
  const combined = Object.values(fileContents).join('\n');
  const hasSubmit = SUBMIT_ASSESSMENT_PATTERN.test(combined) || SUBMIT_QUIZ_PATTERN.test(combined);
  const hasAssessmentUi =
    /assessment-card|question-container|Final Assessment|assessment-result|score-message/i.test(combined);
  return hasSubmit && hasAssessmentUi;
}

function activeSubmitBodies(fileContents: Record<string, string>): string[] {
  const bodies: string[] = [];
  for (const source of Object.values(fileContents)) {
    if (!source) continue;
    for (const pattern of [SUBMIT_ASSESSMENT_PATTERN, SUBMIT_QUIZ_PATTERN]) {
      const block = findFunctionBlock(source, pattern);
      if (block) bodies.push(block.block.body);
    }
  }
  return bodies;
}

function hasSafeFullRetake(fileContents: Record<string, string>, profile: RepairProfile): boolean {
  if (!hasFinalAssessmentRuntime(fileContents)) return true;
  const combined = Object.values(fileContents).join('\n');

  if (combined.includes(COMPACT_RETAKE_MARKER)) return true;

  if (profile === 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1') {
    const hasUniversalReset = combined.includes(UNIVERSAL_FULL_RETAKE_MARKER) && /checked\s*=\s*false/.test(combined);
    const hasGate = combined.includes(UNIVERSAL_RETAKE_GATE_MARKER) && /Retake Assessment/.test(combined);
    const allAnswersRequired = /answered\s*<\s*questions\.length|answered\s*!==?\s*questions\.length|answered\s*!=\s*questions\.length/.test(combined);
    return hasUniversalReset && hasGate && allAnswersRequired;
  }

  if (profile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {
    const bodies = activeSubmitBodies(fileContents);
    const activeAssessmentIsHardened = bodies.length > 0 && bodies.every((body) =>
      body.includes('ISSUE1_ASSESSMENT_PRESERVATION') || body.includes('showAssessmentModal')
    );
    const clearsAll = /Retake Assessment/.test(combined) && /checked\s*=\s*false/.test(combined);
    return activeAssessmentIsHardened && clearsAll;
  }

  return false;
}

function hasSafeFeedbackProtection(fileContents: Record<string, string>, profile: RepairProfile): boolean {
  if (!hasFinalAssessmentRuntime(fileContents)) return true;
  const combined = Object.values(fileContents).join('\n');
  if (combined.includes(FEEDBACK_PROTECTION_MARKER)) return true;

  if (profile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {
    const bodies = activeSubmitBodies(fileContents);
    return bodies.length > 0 && bodies.every((body) =>
      body.includes('ISSUE1_ASSESSMENT_PRESERVATION') && body.includes('showAssessmentModal') && !/gradeQuestion\s*\(/.test(body)
    );
  }

  return false;
}

export function analyzeCrossProfileWorkdayIntegrity(
  fileContents: Record<string, string>,
  profile: RepairProfile,
  launchResource?: string | null
): CrossProfileWorkdayFindings {
  if (!isKnownProfile(profile)) {
    return {
      exitControl: 'NOT_APPLICABLE',
      exitHandler: 'NOT_APPLICABLE',
      exitWiring: 'NOT_APPLICABLE',
      assessmentRetake: 'NOT_APPLICABLE',
      assessmentFeedbackProtection: 'NOT_APPLICABLE',
    };
  }

  const launchHtmlPath = getLaunchHtmlPath(fileContents, launchResource);
  const launchHtml = launchHtmlPath ? (fileContents[launchHtmlPath] || '') : '';
  const assessmentApplies = hasFinalAssessmentRuntime(fileContents);

  return {
    exitControl: hasVisibleExitControl(launchHtml) ? 'PRESENT' : 'MISSING',
    exitHandler: hasSafeExitHandler(fileContents) ? 'SAFE' : 'MISSING_OR_UNSAFE',
    exitWiring: hasExitWiring(fileContents, launchHtmlPath) ? 'WIRED' : 'MISSING_OR_BROKEN',
    assessmentRetake: assessmentApplies
      ? (hasSafeFullRetake(fileContents, profile) ? 'SAFE' : 'UNSAFE')
      : 'NOT_APPLICABLE',
    assessmentFeedbackProtection: assessmentApplies
      ? (hasSafeFeedbackProtection(fileContents, profile) ? 'SAFE' : 'UNSAFE')
      : 'NOT_APPLICABLE',
  };
}

export function hasBlockingCrossProfileFinding(findings: CrossProfileWorkdayFindings): boolean {
  return (
    findings.exitControl === 'MISSING' ||
    findings.exitHandler === 'MISSING_OR_UNSAFE' ||
    findings.exitWiring === 'MISSING_OR_BROKEN' ||
    findings.assessmentRetake === 'UNSAFE' ||
    findings.assessmentFeedbackProtection === 'UNSAFE'
  );
}

const CANONICAL_EXIT_SCRIPT = `
<script id="scormify-exit-integrity">
/* ${EXIT_MARKER} */
(function() {
  function getAdapter() {
    if (window.SafeSCORM && typeof window.SafeSCORM.setValue === 'function') {
      return {
        set: function(k, v) { return window.SafeSCORM.setValue(k, v); },
        commit: function() { return typeof window.SafeSCORM.commit === 'function' ? window.SafeSCORM.commit() : true; },
        finish: function() { return typeof window.SafeSCORM.finish === 'function' ? window.SafeSCORM.finish() : true; }
      };
    }
    if (window.SCORM && typeof window.SCORM.set === 'function') {
      return {
        set: function(k, v) { return window.SCORM.set(k, v); },
        commit: function() { return typeof window.SCORM.commit === 'function' ? window.SCORM.commit() : true; },
        finish: function() { return typeof window.SCORM.finish === 'function' ? window.SCORM.finish() : true; }
      };
    }
    if (window.UniversalSCORM && typeof window.UniversalSCORM.setValue === 'function') {
      return {
        set: function(k, v) { return window.UniversalSCORM.setValue(k, v); },
        commit: function() { return typeof window.UniversalSCORM.commit === 'function' ? window.UniversalSCORM.commit() : true; },
        finish: function() { return typeof window.UniversalSCORM.finish === 'function' ? window.UniversalSCORM.finish() : true; }
      };
    }
    if (window.API && typeof window.API.LMSSetValue === 'function') {
      return {
        set: function(k, v) { return window.API.LMSSetValue(k, String(v)); },
        commit: function() { return typeof window.API.LMSCommit === 'function' ? window.API.LMSCommit('') : true; },
        finish: function() { return typeof window.API.LMSFinish === 'function' ? window.API.LMSFinish('') : true; }
      };
    }
    return null;
  }

  function showExitFallback() {
    if (!document || !document.body) return;
    var existing = document.getElementById('scormify-exit-saved-message');
    if (existing) return;
    var overlay = document.createElement('div');
    overlay.id = 'scormify-exit-saved-message';
    overlay.setAttribute('role', 'status');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.88);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,sans-serif;text-align:center;color:#fff;';
    overlay.innerHTML = '<div style="max-width:480px;background:#1e293b;border:1px solid #475569;border-radius:12px;padding:24px 28px;"><h2 style="font-size:20px;margin:0 0 8px;">Course Progress Saved</h2><p style="margin:0;color:#cbd5e1;line-height:1.5;">Your course session has been saved and closed with the LMS. If this window does not close automatically, use Workday\'s close control to return to Learning.</p></div>';
    document.body.appendChild(overlay);
  }

  window.scormifyExitCourse = function(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (window.__scormifyExitInProgress) return false;
    window.__scormifyExitInProgress = true;

    try {
      if (typeof window.saveProgress === 'function') window.saveProgress();
      else if (typeof window.save === 'function') window.save();
    } catch (saveError) {
      console.warn('[Scormify] Pre-exit save notice:', saveError);
    }

    var adapter = getAdapter();
    if (adapter) {
      try { adapter.set('cmi.core.exit', 'suspend'); } catch (_) {}
      try { adapter.commit(); } catch (_) {}
      try { adapter.finish(); } catch (_) {}
    }

    window.__scormifySessionTerminated = true;
    setTimeout(function() {
      try { window.close(); } catch (_) {}
      setTimeout(function() {
        if (!window.closed) showExitFallback();
      }, 250);
    }, 50);
    return false;
  };
})();
</script>`;

const CANONICAL_EXIT_BUTTON = `<button id="scormify-exit-course" class="scormify-exit-course" type="button" onclick="return scormifyExitCourse(event)" aria-label="Exit Course" title="Exit Course" style="display:inline-flex;visibility:visible;opacity:1;align-items:center;gap:6px;flex-shrink:0;margin-left:auto;padding:7px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#ffffff;color:#334155;font:600 12px/1.2 system-ui,-apple-system,sans-serif;cursor:pointer;white-space:nowrap;">Exit Course</button>`;

function injectOrRepairExitHtml(html: string): { html: string; changed: boolean; description: string } {
  let updated = html;
  let changed = false;
  let repairedExisting = false;

  const tagPattern = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  updated = updated.replace(tagPattern, (full, tagName: string, attrs: string, inner: string) => {
    if (repairedExisting || !isExitLikeControl(`<${tagName}${attrs}>`, inner)) return full;
    repairedExisting = true;
    let newAttrs = attrs.replace(/\s+onclick\s*=\s*(['"])[\s\S]*?\1/i, '');
    newAttrs = newAttrs.replace(/\s+disabled(?:\s*=\s*(['"])[^'"]*\1)?/i, '');
    if (/style\s*=\s*(['"])/i.test(newAttrs)) {
      newAttrs = newAttrs.replace(/style\s*=\s*(['"])([\s\S]*?)\1/i, (_m: string, quote: string, style: string) => {
        const cleaned = style
          .replace(/display\s*:\s*none\s*;?/gi, '')
          .replace(/visibility\s*:\s*hidden\s*;?/gi, '')
          .replace(/opacity\s*:\s*0\s*;?/gi, '');
        return `style=${quote}${cleaned}${quote}`;
      });
    }
    changed = true;
    return `<${tagName}${newAttrs} onclick="return scormifyExitCourse(event)" data-scormify-exit-bound="true">${inner}</${tagName}>`;
  });

  if (!repairedExisting) {
    if (/<\/header>/i.test(updated)) {
      updated = updated.replace(/<\/header>/i, `${CANONICAL_EXIT_BUTTON}\n</header>`);
    } else if (/<body\b[^>]*>/i.test(updated)) {
      updated = updated.replace(/(<body\b[^>]*>)/i, `$1\n<div style="position:fixed;top:10px;right:12px;z-index:2147483000;">${CANONICAL_EXIT_BUTTON}</div>`);
    } else {
      updated = `${CANONICAL_EXIT_BUTTON}\n${updated}`;
    }
    changed = true;
  }

  if (!updated.includes(EXIT_MARKER)) {
    if (/<\/body>/i.test(updated)) updated = updated.replace(/<\/body>/i, `${CANONICAL_EXIT_SCRIPT}\n</body>`);
    else updated += `\n${CANONICAL_EXIT_SCRIPT}`;
    changed = true;
  }

  return {
    html: updated,
    changed,
    description: repairedExisting
      ? 'Rewired existing Exit Course control to the canonical Workday-safe exit handler'
      : 'Injected persistent Exit Course control and canonical Workday-safe exit handler',
  };
}

const COMPACT_ASSESSMENT_HELPERS = `
/* ${FEEDBACK_PROTECTION_MARKER} */
function scormifyProtectFailedFinalAssessmentFeedback() {
  if (typeof document === 'undefined') return;
  var feedbacks = document.querySelectorAll('.assessment-card .feedback, .question-container .feedback, [id*="assessment-feedback"]');
  for (var i = 0; i < feedbacks.length; i++) {
    feedbacks[i].textContent = '';
    if ('innerHTML' in feedbacks[i]) feedbacks[i].innerHTML = '';
    if (feedbacks[i].style) feedbacks[i].style.display = 'none';
    if (feedbacks[i].classList) feedbacks[i].classList.remove('correct', 'incorrect', 'correct-feedback', 'incorrect-feedback', 'success', 'error');
  }
  var marks = document.querySelectorAll('.correct-answer, .incorrect-answer, .option.correct, .option.incorrect, .question.correct, .question.incorrect');
  for (var m = 0; m < marks.length; m++) {
    if (marks[m].classList) marks[m].classList.remove('correct-answer', 'incorrect-answer', 'correct', 'incorrect');
  }
}

function scormifyPrepareFullFinalAssessmentRetake() {
  // ${COMPACT_RETAKE_MARKER}
  if (typeof document === 'undefined') return;
  scormifyProtectFailedFinalAssessmentFeedback();

  var root = document.querySelector('.assessment-card') || document.querySelector('[data-assessment]') || document.body;
  var submitButton = root && root.querySelector
    ? (root.querySelector('button[onclick*="submitAssessment"]') || root.querySelector('button[onclick*="submitQuiz"]') || root.querySelector('.submit-assessment') || root.querySelector('.check-button'))
    : null;
  if (submitButton && submitButton.style) submitButton.style.display = 'none';

  var retryButton = document.getElementById('scormify-retake-assessment');
  if (!retryButton && document.createElement) {
    retryButton = document.createElement('button');
    retryButton.id = 'scormify-retake-assessment';
    retryButton.type = 'button';
    retryButton.textContent = 'Retake Assessment';
    retryButton.className = 'check-button scormify-retake-assessment';
    retryButton.style.cssText = 'margin-top:12px;padding:9px 16px;border:0;border-radius:6px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer;';
    if (submitButton && submitButton.parentNode) submitButton.parentNode.insertBefore(retryButton, submitButton.nextSibling);
    else if (root && root.appendChild) root.appendChild(retryButton);
  }

  if (retryButton) {
    retryButton.style.display = '';
    retryButton.onclick = function(event) {
      if (event && event.preventDefault) event.preventDefault();
      var inputs = document.querySelectorAll('.assessment-card input[type="radio"], .assessment-card input[type="checkbox"], .question-container input[type="radio"], .question-container input[type="checkbox"]');
      for (var i = 0; i < inputs.length; i++) {
        inputs[i].checked = false;
        inputs[i].disabled = false;
        if (inputs[i].removeAttribute) inputs[i].removeAttribute('aria-invalid');
      }
      scormifyProtectFailedFinalAssessmentFeedback();
      var result = document.getElementById('assessment-result') || document.getElementById('assessment-results');
      if (result) {
        result.textContent = '';
        if (result.classList) result.classList.remove('pass', 'fail', 'passed', 'failed', 'success', 'error');
        if (result.style) result.style.display = '';
      }
      retryButton.style.display = 'none';
      if (submitButton) {
        if (submitButton.style) submitButton.style.display = '';
        submitButton.disabled = false;
        submitButton.textContent = 'Submit Assessment';
      }
      if (window.assessmentData) window.assessmentData.lastAnswers = {};
      if (inputs.length && typeof inputs[0].focus === 'function') inputs[0].focus();
    };
  }
}
`;

function hardenKnownCompactFinalAssessment(code: string): { code: string; changed: boolean; description?: string } {
  if (code.includes(COMPACT_RETAKE_MARKER) && code.includes(FEEDBACK_PROTECTION_MARKER)) {
    return { code, changed: false };
  }

  let pattern = SUBMIT_ASSESSMENT_PATTERN;
  let block = findFunctionBlock(code, pattern);
  let functionName = 'submitAssessment';
  if (!block) {
    pattern = SUBMIT_QUIZ_PATTERN;
    block = findFunctionBlock(code, pattern);
    functionName = 'submitQuiz';
  }
  if (!block) return { code, changed: false };

  const body = block.block.body;
  const isKnownSimpleAssessment =
    /gradeQuestion\s*\(/.test(body) &&
    /querySelectorAll\s*\([^)]*(?:assessment-card|\.question)/i.test(body) &&
    /score\s*>=\s*80|passed\s*=\s*score\s*>=\s*80|passingScore\s*=\s*80/i.test(body);
  if (!isKnownSimpleAssessment) return { code, changed: false };

  const newBody = `
  // ${COMPACT_RETAKE_MARKER}
  const questions = Array.from(document.querySelectorAll('.assessment-card .question, .question-container'));
  const result = document.getElementById('assessment-result') || document.getElementById('assessment-results');
  const passingScore = 80;
  const unanswered = questions.filter(function(q) { return !q.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked, input:checked'); }).length;
  if (unanswered > 0) {
    if (result) {
      result.textContent = 'Please answer every assessment question before submitting.';
      result.className = 'assessment-result fail';
    }
    return;
  }

  const correct = questions.filter(function(q) { return gradeQuestion(q); }).length;
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  const currentPassed = score >= passingScore;

  var priorScore = 0;
  var priorStatus = '';
  if (typeof SCORM !== 'undefined' && SCORM) {
    if (typeof SCORM.get === 'function') {
      var priorRaw = parseFloat(SCORM.get('cmi.core.score.raw'));
      if (!isNaN(priorRaw)) priorScore = priorRaw;
      priorStatus = String(SCORM.get('cmi.core.lesson_status') || '').toLowerCase();
    }
  }
  var bestScore = Math.max(priorScore, score);
  var finalPassed = priorStatus === 'passed' || bestScore >= passingScore;

  if (typeof SCORM !== 'undefined' && SCORM && typeof SCORM.set === 'function') {
    SCORM.set('cmi.core.score.raw', bestScore);
    SCORM.set('cmi.core.score.min', 0);
    SCORM.set('cmi.core.score.max', 100);
    SCORM.set('cmi.core.lesson_status', finalPassed ? 'passed' : 'failed');
    if (typeof SCORM.commit === 'function') SCORM.commit();
  }

  if (result) {
    if (currentPassed) {
      result.textContent = 'Score: ' + score + '% - Passed';
      result.className = 'assessment-result pass';
    } else if (finalPassed) {
      result.textContent = 'Current attempt: ' + score + '%. Course remains passed. Best score: ' + bestScore + '%.';
      result.className = 'assessment-result pass';
    } else {
      result.textContent = 'Score: ' + score + '% - Not passed. Select Retake Assessment to begin a new attempt.';
      result.className = 'assessment-result fail';
    }
  }

  if (!currentPassed) scormifyPrepareFullFinalAssessmentRetake();
`;

  let updated = code.slice(0, block.block.contentStart) + newBody + code.slice(block.block.contentEnd);
  if (!updated.includes(FEEDBACK_PROTECTION_MARKER)) updated += `\n\n${COMPACT_ASSESSMENT_HELPERS}\n`;

  try {
    new Function(updated);
  } catch (err: any) {
    throw new Error(`Syntax error after cross-profile ${functionName} hardening: ${err.message}`);
  }

  return {
    code: updated,
    changed: true,
    description: `Hardened ${functionName} so failed attempts hide answer-revealing feedback, require an explicit full blank retake, preserve best score/pass, and require all questions to be answered`,
  };
}

function hardenUniversalFailedFeedback(code: string): { code: string; changed: boolean; description?: string } {
  if (!code.includes(UNIVERSAL_RETAKE_GATE_MARKER) || code.includes(FEEDBACK_PROTECTION_MARKER)) {
    return { code, changed: false };
  }
  const helper = findFunctionBlock(code, /window\.__scormifyShowFullRetake\s*=\s*function\s*\([^)]*\)\s*\{/i);
  if (!helper) return { code, changed: false };

  const protection = `
    // ${FEEDBACK_PROTECTION_MARKER}
    var __scormifyFeedback = document.querySelectorAll('.question-container .feedback, .assessment-card .feedback, [id*="assessment-feedback"]');
    __scormifyFeedback.forEach(function(feedback) {
        feedback.textContent = '';
        if ('innerHTML' in feedback) feedback.innerHTML = '';
        if (feedback.style) feedback.style.display = 'none';
        if (feedback.classList) feedback.classList.remove('correct', 'incorrect', 'correct-feedback', 'incorrect-feedback', 'success', 'error');
    });
    var __scormifyAnswerMarks = document.querySelectorAll('.correct-answer, .incorrect-answer, .option.correct, .option.incorrect, .question.correct, .question.incorrect');
    __scormifyAnswerMarks.forEach(function(mark) {
        if (mark.classList) mark.classList.remove('correct-answer', 'incorrect-answer', 'correct', 'incorrect');
    });
`;

  const newBody = protection + helper.block.body;
  const updated = code.slice(0, helper.block.contentStart) + newBody + code.slice(helper.block.contentEnd);
  try {
    new Function(updated);
  } catch (err: any) {
    throw new Error(`Syntax error after Universal feedback protection: ${err.message}`);
  }
  return {
    code: updated,
    changed: true,
    description: 'Protected failed final assessments from revealing answer feedback/correctness before a full retake begins',
  };
}

export function hardenCrossProfileWorkdayPackage(
  fileContents: Record<string, string>,
  profile: RepairProfile,
  launchResource?: string | null
): CrossProfileHardeningResult {
  const updatedContents = { ...fileContents };
  const filesModified: string[] = [];
  const codeChanges: CodeChange[] = [];
  const audits: PatchPatternAudit[] = [];
  const logs: string[] = [];
  const before = analyzeCrossProfileWorkdayIntegrity(updatedContents, profile, launchResource);

  if (!isKnownProfile(profile)) {
    return { updatedContents, filesModified, codeChanges, audits, logs, before, after: before };
  }

  const launchHtmlPath = getLaunchHtmlPath(updatedContents, launchResource);
  const exitNeedsRepair =
    before.exitControl === 'MISSING' ||
    before.exitHandler === 'MISSING_OR_UNSAFE' ||
    before.exitWiring === 'MISSING_OR_BROKEN';

  if (exitNeedsRepair && launchHtmlPath && updatedContents[launchHtmlPath]) {
    const original = updatedContents[launchHtmlPath];
    const exitRepair = injectOrRepairExitHtml(original);
    if (exitRepair.changed && exitRepair.html !== original) {
      updatedContents[launchHtmlPath] = exitRepair.html;
      filesModified.push(launchHtmlPath);
      codeChanges.push({
        filePath: launchHtmlPath,
        description: exitRepair.description,
        beforeSnippet: original.slice(0, 300),
        afterSnippet: exitRepair.html.slice(0, 300),
      });
      audits.push({
        filePath: launchHtmlPath,
        patternExpected: 'visible Exit Course control wired to a suspend/commit/finish handler',
        matchFound: before.exitControl === 'PRESENT',
        replacementApplied: true,
        contentChanged: true,
        reason: 'Missing or unsafe exit behavior normalized for Workday',
      });
      logs.push(`Cross-profile Exit Course integrity repaired in ${launchHtmlPath}`);
    }
  } else {
    audits.push({
      filePath: launchHtmlPath || 'index.html',
      patternExpected: 'visible Exit Course control wired to a suspend/commit/finish handler',
      matchFound: !exitNeedsRepair,
      replacementApplied: false,
      contentChanged: false,
      reason: exitNeedsRepair ? 'Launch HTML was not available for deterministic repair' : 'Existing Exit Course behavior already safe',
    });
  }

  const navCandidates = getNavigationCandidates(updatedContents);
  if (profile === 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1') {
    for (const filePath of navCandidates) {
      const original = updatedContents[filePath];
      if (!original) continue;
      const hardened = hardenKnownCompactFinalAssessment(original);
      if (hardened.changed && hardened.code !== original) {
        updatedContents[filePath] = hardened.code;
        if (!filesModified.includes(filePath)) filesModified.push(filePath);
        codeChanges.push({
          filePath,
          description: hardened.description || 'Hardened compact final-assessment retake behavior',
          beforeSnippet: original.slice(0, 300),
          afterSnippet: hardened.code.slice(0, 300),
        });
        audits.push({
          filePath,
          patternExpected: 'Compact final assessment requires a full blank retake and protects failed-answer feedback',
          matchFound: true,
          replacementApplied: true,
          contentChanged: true,
        });
        logs.push(`Cross-profile Compact final-assessment integrity repaired in ${filePath}`);
        break;
      }
    }
  }

  if (profile === 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1') {
    for (const filePath of navCandidates) {
      const original = updatedContents[filePath];
      if (!original) continue;
      const hardened = hardenUniversalFailedFeedback(original);
      if (hardened.changed && hardened.code !== original) {
        updatedContents[filePath] = hardened.code;
        if (!filesModified.includes(filePath)) filesModified.push(filePath);
        codeChanges.push({
          filePath,
          description: hardened.description || 'Protected Universal failed-assessment feedback',
          beforeSnippet: original.slice(0, 300),
          afterSnippet: hardened.code.slice(0, 300),
        });
        audits.push({
          filePath,
          patternExpected: 'Universal failed final assessment does not reveal correct-answer feedback before retake',
          matchFound: true,
          replacementApplied: true,
          contentChanged: true,
        });
        logs.push(`Cross-profile Universal failed-feedback protection applied in ${filePath}`);
        break;
      }
    }
  }

  const after = analyzeCrossProfileWorkdayIntegrity(updatedContents, profile, launchResource);
  return { updatedContents, filesModified, codeChanges, audits, logs, before, after };
}

export function validateCrossProfileWorkdayIntegrity(
  updatedFilesMap: Record<string, string>,
  profile: RepairProfile,
  launchResource?: string | null
): ValidationItem[] {
  if (!isKnownProfile(profile)) return [];
  const findings = analyzeCrossProfileWorkdayIntegrity(updatedFilesMap, profile, launchResource);

  const exitPassed =
    findings.exitControl === 'PRESENT' &&
    findings.exitHandler === 'SAFE' &&
    findings.exitWiring === 'WIRED';
  const retakePassed = findings.assessmentRetake !== 'UNSAFE';
  const feedbackPassed = findings.assessmentFeedbackProtection !== 'UNSAFE';

  return [
    {
      id: 60,
      title: 'Exit Course control is present and Workday-safe',
      ruleName: 'Cross-profile Exit Course Integrity',
      file: getLaunchHtmlPath(updatedFilesMap, launchResource) || 'index.html',
      passed: exitPassed,
      details: exitPassed
        ? 'PASS — visible Exit Course control is wired to a handler that sets cmi.core.exit=suspend, commits, finishes, preserves LMS status/score, and provides a close fallback'
        : `FAIL — Exit Course integrity incomplete (control=${findings.exitControl}, handler=${findings.exitHandler}, wiring=${findings.exitWiring})`,
    },
    {
      id: 61,
      title: 'Failed final assessment requires a full blank retake',
      ruleName: 'Cross-profile Full Assessment Retake Integrity',
      file: getNavigationCandidates(updatedFilesMap)[0] || 'scripts/navigation.js',
      passed: retakePassed,
      details: findings.assessmentRetake === 'NOT_APPLICABLE'
        ? 'PASS — no scored final-assessment retake runtime detected in this package'
        : (retakePassed
          ? 'PASS — a failed scored assessment cannot be directly corrected/resubmitted; the next attempt starts with all responses cleared and requires every question again'
          : 'FAIL — failed scored assessment can still retain or selectively correct prior responses'),
    },
    {
      id: 62,
      title: 'Failed final assessment does not reveal correct answers before retake',
      ruleName: 'Cross-profile Failed Assessment Feedback Protection',
      file: getNavigationCandidates(updatedFilesMap)[0] || 'scripts/navigation.js',
      passed: feedbackPassed,
      details: findings.assessmentFeedbackProtection === 'NOT_APPLICABLE'
        ? 'PASS — no scored final-assessment feedback path detected in this package'
        : (feedbackPassed
          ? 'PASS — failed final-assessment answer feedback/correctness styling is suppressed before a new retake; lesson knowledge-check feedback remains untouched'
          : 'FAIL — failed final assessment may expose answer-revealing feedback or correctness styling before retake'),
    },
  ];
}
