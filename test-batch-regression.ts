import {
  hardenUniversalAssessmentRuntime,
  validateUniversalPassPreservation,
} from './src/utils/universalPassPreservation';
import {
  analyzeCrossProfileWorkdayIntegrity,
  hardenCrossProfileWorkdayPackage,
  validateCrossProfileWorkdayIntegrity,
} from './src/utils/crossProfileWorkdayHardening';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const universalProfile = 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1' as const;
const statefulProfile = 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1' as const;

// ---------------------------------------------------------------------------
// U-BATCH — mirrors the four Universal failures in the 2026-09-15 batch log.
// The package is correctly hardened with an explicit full-retake gate/reset,
// but legacy non-executable prose containing "Submit Again" may remain. Rule 40
// must validate actionable behavior, not stale text.
// ---------------------------------------------------------------------------
const universalRaw = `
window.assessmentData = { attempts: 0, scores: [], lastAnswers: {} };
window.submitAssessment = async function() {
  const questions = document.querySelectorAll('.question-container');
  const answered = document.querySelectorAll('.question-container input:checked').length;
  if (answered < questions.length) return;
  const passingScore = 80;
  window.assessmentData.attempts++;
  if (window.assessmentData.attempts > 1) {
    SafeSCORM.setStatus({ completion: 'incomplete' });
  }
  const percentage = 40;
  window.assessmentData.scores.push(percentage);
  const bestScore = Math.max(...window.assessmentData.scores);
  SafeSCORM.setScore(bestScore);
  const submitButton = document.querySelector('.submit-assessment');
  const retryButton = document.getElementById('retry-assessment');
  if (percentage >= passingScore) {
    SafeSCORM.setStatus({ completion: 'completed', success: 'passed' });
  } else {
    SafeSCORM.setStatus({ success: 'failed' });
    submitButton.textContent = 'Submit Again';
    // Never show retry button - we allow direct resubmission
    if (retryButton) retryButton.style.display = 'none';
    console.log('You can adjust your answers and submit again.');
  }
};
`;

const universalHardened = hardenUniversalAssessmentRuntime(universalRaw);
assert(universalHardened.modified, 'U-BATCH: Universal hardener did not modify legacy direct-resubmit runtime');
let universalCode = universalHardened.code;
// Simulate the stale prose that existed in the real batch output after the safe
// gate had already been installed. It is a comment only, not an executable path.
universalCode = universalCode.replace(
  'window.__scormifyShowFullRetake();',
  '/* stale builder note: Submit Again */ window.__scormifyShowFullRetake();'
);
const universalCheck = validateUniversalPassPreservation({ 'scripts/navigation.js': universalCode });
assert(universalCheck.passed, `U-BATCH: Rule 40 still false-fails safe Universal output: ${universalCheck.details}`);


// Real batch variant: helper gate is executable inside submitAssessment, while
// the marker itself lives outside that function in the helper definition.
const universalNoInlineMarkerRaw = universalRaw.replace(
  "    // Never show retry button - we allow direct resubmission\n    if (retryButton) retryButton.style.display = 'none';\n",
  "    console.log('legacy builder label: Submit Again');\n"
);
const universalNoInlineMarkerHardened = hardenUniversalAssessmentRuntime(universalNoInlineMarkerRaw);
assert(universalNoInlineMarkerHardened.modified, 'U-BATCH-2: Universal hardener did not modify no-inline-marker variant');
const universalNoInlineMarkerCheck = validateUniversalPassPreservation({
  'scripts/navigation.js': universalNoInlineMarkerHardened.code,
});
assert(
  universalNoInlineMarkerCheck.passed,
  `U-BATCH-2: safe explicit helper gate still false-fails as direct resubmit: ${universalNoInlineMarkerCheck.details}`
);


// Real mixed-era variant from the 2026-09-15 five-package rerun: some Universal
// submitAssessment bodies contain more than one executable Submit Again write.
// The transformer must neutralize every one, not merely the first match.
const universalMultiSubmitAgainRaw = universalRaw.replace(
  "    submitButton.textContent = 'Submit Again';\n",
  "    submitButton.textContent = 'Submit Again';\n    console.log('legacy duplicate submit label');\n    submitButton.innerHTML = 'Submit Again';\n"
);
const universalMultiSubmitAgainHardened = hardenUniversalAssessmentRuntime(universalMultiSubmitAgainRaw);
assert(universalMultiSubmitAgainHardened.modified, 'U-BATCH-3: Universal hardener did not modify multiple Submit Again writes');
const remainingActionableSubmitAgain = /submitButton\.(?:textContent|innerText|innerHTML)\s*=\s*['\"]Submit Again['\"]/i.test(
  universalMultiSubmitAgainHardened.code
);
assert(!remainingActionableSubmitAgain, 'U-BATCH-3: actionable Submit Again assignment remained after hardening');
const universalMultiSubmitAgainCheck = validateUniversalPassPreservation({
  'scripts/navigation.js': universalMultiSubmitAgainHardened.code,
});
assert(
  universalMultiSubmitAgainCheck.passed,
  `U-BATCH-3: Rule 40 still fails after all actionable Submit Again writes are neutralized: ${universalMultiSubmitAgainCheck.details}`
);

const universalCross = analyzeCrossProfileWorkdayIntegrity(
  {
    'index.html': '<html><body><button onclick="exitCourse()">Exit Course</button><script>function exitCourse(){SCORM.set(\'cmi.core.exit\',\'suspend\');SCORM.commit();SCORM.finish();}</script></body></html>',
    'scripts/navigation.js': universalCode,
  },
  universalProfile,
  'index.html'
);
assert(universalCross.assessmentRetake === 'SAFE', 'U-BATCH: safe Universal full-retake path was classified unsafe');

// ---------------------------------------------------------------------------
// S-BATCH — mirrors the two Stateful Compact failures in the batch log.
// Issue #1 preserves the package's gradeQuestion() scoring calculation, so
// answer-revealing feedback can exist before the canonical failure modal.
// Cross-profile hardening must clear it immediately before the modal while
// leaving score/pass preservation and the existing Retake/Save & Exit UX intact.
// ---------------------------------------------------------------------------
const statefulInput: Record<string, string> = {
  'index.html': `<!doctype html><html><body><header><button id="btn-save-exit" onclick="saveAndExitCourse()">Save &amp; Exit</button></header><script src="scripts/navigation.js"></script></body></html>`,
  'scripts/navigation.js': `
function saveAndExitCourse(){ SCORM.set('cmi.core.exit','suspend'); SCORM.commit(); SCORM.finish(); }
function gradeQuestion(q){
  var feedback = q.querySelector('.feedback');
  if (feedback) feedback.textContent = 'Incorrect. The correct answer is A.';
  return false;
}
function submitAssessment() {
  const qs = Array.from(document.querySelectorAll('.assessment-card .question'));
  const correct = qs.filter(function(q){ return gradeQuestion(q); }).length;
  const score = qs.length ? Math.round((correct / qs.length) * 100) : 0;
  /* ISSUE1_ASSESSMENT_PRESERVATION */
  var __currentScore = Math.round(Number(score) || 0);
  var __bestScore = Math.max(0, __currentScore);
  var __finalStatus = __bestScore >= 80 ? 'passed' : 'failed';
  if (typeof showAssessmentModal === 'function') showAssessmentModal(__currentScore, __bestScore, __finalStatus);
}
function showAssessmentModal(){
  var label = 'Retake Assessment';
  var inputs = document.querySelectorAll('.assessment-card input[type="radio"], .assessment-card input[type="checkbox"]');
  for (var i=0;i<inputs.length;i++) inputs[i].checked = false;
}
`,
};

const statefulBefore = analyzeCrossProfileWorkdayIntegrity(statefulInput, statefulProfile, 'index.html');
assert(statefulBefore.assessmentFeedbackProtection === 'UNSAFE', 'S-BATCH precondition: Stateful answer-feedback leak was not detected');

const statefulResult = hardenCrossProfileWorkdayPackage(statefulInput, statefulProfile, 'index.html');
const statefulNav = statefulResult.updatedContents['scripts/navigation.js'];
assert(statefulNav.includes('SCORMIFY CROSS-PROFILE WORKDAY: failed-final-assessment feedback protected'), 'S-BATCH: feedback-protection marker missing');
assert(statefulNav.includes('if (__currentScore < 80) scormifyProtectStatefulFailedFinalAssessmentFeedback();'), 'S-BATCH: failed attempt does not clear feedback before modal');
assert(statefulNav.includes('ISSUE1_ASSESSMENT_PRESERVATION'), 'S-BATCH: Issue #1 assessment preservation was removed');
assert(statefulNav.includes('showAssessmentModal(__currentScore, __bestScore, __finalStatus)'), 'S-BATCH: existing Stateful modal invocation was removed');
assert(statefulNav.includes("cmi.core.exit','suspend'"), 'S-BATCH: existing Save & Exit behavior was removed');

const statefulAfter = analyzeCrossProfileWorkdayIntegrity(statefulResult.updatedContents, statefulProfile, 'index.html');
assert(statefulAfter.assessmentFeedbackProtection === 'SAFE', 'S-BATCH: Stateful feedback protection still validates unsafe after repair');
const statefulChecks = validateCrossProfileWorkdayIntegrity(statefulResult.updatedContents, statefulProfile, 'index.html');
const rule62 = statefulChecks.find((c) => c.id === 62);
assert(rule62?.passed, `S-BATCH: Rule 62 still fails after repair: ${rule62?.details || 'missing check'}`);

console.log('Mixed-era batch regression suite: PASS');
console.log('- Universal Rule 40 ignores stale non-executable Submit Again prose when explicit full-retake behavior is safe');
console.log('- Stateful failed-assessment feedback/correctness is cleared before the existing failure modal');
console.log('- Existing Issue #1 pass/best-score, Retake, and Save & Exit behavior remains present');
