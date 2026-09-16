import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  ensurePageContentManifestEntry,
  hardenStatefulRuntimeCode,
  validateIssue1StatefulRuntime,
  verifyFinalZipIntegrity,
} from './src/utils/issue1StatefulRuntime';

const brokenFixture = `
const PAGES=[{id:'page-1'},{id:'page-2'},{id:'assessment'}];
let current=0;
var STORAGE_KEY='scormArchitectProgress::fixture';
var LMS_CONTEXT={initialized:true,available:true,entry:'resume'};
var __browserWrites=0;
function initializeLmsContext(){return LMS_CONTEXT}
function writeBrowserStorage(){__browserWrites++}
const visited=new Set();
const completedKnowledgeChecks=new Set();
const completedAudioPages=new Set();
function el(id){return document.getElementById(id)}
function currentPageId(){return PAGES[current]?PAGES[current].id:''}
function getProgress(){return Math.round((visited.size/PAGES.length)*100)}
function save(){const state={visited:Array.from(visited),currentPageId:currentPageId()};const serialized=JSON.stringify(state);writeBrowserStorage('sessionStorage',serialized);writeBrowserStorage('localStorage',serialized);const progress=getProgress();el('progress-fill').style.width=progress+'%';el('progress-text').textContent=progress+'% complete';if(window.SCORM){SCORM.set('cmi.suspend_data',serialized);SCORM.set('cmi.core.lesson_location',currentPageId());SCORM.commit()}}
function setNav(){window.__setNav=(window.__setNav||0)+1}
function initializeCaptions(){window.__captions=(window.__captions||0)+1}
function initializeCompletionGate(){window.__gate=(window.__gate||0)+1}
async function loadPage(index){var targetId=typeof page!=='undefined'?page:'';var pageHtml='';if(window.SCORM_PAGE_CONTENT&&window.SCORM_PAGE_CONTENT[targetId])pageHtml=window.SCORM_PAGE_CONTENT[targetId];el('content-container').innerHTML=pageHtml}
function recordAssessmentInteraction(){}
function submitAssessment(){const qs=[];const score=window.__testScore;const result=el('assessment-result');const passed=score>=80;result.textContent='Score: '+score+'% - '+(passed?'Passed':'Try again');if(window.SCORM){qs.forEach(recordAssessmentInteraction);SCORM.set('cmi.core.score.raw',score);SCORM.set('cmi.core.score.min',0);SCORM.set('cmi.core.score.max',100);SCORM.set('cmi.core.lesson_status',passed?'passed':'failed');SCORM.commit()}}
function showAssessmentModal(currentScore,bestScore,finalStatus){window.__modal={currentScore,bestScore,finalStatus}}
function updateProgress(pageId){visited.add(pageId);save()}
`;

const hardened = hardenStatefulRuntimeCode(brokenFixture, 'fixture');
assert.equal(hardened.modified, true, 'hardener should modify broken fixture');

const elements: Record<string, any> = {
  'content-container': { innerHTML: '', style: {}, textContent: '' },
  'progress-fill': { style: {}, textContent: '' },
  'progress-text': { style: {}, textContent: '' },
  'assessment-result': { style: {}, textContent: '', className: '' },
};
const documentMock = {
  getElementById(id: string) { return elements[id] || null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
const lms: Record<string, string> = {
  'cmi.core.entry': 'resume',
  'cmi.core.lesson_status': 'incomplete',
  'cmi.core.score.raw': '',
};
const SCORM = {
  api: true,
  get(key: string) { return lms[key] ?? ''; },
  set(key: string, value: any) { lms[key] = String(value); return true; },
  commit() { return true; },
};
const windowMock: any = {
  SCORM,
  SCORM_PAGE_CONTENT: {
    'page-1': '<h1>First</h1>',
    'page-2': '<h1>Second</h1>',
    assessment: '<h1>Assessment</h1>',
  },
  __testScore: 0,
};

const run = new Function('window', 'document', 'SCORM', `${hardened.code}\nreturn {\n  loadPage, submitAssessment, save, getProgress, visited,\n  browserWrites: () => __browserWrites,\n  currentValue: () => current\n};`);
const env: any = run(windowMock, documentMock, SCORM);

await env.loadPage(0);
assert.match(elements['content-container'].innerHTML, /First/, 'loadPage(0) should render first page');
assert.equal(env.currentValue(), 0);
await env.loadPage(1);
assert.match(elements['content-container'].innerHTML, /Second/, 'loadPage(1) should render second page');
assert.equal(env.currentValue(), 1);
assert.ok(windowMock.__setNav >= 2, 'loadPage should preserve setNav side effect');

for (const id of ['page-1', 'page-2', 'assessment', 'invalid-a', 'invalid-b', 'invalid-c']) env.visited.add(id);
assert.ok(env.getProgress() <= 100, 'progress must never exceed 100%');

const writesBefore = env.browserWrites();
env.save();
assert.equal(env.browserWrites(), writesBefore, 'LMS-active save must make zero browser-storage writes');

windowMock.__testScore = 79;
env.submitAssessment();
assert.equal(lms['cmi.core.lesson_status'], 'failed', '79 must fail on first attempt');
assert.equal(windowMock.__modal.finalStatus, 'failed', 'failed submission must invoke modal');

windowMock.__testScore = 80;
env.submitAssessment();
assert.equal(lms['cmi.core.lesson_status'], 'passed', '80 must pass');

windowMock.__testScore = 100;
env.submitAssessment();
assert.equal(lms['cmi.core.score.raw'], '100');
windowMock.__testScore = 40;
env.submitAssessment();
assert.equal(lms['cmi.core.lesson_status'], 'passed', 'later failure must not downgrade prior pass');
assert.equal(lms['cmi.core.score.raw'], '100', 'later failure must not lower best score');

lms['cmi.core.lesson_status'] = 'failed';
env.save();
assert.equal(elements['progress-text'].textContent, '100% viewed', 'failed learner with all valid pages viewed should see 100% viewed');
lms['cmi.core.lesson_status'] = 'passed';
env.save();
assert.equal(elements['progress-text'].textContent, '100% complete', 'passed learner should see 100% complete');

// Rule 42 regression: some older Compact packages calculate progress only inside save().
// The canonical authoritative save path is safe because it filters valid page IDs,
// deduplicates visits, and clamps the final percentage to 0-100.
const saveOnlyOriginal = `
const PAGES=[{id:'page-1'},{id:'page-2'},{id:'assessment'}];
const visited=new Set(['page-1','page-2','assessment','bogus-page']);
function save(){
  const progress=Math.round((visited.size/PAGES.length)*100);
  return progress;
}
`;
const saveOnlyHardened = hardenStatefulRuntimeCode(saveOnlyOriginal, 'save-only-progress');
const saveOnlyRule42 = validateIssue1StatefulRuntime(
  { 'scripts/navigation.js': saveOnlyHardened.code, 'imsmanifest.xml': '' },
  ['scripts/navigation.js']
).find((c) => c.id === 42);
assert.equal(saveOnlyRule42?.passed, true, 'Rule 42 must recognize the canonical clamped save() path when getProgress/updateProgress are absent');

const unsafeSaveOnlyRule42 = validateIssue1StatefulRuntime(
  { 'scripts/navigation.js': saveOnlyOriginal, 'imsmanifest.xml': '' },
  ['scripts/navigation.js']
).find((c) => c.id === 42);
assert.equal(unsafeSaveOnlyRule42?.passed, false, 'Rule 42 must still reject an unclamped legacy save()-only progress path');

const manifest = `<?xml version="1.0"?><manifest><resources><resource identifier="r1" href="index.html"><file href="index.html"/></resource></resources></manifest>`;
const manifestResult = ensurePageContentManifestEntry(manifest);
assert.equal(manifestResult.modified, true);
assert.match(manifestResult.xml, /<file href="scripts\/page-content\.js"\/>/);

const validationMap = {
  'scripts/navigation.js': hardened.code,
  'scripts/page-content.js': 'window.SCORM_PAGE_CONTENT={};',
  'imsmanifest.xml': manifestResult.xml,
};
const issueChecks = validateIssue1StatefulRuntime(validationMap, ['scripts/navigation.js', 'scripts/page-content.js', 'imsmanifest.xml']);
assert.ok(issueChecks.length >= 6);
assert.ok(issueChecks.every((c) => c.passed), `Issue #1 structural checks failed: ${issueChecks.filter((c) => !c.passed).map((c) => c.details).join('; ')}`);

const originalZip = new JSZip();
originalZip.file('imsmanifest.xml', manifest);
originalZip.file('index.html', '<html></html>');
originalZip.file('media/test.png', new Uint8Array([1, 2, 3, 4, 5]));
const finalZip = new JSZip();
finalZip.file('imsmanifest.xml', manifestResult.xml);
finalZip.file('index.html', '<html></html>');
finalZip.file('media/test.png', new Uint8Array([1, 2, 3, 4, 5]));
finalZip.file('scripts/page-content.js', 'window.SCORM_PAGE_CONTENT={};');
const finalBlob = await finalZip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
const integrity = await verifyFinalZipIntegrity(originalZip, finalBlob, true);
assert.equal(integrity.passed, true, integrity.details);

console.log('Issue #1 regression suite: PASS');
console.log('- loadPage(0/1) renders bundled content');
console.log('- progress cannot exceed 100%');
console.log('- Rule 42 recognizes canonical save()-only progress hardening and rejects legacy unclamped save()');
console.log('- LMS save performs zero browser-storage writes');
console.log('- 79 fails, 80 passes, 100 then 40 preserves pass/best score');
console.log('- failure path invokes assessment modal');
console.log('- viewed vs complete label semantics verified');
console.log('- manifest dependency and final ZIP reopen/binary integrity verified');
