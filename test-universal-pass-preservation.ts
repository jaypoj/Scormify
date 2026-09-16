import {
  hardenUniversalAssessmentRuntime,
  validateUniversalFullRetakeReset,
  validateUniversalPassPreservation,
} from './src/utils/universalPassPreservation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeClassList(initial: string[] = []) {
  const values = new Set(initial);
  return {
    add(...names: string[]) { names.forEach((name) => values.add(name)); },
    remove(...names: string[]) { names.forEach((name) => values.delete(name)); },
    contains(name: string) { return values.has(name); },
    toString() { return Array.from(values).join(' '); },
  };
}

const fixture = `
window.assessmentData = { attempts: 0, scores: [], lastAnswers: {} };
const SafeSCORM = globalThis.__SAFE_SCORM__;
const document = globalThis.__DOC__;
window.submitAssessment = async function() {
  const questions = document.querySelectorAll('.question-container');
  let score = 0;
  let answered = 0;
  const passingScore = 80;
  const currentAnswers = {};

  window.assessmentData.attempts++;
  if (window.assessmentData.attempts > 1) {
    SafeSCORM.setStatus({ completion: 'incomplete' });
  }

  questions.forEach((container, index) => {
    const selectedInput = container.querySelector('input[type="radio"]:checked');
    if (selectedInput) {
      answered++;
      const correct = selectedInput.dataset.correct;
      const selected = selectedInput.value;
      const isCorrect = correct === selected;
      currentAnswers[index] = { selected, correct, isCorrect };
      if (isCorrect) score++;

      const feedback = container.querySelector('.feedback');
      if (feedback) {
        feedback.textContent = isCorrect ? 'Correct' : 'Incorrect';
        feedback.style.display = 'block';
        container.classList.add(isCorrect ? 'correct-answer' : 'incorrect-answer');
      }
    }
  });

  if (answered < questions.length) {
    window.assessmentData.attempts--;
    return;
  }

  const percentage = Math.round((score / questions.length) * 100);
  window.assessmentData.scores.push(percentage);
  window.assessmentData.lastAnswers = currentAnswers;
  const bestScore = Math.max(...window.assessmentData.scores);
  SafeSCORM.setScore(bestScore);

  const submitButton = document.querySelector('.submit-assessment');
  const retryButton = document.getElementById('retry-assessment');
  const completionMessage = document.getElementById('completion-message');
  const results = document.getElementById('assessment-results');

  if (percentage >= passingScore) {
    SafeSCORM.setStatus({ completion: 'completed', success: 'passed' });
    if (results) results.style.display = 'block';
  } else {
    SafeSCORM.setStatus({ success: 'failed' });
    if (results) results.style.display = 'block';
    if (submitButton) submitButton.textContent = 'Submit Again';
    if (results) results.textContent = 'You can adjust your answers and submit again.';
    // Never show retry button - we allow direct resubmission
    if (retryButton) retryButton.style.display = 'none';
    if (completionMessage) completionMessage.style.display = 'none';
  }
};

window.retryAssessment = function() {
  const questions = document.querySelectorAll('.question-container');
  if (window.assessmentData.attempts < 3) {
    questions.forEach((container) => {
      const selected = container.querySelector('input[type="radio"]:checked');
      if (selected) selected.checked = false;
    });
  } else {
    // Keep incorrect answers visible, only clear correct ones
    Object.keys(window.assessmentData.lastAnswers || {}).forEach((key) => {
      const answer = window.assessmentData.lastAnswers[key];
      if (answer && answer.isCorrect) {
        const selected = questions[Number(key)].querySelector('input[type="radio"]:checked');
        if (selected) selected.checked = false;
      }
      // Keep incorrect answers and their feedback visible
    });
  }
};
`;

const transformed = hardenUniversalAssessmentRuntime(fixture);
assert(transformed.modified, 'Expected Universal fixture to be modified');
assert(transformed.code.includes('__scormifyPriorPassed'), 'Missing prior-pass guard');
assert(transformed.code.includes('__scormifyPriorRawScore'), 'Missing prior-score preservation');
assert(transformed.code.includes('SCORMIFY UNIVERSAL WORKDAY: explicit full-retake gate'), 'Missing explicit full-retake gate');
assert(transformed.code.includes('SCORMIFY UNIVERSAL WORKDAY: full assessment retake reset'), 'Missing full-retake reset');
assert(!transformed.code.includes('Submit Again'), 'Unsafe direct Submit Again behavior remains');
assert(!transformed.code.includes('Keep incorrect answers visible'), 'Unsafe selective retry behavior remains');

const passValidation = validateUniversalPassPreservation({ 'scripts/navigation.js': transformed.code });
assert(passValidation.passed, passValidation.details);

const fullRetakeValidation = validateUniversalFullRetakeReset({ 'scripts/navigation.js': transformed.code });
assert(fullRetakeValidation.passed, fullRetakeValidation.details);


// Historical Universal generation: failed attempts write SCORM 1.2 lesson_status directly
// instead of using the newer version-aware SafeSCORM.setStatus helper.
const legacyDirectFailedFixture = fixture.replace(
  "SafeSCORM.setStatus({ success: 'failed' });",
  "SafeSCORM.setValue('cmi.core.lesson_status', 'failed');\n    SafeSCORM.commit();"
);
const legacyDirectTransformed = hardenUniversalAssessmentRuntime(legacyDirectFailedFixture);
assert(legacyDirectTransformed.modified, 'Expected legacy direct-failed-status fixture to be modified');
assert(
  legacyDirectTransformed.code.includes("SafeSCORM.setValue('cmi.core.lesson_status', 'passed')"),
  'Legacy direct-failed-status repair did not add prior-pass preservation write'
);
const legacyDirectValidation = validateUniversalPassPreservation({ 'scripts/navigation.js': legacyDirectTransformed.code });
assert(legacyDirectValidation.passed, `Legacy direct-failed-status Rule 40 regression: ${legacyDirectValidation.details}`);

function createRuntime(priorStatus: string, priorRawScore: string, correctCount: number, codeUnderTest = transformed.code) {
  const store: Record<string, string> = {
    'cmi.core.lesson_status': priorStatus,
    'cmi.core.score.raw': priorRawScore,
  };
  const statusWrites: Array<Record<string, string>> = [];
  const scoreWrites: number[] = [];

  const SafeSCORM = {
    getValue(key: string) { return store[key] || ''; },
    setValue(key: string, value: string) { store[key] = String(value); return true; },
    commit() { return true; },
    setScore(score: number) {
      scoreWrites.push(score);
      store['cmi.core.score.raw'] = String(score);
      return true;
    },
    setStatus(value: { completion?: string; success?: string }) {
      statusWrites.push({ ...value } as Record<string, string>);
      if (value.success === 'passed' && value.completion === 'completed') store['cmi.core.lesson_status'] = 'passed';
      else if (value.success === 'failed') store['cmi.core.lesson_status'] = 'failed';
      else if (value.completion) store['cmi.core.lesson_status'] = value.completion;
      return true;
    },
  };

  const feedbacks = Array.from({ length: 10 }, () => ({
    textContent: 'Old feedback',
    innerHTML: 'Old feedback',
    style: { display: 'block' },
    classList: makeClassList(['feedback', 'incorrect']),
    removeAttribute() {},
  }));

  const inputs = Array.from({ length: 10 }, (_, index) => ({
    checked: true,
    dataset: { correct: 'A' },
    value: index < correctCount ? 'A' : 'B',
    removeAttribute() {},
  }));

  const questions = Array.from({ length: 10 }, (_, index) => ({
    classList: makeClassList(['incorrect-answer']),
    querySelector(selector: string) {
      if (selector.includes(':checked')) return inputs[index].checked ? inputs[index] : null;
      if (selector === '.feedback') return feedbacks[index];
      return null;
    },
    querySelectorAll() { return []; },
  }));

  const results = {
    textContent: '',
    style: { display: 'none' },
    classList: makeClassList(['failed']),
  };
  const completionMessage = { style: { display: 'none' } };
  const scoreMessage = { textContent: '' };
  const scorePercentage = { textContent: '' };
  const actionHost = {
    appendChild(node: any) { dynamicRetryButton = node; },
  };
  const submitButton: any = {
    textContent: 'Submit Assessment',
    style: { display: '' },
    disabled: false,
    parentElement: actionHost,
  };
  let dynamicRetryButton: any = null;

  const documentMock: any = {
    body: actionHost,
    querySelectorAll(selector: string) {
      if (selector === '.question-container') return questions;
      if (selector === 'input[type="radio"], input[type="checkbox"]') return inputs;
      if (selector === '.feedback') return feedbacks;
      return [];
    },
    querySelector(selector: string) {
      if (selector === '.submit-assessment') return submitButton;
      if (selector === '.retry-assessment') return dynamicRetryButton;
      return null;
    },
    getElementById(id: string) {
      if (id === 'retry-assessment') return dynamicRetryButton;
      if (id === 'completion-message') return completionMessage;
      if (id === 'assessment-results') return results;
      if (id === 'assessment-result') return null;
      if (id === 'score-message') return scoreMessage;
      if (id === 'score-percentage') return scorePercentage;
      if (id === 'submit-assessment') return null;
      return null;
    },
    createElement() {
      return {
        type: '',
        id: '',
        className: '',
        textContent: '',
        style: { display: '' },
        onclick: null,
      };
    },
  };

  const windowMock: any = {
    assessmentData: { attempts: 0, scores: [], lastAnswers: {} },
    scrollTo() {},
  };

  (globalThis as any).__SAFE_SCORM__ = SafeSCORM;
  (globalThis as any).__DOC__ = documentMock;

  const factory = new Function('window', `${codeUnderTest}; return { submitAssessment: window.submitAssessment, retryAssessment: window.retryAssessment };`);
  const runtime = factory(windowMock);

  return {
    store,
    statusWrites,
    scoreWrites,
    inputs,
    feedbacks,
    questions,
    results,
    submitButton,
    getRetryButton: () => dynamicRetryButton,
    windowMock,
    ...runtime,
  };
}

// New tester-reported behavior: fail, review feedback, then Retake must start completely blank.
const failedRuntime = createRuntime('', '0', 4);
await failedRuntime.submitAssessment();
assert(failedRuntime.store['cmi.core.lesson_status'] === 'failed', 'Fresh 40% attempt should be failed');
assert(failedRuntime.getRetryButton(), 'Failed attempt should expose a Retake Assessment button');
assert(failedRuntime.getRetryButton().textContent === 'Retake Assessment', 'Retry control should say Retake Assessment');
assert(failedRuntime.submitButton.style.display === 'none', 'Submit button should be hidden until Retake Assessment is chosen');
assert(failedRuntime.inputs.every((input: any) => input.checked), 'Failed-attempt answers should remain visible until learner chooses Retake');

failedRuntime.retryAssessment();
assert(failedRuntime.inputs.every((input: any) => !input.checked), 'Retake must clear every selected answer');
assert(failedRuntime.feedbacks.every((feedback: any) => feedback.textContent === '' && feedback.style.display === 'none'), 'Retake must clear/hide all per-question feedback');
assert(failedRuntime.questions.every((question: any) => !question.classList.contains('incorrect-answer') && !question.classList.contains('correct-answer')), 'Retake must clear answer-state styling');
assert(failedRuntime.results.style.display === 'none', 'Retake must hide the prior result panel');
assert(failedRuntime.submitButton.style.display === '', 'Retake must restore the Submit Assessment button');
assert(failedRuntime.submitButton.textContent === 'Submit Assessment', 'Retake must restore the Submit Assessment label');
assert(Object.keys(failedRuntime.windowMock.assessmentData.lastAnswers).length === 0, 'Retake must clear saved lastAnswers UI state');

const scoreWriteCountBeforeBlankSubmit = failedRuntime.scoreWrites.length;
await failedRuntime.submitAssessment();
assert(failedRuntime.scoreWrites.length === scoreWriteCountBeforeBlankSubmit, 'Blank retake must not submit a score; every question must be answered again');

// Historical invariant must still survive the new UI repair: 100% prior pass + 40% retake remains passed/100.
const passedRuntime = createRuntime('passed', '100', 4);
await passedRuntime.submitAssessment();
assert(passedRuntime.store['cmi.core.lesson_status'] === 'passed', `Expected prior pass to remain passed, got ${passedRuntime.store['cmi.core.lesson_status']}`);
assert(passedRuntime.store['cmi.core.score.raw'] === '100', `Expected best score 100 to remain, got ${passedRuntime.store['cmi.core.score.raw']}`);
assert(!passedRuntime.statusWrites.some((write) => write.completion === 'incomplete'), 'Prior passed learner was incorrectly reset to incomplete on retake');
assert(passedRuntime.statusWrites.some((write) => write.success === 'passed'), 'Expected lower retake to preserve passed status');


// Execute the exact older direct lesson_status failure shape: a fresh failed attempt must
// still report failed, while a learner with an authoritative prior pass/best score stays passed.
const legacyDirectFreshRuntime = createRuntime('', '0', 4, legacyDirectTransformed.code);
await legacyDirectFreshRuntime.submitAssessment();
assert(
  legacyDirectFreshRuntime.store['cmi.core.lesson_status'] === 'failed',
  `Legacy direct-failed-status fresh attempt should be failed, got ${legacyDirectFreshRuntime.store['cmi.core.lesson_status']}`
);

const legacyDirectPassedRuntime = createRuntime('passed', '100', 4, legacyDirectTransformed.code);
await legacyDirectPassedRuntime.submitAssessment();
assert(
  legacyDirectPassedRuntime.store['cmi.core.lesson_status'] === 'passed',
  `Legacy direct-failed-status lower retake downgraded prior pass to ${legacyDirectPassedRuntime.store['cmi.core.lesson_status']}`
);
assert(
  legacyDirectPassedRuntime.store['cmi.core.score.raw'] === '100',
  `Legacy direct-failed-status lower retake downgraded best score to ${legacyDirectPassedRuntime.store['cmi.core.score.raw']}`
);

// Older Universal packages with no retake/direct-resubmit state machine remain governed by historical rules only.
const noRetakeValidation = validateUniversalFullRetakeReset({
  'scripts/navigation.js': `window.submitAssessment = function() { const questions = []; const answered = 0; if (answered < questions.length) return; };`,
});
assert(noRetakeValidation.passed, 'Universal package with no retake behavior should remain not-applicable for the new rule');

console.log('PASS — Universal historical repairs retained; failed retake now requires a full blank reassessment');
