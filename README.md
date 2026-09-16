# Scormify — Workday SCORM Repair Utility

Scormify is a deterministic, browser-side repair and validation utility for legacy custom SCORM packages being migrated from Moodle into Workday Learning.

This README is the **living architecture and regression contract** for the repository. Before changing Scormify, read this file first and preserve every working invariant unless a deliberate replacement is documented and fully regression-tested.

> **Security:** this repository is public. Never commit real corporate SCORM packages, training media, Workday exports, learner data, credentials, proprietary source content, or other confidential files. Tests and fixtures must be synthetic.

## Current scope

Automatic repair is intentionally limited to recognized custom **SCORM 1.2** package families:

| Repair profile | Purpose |
|---|---|
| `KNOWN_SCORM12_COMPACT_QUIZ_80_V1` | Earlier compact custom-builder packages |
| `KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1` | Stateful compact packages with browser-state/page-loading issues |
| `KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1` | UniversalSCORM / SafeSCORM custom-builder packages |

SCORM 2004, ambiguous packages, and unknown/vendor runtimes are **not automatically rewritten**. They are protected for manual review unless a future profile is explicitly designed and tested.

## Non-negotiable behavior

Every recognized package family must preserve these invariants after repair.

### SCORM / LMS state

- `imsmanifest.xml` remains at the package root.
- The package remains SCORM 1.2.
- The passing threshold remains exactly **80%**.
- **79% fails; 80% passes.**
- Page visitation/progress must never manufacture `completed` or `passed`.
- Finish/last-page navigation must never manufacture completion.
- `beforeunload`, `unload`, `pagehide`, or Exit Course must never manufacture completion.
- Relaunch must preserve authoritative LMS status instead of blindly resetting to `incomplete`.
- A prior passing result may not be downgraded by a later lower retake.
- The reported best/raw score may not decrease below the prior authoritative LMS best score.
- Stateful packages must treat LMS state as authoritative while the LMS API is active; browser storage is standalone-preview fallback only.
- Progress must be filtered to valid pages and clamped to 0–100%.

### Final assessment behavior

For a **scored final assessment**:

- A failed attempt may not be converted into a pass by correcting only the previously missed questions.
- The learner must explicitly choose **Retake Assessment** before beginning another attempt.
- A retake starts with **all prior radio/checkbox selections cleared**.
- Correct/incorrect styling and previous result presentation are cleared for the new attempt.
- Every assessment question must be answered again before the next scored submission.
- Failed-final-assessment feedback must not reveal the correct answer before the learner starts the next attempt.
- Ordinary instructional **knowledge-check** feedback remains intact; Scormify does not globally remove lesson feedback.
- A prior LMS pass/best score is preserved even if a later full retake scores below 80%.

### Exit Course behavior

Every recognized custom SCORM 1.2 package must have a usable Exit Course / Save & Exit path.

The cross-profile Exit Course contract is:

1. A visible and actionable learner control exists (`Exit Course`, `Save & Exit`, or a recognized equivalent).
2. The control is actually wired to a callable handler.
3. Current course state is saved when a safe package-specific save function is available.
4. `cmi.core.exit` is set to `suspend`.
5. The package commits to the LMS.
6. The package finishes the SCORM session exactly once.
7. Exit does **not** write `completed`, `passed`, `failed`, or a new score.
8. The package attempts `window.close()` after LMS communication is finished.
9. If the Workday/browser container blocks scripted closing, the learner gets a clear **Course Progress Saved** fallback telling them to use Workday's close control.
10. Scormify never reaches into or manipulates Workday's parent/top frame.

## Package processing pipeline

Scormify deliberately uses sequential, deterministic processing:

1. **Open ZIP** and inventory files.
2. **Inspect nested ZIPs** one level deep when Moodle supplies an outer wrapper.
3. **Parse manifest** and determine authoritative SCORM version.
4. **Classify package family** and select a repair profile.
5. **Inventory status writes and legacy defects**.
6. **Scan cross-profile Workday integrity**: Exit Course, final-assessment retake, failed-final-assessment feedback.
7. **Apply historical profile-specific remediation**.
8. **Apply additive cross-profile hardening**. This stage must never replace or erase profile-specific fixes.
9. **Run final completion normalization**.
10. **Repackage the authoritative SCORM contents** with a flat root.
11. **Validate all historical and current rules**.
12. **Block download on any failed build-blocking rule**.
13. Produce `CourseName_WORKDAY_FIXED.zip` only after validation passes.

## Core code map

| File | Responsibility |
|---|---|
| `src/utils/packageProcessor.ts` | End-to-end scan/patch/repack/validation pipeline, nested-ZIP handling, final download gating |
| `src/utils/detector.ts` | SCORM version/profile detection, pass-score analysis, action status, cross-profile defect detection |
| `src/utils/statusInventory.ts` | Status-write inventory; progress, finish, relaunch and unsafe-exit status defects; Stateful findings |
| `src/utils/patcher.ts` | Profile-specific deterministic patch dispatch and transformations |
| `src/utils/codeTransformer.ts` | Compact/Stateful transformations, completion normalization, Stateful modal and Save & Exit behavior |
| `src/utils/issue1StatefulRuntime.ts` | Stateful authoritative state, page-content, progress, assessment preservation, ZIP integrity checks |
| `src/utils/universalPassPreservation.ts` | Universal prior-pass/best-score preservation and explicit full-blank retake behavior |
| `src/utils/crossProfileWorkdayHardening.ts` | Additive Exit Course integrity, cross-profile final-assessment retake, failed-feedback protection, Rules 60–62 |
| `src/utils/legacyUniversalWorkday.ts` | Universal 80% threshold evidence resolver |
| `src/utils/validator.ts` | Historical/common/profile-specific deterministic validation rules |
| `src/utils/braceScanner.ts` | Structural function/block parsing used instead of unsafe multi-brace regex replacements |
| `src/utils/manifest.ts` | Manifest parsing and SCORM launch/reference metadata |
| `src/utils/passScoreDetector.ts` | Pass-score evidence and consistency detection |
| `src/App.tsx` | Browser UI, sequential scan/patch orchestration, batch handling |

## Important profile-specific protections

### Compact

- Remove progress/Finish writes that incorrectly set `completed`.
- Keep Finish messaging conditional on actual LMS `passed` status.
- Guard relaunch initialization.
- Maintain the exact 80% threshold.
- Cross-profile hardening adds/repairs Exit Course where needed.
- Known simple final-assessment runtimes are converted from editable/selective resubmission to a complete blank retake and failed-answer feedback is suppressed.
- If a recognized Compact profile contains a final-assessment runtime Scormify cannot safely normalize, validation must fail rather than silently release it.

### Stateful Compact

- Extends/composes Compact protections; it does not replace them.
- LMS state is authoritative during LMS operation.
- Browser-storage keys are namespaced for standalone fallback.
- Fresh/replay/resume state is handled deterministically.
- Progress is deduplicated, valid-page filtered, and clamped.
- Dynamic lesson-page loading is replaced with `scripts/page-content.js` for Workday inline-page compatibility.
- Failed assessment uses an accessible Retake / Save & Exit modal.
- Prior pass and best score are preserved.
- Existing approved Save & Exit behavior must be recognized by the cross-profile layer and left intact.
- If the retained legacy `gradeQuestion()` path can expose per-question correct-answer feedback, Scormify clears that feedback/correctness styling **only on failed final assessments** immediately before the existing failure modal. The score calculation, pass/best-score preservation, modal, Retake, and Save & Exit flow remain unchanged.
- Stateful assessment paths that do not contain an answer-revealing grading path must continue to validate as already safe; Scormify must not require unnecessary rewrites.

### Universal

- Neutralize unsafe unload completion writes.
- Guard relaunch initialization.
- Resolve direct/constant/config-based 80% threshold evidence.
- Preserve prior LMS pass and best score across lower retakes.
- Replace direct/selective resubmission with an explicit **Retake Assessment** gate.
- Full retake clears all answers, feedback, correctness styling, old result UI, and saved `lastAnswers` before the new attempt.
- Cross-profile hardening suppresses answer-revealing failed-final-assessment feedback while retaining the existing Universal retake/pass-preservation logic.
- Universal Rule 40 must validate **executable retake behavior**, not stale comments/help text. A leftover non-executable phrase such as `Submit Again` must not fail a package when the actual submit control is hidden behind the explicit full-retake gate and no actionable direct-resubmit assignment remains.
- Existing Universal `fetch('pages/...')` architecture is not rewritten unless Workday evidence shows it is necessary.

## Tester-derived regression requirements

The following real tester findings are now permanent regression cases conceptually, but real corporate packages must **not** be committed to this repository:

- **Gas Distribution 100-09:** missing Exit Course; editable failed assessment; retained correct-answer feedback.
- **Complex Projects 29 — Storage Facilities:** failed assessment allowed correction of only missed questions; explanatory feedback revealed answers before successful resubmission.
- **Pipelines 102-20:** alternate assessment UI still allowed editing only failed responses.
- **Electric Distribution 14:** failed assessment retained prior correct selections and allowed targeted correction.
- **2026-09-15 mixed-era batch:** six SCORM 1.2 packages from multiple builder phases all reached the repair/validation stage but were blocked by two shared regressions. Universal outputs were false-failed by stale `Submit Again` prose even though the full-retake gate/reset was present; Stateful outputs still needed failed-final answer-feedback cleanup around their retained `gradeQuestion()` path. These cases are represented only by synthetic regressions in the public repository.

Text/content defects reported in those courses (truncated sentences, typos, questionable answer wording) are **content-review issues**, not automatic SCORM runtime repairs.

## Validation gates

Historical rules remain active. New behavior is additive.

Notable gates include:

- Common Rules 1–20: manifest, files, target modifications, threshold, syntax, ZIP/root, API getter, Finish message and related protections.
- Stateful rules: authoritative state, storage isolation, progress, pass/best-score, failed-assessment UX, Save & Exit, inline page compatibility and Issue #1 runtime checks.
- Universal Rule 40: prior pass/best-score preservation **plus** full-blank retake behavior.
- **Rule 60:** Exit Course control is present, wired, and Workday-safe.
- **Rule 61:** failed final assessment requires a complete blank retake.
- **Rule 62:** failed final assessment does not expose correct-answer feedback before retake.
- **Rule 99:** final Finish/last-page completion invariant.

A package is downloadable only when all applicable visible validation checks pass and no hidden historical defect remains.

## Regression tests

Primary commands:

```bash
bun install --frozen-lockfile
bun run lint
bun run test
bunx tsx test-retake-threshold.ts
bunx tsx test-universal-pass-preservation.ts
bunx tsx test-cross-profile-integrity.ts
bunx tsx test-batch-regression.ts
bun run build
```

Important suites:

- `test-verify.ts` — baseline deterministic profile/ZIP behavior.
- `test-issue1.ts` — Stateful Issue #1 runtime/lifecycle behavior.
- `test-retake-threshold.ts` — retake cleanup and threshold resolution.
- `test-universal-pass-preservation.ts` — Universal 79/80/pass-preservation/full-retake behavior.
- `test-cross-profile-integrity.ts` — cross-profile Exit Course, full retake, failed-feedback protection, Stateful non-regression, unknown/vendor no-rewrite.
- `test-batch-regression.ts` — mixed-era batch regression guard: Universal stale-prose false positives and Stateful failed-final answer-feedback cleanup, while preserving historical score/pass/modal/Save & Exit behavior.

GitHub Actions must run these suites before deployment.

## Change protocol

Before changing Scormify:

1. Read this README and the relevant transformer/validator files.
2. Make changes on the active development branch; do not merge to `main` without explicit approval.
3. Prefer **additive composition** over replacing existing working functions.
4. Do not loosen a validator merely to make a package pass; distinguish a true unsafe runtime from a validator false positive and add a regression for the exact behavior.
5. Do not silently transform an unknown/vendor runtime.
6. Never use real corporate SCORM content as a committed regression fixture.
7. Add or extend a synthetic regression for every newly discovered production behavior.
8. Require TypeScript, existing regressions, new regressions, and production build to pass.
9. Confirm GitHub Pages deployment before asking for another Workday pilot.
10. Update this README whenever a new supported profile, invariant, regression, or deliberate limitation is introduced.

## Current development context

As of **2026-09-15**, active development is on:

`fix/retake-and-legacy-universal`

The stable earlier Stateful rollback branch remains:

`fix/stateful-runtime-issue-1`

The active GitHub Pages build is expected at:

`https://jaypoj.github.io/Scormify/`

Do not treat a successful upload alone as migration completion. Workday runtime behavior still requires pilot validation with fresh learner/enrollment scenarios, failure below 80%, pass at/above 80%, relaunch, retake, best-score preservation, and Exit Course behavior.


## 2026-09-15 Universal multi-resubmit regression

A five-package mixed-era rerun exposed a Universal-only Rule 40 failure: three real Universal packages passed cross-profile Rules 61/62 but Rule 40 still found an executable `Submit Again` assignment. Root cause: the Universal transformer replaced only the first matching `submitButton.* = 'Submit Again'` statement. Some legacy builder outputs contain multiple equivalent assignments. The fix is deliberately additive and keeps Rule 40 strict: Scormify now neutralizes **all** executable `Submit Again` assignments in the parsed `submitAssessment` function, including `textContent`, `innerText`, and `innerHTML` variants. The validator is not weakened. Post-remediation diagnostic warnings are also reconciled with final cross-profile findings so resolved Exit/retake/feedback warnings do not remain in exported JSON.


## 2026-09-15 Failed-assessment resume bookmark

A learner-UX regression was confirmed across older custom-course behavior: after completing the lesson, failing the final quiz, and choosing Save & Exit, a later LMS launch could reopen at an older lesson bookmark and force the learner through page knowledge checks again. Scormify now treats the failed final assessment as the authoritative resume point. Stateful `saveAndExitCourse()` persists the full LMS state, writes `cmi.core.lesson_location` to the active/final assessment page, then sets `cmi.core.exit=suspend`, commits, and finishes. The cross-profile Exit Course handler applies the same bookmark protection for known Compact/Stateful/Universal profiles and upgrades prior Scormify canonical exit scripts. This does not bypass the final assessment, change the 80% threshold, alter best-score/pass preservation, or weaken knowledge checks during a normal first pass. Rule 45 validates the Stateful modal path and Rule 63 validates the cross-profile failed-assessment resume invariant.


## 2026-09-16 Canonical Save & Exit lifecycle

A Workday pilot of a repaired Universal-era package exposed an exit-lifecycle regression: the visible `Exit Course` control had been correctly rewired to Scormify, but the package's legacy `beforeunload` confirmation and duplicate unload-time Finish behavior could still intercept an intentional close. The prior canonical handler also ignored explicit `false` results from Commit/Finish and could display a saved/closed message without proving LMS termination.

Scormify now treats `Exit Course` and `Save & Exit` as labels for one canonical lifecycle across known Compact, Stateful, and Universal profiles. All recognized static exit controls are rewired to `scormifyExitCourse()`, historical global `exitCourse()` / `saveAndExitCourse()` calls delegate to the same function, legacy `beforeunload` / `unload` / `pagehide` handlers are guarded during intentional exit, and the canonical path requires a usable SCORM API plus successful `cmi.core.exit=suspend`, Commit, and Finish before marking the session terminated or attempting to close the Workday content window. Failed Commit/Finish leaves the package open and retryable instead of claiming success.

The Pages/verification workflows now execute `test-exit-runtime.ts`, which runs the generated canonical handler against a mocked SCORM API and verifies both the successful save/suspend/commit/finish/close sequence and fail-closed behavior when Commit returns false. `test-cross-profile-integrity.ts` also covers multiple historical exit controls and conflicting legacy unload handlers.
