import vm from 'node:vm';
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
