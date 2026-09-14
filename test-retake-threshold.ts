import assert from 'node:assert/strict';
import { transformStatefulWorkdayNavigation } from './src/utils/codeTransformer';
import { findThreshold80Evidence } from './src/utils/legacyUniversalWorkday';

const statefulFixture = `
const PAGES=[{id:'page-1'},{id:'assessment'}];
let current=0;
function getProgress(){return 0}
function save(){}
function loadPage(index){ current=index; }
function submitAssessment(){ const score=79; }
`;

const transformed = transformStatefulWorkdayNavigation(statefulFixture, 'retake_fixture');
assert.match(transformed.code, /feedbacks\[f\]\.textContent\s*=\s*['"]['"]/, 'Retake must clear per-question feedback text');
assert.match(transformed.code, /assessmentResult\.textContent\s*=\s*['"]['"]/, 'Retake must clear prior assessment result text');
assert.match(transformed.code, /correct-answer.*incorrect-answer/s, 'Retake must clear stale answer-state classes');

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
console.log('- Rule 9 resolves direct, local constant, and configuration-property 80% thresholds');
