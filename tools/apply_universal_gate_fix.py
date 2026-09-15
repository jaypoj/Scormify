from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Anchor not found in {path}')
    p.write_text(text.replace(old, new, 1))


replace_once(
    'src/utils/universalPassPreservation.ts',
    "  const hasExplicitGate = body.includes(SHOW_RETAKE_MARKER);\n  if (hasExplicitGate) return false;",
    "  const hasExplicitGate = body.includes(SHOW_RETAKE_MARKER) ||\n"
    "    /submitButton\\.style\\.display\\s*=\\s*['\\\"]none['\\\"][\\s\\S]{0,220}(?:window\\.)?__scormifyShowFullRetake\\s*\\(\\s*\\)/i.test(body);\n"
    "  if (hasExplicitGate) return false;",
)


test_path = Path('test-batch-regression.ts')
test = test_path.read_text()
anchor = "assert(universalCheck.passed, `U-BATCH: Rule 40 still false-fails safe Universal output: ${universalCheck.details}`);\n"
addition = r'''

// Real batch variant: helper gate is executable inside submitAssessment, while
// the marker itself lives outside that function in the helper definition.
const universalNoInlineMarkerRaw = universalRaw.replace(
  "    // Never show retry button - we allow direct resubmission\n    if (retryButton) retryButton.style.display = 'none';\n",
  "    console.log('legacy builder label: Submit Again');\n"
);
const universalNoInlineMarkerHardened = hardenUniversalAssessmentRuntime(universalNoInlineMarkerRaw);
assert(universalNoInlineMarkerHardened.modified, 'U-BATCH-2: Universal hardener did not modify no-inline-marker variant');
const universalNoInlineMarkerCheck = validateUniversalPassPreservation({
  'scripts/navigation.js': universalNoInlineMarkerHardened.code,
});
assert(
  universalNoInlineMarkerCheck.passed,
  `U-BATCH-2: safe explicit helper gate still false-fails as direct resubmit: ${universalNoInlineMarkerCheck.details}`
);
'''
if 'U-BATCH-2:' not in test:
    if anchor not in test:
        raise SystemExit('Batch regression anchor not found')
    test = test.replace(anchor, anchor + addition, 1)
    test_path.write_text(test)

print('Targeted Universal gate validator patch applied.')
