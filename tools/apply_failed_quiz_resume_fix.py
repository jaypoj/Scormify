from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'Anchor not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# 1) Stateful assessment Save & Exit: save the active assessment bookmark before
#    cmi.core.exit=suspend so a failed learner resumes at the quiz instead of page 1.
#    Existing saveAndExitCourse implementations are normalized, not merely skipped.
# ---------------------------------------------------------------------------
ct_path = Path('src/utils/codeTransformer.ts')
ct = ct_path.read_text()
pattern = re.compile(
    r"  if \(!code\.includes\('function saveAndExitCourse'\)\) \{[\s\S]*?\n  \}\n\n  // 7\. MANDATORY FINAL COMPLETION NORMALIZATION PASS",
    re.M,
)
match = pattern.search(ct)
if not match:
    raise SystemExit('Stateful saveAndExitCourse injection block not found')

replacement = r'''  // Failed-final-assessment Save & Exit must checkpoint the assessment page before
  // setting cmi.core.exit=suspend. Otherwise the LMS can correctly resume the SCO
  // but the package reopens at an older bookmark and forces lesson knowledge checks again.
  const statefulSaveExitBody = `
  /* SCORMIFY STATEFUL WORKDAY: failed-assessment resume bookmark */
  if (typeof window !== 'undefined' && window._isExiting) return;
  if (typeof window !== 'undefined') window._isExiting = true;

  var __scormifyScorm = (typeof SCORM !== 'undefined' && SCORM)
    ? SCORM
    : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
  var __scormifyStatus = '';
  if (__scormifyScorm && typeof __scormifyScorm.get === 'function') {
    try { __scormifyStatus = String(__scormifyScorm.get('cmi.core.lesson_status') || '').toLowerCase(); } catch (_) {}
  }

  var __scormifyResumePage = '';
  try {
    if (typeof currentPageId === 'function') {
      __scormifyResumePage = String(currentPageId() || '');
    }
    if (!__scormifyResumePage && typeof currentPage !== 'undefined') {
      if (typeof currentPage === 'number' && typeof PAGES !== 'undefined' && Array.isArray(PAGES) && PAGES[currentPage]) {
        var __scormifyCurrentEntry = PAGES[currentPage];
        __scormifyResumePage = typeof __scormifyCurrentEntry === 'string'
          ? __scormifyCurrentEntry
          : String((__scormifyCurrentEntry && __scormifyCurrentEntry.id) || '');
      } else if (typeof currentPage === 'string') {
        __scormifyResumePage = currentPage;
      }
    }
    if (!__scormifyResumePage && typeof current !== 'undefined' && typeof current === 'number' && typeof PAGES !== 'undefined' && Array.isArray(PAGES) && PAGES[current]) {
      var __scormifyIndexedEntry = PAGES[current];
      __scormifyResumePage = typeof __scormifyIndexedEntry === 'string'
        ? __scormifyIndexedEntry
        : String((__scormifyIndexedEntry && __scormifyIndexedEntry.id) || '');
    }
    // This function is invoked by the failed final-assessment modal. If this older
    // builder does not expose its current-page variable, the assessment is the final page.
    if (!__scormifyResumePage && __scormifyStatus === 'failed' && typeof PAGES !== 'undefined' && Array.isArray(PAGES) && PAGES.length) {
      var __scormifyFinalEntry = PAGES[PAGES.length - 1];
      __scormifyResumePage = typeof __scormifyFinalEntry === 'string'
        ? __scormifyFinalEntry
        : String((__scormifyFinalEntry && __scormifyFinalEntry.id) || '');
    }
  } catch (_) {}

  // Persist the complete Stateful payload first (visited pages, knowledge checks,
  // audio gates, etc.), then explicitly overwrite the bookmark with the assessment page.
  try {
    if (typeof save === 'function') save();
    else if (typeof saveProgress === 'function') saveProgress();
  } catch (saveError) {
    console.warn('[Scormify] Failed-assessment pre-exit save notice:', saveError);
  }

  if (__scormifyScorm) {
    if (typeof __scormifyScorm.set === 'function') {
      if (__scormifyResumePage) __scormifyScorm.set('cmi.core.lesson_location', __scormifyResumePage);
      __scormifyScorm.set('cmi.core.exit', 'suspend');
    }
    if (typeof __scormifyScorm.commit === 'function') __scormifyScorm.commit();
    if (typeof __scormifyScorm.finish === 'function') __scormifyScorm.finish();
  }

  try {
    if (typeof window !== 'undefined' && window.close) window.close();
  } catch (e) {}

  if (typeof document !== 'undefined' && document.body) {
    var exitMsgEl = document.getElementById('exit-notification') || document.createElement('div');
    exitMsgEl.id = 'exit-notification';
    exitMsgEl.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.85);color:#fff;display:flex;align-items:center;justify-content:center;z-index:999999;font-family:system-ui,-apple-system,sans-serif;padding:24px;text-align:center;';
    exitMsgEl.innerHTML = '<div style="background:#1e293b;padding:24px 32px;border-radius:12px;border:1px solid #334155;max-width:440px;"><h3 style="margin:0 0 8px 0;font-size:18px;font-weight:600;">Course Progress Saved</h3><p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.5;">Your progress has been saved. Reopening the course will return you to the assessment.</p></div>';
    document.body.appendChild(exitMsgEl);
  }
`;

  const saveExitPattern = /(?:(?:var|let|const)\\s+saveAndExitCourse\\s*=\\s*function|function\\s+saveAndExitCourse)\\s*\\([^)]*\\)\\s*\\{/i;
  const saveExitBlock = findFunctionBlock(code, saveExitPattern);
  if (saveExitBlock) {
    if (!saveExitBlock.block.body.includes('SCORMIFY STATEFUL WORKDAY: failed-assessment resume bookmark')) {
      code = code.slice(0, saveExitBlock.block.contentStart) + statefulSaveExitBody + code.slice(saveExitBlock.block.contentEnd);
      changes.push('Hardened existing Save & Exit to persist Stateful progress and resume failed learners at the final assessment');
      audits.push({
        patternExpected: 'Save & Exit persists assessment bookmark before suspend/finish',
        matchFound: true,
        replacementApplied: true,
      });
      modified = true;
    }
  } else {
    code += '\\n\\nfunction saveAndExitCourse() {' + statefulSaveExitBody + '\\n}\\n';
    changes.push('Injected Save & Exit with failed-assessment resume bookmark, suspend exit, and non-destructive close');
    audits.push({
      patternExpected: 'Save & Exit persists assessment bookmark before suspend/finish',
      matchFound: false,
      replacementApplied: true,
      reason: 'Canonical Save & Exit injected because the package had no handler',
    });
    modified = true;
  }

  // 7. MANDATORY FINAL COMPLETION NORMALIZATION PASS'''
ct = ct[:match.start()] + replacement + ct[match.end():]
ct_path.write_text(ct)


# ---------------------------------------------------------------------------
# 2) Stateful validator: make resume-bookmark preservation build-blocking.
# ---------------------------------------------------------------------------
issue_path = Path('src/utils/issue1StatefulRuntime.ts')
issue = issue_path.read_text()
anchor = """  const pageContentPresent = zipFileList.some((f) => f.toLowerCase() === 'scripts/page-content.js');\n"""
addition = r'''  const saveExitBody = effectiveBody(nav, 'saveAndExitCourse');
  const saveExitResumePassed =
    saveExitBody.includes('SCORMIFY STATEFUL WORKDAY: failed-assessment resume bookmark') &&
    saveExitBody.includes('cmi.core.lesson_location') &&
    saveExitBody.includes("cmi.core.exit', 'suspend'") &&
    /typeof save\s*===\s*['"]function['"][\s\S]{0,120}save\s*\(\s*\)/.test(saveExitBody) &&
    /commit\s*\(\s*\)/.test(saveExitBody) &&
    /finish\s*\(\s*\)/.test(saveExitBody);
  checks.push({
    id: 45,
    title: 'Failed-assessment Save & Exit preserves assessment resume bookmark',
    ruleName: 'Issue #1 Failed Assessment Resume Runtime',
    file: 'scripts/navigation.js',
    passed: saveExitResumePassed,
    details: saveExitResumePassed
      ? 'PASS — failed-assessment Save & Exit persists Stateful progress, writes the assessment lesson_location bookmark, then suspends/commits/finishes'
      : 'FAIL — failed-assessment Save & Exit can relaunch at an older lesson page instead of the final assessment',
  });

'''
if anchor not in issue:
    raise SystemExit('Issue #1 validator page-content anchor not found')
issue = issue.replace(anchor, addition + anchor, 1)
issue_path.write_text(issue)


# ---------------------------------------------------------------------------
# 3) Cross-profile Exit Course: preserve/repair the bookmark too. This covers
#    Universal/Compact top-right Exit Course and upgrades already-fixed packages.
# ---------------------------------------------------------------------------
cp_path = Path('src/utils/crossProfileWorkdayHardening.ts')
cp = cp_path.read_text()
cp = cp.replace(
    "const EXIT_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: exit-course integrity';\n",
    "const EXIT_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: exit-course integrity';\nconst EXIT_RESUME_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: failed-assessment resume bookmark';\n",
    1,
)

# Make the existing safety detector distinguish reads from status writes.
old_write_check = "  const writesStatus = /(?:cmi\\.core\\.lesson_status|cmi\\.completion_status|cmi\\.success_status)[\\s\\S]{0,140}(?:completed|passed|failed)/i.test(body);\n"
new_write_check = "  const writesStatus = /(?:set|setValue|LMSSetValue)\\s*\\(\\s*['\"](?:cmi\\.core\\.lesson_status|cmi\\.completion_status|cmi\\.success_status)['\"]/i.test(body);\n"
if old_write_check not in cp:
    raise SystemExit('Cross-profile writesStatus anchor not found')
cp = cp.replace(old_write_check, new_write_check, 1)

# Add a dedicated bookmark detector after hasSafeExitHandler.
anchor_safe = """function hasExitWiring(fileContents: Record<string, string>, launchHtmlPath: string | null): boolean {\n"""
bookmark_helper = r'''function exitBodyPreservesResumeBookmark(body: string | null): boolean {
  if (!body) return false;
  const writesBookmark = /(?:set|setValue|LMSSetValue)\s*\(\s*['"]cmi\.core\.lesson_location['"]/i.test(body);
  const suspends = /(?:set|setValue|LMSSetValue)\s*\(\s*['"]cmi\.core\.exit['"][\s\S]{0,100}['"]suspend['"]/i.test(body);
  const commits = /(?:\.commit\s*\(|LMSCommit\s*\()/i.test(body);
  const finishes = /(?:\.finish\s*\(|LMSFinish\s*\()/i.test(body);
  return writesBookmark && suspends && commits && finishes;
}

function hasAssessmentResumeBookmark(fileContents: Record<string, string>): boolean {
  for (const source of Object.values(fileContents)) {
    if (!source) continue;
    if (source.includes(EXIT_RESUME_MARKER)) return true;
    const body = findExitFunctionBody(source);
    if (exitBodyPreservesResumeBookmark(body)) return true;
  }
  return false;
}

'''
if anchor_safe not in cp:
    raise SystemExit('Cross-profile hasExitWiring anchor not found')
cp = cp.replace(anchor_safe, bookmark_helper + anchor_safe, 1)

# Adapter gets read access so the exit path can detect failed status/current bookmark.
adapter_repls = [
    (
        "        set: function(k, v) { return window.SafeSCORM.setValue(k, v); },\n        commit:",
        "        get: function(k) { return typeof window.SafeSCORM.getValue === 'function' ? window.SafeSCORM.getValue(k) : ''; },\n        set: function(k, v) { return window.SafeSCORM.setValue(k, v); },\n        commit:"
    ),
    (
        "        set: function(k, v) { return window.SCORM.set(k, v); },\n        commit:",
        "        get: function(k) { return typeof window.SCORM.get === 'function' ? window.SCORM.get(k) : ''; },\n        set: function(k, v) { return window.SCORM.set(k, v); },\n        commit:"
    ),
    (
        "        set: function(k, v) { return window.UniversalSCORM.setValue(k, v); },\n        commit:",
        "        get: function(k) { return typeof window.UniversalSCORM.getValue === 'function' ? window.UniversalSCORM.getValue(k) : ''; },\n        set: function(k, v) { return window.UniversalSCORM.setValue(k, v); },\n        commit:"
    ),
    (
        "        set: function(k, v) { return window.API.LMSSetValue(k, String(v)); },\n        commit:",
        "        get: function(k) { return typeof window.API.LMSGetValue === 'function' ? window.API.LMSGetValue(k) : ''; },\n        set: function(k, v) { return window.API.LMSSetValue(k, String(v)); },\n        commit:"
    ),
]
for old, new in adapter_repls:
    if old not in cp:
        raise SystemExit(f'Adapter anchor not found: {old[:60]}')
    cp = cp.replace(old, new, 1)

# Insert bookmark preservation into canonical exit handler.
exit_anchor = """    var adapter = getAdapter();\n    if (adapter) {\n      try { adapter.set('cmi.core.exit', 'suspend'); } catch (_) {}\n      try { adapter.commit(); } catch (_) {}\n      try { adapter.finish(); } catch (_) {}\n    }\n"""
exit_replacement = r'''    var adapter = getAdapter();
    if (adapter) {
      /* ${EXIT_RESUME_MARKER} */
      var __scormifyStatus = '';
      var __scormifyResumePage = '';
      try { __scormifyStatus = String(adapter.get ? (adapter.get('cmi.core.lesson_status') || '') : '').toLowerCase(); } catch (_) {}
      try {
        if (typeof currentPageId === 'function') __scormifyResumePage = String(currentPageId() || '');
        if (!__scormifyResumePage && typeof currentPage !== 'undefined') {
          if (typeof currentPage === 'number' && typeof PAGES !== 'undefined' && Array.isArray(PAGES) && PAGES[currentPage]) {
            var __scormifyCurrentEntry = PAGES[currentPage];
            __scormifyResumePage = typeof __scormifyCurrentEntry === 'string' ? __scormifyCurrentEntry : String((__scormifyCurrentEntry && __scormifyCurrentEntry.id) || '');
          } else if (typeof currentPage === 'string') {
            __scormifyResumePage = currentPage;
          }
        }
        if (!__scormifyResumePage && typeof current !== 'undefined' && typeof current === 'number' && typeof PAGES !== 'undefined' && Array.isArray(PAGES) && PAGES[current]) {
          var __scormifyIndexedEntry = PAGES[current];
          __scormifyResumePage = typeof __scormifyIndexedEntry === 'string' ? __scormifyIndexedEntry : String((__scormifyIndexedEntry && __scormifyIndexedEntry.id) || '');
        }
        if (!__scormifyResumePage && __scormifyStatus === 'failed' && typeof PAGES !== 'undefined' && Array.isArray(PAGES) && PAGES.length) {
          var __scormifyFinalEntry = PAGES[PAGES.length - 1];
          __scormifyResumePage = typeof __scormifyFinalEntry === 'string' ? __scormifyFinalEntry : String((__scormifyFinalEntry && __scormifyFinalEntry.id) || '');
        }
        if (!__scormifyResumePage && adapter.get) __scormifyResumePage = String(adapter.get('cmi.core.lesson_location') || '');
      } catch (_) {}

      try { if (__scormifyResumePage) adapter.set('cmi.core.lesson_location', __scormifyResumePage); } catch (_) {}
      try { adapter.set('cmi.core.exit', 'suspend'); } catch (_) {}
      try { adapter.commit(); } catch (_) {}
      try { adapter.finish(); } catch (_) {}
    }
'''
if exit_anchor not in cp:
    raise SystemExit('Canonical exit handler anchor not found')
cp = cp.replace(exit_anchor, exit_replacement, 1)

# Upgrade a prior Scormify canonical exit script if it lacks the new marker.
inject_anchor = """  let updated = html;\n  let changed = false;\n  let repairedExisting = false;\n\n  const tagPattern = /<(button|a)\\b([^>]*)>([\\s\\S]*?)<\\/\\1>/gi;\n"""
inject_replacement = r'''  let updated = html;
  let changed = false;
  let repairedExisting = false;

  const priorCanonicalExit = /<script\s+id=["']scormify-exit-integrity["'][^>]*>[\s\S]*?<\/script>/i;
  if (priorCanonicalExit.test(updated) && !updated.includes(EXIT_RESUME_MARKER)) {
    updated = updated.replace(priorCanonicalExit, CANONICAL_EXIT_SCRIPT.trim());
    changed = true;
  }

  const tagPattern = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
'''
if inject_anchor not in cp:
    raise SystemExit('injectOrRepairExitHtml initialization anchor not found')
cp = cp.replace(inject_anchor, inject_replacement, 1)
cp = cp.replace("  if (!updated.includes(EXIT_MARKER)) {\n", "  if (!updated.includes(EXIT_RESUME_MARKER)) {\n", 1)

# Existing safe suspend/finish is no longer enough when a final assessment exists.
exit_need_anchor = """  const exitNeedsRepair =\n    before.exitControl === 'MISSING' ||\n    before.exitHandler === 'MISSING_OR_UNSAFE' ||\n    before.exitWiring === 'MISSING_OR_BROKEN';\n"""
exit_need_replacement = """  const resumeBookmarkNeeded = hasFinalAssessmentRuntime(updatedContents) && !hasAssessmentResumeBookmark(updatedContents);\n  const exitNeedsRepair =\n    before.exitControl === 'MISSING' ||\n    before.exitHandler === 'MISSING_OR_UNSAFE' ||\n    before.exitWiring === 'MISSING_OR_BROKEN' ||\n    resumeBookmarkNeeded;\n"""
if exit_need_anchor not in cp:
    raise SystemExit('exitNeedsRepair anchor not found')
cp = cp.replace(exit_need_anchor, exit_need_replacement, 1)

# Add Rule 63 without changing the existing Rules 60-62 contract.
validation_anchor = """  const feedbackPassed = findings.assessmentFeedbackProtection !== 'UNSAFE';\n\n  return [\n"""
validation_replacement = """  const feedbackPassed = findings.assessmentFeedbackProtection !== 'UNSAFE';\n  const resumeBookmarkApplicable = hasFinalAssessmentRuntime(updatedFilesMap);\n  const resumeBookmarkPassed = !resumeBookmarkApplicable || hasAssessmentResumeBookmark(updatedFilesMap);\n\n  return [\n"""
if validation_anchor not in cp:
    raise SystemExit('Cross-profile validation anchor not found')
cp = cp.replace(validation_anchor, validation_replacement, 1)

rule62_end = r'''    {
      id: 62,
      title: 'Failed final assessment does not reveal correct answers before retake',
      ruleName: 'Cross-profile Failed Assessment Feedback Protection',
      file: getNavigationCandidates(updatedFilesMap)[0] || 'scripts/navigation.js',
      passed: feedbackPassed,
      details: findings.assessmentFeedbackProtection === 'NOT_APPLICABLE'
        ? 'PASS — no scored final-assessment feedback path detected in this package'
        : (feedbackPassed
          ? 'PASS — failed final-assessment answer feedback/correctness styling is suppressed before a new retake; lesson knowledge-check feedback remains untouched'
          : 'FAIL — failed final assessment may expose answer-revealing feedback or correctness styling before retake'),
    },
'''
rule63 = rule62_end + r'''    {
      id: 63,
      title: 'Failed assessment exit preserves the assessment resume bookmark',
      ruleName: 'Cross-profile Failed Assessment Resume Integrity',
      file: getLaunchHtmlPath(updatedFilesMap, launchResource) || getNavigationCandidates(updatedFilesMap)[0] || 'index.html',
      passed: resumeBookmarkPassed,
      details: !resumeBookmarkApplicable
        ? 'PASS — no scored final assessment detected; assessment-resume bookmark rule is not applicable'
        : (resumeBookmarkPassed
          ? 'PASS — exiting after a failed final assessment preserves/writes cmi.core.lesson_location before suspend/commit/finish so relaunch can return to the assessment'
          : 'FAIL — failed-assessment exit can suspend without preserving the assessment bookmark, causing relaunch at an older lesson page'),
    },
'''
if rule62_end not in cp:
    raise SystemExit('Rule 62 block anchor not found')
cp = cp.replace(rule62_end, rule63, 1)
cp_path.write_text(cp)


# ---------------------------------------------------------------------------
# 4) Regression coverage: Stateful runtime bookmark + cross-profile upgrades.
# ---------------------------------------------------------------------------
rt_path = Path('test-retake-threshold.ts')
rt = rt_path.read_text()
rt = rt.replace("let current=0;", "let current=1;", 1)
insert_after = """assert.match(transformed.code, /correct-answer.*incorrect-answer/s, 'Retake must clear stale answer-state classes');\n"""
rt_add = r'''
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
'''
if insert_after not in rt:
    raise SystemExit('Retake test insertion anchor not found')
rt = rt.replace(insert_after, insert_after + rt_add, 1)
rt = rt.replace(
    "console.log('- retake clears feedback/result/answer-state presentation');\n",
    "console.log('- retake clears feedback/result/answer-state presentation');\nconsole.log('- failed Save & Exit bookmarks the final assessment before suspend/finish');\n",
    1,
)
rt_path.write_text(rt)

cp_test_path = Path('test-cross-profile-integrity.ts')
ctest = cp_test_path.read_text()
ctest = ctest.replace(
    "assert(compactHtml.includes('adapter.finish()'), 'C1: exit handler does not finish the SCORM session');\n",
    "assert(compactHtml.includes('adapter.finish()'), 'C1: exit handler does not finish the SCORM session');\nassert(compactHtml.includes('SCORMIFY CROSS-PROFILE WORKDAY: failed-assessment resume bookmark'), 'C1: failed-assessment resume bookmark marker missing');\nassert(compactHtml.includes('cmi.core.lesson_location'), 'C1: exit handler does not preserve lesson_location');\n",
    1,
)
ctest = ctest.replace(
    "assert(analyzeCrossProfileWorkdayIntegrity(universalResult.updatedContents, universalProfile, 'index.html').assessmentFeedbackProtection === 'SAFE', 'U1: Universal feedback protection still validates unsafe');\n",
    "assert(analyzeCrossProfileWorkdayIntegrity(universalResult.updatedContents, universalProfile, 'index.html').assessmentFeedbackProtection === 'SAFE', 'U1: Universal feedback protection still validates unsafe');\nassert(universalResult.updatedContents['index.html'].includes('SCORMIFY CROSS-PROFILE WORKDAY: failed-assessment resume bookmark'), 'U1: Universal Exit Course was not upgraded with failed-assessment resume bookmarking');\nassert(validateCrossProfileWorkdayIntegrity(universalResult.updatedContents, universalProfile, 'index.html').every((c) => c.passed), 'U1: one or more cross-profile Universal validation rules failed');\n",
    1,
)
# Keep S1 as the already-safe/no-rewrite case by giving it the new approved marker/bookmark.
ctest = ctest.replace(
    "function saveAndExitCourse(){ SCORM.set('cmi.core.exit','suspend'); SCORM.commit(); SCORM.finish(); }",
    "function saveAndExitCourse(){ /* SCORMIFY STATEFUL WORKDAY: failed-assessment resume bookmark */ if(typeof save==='function') save(); SCORM.set('cmi.core.lesson_location','assessment'); SCORM.set('cmi.core.exit','suspend'); SCORM.commit(); SCORM.finish(); }",
    1,
)
# Add a Statefull legacy safe-but-unbookmarked upgrade case before N1.
n1_anchor = """// N1 — Unknown/vendor profile is inspection-only: no deterministic rewrite.\n"""
s2 = r'''// S2 — A legacy Stateful handler that suspends safely but does not preserve the
// final-assessment bookmark must be upgraded instead of being treated as complete.
const statefulLegacyExitInput: Record<string, string> = {
  'index.html': `<!doctype html><html><body><header><button id="btn-save-exit" onclick="saveAndExitCourse()">Save &amp; Exit</button></header><script src="scripts/navigation.js"></script></body></html>`,
  'scripts/navigation.js': `
function saveAndExitCourse(){ SCORM.set('cmi.core.exit','suspend'); SCORM.commit(); SCORM.finish(); }
function submitQuiz(score){ /* ISSUE1_ASSESSMENT_PRESERVATION */ showAssessmentModal(score, score, score >= 80 ? 'passed' : 'failed'); }
function showAssessmentModal(){ var label='Retake Assessment'; var inputs=document.querySelectorAll('.assessment-card input[type="radio"]'); for(var i=0;i<inputs.length;i++) inputs[i].checked=false; }
`,
};
const statefulLegacyExitResult = hardenCrossProfileWorkdayPackage(statefulLegacyExitInput, statefulProfile, 'index.html');
assert(statefulLegacyExitResult.updatedContents['index.html'].includes('SCORMIFY CROSS-PROFILE WORKDAY: failed-assessment resume bookmark'), 'S2: legacy Stateful exit was not upgraded with a resume bookmark');
assert(statefulLegacyExitResult.updatedContents['index.html'].includes('cmi.core.lesson_location'), 'S2: upgraded Stateful exit does not preserve lesson_location');
assert(validateCrossProfileWorkdayIntegrity(statefulLegacyExitResult.updatedContents, statefulProfile, 'index.html').every((c) => c.passed), 'S2: upgraded Stateful legacy exit failed cross-profile validation');

'''
if n1_anchor not in ctest:
    raise SystemExit('Cross-profile N1 anchor not found')
ctest = ctest.replace(n1_anchor, s2 + n1_anchor, 1)
ctest = ctest.replace(
    "console.log('- Stateful working Save & Exit / modal behavior is recognized and left intact');\n",
    "console.log('- Stateful working Save & Exit / modal behavior is recognized and left intact');\nconsole.log('- failed-assessment exits preserve lesson_location so relaunch can return to the quiz');\n",
    1,
)
cp_test_path.write_text(ctest)


# ---------------------------------------------------------------------------
# 5) Living README note.
# ---------------------------------------------------------------------------
readme_path = Path('README.md')
readme = readme_path.read_text()
marker = '## 2026-09-15 Failed-assessment resume bookmark\n'
if marker not in readme:
    readme += r'''

## 2026-09-15 Failed-assessment resume bookmark

A learner-UX regression was confirmed across older custom-course behavior: after completing the lesson, failing the final quiz, and choosing Save & Exit, a later LMS launch could reopen at an older lesson bookmark and force the learner through page knowledge checks again. Scormify now treats the failed final assessment as the authoritative resume point. Stateful `saveAndExitCourse()` persists the full LMS state, writes `cmi.core.lesson_location` to the active/final assessment page, then sets `cmi.core.exit=suspend`, commits, and finishes. The cross-profile Exit Course handler applies the same bookmark protection for known Compact/Stateful/Universal profiles and upgrades prior Scormify canonical exit scripts. This does not bypass the final assessment, change the 80% threshold, alter best-score/pass preservation, or weaken knowledge checks during a normal first pass. Rule 45 validates the Stateful modal path and Rule 63 validates the cross-profile failed-assessment resume invariant.
'''
    readme_path.write_text(readme)

print('Failed-assessment resume bookmark patch prepared.')
