from pathlib import Path

runtime_path = Path('src/utils/issue1StatefulRuntime.ts')
test_path = Path('test-issue1.ts')

runtime = runtime_path.read_text(encoding='utf-8')
old = """  const progressBody = effectiveBody(nav, 'getProgress');
  const updateBody = effectiveBody(nav, 'updateProgress');
  const hardenedGetProgress = progressBody.includes('ISSUE1_PROGRESS_CLAMP') && progressBody.includes('Math.min(100') && progressBody.includes('validIds') && progressBody.includes('seen');
  const hardenedUpdateProgress = updateBody.includes('ISSUE1_ACTIVE_PROGRESS_PATH') && updateBody.includes('Math.min(100') && updateBody.includes('validIds');
  const progressPassed = hardenedGetProgress || hardenedUpdateProgress;
  checks.push({ id: 42, title: 'Active progress calculation filters/deduplicates valid pages and clamps to 100%', ruleName: 'Issue #1 Progress Runtime', file: 'scripts/navigation.js', passed: progressPassed, details: progressPassed ? 'PASS — effective progress path filters invalid/duplicate IDs and clamps 0-100%' : 'FAIL — active progress path can exceed 100%' });

  const effectiveSave = effectiveBody(nav, 'save');
  const labelSource = effectiveSave || updateBody;
"""
new = """  const progressBody = effectiveBody(nav, 'getProgress');
  const updateBody = effectiveBody(nav, 'updateProgress');
  const effectiveSave = effectiveBody(nav, 'save');
  const hardenedGetProgress = progressBody.includes('ISSUE1_PROGRESS_CLAMP') && progressBody.includes('Math.min(100') && progressBody.includes('validIds') && progressBody.includes('seen');
  const hardenedUpdateProgress = updateBody.includes('ISSUE1_ACTIVE_PROGRESS_PATH') && updateBody.includes('Math.min(100') && updateBody.includes('validIds');
  const hardenedSaveProgress = effectiveSave.includes('ISSUE1_AUTHORITATIVE_SAVE') && effectiveSave.includes('progress = Math.min(100') && effectiveSave.includes('validIds') && effectiveSave.includes('seen');
  const progressPassed = hardenedGetProgress || hardenedUpdateProgress || hardenedSaveProgress;
  checks.push({ id: 42, title: 'Active progress calculation filters/deduplicates valid pages and clamps to 100%', ruleName: 'Issue #1 Progress Runtime', file: 'scripts/navigation.js', passed: progressPassed, details: progressPassed ? 'PASS — effective progress path filters invalid/duplicate IDs and clamps 0-100%' : 'FAIL — active progress path can exceed 100%' });

  const labelSource = effectiveSave || updateBody;
"""
if runtime.count(old) != 1:
    raise SystemExit(f'Expected exactly one Rule 42 validator block, found {runtime.count(old)}')
runtime = runtime.replace(old, new, 1)
runtime_path.write_text(runtime, encoding='utf-8')

test = test_path.read_text(encoding='utf-8')
anchor = """assert.equal(elements['progress-text'].textContent, '100% complete', 'passed learner should see 100% complete');

const manifest = `<?xml version=\"1.0\"?><manifest><resources><resource identifier=\"r1\" href=\"index.html\"><file href=\"index.html\"/></resource></resources></manifest>`;
"""
regression = """assert.equal(elements['progress-text'].textContent, '100% complete', 'passed learner should see 100% complete');

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

const manifest = `<?xml version=\"1.0\"?><manifest><resources><resource identifier=\"r1\" href=\"index.html\"><file href=\"index.html\"/></resource></resources></manifest>`;
"""
if test.count(anchor) != 1:
    raise SystemExit(f'Expected exactly one test insertion anchor, found {test.count(anchor)}')
test = test.replace(anchor, regression, 1)
log_anchor = "console.log('- progress cannot exceed 100%');"
if test.count(log_anchor) != 1:
    raise SystemExit(f'Expected one progress console log anchor, found {test.count(log_anchor)}')
test = test.replace(log_anchor, log_anchor + "\nconsole.log('- Rule 42 recognizes canonical save()-only progress hardening and rejects legacy unclamped save()');", 1)
test_path.write_text(test, encoding='utf-8')

print('Rule 42 save-path validator fix and regression prepared.')
