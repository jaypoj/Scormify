from pathlib import Path

source_path = Path('src/utils/universalPassPreservation.ts')
test_path = Path('test-universal-pass-preservation.ts')

source = source_path.read_text()
test = test_path.read_text()

start_anchor = "    // Historical Universal fix #4: a later lower retake cannot downgrade a prior pass."
end_anchor = "  // New additive Universal fix: direct resubmission after failure is not a new full attempt."
start = source.find(start_anchor)
end = source.find(end_anchor, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate Universal failed-status hardening block')

source_replacement = '''    // Historical Universal fix #4: a later lower retake cannot downgrade a prior pass.
    // Two known Universal builder generations exist in production:
    //   newer: SafeSCORM.setStatus({ success: 'failed' })
    //   older: SafeSCORM.setValue('cmi.core.lesson_status', 'failed')
    // Both must preserve an authoritative prior pass / best score.
    const failSetStatusPattern = /(?:window\\.)?SafeSCORM\\.setStatus\\s*\\(\\s*\\{\\s*success\\s*:\\s*['"]failed['"]\\s*\\}\\s*\\)\\s*;/;
    const failSetValuePattern = /(?:window\\.)?SafeSCORM\\.setValue\\s*\\(\\s*['"]cmi\\.core\\.lesson_status['"]\\s*,\\s*['"]failed['"]\\s*\\)\\s*;/;
    const priorPassMarker = 'SCORMIFY UNIVERSAL WORKDAY: preserve prior pass';

    if (!body.includes(priorPassMarker)) {
      if (failSetStatusPattern.test(body)) {
        const replacement = `if (__scormifyPriorPassed || bestScore >= passingScore) {
                    // SCORMIFY UNIVERSAL WORKDAY: preserve prior pass/best score after a lower retake
                    SafeSCORM.setStatus({ completion: 'completed', success: 'passed' });
                    console.log('[Scormify] Lower retake did not downgrade prior passing LMS status');
                } else {
                    SafeSCORM.setStatus({ success: 'failed' });
                }`;
        body = body.replace(failSetStatusPattern, replacement);
        changed = true;
        changes.push('Guarded failed retake status so a prior/best passing result remains passed');
        audits.push({ patternExpected: "SafeSCORM.setStatus({ success: 'failed' })", matchFound: true, replacementApplied: true });
      } else if (failSetValuePattern.test(body)) {
        const replacement = `if (__scormifyPriorPassed || bestScore >= passingScore) {
                    // SCORMIFY UNIVERSAL WORKDAY: preserve prior pass/best score after a lower retake
                    SafeSCORM.setValue('cmi.core.lesson_status', 'passed');
                    console.log('[Scormify] Lower retake did not downgrade prior passing LMS status');
                } else {
                    SafeSCORM.setValue('cmi.core.lesson_status', 'failed');
                }`;
        body = body.replace(failSetValuePattern, replacement);
        changed = true;
        changes.push('Guarded legacy direct failed lesson_status write so a prior/best passing result remains passed');
        audits.push({ patternExpected: "SafeSCORM.setValue('cmi.core.lesson_status', 'failed')", matchFound: true, replacementApplied: true });
      } else {
        audits.push({
          patternExpected: 'known Universal failed-status write',
          matchFound: false,
          replacementApplied: false,
          reason: 'No known SafeSCORM failed-status write shape found in submitAssessment',
        });
      }
    } else {
      audits.push({ patternExpected: 'prior-pass preservation guard', matchFound: true, replacementApplied: false, reason: 'Already hardened' });
    }
  }
'''
source = source[:start] + source_replacement + '\n' + source[end:]

old_validation = '''  const resetGuarded = /attempts\\s*>\\s*1\\s*&&\\s*!__scormifyPriorPassed/.test(body);
  const failGuarded = /__scormifyPriorPassed\\s*\\|\\|\\s*bestScore\\s*>=\\s*passingScore/.test(body) &&
    body.includes("SafeSCORM.setStatus({ completion: 'completed', success: 'passed' })");
  const historicalPassPreserved = hasPriorStatus && hasPriorScore && resetGuarded && failGuarded;'''
new_validation = '''  const resetGuarded = /attempts\\s*>\\s*1\\s*&&\\s*!__scormifyPriorPassed/.test(body);
  const hasPriorPassGuard = /__scormifyPriorPassed\\s*\\|\\|\\s*bestScore\\s*>=\\s*passingScore/.test(body) &&
    body.includes('SCORMIFY UNIVERSAL WORKDAY: preserve prior pass');
  const hasPreservedPassWrite =
    body.includes("SafeSCORM.setStatus({ completion: 'completed', success: 'passed' })") ||
    /(?:window\\.)?SafeSCORM\\.setValue\\s*\\(\\s*['"]cmi\\.core\\.lesson_status['"]\\s*,\\s*['"]passed['"]\\s*\\)/.test(body);
  const failGuarded = hasPriorPassGuard && hasPreservedPassWrite;
  const historicalPassPreserved = hasPriorStatus && hasPriorScore && resetGuarded && failGuarded;'''
if old_validation not in source:
    raise SystemExit('Could not locate Rule 40 failed-retake validation block')
source = source.replace(old_validation, new_validation, 1)
source_path.write_text(source)

validation_anchor = "const fullRetakeValidation = validateUniversalFullRetakeReset({ 'scripts/navigation.js': transformed.code });\nassert(fullRetakeValidation.passed, fullRetakeValidation.details);\n"
if validation_anchor not in test:
    raise SystemExit('Could not locate Universal regression insertion anchor')

direct_fixture_test = '''

// Historical Universal generation: failed attempts write SCORM 1.2 lesson_status directly
// instead of using the newer version-aware SafeSCORM.setStatus helper.
const legacyDirectFailedFixture = fixture.replace(
  "SafeSCORM.setStatus({ success: 'failed' });",
  "SafeSCORM.setValue('cmi.core.lesson_status', 'failed');\\n    SafeSCORM.commit();"
);
const legacyDirectTransformed = hardenUniversalAssessmentRuntime(legacyDirectFailedFixture);
assert(legacyDirectTransformed.modified, 'Expected legacy direct-failed-status fixture to be modified');
assert(
  legacyDirectTransformed.code.includes("SafeSCORM.setValue('cmi.core.lesson_status', 'passed')"),
  'Legacy direct-failed-status repair did not add prior-pass preservation write'
);
const legacyDirectValidation = validateUniversalPassPreservation({ 'scripts/navigation.js': legacyDirectTransformed.code });
assert(legacyDirectValidation.passed, `Legacy direct-failed-status Rule 40 regression: ${legacyDirectValidation.details}`);
'''
test = test.replace(validation_anchor, validation_anchor + direct_fixture_test, 1)

old_signature = "function createRuntime(priorStatus: string, priorRawScore: string, correctCount: number) {"
new_signature = "function createRuntime(priorStatus: string, priorRawScore: string, correctCount: number, codeUnderTest = transformed.code) {"
if old_signature not in test:
    raise SystemExit('Could not locate createRuntime signature')
test = test.replace(old_signature, new_signature, 1)

old_mock = "    getValue(key: string) { return store[key] || ''; },\n    setScore(score: number) {"
new_mock = "    getValue(key: string) { return store[key] || ''; },\n    setValue(key: string, value: string) { store[key] = String(value); return true; },\n    commit() { return true; },\n    setScore(score: number) {"
if old_mock not in test:
    raise SystemExit('Could not locate SafeSCORM runtime mock anchor')
test = test.replace(old_mock, new_mock, 1)

old_factory = "  const factory = new Function('window', `${transformed.code}; return { submitAssessment: window.submitAssessment, retryAssessment: window.retryAssessment };`);"
new_factory = "  const factory = new Function('window', `${codeUnderTest}; return { submitAssessment: window.submitAssessment, retryAssessment: window.retryAssessment };`);"
if old_factory not in test:
    raise SystemExit('Could not locate runtime factory anchor')
test = test.replace(old_factory, new_factory, 1)

runtime_anchor = "assert(passedRuntime.statusWrites.some((write) => write.success === 'passed'), 'Expected lower retake to preserve passed status');\n"
if runtime_anchor not in test:
    raise SystemExit('Could not locate prior-pass runtime assertion anchor')

direct_runtime = '''

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
'''
test = test.replace(runtime_anchor, runtime_anchor + direct_runtime, 1)
test_path.write_text(test)

print('Legacy Universal direct-failed-status compatibility patch applied successfully.')
