from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Anchor not found in {path}')
    p.write_text(text.replace(old, new, 1))


# 1) Universal hardener: replace EVERY executable Submit Again assignment in the
# parsed submitAssessment body, not only the first occurrence. Rule 40 remains
# strict: any actionable Submit Again assignment left after remediation is a fail.
replace_once(
    'src/utils/universalPassPreservation.ts',
    "  const submitAgainPattern = /submitButton\\.textContent\\s*=\\s*['\"]Submit Again['\"]\\s*;?/i;\n  if (submitAgainPattern.test(updated)) {\n    updated = updated.replace(\n      submitAgainPattern,\n      `submitButton.textContent = 'Submit Assessment';\n                submitButton.style.display = 'none';\n                window.__scormifyShowFullRetake();`\n    );\n    changed = true;\n  }",
    "  const submitAgainPattern = /submitButton\\.(?:textContent|innerText|innerHTML)\\s*=\\s*['\"]Submit Again['\"]\\s*;?/gi;\n  if (submitAgainPattern.test(updated)) {\n    submitAgainPattern.lastIndex = 0;\n    updated = updated.replace(\n      submitAgainPattern,\n      `submitButton.textContent = 'Submit Assessment';\n                submitButton.style.display = 'none';\n                window.__scormifyShowFullRetake();`\n    );\n    changed = true;\n  }"
)

# 2) Batch regression: reproduce the real mixed-era failure shape where a legacy
# Universal submitAssessment body contains more than one executable Submit Again
# assignment. The hardened output must contain zero actionable Submit Again writes.
test_path = Path('test-batch-regression.ts')
test = test_path.read_text()
anchor = "assert(\n  universalNoInlineMarkerCheck.passed,\n  `U-BATCH-2: safe explicit helper gate still false-fails as direct resubmit: ${universalNoInlineMarkerCheck.details}`\n);\n"
addition = r'''

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
'''
if 'U-BATCH-3:' not in test:
    if anchor not in test:
        raise SystemExit('U-BATCH-2 anchor not found in test-batch-regression.ts')
    test = test.replace(anchor, anchor + addition, 1)
    test_path.write_text(test)

# 3) Reconcile pre-fix warnings with post-fix findings. The diagnostic JSON should
# not continue claiming an Exit/retake/feedback defect after the corresponding
# post-remediation cross-profile finding is SAFE/PRESENT/WIRED.
package_path = Path('src/utils/packageProcessor.ts')
package = package_path.read_text()
anchor_pkg = """  const patchedZipSizeBytes = patchedBlob ? patchedBlob.size : 0;\n  const patchedZipGenerated = Boolean(patchedBlob && patchedBlob.size > 0);\n  const downloadReady = validationPassed && patchedZipGenerated;\n"""
insert_pkg = """  const finalCrossProfileFindings = crossProfileResult?.after || pkg.crossProfileWorkdayFindings;\n  const finalWarnings = (pkg.warnings || []).filter((warning) => {\n    if (!finalCrossProfileFindings) return true;\n\n    if (\n      warning.startsWith('Exit Course integrity: visible Exit Course / Save & Exit control is missing.') &&\n      finalCrossProfileFindings.exitControl !== 'MISSING'\n    ) return false;\n\n    if (\n      warning.startsWith('Exit Course integrity: exit handler is missing, unsafe, or not correctly wired.') &&\n      finalCrossProfileFindings.exitHandler === 'SAFE' &&\n      finalCrossProfileFindings.exitWiring === 'WIRED'\n    ) return false;\n\n    if (\n      warning.startsWith('Final assessment integrity: failed attempt can retain/selectively correct prior answers') &&\n      finalCrossProfileFindings.assessmentRetake === 'SAFE'\n    ) return false;\n\n    if (\n      warning.startsWith('Final assessment integrity: failed assessment may reveal answer feedback/correctness before retake.') &&\n      finalCrossProfileFindings.assessmentFeedbackProtection === 'SAFE'\n    ) return false;\n\n    return true;\n  });\n\n  const patchedZipSizeBytes = patchedBlob ? patchedBlob.size : 0;\n  const patchedZipGenerated = Boolean(patchedBlob && patchedBlob.size > 0);\n  const downloadReady = validationPassed && patchedZipGenerated;\n"""
if 'const finalCrossProfileFindings =' not in package:
    if anchor_pkg not in package:
        raise SystemExit('Warning reconciliation anchor not found in packageProcessor.ts')
    package = package.replace(anchor_pkg, insert_pkg, 1)

package = package.replace(
    "    crossProfileWorkdayFindings: crossProfileResult?.after || pkg.crossProfileWorkdayFindings,\n    error: validationPassed ? undefined : 'Validation failed after remediation attempt',",
    "    crossProfileWorkdayFindings: finalCrossProfileFindings,\n    warnings: finalWarnings,\n    error: validationPassed ? undefined : 'Validation failed after remediation attempt',",
    1,
)
package_path.write_text(package)

# 4) Living README note so future changes know why Rule 40 must neutralize all
# actionable assignments rather than weakening the validator.
readme_path = Path('README.md')
readme = readme_path.read_text()
marker = '## 2026-09-15 Universal multi-resubmit regression\n'
if marker not in readme:
    readme += r'''

## 2026-09-15 Universal multi-resubmit regression

A five-package mixed-era rerun exposed a Universal-only Rule 40 failure: three real Universal packages passed cross-profile Rules 61/62 but Rule 40 still found an executable `Submit Again` assignment. Root cause: the Universal transformer replaced only the first matching `submitButton.* = 'Submit Again'` statement. Some legacy builder outputs contain multiple equivalent assignments. The fix is deliberately additive and keeps Rule 40 strict: Scormify now neutralizes **all** executable `Submit Again` assignments in the parsed `submitAssessment` function, including `textContent`, `innerText`, and `innerHTML` variants. The validator is not weakened. Post-remediation diagnostic warnings are also reconciled with final cross-profile findings so resolved Exit/retake/feedback warnings do not remain in exported JSON.
'''
    readme_path.write_text(readme)

print('Rule 40 multi-resubmit + warning reconciliation patch prepared.')
