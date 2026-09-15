from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly 1 match, found {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# ---------------------------------------------------------------------------
# 1) Universal Rule 40 false-positive: after the explicit Retake Assessment
# gate is installed, stale explanatory/comment text containing "Submit Again"
# must not be treated as an actionable direct-resubmit control. We still fail
# if executable code actually relabels the active submit button to Submit Again.
# ---------------------------------------------------------------------------
replace_once(
    'src/utils/universalPassPreservation.ts',
    """function hasUnsafeDirectResubmit(body: string): boolean {\n  return /Submit Again/i.test(body) ||\n    /adjust your answers and submit again/i.test(body) ||\n    /Never show retry button\\s*-?\\s*we allow direct resubmission/i.test(body);\n}\n""",
    """function hasUnsafeDirectResubmit(body: string): boolean {\n  // Treat only an actionable direct-resubmit path as unsafe after hardening.\n  // Older Universal runtimes can retain stale comments/help text containing\n  // \"Submit Again\" even after the submit control is hidden behind the explicit\n  // Retake Assessment gate. Those strings are not executable behavior.\n  const actionableSubmitAgain = /submitButton\\.(?:textContent|innerText|innerHTML)\\s*=\\s*['\"]Submit Again['\"]/i.test(body);\n  if (actionableSubmitAgain) return true;\n\n  const hasExplicitGate = body.includes(SHOW_RETAKE_MARKER);\n  if (hasExplicitGate) return false;\n\n  return /adjust your answers and submit again/i.test(body) ||\n    /Never show retry button\\s*-?\\s*we allow direct resubmission/i.test(body) ||\n    /Submit Again/i.test(body);\n}\n""",
)


# ---------------------------------------------------------------------------
# 2) Stateful Compact real runtime gap: Issue #1 intentionally leaves the
# package's gradeQuestion() calculation in place, then replaces the SCORM write
# block with the canonical pass/best-score modal flow. That means answer-revealing
# per-question feedback can still exist before the modal. Add a narrow additive
# cleanup immediately before the failed modal, without altering scoring or the
# already-approved Retake/Save & Exit behavior.
# ---------------------------------------------------------------------------
replace_once(
    'src/utils/crossProfileWorkdayHardening.ts',
    """function hasSafeFeedbackProtection(fileContents: Record<string, string>, profile: RepairProfile): boolean {\n  if (!hasFinalAssessmentRuntime(fileContents)) return true;\n  const combined = Object.values(fileContents).join('\\n');\n  if (combined.includes(FEEDBACK_PROTECTION_MARKER)) return true;\n\n  if (profile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {\n    const bodies = activeSubmitBodies(fileContents);\n    return bodies.length > 0 && bodies.every((body) =>\n      body.includes('ISSUE1_ASSESSMENT_PRESERVATION') && body.includes('showAssessmentModal') && !/gradeQuestion\\s*\\(/.test(body)\n    );\n  }\n\n  return false;\n}\n""",
    """function hasSafeFeedbackProtection(fileContents: Record<string, string>, profile: RepairProfile): boolean {\n  if (!hasFinalAssessmentRuntime(fileContents)) return true;\n  const combined = Object.values(fileContents).join('\\n');\n\n  if (profile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {\n    const bodies = activeSubmitBodies(fileContents);\n    const helperPresent =\n      combined.includes(FEEDBACK_PROTECTION_MARKER) &&\n      combined.includes('function scormifyProtectStatefulFailedFinalAssessmentFeedback');\n    return helperPresent && bodies.length > 0 && bodies.every((body) =>\n      body.includes('ISSUE1_ASSESSMENT_PRESERVATION') &&\n      body.includes('showAssessmentModal') &&\n      body.includes('scormifyProtectStatefulFailedFinalAssessmentFeedback')\n    );\n  }\n\n  if (combined.includes(FEEDBACK_PROTECTION_MARKER)) return true;\n  return false;\n}\n""",
)

anchor = """function hardenUniversalFailedFeedback(code: string): { code: string; changed: boolean; description?: string } {\n"""
stateful_helper = r'''const STATEFUL_FEEDBACK_HELPER = `
/* ${FEEDBACK_PROTECTION_MARKER} */
function scormifyProtectStatefulFailedFinalAssessmentFeedback() {
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
`;

function hardenStatefulFailedFeedback(code: string): { code: string; changed: boolean; description?: string } {
  if (!code.includes('ISSUE1_ASSESSMENT_PRESERVATION') || !code.includes('showAssessmentModal')) {
    return { code, changed: false };
  }

  const modalCall = "if (typeof showAssessmentModal === 'function') showAssessmentModal(__currentScore, __bestScore, __finalStatus);";
  if (!code.includes(modalCall)) return { code, changed: false };

  let updated = code;
  const protectedModalCall = "if (__currentScore < 80) scormifyProtectStatefulFailedFinalAssessmentFeedback();\n  " + modalCall;
  updated = updated.split(modalCall).join(protectedModalCall);

  if (!updated.includes(FEEDBACK_PROTECTION_MARKER)) {
    updated += `\n\n${STATEFUL_FEEDBACK_HELPER}\n`;
  }

  try {
    new Function(updated);
  } catch (err: any) {
    throw new Error(`Syntax error after Stateful feedback protection: ${err.message}`);
  }

  return {
    code: updated,
    changed: updated !== code,
    description: 'Protected Stateful failed final assessments from revealing answer feedback/correctness before the existing Retake / Save & Exit modal',
  };
}

'''

p = Path('src/utils/crossProfileWorkdayHardening.ts')
text = p.read_text(encoding='utf-8')
if text.count(anchor) != 1:
    raise SystemExit(f'crossProfileWorkdayHardening.ts: Universal feedback anchor count {text.count(anchor)}')
text = text.replace(anchor, stateful_helper + anchor, 1)
p.write_text(text, encoding='utf-8')

branch_anchor = """  if (profile === 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1') {\n"""
stateful_branch = """  if (profile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {\n    for (const filePath of navCandidates) {\n      const original = updatedContents[filePath];\n      if (!original) continue;\n      const hardened = hardenStatefulFailedFeedback(original);\n      if (hardened.changed && hardened.code !== original) {\n        updatedContents[filePath] = hardened.code;\n        if (!filesModified.includes(filePath)) filesModified.push(filePath);\n        codeChanges.push({\n          filePath,\n          description: hardened.description || 'Protected Stateful failed-assessment feedback',\n          beforeSnippet: original.slice(0, 300),\n          afterSnippet: hardened.code.slice(0, 300),\n        });\n        audits.push({\n          filePath,\n          patternExpected: 'Stateful failed final assessment clears answer-revealing feedback before the existing modal',\n          matchFound: true,\n          replacementApplied: true,\n          contentChanged: true,\n        });\n        logs.push(`Cross-profile Stateful failed-feedback protection applied in ${filePath}`);\n        break;\n      }\n    }\n  }\n\n"""

p = Path('src/utils/crossProfileWorkdayHardening.ts')
text = p.read_text(encoding='utf-8')
# Insert before the Universal hardening branch inside hardenCrossProfileWorkdayPackage.
# There are multiple profile comparisons earlier in the file; use the unique nearby navCandidates context.
needle = """  const navCandidates = getNavigationCandidates(updatedContents);\n  if (profile === 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1') {\n"""
if text.count(needle) != 1:
    raise SystemExit(f'crossProfileWorkdayHardening.ts: navCandidates anchor count {text.count(needle)}')
# First insert Stateful branch after the Compact branch by locating the exact Universal branch that follows the Compact hardener.
compact_end_marker = """  if (profile === 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1') {\n    for (const filePath of navCandidates) {\n      const original = updatedContents[filePath];\n      if (!original) continue;\n      const hardened = hardenUniversalFailedFeedback(original);\n"""
if text.count(compact_end_marker) != 1:
    raise SystemExit(f'crossProfileWorkdayHardening.ts: Universal hardening branch count {text.count(compact_end_marker)}')
text = text.replace(compact_end_marker, stateful_branch + compact_end_marker, 1)
p.write_text(text, encoding='utf-8')


# ---------------------------------------------------------------------------
# 3) Extend regression tests with both real batch-log failure shapes:
#    - Universal stale "Submit Again" text after a valid explicit gate must pass.
#    - Stateful gradeQuestion feedback must be actively cleared before modal.
# ---------------------------------------------------------------------------
p = Path('test-cross-profile-integrity.ts')
text = p.read_text(encoding='utf-8')
insert_before = """// N1 — Unknown/vendor profile is inspection-only: no deterministic rewrite.\n"""
if text.count(insert_before) != 1:
    raise SystemExit('test-cross-profile-integrity.ts: N1 insertion anchor not unique')

new_tests = r'''// ---------------------------------------------------------------------------
// U2 — Real batch-log regression shape: explicit full-retake gate is safe even
// when stale non-executable legacy help/comment text still says "Submit Again".
// Rule 40 must validate behavior, not stale prose.
// ---------------------------------------------------------------------------
const universalStaleTextInput: Record<string, string> = {
  'index.html': universalResult.updatedContents['index.html'],
  'scripts/navigation.js': universalResult.updatedContents['scripts/navigation.js'].replace(
    "if (score < passingScore) window.__scormifyShowFullRetake();",
    "if (score < passingScore) { /* legacy help text: Submit Again */ window.__scormifyShowFullRetake(); }"
  ),
};
const universalStaleTextCheck = analyzeCrossProfileWorkdayIntegrity(universalStaleTextInput, universalProfile, 'index.html');
assert(universalStaleTextCheck.assessmentRetake === 'SAFE', 'U2: stale non-executable Submit Again text incorrectly reclassified a safe Universal retake as unsafe');

// ---------------------------------------------------------------------------
// S2 — Real batch-log regression shape: Issue #1 Stateful assessment may still
// call gradeQuestion() before the canonical modal. Cross-profile hardening must
// clear answer-revealing feedback/correctness immediately before the failed modal
// without replacing the existing score/pass/Retake/Save & Exit logic.
// ---------------------------------------------------------------------------
const statefulLeakInput: Record<string, string> = {
  'index.html': statefulInput['index.html'],
  'scripts/navigation.js': `
function saveAndExitCourse(){ SCORM.set('cmi.core.exit','suspend'); SCORM.commit(); SCORM.finish(); }
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
const statefulLeakBefore = analyzeCrossProfileWorkdayIntegrity(statefulLeakInput, statefulProfile, 'index.html');
assert(statefulLeakBefore.assessmentFeedbackProtection === 'UNSAFE', 'S2 precondition: Stateful gradeQuestion feedback leak was not detected');
const statefulLeakResult = hardenCrossProfileWorkdayPackage(statefulLeakInput, statefulProfile, 'index.html');
const statefulLeakNav = statefulLeakResult.updatedContents['scripts/navigation.js'];
assert(statefulLeakNav.includes('SCORMIFY CROSS-PROFILE WORKDAY: failed-final-assessment feedback protected'), 'S2: Stateful feedback-protection marker missing');
assert(statefulLeakNav.includes('if (__currentScore < 80) scormifyProtectStatefulFailedFinalAssessmentFeedback();'), 'S2: failed Stateful attempt does not clear answer feedback before modal');
assert(statefulLeakNav.includes('ISSUE1_ASSESSMENT_PRESERVATION'), 'S2: Issue #1 assessment preservation was removed');
assert(statefulLeakNav.includes('showAssessmentModal(__currentScore, __bestScore, __finalStatus)'), 'S2: existing Stateful modal invocation was removed');
assert(analyzeCrossProfileWorkdayIntegrity(statefulLeakResult.updatedContents, statefulProfile, 'index.html').assessmentFeedbackProtection === 'SAFE', 'S2: Stateful feedback protection still validates unsafe after repair');

'''
text = text.replace(insert_before, new_tests + insert_before, 1)
# Update summary line to reflect the new behavior.
text = text.replace(
    "console.log('- Stateful working Save & Exit / modal behavior is recognized and left intact');",
    "console.log('- Stateful working Save & Exit / modal behavior is preserved; failed-answer feedback is suppressed when needed');"
)
p.write_text(text, encoding='utf-8')

print('Batch regression fixes applied successfully.')
