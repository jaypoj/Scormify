from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'src/utils/crossProfileWorkdayHardening.ts'
TEST = ROOT / 'test-exit-runtime.ts'
CROSS_TEST = ROOT / 'test-cross-profile-integrity.ts'
DEPLOY = ROOT / '.github/workflows/deploy-issue1-preview.yml'
VERIFY = ROOT / '.github/workflows/retake-threshold-verify.yml'
README = ROOT / 'README.md'


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    require(count == 1, f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


text = TARGET.read_text()

text = replace_once(
    text,
    "const EXIT_RESUME_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: failed-assessment resume bookmark';\n",
    "const EXIT_RESUME_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: failed-assessment resume bookmark';\n"
    "const EXIT_RUNTIME_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: verified save-exit lifecycle';\n"
    "const UNLOAD_GUARD_MARKER = 'SCORMIFY CROSS-PROFILE WORKDAY: intentional-exit unload guard';\n",
    'exit runtime constants',
)

text = replace_once(
    text,
    "    if (source.includes(EXIT_MARKER) && source.includes('scormifyExitCourse')) return true;",
    "    if (source.includes(EXIT_MARKER) && source.includes(EXIT_RUNTIME_MARKER) && source.includes('scormifyExitCourse')) return true;",
    'canonical exit handler validation',
)

canonical = r'''const CANONICAL_EXIT_SCRIPT = `
<script id="scormify-exit-integrity">
/* ${EXIT_MARKER} */
/* ${EXIT_RUNTIME_MARKER} */
(function() {
  function getAdapter() {
    if (window.SafeSCORM && typeof window.SafeSCORM.setValue === 'function' && typeof window.SafeSCORM.commit === 'function' && typeof window.SafeSCORM.finish === 'function') {
      return {
        get: function(k) { return typeof window.SafeSCORM.getValue === 'function' ? window.SafeSCORM.getValue(k) : ''; },
        set: function(k, v) { return window.SafeSCORM.setValue(k, v); },
        commit: function() { return window.SafeSCORM.commit(); },
        finish: function() { return window.SafeSCORM.finish(); }
      };
    }
    if (window.SCORM && typeof window.SCORM.set === 'function' && typeof window.SCORM.commit === 'function' && typeof window.SCORM.finish === 'function') {
      return {
        get: function(k) { return typeof window.SCORM['get'] === 'function' ? window.SCORM['get'](k) : ''; },
        set: function(k, v) { return window.SCORM.set(k, v); },
        commit: function() { return window.SCORM.commit(); },
        finish: function() { return window.SCORM.finish(); }
      };
    }
    if (window.UniversalSCORM && typeof window.UniversalSCORM.setValue === 'function' && typeof window.UniversalSCORM.commit === 'function' && typeof window.UniversalSCORM.finish === 'function') {
      return {
        get: function(k) { return typeof window.UniversalSCORM.getValue === 'function' ? window.UniversalSCORM.getValue(k) : ''; },
        set: function(k, v) { return window.UniversalSCORM.setValue(k, v); },
        commit: function() { return window.UniversalSCORM.commit(); },
        finish: function() { return window.UniversalSCORM.finish(); }
      };
    }
    if (window.API && typeof window.API.LMSSetValue === 'function' && typeof window.API.LMSCommit === 'function' && typeof window.API.LMSFinish === 'function') {
      return {
        get: function(k) { return typeof window.API.LMSGetValue === 'function' ? window.API.LMSGetValue(k) : ''; },
        set: function(k, v) { return window.API.LMSSetValue(k, String(v)); },
        commit: function() { return window.API.LMSCommit(''); },
        finish: function() { return window.API.LMSFinish(''); }
      };
    }
    return null;
  }

  function showExitMessage(title, message, isError) {
    if (typeof document === 'undefined' || !document.body) return;
    var existing = document.getElementById('scormify-exit-saved-message');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var overlay = document.createElement('div');
    overlay.id = 'scormify-exit-saved-message';
    overlay.setAttribute('role', isError ? 'alert' : 'status');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.88);z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,-apple-system,sans-serif;text-align:center;color:#fff;';
    overlay.innerHTML = '<div style="max-width:520px;background:#1e293b;border:1px solid #475569;border-radius:12px;padding:24px 28px;"><h2 style="font-size:20px;margin:0 0 8px;">' + title + '</h2><p style="margin:0;color:#cbd5e1;line-height:1.5;">' + message + '</p></div>';
    document.body.appendChild(overlay);
  }

  function failExit(message) {
    window.__scormifyExitInProgress = false;
    window.__scormifySuppressUnloadPrompt = false;
    window.__scormifySessionTerminated = false;
    try { console.error('[Scormify] Save & Exit failed:', message); } catch (_) {}
    showExitMessage('Unable to Exit Safely', 'Your course remains open because Scormify could not confirm that Workday saved and closed the SCORM session. Please keep this window open and try Save & Exit again.', true);
    return false;
  }

  function resultFailed(value) {
    return value === false || value === 'false';
  }

  window.scormifyExitCourse = function(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (window.__scormifyExitInProgress) return false;
    window.__scormifyExitInProgress = true;
    window.__scormifySuppressUnloadPrompt = true;
    window.__scormifySessionTerminated = false;

    try {
      if (typeof window.saveProgress === 'function') window.saveProgress();
      else if (typeof window.save === 'function') window.save();
      else if (typeof saveProgress === 'function') saveProgress();
      else if (typeof save === 'function') save();
    } catch (saveError) {
      try { console.warn('[Scormify] Pre-exit save notice:', saveError); } catch (_) {}
    }

    var adapter = getAdapter();
    if (!adapter) return failExit('No usable SCORM 1.2 API adapter with set/commit/finish was available.');

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

    try {
      if (__scormifyResumePage && resultFailed(adapter.set('cmi.core.lesson_location', __scormifyResumePage))) {
        return failExit('The LMS rejected the resume bookmark.');
      }
    } catch (_) {
      return failExit('The LMS threw an error while saving the resume bookmark.');
    }

    try {
      if (resultFailed(adapter.set('cmi.core.exit', 'suspend'))) return failExit('The LMS rejected cmi.core.exit=suspend.');
    } catch (_) {
      return failExit('The LMS threw an error while setting cmi.core.exit=suspend.');
    }

    try {
      if (resultFailed(adapter.commit())) return failExit('LMS Commit returned failure.');
    } catch (_) {
      return failExit('LMS Commit threw an error.');
    }

    try {
      if (resultFailed(adapter.finish())) return failExit('LMS Finish returned failure.');
    } catch (_) {
      return failExit('LMS Finish threw an error.');
    }

    window.__scormifySessionTerminated = true;

    setTimeout(function() {
      try { window.close(); } catch (_) {}
      setTimeout(function() {
        if (!window.closed) {
          showExitMessage('Course Progress Saved', 'Your course progress was saved and the SCORM session was closed with Workday. If this window does not close automatically, use Workday\'s close control to return to Learning.', false);
        }
      }, 250);
    }, 50);
    return false;
  };

  window.scormifySaveAndExit = window.scormifyExitCourse;
  window.saveAndExitCourse = function(event) { return window.scormifyExitCourse(event); };
  window.exitCourse = function(event) { return window.scormifyExitCourse(event); };
})();
</script>`;'''

pattern = re.compile(r"const CANONICAL_EXIT_SCRIPT = `\n<script id=\"scormify-exit-integrity\">[\s\S]*?</script>`;", re.M)
text, n = pattern.subn(lambda _m: canonical, text, count=1)
require(n == 1, f'canonical script replacement: expected 1 match, found {n}')

text = replace_once(text, "let repairedExisting = false;", "let repairedExistingCount = 0;", 'exit control counter declaration')
text = replace_once(
    text,
    "    if (repairedExisting || !isExitLikeControl(`<${tagName}${attrs}>`, inner)) return full;\n    repairedExisting = true;",
    "    if (!isExitLikeControl(`<${tagName}${attrs}>`, inner)) return full;\n    repairedExistingCount += 1;",
    'rewire all exit controls',
)
text = replace_once(text, "  if (!repairedExisting) {", "  if (repairedExistingCount === 0) {", 'inject only when no exit controls')
text = replace_once(
    text,
    "    description: repairedExisting\n      ? 'Rewired existing Exit Course control to the canonical Workday-safe exit handler'\n      : 'Injected persistent Exit Course control and canonical Workday-safe exit handler',",
    "    description: repairedExistingCount > 0\n      ? `Rewired ${repairedExistingCount} existing Exit Course / Save & Exit control(s) to the canonical Workday-safe exit handler`\n      : 'Injected persistent Save & Exit control and canonical Workday-safe exit handler',",
    'exit repair description',
)
text = text.replace(
    '>Exit Course</button>`;',
    '>Save &amp; Exit</button>`;',
    1,
)

unload_guard_helper = r'''
function guardIntentionalExitUnload(source: string): { source: string; changed: boolean } {
  let updated = source;
  let changed = false;
  const guard = `\n    /* ${UNLOAD_GUARD_MARKER} */\n    if (typeof window !== 'undefined' && (window.__scormifyExitInProgress || window.__scormifySessionTerminated)) return;`;
  const patterns = [
    /((?:window\.)?addEventListener\s*\(\s*['"](?:beforeunload|unload|pagehide)['"]\s*,\s*function\s*\([^)]*\)\s*\{)/gi,
    /((?:window\.)?addEventListener\s*\(\s*['"](?:beforeunload|unload|pagehide)['"]\s*,\s*\([^)]*\)\s*=>\s*\{)/gi,
    /(window\.onbeforeunload\s*=\s*function\s*\([^)]*\)\s*\{)/gi,
  ];

  for (const pattern of patterns) {
    updated = updated.replace(pattern, (match) => {
      const nearbyStart = Math.max(0, updated.indexOf(match));
      const nearby = updated.slice(nearbyStart, nearbyStart + match.length + 220);
      if (nearby.includes(UNLOAD_GUARD_MARKER)) return match;
      changed = true;
      return match + guard;
    });
  }

  return { source: updated, changed };
}

function intentionalExitUnloadGuardsAreSafe(fileContents: Record<string, string>): boolean {
  for (const [path, source] of Object.entries(fileContents)) {
    if (!source || !/\.(?:js|html?|htm)$/i.test(path)) continue;
    const hasPotentialConflict =
      /(?:beforeunload|pagehide|['"]unload['"])/i.test(source) &&
      /(?:preventDefault\s*\(|returnValue\s*=|\.finish\s*\(|LMSFinish\s*\()/i.test(source);
    if (hasPotentialConflict && !source.includes(UNLOAD_GUARD_MARKER)) return false;
  }
  return true;
}
'''
anchor = "\nconst COMPACT_ASSESSMENT_HELPERS = `"
require(anchor in text, 'unload guard helper anchor missing')
text = text.replace(anchor, unload_guard_helper + anchor, 1)

nav_anchor = "\n  const navCandidates = getNavigationCandidates(updatedContents);"
guard_application = r'''

  // Canonical Save & Exit must not be blocked or double-finished by legacy unload handlers.
  for (const filePath of Object.keys(updatedContents)) {
    if (!/\.(?:js|html?|htm)$/i.test(filePath)) continue;
    const original = updatedContents[filePath];
    if (!original || !/(?:beforeunload|pagehide|['"]unload['"])/i.test(original)) continue;
    const guarded = guardIntentionalExitUnload(original);
    if (guarded.changed && guarded.source !== original) {
      updatedContents[filePath] = guarded.source;
      if (!filesModified.includes(filePath)) filesModified.push(filePath);
      codeChanges.push({
        filePath,
        description: 'Guarded legacy unload/close logic so intentional Scormify Save & Exit is not blocked or double-finished',
        beforeSnippet: original.slice(0, 300),
        afterSnippet: guarded.source.slice(0, 300),
      });
      audits.push({
        filePath,
        patternExpected: 'legacy beforeunload/unload/pagehide handler bypasses itself during canonical Save & Exit',
        matchFound: true,
        replacementApplied: true,
        contentChanged: true,
      });
      logs.push(`Canonical Save & Exit unload guard applied in ${filePath}`);
    }
  }
'''
require(nav_anchor in text, 'navCandidates anchor missing')
text = text.replace(nav_anchor, guard_application + nav_anchor, 1)

text = replace_once(
    text,
    "  const exitPassed =\n    findings.exitControl === 'PRESENT' &&\n    findings.exitHandler === 'SAFE' &&\n    findings.exitWiring === 'WIRED';",
    "  const unloadGuardsPassed = intentionalExitUnloadGuardsAreSafe(updatedFilesMap);\n  const exitPassed =\n    findings.exitControl === 'PRESENT' &&\n    findings.exitHandler === 'SAFE' &&\n    findings.exitWiring === 'WIRED' &&\n    unloadGuardsPassed;",
    'exit validation includes unload guards',
)
text = replace_once(
    text,
    "        ? 'PASS — visible Exit Course control is wired to a handler that sets cmi.core.exit=suspend, commits, finishes, preserves LMS status/score, and provides a close fallback'",
    "        ? 'PASS — all recognized Exit Course / Save & Exit controls use the verified canonical lifecycle: save/bookmark, cmi.core.exit=suspend, checked commit, checked finish, intentional-unload guard, and close fallback'",
    'Rule 60 pass wording',
)
text = replace_once(
    text,
    "        : `FAIL — Exit Course integrity incomplete (control=${findings.exitControl}, handler=${findings.exitHandler}, wiring=${findings.exitWiring})`,",
    "        : `FAIL — Exit Course integrity incomplete (control=${findings.exitControl}, handler=${findings.exitHandler}, wiring=${findings.exitWiring}, unloadGuards=${unloadGuardsPassed ? 'SAFE' : 'UNSAFE'})`,",
    'Rule 60 fail wording',
)

TARGET.write_text(text)

# Extend existing cross-profile regression with the exact production failure shape.
cross = CROSS_TEST.read_text()
insert_before = "\n// ---------------------------------------------------------------------------\n// U1 — Universal builder era"
require(insert_before in cross, 'cross-profile test insertion anchor missing')
new_case = r'''

// C3 — Multiple historical exit controls + legacy beforeunload confirmation must all
// converge on the canonical handler, and the unload prompt must bypass intentional exit.
const multiExitInput: Record<string, string> = {
  'index.html': `<!doctype html><html><body><header>
    <button id="exit-course" onclick="exitCourse()">Exit Course</button>
    <button id="btn-save-exit" onclick="saveAndExitCourse()">Save &amp; Exit</button>
  </header><script src="scripts/navigation.js"></script><script src="scripts/scorm-api.js"></script></body></html>`,
  'scripts/navigation.js': `
var COURSE_SETTINGS = { confirmExit: true };
window.addEventListener('beforeunload', function(e) {
  if (COURSE_SETTINGS.confirmExit) { e.preventDefault(); e.returnValue = 'Are you sure?'; return 'Are you sure?'; }
});
function exitCourse(){ if(window.UniversalSCORM){ UniversalSCORM.setValue('cmi.core.exit','suspend'); UniversalSCORM.commit(); UniversalSCORM.finish(); } }
function saveAndExitCourse(){ exitCourse(); }
`,
  'scripts/scorm-api.js': `
window.addEventListener('beforeunload', function() {
  if (window.UniversalSCORM) { UniversalSCORM.commit(); UniversalSCORM.finish(); }
});
window.UniversalSCORM = window.UniversalSCORM || {};
`,
};
const multiExitResult = hardenCrossProfileWorkdayPackage(multiExitInput, universalProfile, 'index.html');
const multiExitHtml = multiExitResult.updatedContents['index.html'];
const multiExitNav = multiExitResult.updatedContents['scripts/navigation.js'];
const multiExitApi = multiExitResult.updatedContents['scripts/scorm-api.js'];
assert((multiExitHtml.match(/onclick="return scormifyExitCourse\(event\)"/g) || []).length === 2, 'C3: every existing exit control was not canonicalized');
assert(multiExitHtml.includes('verified save-exit lifecycle'), 'C3: verified lifecycle marker missing');
assert(multiExitHtml.includes("resultFailed(adapter.commit())"), 'C3: canonical exit does not check Commit result');
assert(multiExitHtml.includes("resultFailed(adapter.finish())"), 'C3: canonical exit does not check Finish result');
assert(multiExitNav.includes('intentional-exit unload guard'), 'C3: legacy confirmation beforeunload was not guarded');
assert(multiExitApi.includes('intentional-exit unload guard'), 'C3: legacy duplicate Finish beforeunload was not guarded');
assert(validateCrossProfileWorkdayIntegrity(multiExitResult.updatedContents, universalProfile, 'index.html').every((c) => c.passed), 'C3: canonical multi-exit lifecycle failed validation');
'''
cross = cross.replace(insert_before, new_case + insert_before, 1)
CROSS_TEST.write_text(cross)

runtime_test = r'''import vm from 'node:vm';
import { hardenCrossProfileWorkdayPackage } from './src/utils/crossProfileWorkdayHardening';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const profile = 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1' as const;
const input: Record<string, string> = {
  'index.html': '<!doctype html><html><body><header><button onclick="exitCourse()">Exit Course</button></header></body></html>',
  'scripts/navigation.js': `window.addEventListener('beforeunload', function(e){ e.preventDefault(); e.returnValue='Are you sure?'; });`,
};

const repaired = hardenCrossProfileWorkdayPackage(input, profile, 'index.html');
const html = repaired.updatedContents['index.html'];
const scriptMatch = html.match(/<script id="scormify-exit-integrity">([\s\S]*?)<\/script>/i);
assert(scriptMatch, 'Runtime test: canonical exit script was not injected');

function runScenario(commitResult: boolean) {
  const calls: string[] = [];
  let closeCalls = 0;
  const values: Record<string, string> = {
    'cmi.core.lesson_status': 'incomplete',
    'cmi.core.lesson_location': 'lesson-2',
  };

  const windowObj: any = {
    closed: false,
    UniversalSCORM: {
      getValue(key: string) { calls.push('get:' + key); return values[key] || ''; },
      setValue(key: string, value: string) { calls.push('set:' + key + '=' + value); values[key] = value; return true; },
      commit() { calls.push('commit'); return commitResult; },
      finish() { calls.push('finish'); return true; },
    },
    saveProgress() { calls.push('saveProgress'); },
    close() { closeCalls += 1; windowObj.closed = true; },
  };

  const context: any = {
    window: windowObj,
    console,
    setTimeout(fn: Function) { fn(); return 0; },
    Array,
    String,
  };
  windowObj.window = windowObj;
  vm.createContext(context);
  vm.runInContext(scriptMatch[1], context);
  windowObj.scormifyExitCourse({ preventDefault() { calls.push('preventDefault'); } });
  return { calls, closeCalls, windowObj };
}

const success = runScenario(true);
assert(success.calls.includes('saveProgress'), 'Runtime success: saveProgress did not run');
assert(success.calls.includes('set:cmi.core.exit=suspend'), 'Runtime success: cmi.core.exit=suspend was not written');
assert(success.calls.filter((c) => c === 'commit').length === 1, 'Runtime success: Commit must run exactly once');
assert(success.calls.filter((c) => c === 'finish').length === 1, 'Runtime success: Finish must run exactly once');
assert(success.closeCalls === 1, 'Runtime success: close should occur after successful termination');
assert(success.windowObj.__scormifySessionTerminated === true, 'Runtime success: session termination flag not set');

const failedCommit = runScenario(false);
assert(failedCommit.calls.filter((c) => c === 'commit').length === 1, 'Runtime failure: Commit should be attempted once');
assert(!failedCommit.calls.includes('finish'), 'Runtime failure: Finish must not run after failed Commit');
assert(failedCommit.closeCalls === 0, 'Runtime failure: window must remain open after failed Commit');
assert(failedCommit.windowObj.__scormifySessionTerminated === false, 'Runtime failure: session must not be marked terminated');
assert(failedCommit.windowObj.__scormifyExitInProgress === false, 'Runtime failure: retry lock must be released');

console.log('Canonical Save & Exit runtime regression: PASS');
console.log('- successful lifecycle saves, suspends, commits once, finishes once, then closes');
console.log('- failed Commit blocks Finish/close and leaves the course retryable');
'''
TEST.write_text(runtime_test)

for workflow in [DEPLOY, VERIFY]:
    if not workflow.exists():
        continue
    wf = workflow.read_text()
    if 'Canonical Save & Exit runtime regression' not in wf:
        anchor = "      - name: Cross-profile Workday integrity regression\n        run: bunx tsx test-cross-profile-integrity.ts\n"
        require(anchor in wf, f'{workflow.name}: cross-profile workflow anchor missing')
        wf = wf.replace(
            anchor,
            anchor + "\n      - name: Canonical Save & Exit runtime regression\n        run: bunx tsx test-exit-runtime.ts\n",
            1,
        )
        workflow.write_text(wf)

readme = README.read_text()
if 'Canonical Save & Exit lifecycle' not in readme:
    readme += r'''

## 2026-09-16 Canonical Save & Exit lifecycle

A Workday pilot of a repaired Universal-era package exposed an exit-lifecycle regression: the visible `Exit Course` control had been correctly rewired to Scormify, but the package's legacy `beforeunload` confirmation and duplicate unload-time Finish behavior could still intercept an intentional close. The prior canonical handler also ignored explicit `false` results from Commit/Finish and could display a saved/closed message without proving LMS termination.

Scormify now treats `Exit Course` and `Save & Exit` as labels for one canonical lifecycle across known Compact, Stateful, and Universal profiles. All recognized static exit controls are rewired to `scormifyExitCourse()`, historical global `exitCourse()` / `saveAndExitCourse()` calls delegate to the same function, legacy `beforeunload` / `unload` / `pagehide` handlers are guarded during intentional exit, and the canonical path requires a usable SCORM API plus successful `cmi.core.exit=suspend`, Commit, and Finish before marking the session terminated or attempting to close the Workday content window. Failed Commit/Finish leaves the package open and retryable instead of claiming success.

The Pages/verification workflows now execute `test-exit-runtime.ts`, which runs the generated canonical handler against a mocked SCORM API and verifies both the successful save/suspend/commit/finish/close sequence and fail-closed behavior when Commit returns false. `test-cross-profile-integrity.ts` also covers multiple historical exit controls and conflicting legacy unload handlers.
'''
    README.write_text(readme)

print('Canonical Save & Exit fix staged successfully.')
