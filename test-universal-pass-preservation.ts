import { hardenUniversalAssessmentRuntime, validateUniversalPassPreservation } from './src/utils/universalPassPreservation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const fixture = `
window.assessmentData = { attempts: 1, scores: [] };
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
    }
  });

  if (answered < questions.length) return;
  const percentage = Math.round((score / questions.length) * 100);
  window.assessmentData.scores.push(percentage);
  const bestScore = Math.max(...window.assessmentData.scores);
  SafeSCORM.setScore(bestScore);

  if (percentage >= passingScore) {
    SafeSCORM.setStatus({ completion: 'completed', success: 'passed' });
  } else {
    SafeSCORM.setStatus({ success: 'failed' });
  }
};
`;

const transformed = hardenUniversalAssessmentRuntime(fixture);
assert(transformed.modified, 'Expected Universal fixture to be modified');
assert(transformed.code.includes('__scormifyPriorPassed'), 'Missing prior-pass guard');
assert(transformed.code.includes('__scormifyPriorRawScore'), 'Missing prior-score preservation');

const validation = validateUniversalPassPreservation({ 'scripts/navigation.js': transformed.code });
assert(validation.passed, validation.details);

const store: Record<string, string> = {
  'cmi.core.lesson_status': 'passed',
  'cmi.core.score.raw': '100',
};
const statusWrites: Array<Record<string, string>> = [];
const SafeSCORM = {
  getValue(key: string) { return store[key] || ''; },
  setScore(score: number) { store['cmi.core.score.raw'] = String(score); return true; },
  setStatus(value: { completion?: string; success?: string }) {
    statusWrites.push({ ...value } as Record<string, string>);
    if (value.success === 'passed' && value.completion === 'completed') store['cmi.core.lesson_status'] = 'passed';
    else if (value.success === 'failed') store['cmi.core.lesson_status'] = 'failed';
    else if (value.completion) store['cmi.core.lesson_status'] = value.completion;
    return true;
  },
};

const questions = Array.from({ length: 10 }, (_, index) => ({
  querySelector() {
    return { dataset: { correct: 'A' }, value: index < 4 ? 'A' : 'B' };
  },
}));

const windowMock: any = { assessmentData: { attempts: 1, scores: [] } };
(globalThis as any).__SAFE_SCORM__ = SafeSCORM;
(globalThis as any).__DOC__ = { querySelectorAll: () => questions };

const factory = new Function('window', `${transformed.code}; return window.submitAssessment;`);
const submitAssessment = factory(windowMock);
await submitAssessment();

assert(store['cmi.core.lesson_status'] === 'passed', `Expected prior pass to remain passed, got ${store['cmi.core.lesson_status']}`);
assert(store['cmi.core.score.raw'] === '100', `Expected best score 100 to remain, got ${store['cmi.core.score.raw']}`);
assert(!statusWrites.some((write) => write.completion === 'incomplete'), 'Prior passed learner was incorrectly reset to incomplete on retake');
assert(statusWrites.some((write) => write.success === 'passed'), 'Expected final retake write to preserve passed status');

console.log('PASS — Universal 100% pass followed by 40% retake remains passed with score 100');
