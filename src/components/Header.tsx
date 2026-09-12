import React from 'react';
import { ShieldCheck, Cpu, DatabaseZap, AlertTriangle, PlayCircle, FolderOpen } from 'lucide-react';

interface HeaderProps {
  onOpenTestSuite: () => void;
  onLoadSyntheticSamples: () => void;
  isProcessing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenTestSuite,
  onLoadSyntheticSamples,
  isProcessing,
}) => {
  return (
    <header className="border-b border-stone-200 bg-white shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-lg bg-stone-900 text-white flex items-center justify-center font-bold text-lg tracking-wider shadow-xs">
                S→W
              </div>
              <div>
                <h1 className="text-2xl font-bold text-stone-900 tracking-tight">
                  SCORM → Workday Repair Tool
                </h1>
                <p className="text-sm font-medium text-stone-600">
                  Deterministic SCORM package remediation • All processing remains on this device
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck className="w-3.5 h-3.5" />
                100% Client-Side
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                <DatabaseZap className="w-3.5 h-3.5" />
                Zero API / Zero AI Calls
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                <Cpu className="w-3.5 h-3.5" />
                Deterministic Regex & AST Engine
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              id="btn-run-tests"
              onClick={onOpenTestSuite}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border border-stone-300 bg-stone-50 text-stone-700 hover:bg-stone-100 transition-colors disabled:opacity-50"
            >
              <PlayCircle className="w-4 h-4 text-stone-600" />
              Run Test Suite (A–M, C1–C5, E)
            </button>
            <button
              type="button"
              id="btn-load-sample"
              onClick={onLoadSyntheticSamples}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition-colors disabled:opacity-50 shadow-xs"
            >
              <FolderOpen className="w-4 h-4" />
              Load Sample Packages (with Nested)
            </button>
          </div>
        </div>

        {/* Workday Configuration Reminder Callout */}
        <div className="mt-4 p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 text-amber-900 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <strong className="font-semibold text-amber-950">Workday Configuration Reminder: </strong>
            Workday configuration must also be validated separately. For quiz-based packaged content, confirm the Workday Media lesson is configured to provide/track the course grade as required by your organization's Workday configuration.
          </div>
        </div>
      </div>
    </header>
  );
};
