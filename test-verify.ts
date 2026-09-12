// Setup browser globals for Node test run
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
if (typeof (globalThis as any).window.parent === 'undefined') {
  (globalThis as any).window.parent = globalThis;
}
if (typeof (globalThis as any).document === 'undefined') {
  const elementsById: { [k: string]: any } = {};
  (globalThis as any).document = {
    createElement: (tag: string) => {
      const el: any = {
        tagName: tag.toUpperCase(),
        id: '',
        style: {},
        innerHTML: '',
        children: [],
        attrs: {} as Record<string, string>,
        setAttribute: (k: string, v: string) => { el.attrs[k] = v; },
        getAttribute: (k: string) => el.attrs[k],
        appendChild: (child: any) => { el.children.push(child); return child; },
        remove: () => {},
        addEventListener: () => {},
      };
      return el;
    },
    getElementById: (id: string) => elementsById[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
  };
  (globalThis as any).window.document = (globalThis as any).document;
}
if (typeof (globalThis as any).localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => { store[key] = String(val); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k in store) delete store[k]; },
  };
  (globalThis as any).window.localStorage = (globalThis as any).localStorage;
}

import { runSyntheticTestSuite } from './src/utils/syntheticTestFixtures';

async function main() {
  console.log('Running deterministic test suite...');
  const results = await runSyntheticTestSuite();
  let failCount = 0;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${mark} [${r.testId}] ${r.title}`);
    if (!r.passed) {
      failCount++;
      console.log(`  Expected: ${r.expected}`);
      console.log(`  Actual:   ${r.actual}`);
      console.log(`  Details:  ${r.details}`);
    }
  }
  console.log(`\nResults: ${results.length - failCount}/${results.length} passed.`);
  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
