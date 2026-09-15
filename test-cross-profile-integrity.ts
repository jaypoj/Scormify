import {
  analyzeCrossProfileWorkdayIntegrity,
  hardenCrossProfileWorkdayPackage,
  validateCrossProfileWorkdayIntegrity,
} from './src/utils/crossProfileWorkdayHardening';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const compactProfile = 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1' as const;
const universalProfile = 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1' as const;
const statefulProfile = 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1' as const;

// ---------------------------------------------------------------------------
// C1 — Compact builder era represented by the tester's Gas Distribution case:
// no Exit Course button + gradeQuestion() feedback + direct editable resubmit.
// ---------------------------------------------------------------------------
const compactInput: Record<string, string> = {
  'index.html': `<!doctype html><html><head></head><body><header><h1>Compact Course</h1></header><main id="content"></main><script src="scripts/navigation.js"></script></body></html>`,
  'scripts/navigation.js': `
function gradeQuestion(q) {
  var selected = q.querySelector('input:checked');
  var feedback = q.querySelector('.feedback');
  var correct = selected && selected.value === 'correct';
  if (feedback) feedback.textContent = correct ? 'Correct! This is the right answer.' : 'Incorrect. The correct answer is A.';
  if (selected && selected.parentElement) selected.parentElement.classList.add(correct ? 'correct-answer' : 'incorrect-answer');
  return !!correct;
}
function submitAssessment() {
  const questions = Array.from(document.querySelectorAll('.assessment-card .question'));
  const correct = questions.filter(q => gradeQuestion(q)).length;
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  const passed = score >= 80;
  if (window.SCORM) {
    SCORM.set('cmi.core.score.raw', score);
    SCORM.set('cmi.core.lesson_status', passed ? 'passed' : 'failed');
    SCORM.commit();
  }
  const result = document.getElementById('assessment-result');
  if (result) result.textContent = 'Score: ' + score + '%';
}
`,
  'pages/assessment.html': `<section class="assessment-card"><div class="question"><label><input type="radio" name="q1" value="correct">A</label><div class="feedback"></div></div><button class="check-button" onclick="submitAssessment()">Submit Assessment</button><div id="assessment-result"></div></section>`,
};

const compactBefore = analyzeCrossProfileWorkdayIntegrity(compactInput, compactProfile, 'index.html');
assert(compactBefore.exitControl === 'MISSING', 'C1 precondition: missing Compact Exit Course was not detected');
assert(compactBefore.assessmentRetake === 'UNSAFE', 'C1 precondition: editable/selective Compact retake was not detected');
assert(compactBefore.assessmentFeedbackProtection === 'UNSAFE', 'C1 precondition: Compact answer-feedback leakage was not detected');

const compactResult = hardenCrossProfileWorkdayPackage(compactInput, compactProfile, 'index.html');
const compactHtml = compactResult.updatedContents['index.html'];
const compactNav = compactResult.updatedContents['scripts/navigation.js'];
assert(compactHtml.includes('scormify-exit-course'), 'C1: Exit Course control was not injected');
assert(compactHtml.includes("cmi.core.exit', 'suspend'"), 'C1: exit handler does not set cmi.core.exit=suspend');
assert(compactHtml.includes('adapter.commit()'), 'C1: exit handler does not commit');
assert(compactHtml.includes('adapter.finish()'), 'C1: exit handler does not finish the SCORM session');
assert(!/scormifyExitCourse[\s\S]*?cmi\.core\.lesson_status[\s\S]*?(?:passed|failed|completed)/i.test(compactHtml), 'C1: exit handler mutates lesson_status');
assert(compactNav.includes('SCORMIFY CROSS-PROFILE WORKDAY: full final-assessment retake'), 'C1: full-retake marker missing');
assert(compactNav.includes('SCORMIFY CROSS-PROFILE WORKDAY: failed-final-assessment feedback protected'), 'C1: failed-feedback protection marker missing');
assert(compactNav.includes('Please answer every assessment question before submitting.'), 'C1: all-question answer gate missing');
assert(compactNav.includes('Math.max(priorScore, score)'), 'C1: best-score preservation was not included');
assert(compactNav.includes("priorStatus === 'passed'"), 'C1: prior-pass preservation was not included');
assert(compactNav.includes('inputs[i].checked = false'), 'C1: full retake does not clear every answer');
assert(compactNav.includes('feedbacks[i].textContent ='), 'C1: failed feedback is not cleared');

const compactAfter = analyzeCrossProfileWorkdayIntegrity(compactResult.updatedContents, compactProfile, 'index.html');
assert(compactAfter.exitControl === 'PRESENT', 'C1: repaired Compact Exit Course is not visible');
assert(compactAfter.exitHandler === 'SAFE', 'C1: repaired Compact exit handler is not safe');
assert(compactAfter.exitWiring === 'WIRED', 'C1: repaired Compact Exit Course is not wired');
assert(compactAfter.assessmentRetake === 'SAFE', 'C1: Compact full-retake invariant still unsafe after repair');
assert(compactAfter.assessmentFeedbackProtection === 'SAFE', 'C1: Compact failed-feedback protection still unsafe after repair');
assert(validateCrossProfileWorkdayIntegrity(compactResult.updatedContents, compactProfile, 'index.html').every((c) => c.passed), 'C1: one or more cross-profile Compact validation rules failed');

// C2 — Existing but broken Exit Course control must be rewired, not duplicated.
const brokenExitInput: Record<string, string> = {
  'index.html': `<!doctype html><html><body><header><button id="exit-course" onclick="missingExitHandler()">Exit Course</button></header><script src="scripts/navigation.js"></script></body></html>`,
  'scripts/navigation.js': `function nextPage(){ return true; }`,
};
const brokenExitResult = hardenCrossProfileWorkdayPackage(brokenExitInput, compactProfile, 'index.html');
const repairedExitHtml = brokenExitResult.updatedContents['index.html'];
assert(repairedExitHtml.includes('onclick="return scormifyExitCourse(event)"'), 'C2: broken existing Exit Course was not rewired');
assert((repairedExitHtml.match(/>Exit Course<\/button>/g) || []).length === 1, 'C2: existing Exit Course was duplicated instead of repaired');
assert(validateCrossProfileWorkdayIntegrity(brokenExitResult.updatedContents, compactProfile, 'index.html')[0].passed, 'C2: rewired Exit Course did not pass integrity validation');

// ---------------------------------------------------------------------------
// U1 — Universal builder era: preserve the existing Universal retake hardening
// and add answer-feedback protection without replacing the profile logic.
// ---------------------------------------------------------------------------
const universalInput: Record<string, string> = {
  'index.html': `<!doctype html><html><body><header><button onclick="exitCourse()">Exit Course</button></header><script src="scripts/navigation.js"></script><script>function exitCourse(){ if(window.SCORM){ SCORM.set('cmi.core.exit','suspend'); SCORM.commit(); SCORM.finish(); } }</script></body></html>`,
  'scripts/navigation.js': `
window.__scormifyShowFullRetake = function() {
  // SCORMIFY UNIVERSAL WORKDAY: explicit full-retake gate
  var retryButton = document.getElementById('retry-assessment');
  if (retryButton) { retryButton.textContent = 'Retake Assessment'; retryButton.style.display = ''; }
};
window.retryAssessment = function() {
  // SCORMIFY UNIVERSAL WORKDAY: full assessment retake reset
  var questions = document.querySelectorAll('.question-container');
  var allInputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
  allInputs.forEach(function(input){ input.checked = false; });
  document.querySelectorAll('.feedback').forEach(function(feedback){ feedback.textContent = ''; });
  var submitButton = document.querySelector('.submit-assessment');
  if (submitButton) { submitButton.style.display = ''; submitButton.textContent = 'Submit Assessment'; }
  if (window.assessmentData) window.assessmentData.lastAnswers = {};
};
window.submitAssessment = async function() {
  const questions = document.querySelectorAll('.question-container');
  const answered = document.querySelectorAll('.question-container input:checked').length;
  if (answered < questions.length) return;
  const passingScore = 80;
  var score = 40;
  if (score < passingScore) window.__scormifyShowFullRetake();
};
`,
};
const universalBefore = analyzeCrossProfileWorkdayIntegrity(universalInput, universalProfile, 'index.html');
assert(universalBefore.assessmentRetake === 'SAFE', 'U1 precondition: existing Universal full-retake logic should already be safe');
assert(universalBefore.assessmentFeedbackProtection === 'UNSAFE', 'U1 precondition: missing Universal failed-feedback protection was not detected');

const universalResult = hardenCrossProfileWorkdayPackage(universalInput, universalProfile, 'index.html');
const universalNav = universalResult.updatedContents['scripts/navigation.js'];
assert(universalNav.includes('SCORMIFY UNIVERSAL WORKDAY: explicit full-retake gate'), 'U1: existing Universal retake gate was removed');
assert(universalNav.includes('SCORMIFY UNIVERSAL WORKDAY: full assessment retake reset'), 'U1: existing Universal full-retake reset was removed');
assert(universalNav.includes('SCORMIFY CROSS-PROFILE WORKDAY: failed-final-assessment feedback protected'), 'U1: Universal feedback protection was not added');
assert(analyzeCrossProfileWorkdayIntegrity(universalResult.updatedContents, universalProfile, 'index.html').assessmentFeedbackProtection === 'SAFE', 'U1: Universal feedback protection still validates unsafe');

// ---------------------------------------------------------------------------
// S1 — Stateful profile already has its approved modal/save/exit behavior.
// The cross-profile layer must recognize it as safe and not replace working code.
// ---------------------------------------------------------------------------
const statefulInput: Record<string, string> = {
  'index.html': `<!doctype html><html><body><header><button id="btn-save-exit" onclick="saveAndExitCourse()">Save &amp; Exit</button></header><script src="scripts/navigation.js"></script></body></html>`,
  'scripts/navigation.js': `
function saveAndExitCourse(){ SCORM.set('cmi.core.exit','suspend'); SCORM.commit(); SCORM.finish(); }
function submitQuiz(score){
  /* ISSUE1_ASSESSMENT_PRESERVATION */
  var bestScore = Math.max(0, score);
  showAssessmentModal(score, bestScore, score >= 80 ? 'passed' : 'failed');
}
function showAssessmentModal(){
  var label = 'Retake Assessment';
  var inputs = document.querySelectorAll('.assessment-card input[type="radio"], .assessment-card input[type="checkbox"]');
  for (var i=0;i<inputs.length;i++) inputs[i].checked = false;
}
`,
};
const statefulBefore = analyzeCrossProfileWorkdayIntegrity(statefulInput, statefulProfile, 'index.html');
assert(statefulBefore.exitControl === 'PRESENT' && statefulBefore.exitHandler === 'SAFE' && statefulBefore.exitWiring === 'WIRED', 'S1: approved Stateful Save & Exit was not recognized as safe');
assert(statefulBefore.assessmentRetake === 'SAFE', 'S1: approved Stateful Retake Assessment was not recognized as safe');
assert(statefulBefore.assessmentFeedbackProtection === 'SAFE', 'S1: approved Stateful modal assessment path was not recognized as feedback-safe');
const statefulResult = hardenCrossProfileWorkdayPackage(statefulInput, statefulProfile, 'index.html');
assert(statefulResult.updatedContents['index.html'] === statefulInput['index.html'], 'S1: cross-profile layer unnecessarily rewrote working Stateful exit HTML');
assert(statefulResult.updatedContents['scripts/navigation.js'] === statefulInput['scripts/navigation.js'], 'S1: cross-profile layer unnecessarily rewrote working Stateful navigation');

// N1 — Unknown/vendor profile is inspection-only: no deterministic rewrite.
const vendorInput: Record<string, string> = {
  'index.html': '<html><body><div>Vendor player</div></body></html>',
  'vendor.js': 'function vendorRuntime(){ return true; }',
};
const vendorResult = hardenCrossProfileWorkdayPackage(vendorInput, 'NONE', 'index.html');
assert(vendorResult.filesModified.length === 0, 'N1: unknown/vendor package was rewritten');
assert(vendorResult.updatedContents['index.html'] === vendorInput['index.html'], 'N1: unknown/vendor HTML changed');

console.log('Cross-profile Workday integrity regression suite: PASS');
console.log('- Compact missing/broken Exit Course is injected/rewired to suspend + commit + finish with close fallback');
console.log('- Compact final assessment requires every answer, protects failed feedback, and starts retake fully blank');
console.log('- Universal full-retake logic is preserved while failed-answer feedback leakage is suppressed');
console.log('- Stateful working Save & Exit / modal behavior is recognized and left intact');
console.log('- Unknown/vendor profiles remain inspection-only and are not rewritten');
