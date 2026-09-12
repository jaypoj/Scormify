import React, { useState, useEffect } from 'react';
import { X, PlayCircle, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { SyntheticTestResult } from '../types';
import { runSyntheticTestSuite } from '../utils/syntheticTestFixtures';

interface TestModeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TestModeModal: React.FC<TestModeModalProps> = ({ isOpen, onClose }) => {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SyntheticTestResult[]>([]);

  const runTests = async () => {
    setRunning(true);
    try {
      const res = await runSyntheticTestSuite();
      setResults(res);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runTests();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const totalPassed = results.filter((r) => r.passed).length;
  const allPassed = results.length > 0 && totalPassed === results.length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-xl border border-stone-200 shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-stone-900 text-white flex items-center justify-center font-bold text-xs">
              TEST
            </div>
            <div>
              <h3 className="text-sm font-bold text-stone-900">
                SCORM Repair Engine Unit Test Suite (Tests A–I)
              </h3>
              <p className="text-xs text-stone-500">
                Deterministic verification against synthetic fixtures & edge cases
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={running}
              onClick={runTests}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 text-xs font-semibold hover:bg-stone-50 disabled:opacity-50"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Re-run Tests
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200/60"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-6 py-3 border-b border-stone-200 bg-stone-50/50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-stone-700">Suite Status:</span>
            {running ? (
              <span className="text-stone-500 font-mono flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Executing synthetic test suite...
              </span>
            ) : allPassed ? (
              <span className="text-emerald-700 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> All {results.length} Tests Passed Successfully (100%)
              </span>
            ) : (
              <span className="text-rose-700 font-bold flex items-center gap-1">
                <XCircle className="w-4 h-4 text-rose-600" /> {totalPassed} of {results.length} Tests Passed
              </span>
            )}
          </div>
          <span className="font-mono text-stone-500 text-[11px]">
            Tests A–I (Core Profiles) + Tests W1–W10 (Workday Profile)
          </span>
        </div>

        {/* Results List */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {running ? (
            <div className="py-12 text-center text-stone-400 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-stone-700" />
              <span>Running synthetic SCORM test suite...</span>
            </div>
          ) : (
            results.map((test) => (
              <div
                key={test.testId}
                className={`p-3.5 rounded-lg border text-xs ${
                  test.passed ? 'border-stone-200 bg-stone-50/60' : 'border-rose-200 bg-rose-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    {test.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-bold text-stone-900 font-mono">
                        <span className="text-stone-500 mr-2">{test.testId}:</span>
                        {test.title}
                      </div>
                      <div className="text-stone-500 text-[11px] mt-0.5">
                        {test.details}
                      </div>
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                    test.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    {test.passed ? 'PASSED' : 'FAILED'}
                  </span>
                </div>

                <div className="mt-2.5 pt-2 border-t border-stone-200/60 grid grid-cols-2 gap-2 text-[10px] font-mono text-stone-600">
                  <div>
                    <span className="text-stone-400">EXPECTED: </span>
                    <code>{test.expected}</code>
                  </div>
                  <div>
                    <span className="text-stone-400">ACTUAL: </span>
                    <code>{test.actual}</code>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 bg-stone-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-stone-900 text-white font-semibold text-xs hover:bg-stone-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
