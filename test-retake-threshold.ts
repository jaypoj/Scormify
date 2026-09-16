import assert from 'node:assert/strict';
import { transformStatefulWorkdayNavigation } from './src/utils/codeTransformer';
import { findThreshold80Evidence } from './src/utils/legacyUniversalWorkday';

const statefulFixture = `
const PAGES=[{id:'page-1'},{id:'assessment'}];
let current=1;
function getProgress(){return 0}
function save(){}
function loadPage(index){ current=index; }
function submitAssessment(){ const score=79; }
`;

const transformed = transformStatefulWorkdayNavigation(statefulFixture, 'retake_fixture');
assert.match(transformed.code, /feedbacks\[f\]\.textContent\s*=\s*['"]['"]/, 'Retake must clear per-question feedback text');
assert.match(transformed.code, /assessmentResult\.textContent\s*=\s*['"]['"]/, 'Retake must clear prior assessment result text');
assert.match(transformed.code, /correct-answer.*incorrect-answer/s, 'Retake must clear stale answer-state classes');

assert.match(transformed.code, /SCORMIFY STATEFUL WORKDAY: failed-assessment resume bookmark/, 'Stateful Save & Exit must include the failed-assessment resume bookmark hardening');
assert.match(transformed.code, /cmi\.core\.lesson_location/, 'Stateful Save & Exit must write the lesson_location bookmark');
assert.match(transformed.code, /typeof save === ['"]function['"][\s\S]*?save\(\)/, 'Stateful Save & Exit must persist the full state before suspend/finish');

const resumeLms: Record<string, string> = {
  'cmi.core.entry': 'resume',
  'cmi.core.lesson_status': 'failed',
  'cmi.core.lesson_location': '',
};
const resumeScorm = {
  api: true,
  get(key: string) { return resumeLms[key] || ''; },
  set(key: string, value: unknown) { resumeLms[key] = String(value); return true; },
  commit() { return true; },
  finish() { return true; },
};
const resumeWindow: any = { SCORM: resumeScorm, close() {} };
const resumeDocument: any = { body: null, getElementById() { return null; }, querySelector() { return null; } };
const resumeRunner = new Function('window', 'document', 'SCORM', transformed.code + '\nreturn { saveAndExitCourse };');
const resumeEnv: any = resumeRunner(resumeWindow, resumeDocument, resumeScorm);
resumeEnv.saveAndExitCourse();
assert.equal(resumeLms['cmi.core.lesson_location'], 'assessment', 'Failed Save & Exit must bookmark the final assessment page');
assert.equal(resumeLms['cmi.core.exit'], 'suspend', 'Failed Save & Exit must suspend the SCORM session');

const localConstant = findThreshold80Evidence({
  'scripts/navigation.js': `const passingScore = 80; if (percentage >= passingScore) { status='passed'; } else { status='failed'; }`,
});
assert.equal(localConstant.passed, true, localConstant.details);

const configProperty = findThreshold80Evidence({
  'scripts/navigation.js': `const COURSE_SETTINGS={passMark:80}; if (score >= COURSE_SETTINGS.passMark) { status='passed'; } else { status='failed'; }`,
});
assert.equal(configProperty.passed, true, configProperty.details);

const directThreshold = findThreshold80Evidence({
  'scripts/navigation.js': `if (score >= 80) { status='passed'; } else { status='failed'; }`,
});
assert.equal(directThreshold.passed, true, directThreshold.details);

console.log('Retake + threshold regression suite: PASS');
console.log('- retake clears feedback/result/answer-state presentation');
console.log('- failed Save & Exit bookmarks the final assessment before suspend/finish');
console.log('- Rule 9 resolves direct, local constant, and configuration-property 80% thresholds');
