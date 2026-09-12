import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, Wrench, ShieldAlert } from 'lucide-react';
import { BatchSummary } from '../types';

interface ProgressBarProps {
  phase: 'SCANNING' | 'PATCHING';
  summary: BatchSummary;
  currentStatusText?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  phase,
  summary,
  currentStatusText,
}) => {
  const currentIdx = summary.currentIndex ?? 0;
  const total = summary.total || 1;
  const percent = Math.min(100, Math.round((currentIdx / total) * 100));

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-xs p-5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-stone-700 animate-spin" />
          <span className="text-xs font-bold uppercase tracking-wider text-stone-900">
            {phase === 'SCANNING' ? 'PHASE A — INSPECTING & CLASSIFYING BATCH' : 'PHASE B — REMEDIATING & VALIDATING ELIGIBLE PACKAGES'}
          </span>
        </div>
        <div className="text-xs font-bold text-stone-700 font-mono">
          Processing {Math.min(currentIdx + 1, total)} of {total} ({percent}%)
        </div>
      </div>

      {summary.currentFileName && (
        <div className="mb-3 flex items-center justify-between text-xs bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 truncate">
            <span className="font-semibold text-stone-500 shrink-0">Active ZIP:</span>
            <span className="font-mono text-stone-900 truncate font-medium">
              {summary.currentFileName}
            </span>
          </div>
          {currentStatusText && (
            <span className="text-stone-500 font-mono text-[11px] shrink-0 pl-2">
              {currentStatusText}
            </span>
          )}
        </div>
      )}

      {/* Visual Progress Bar */}
      <div className="w-full bg-stone-100 rounded-full h-2.5 overflow-hidden mb-4 border border-stone-200">
        <div
          className="bg-stone-900 h-2.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Counters row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-stone-100">
        <div className="p-2 rounded-lg bg-stone-50 border border-stone-100 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-stone-500" />
          <div>
            <div className="text-[10px] uppercase font-semibold text-stone-500">Processed</div>
            <div className="text-sm font-bold text-stone-900 font-mono">{summary.completed} / {summary.total}</div>
          </div>
        </div>

        <div className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-100 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-emerald-600" />
          <div>
            <div className="text-[10px] uppercase font-semibold text-emerald-700">Patched</div>
            <div className="text-sm font-bold text-emerald-900 font-mono">{summary.patched}</div>
          </div>
        </div>

        <div className="p-2 rounded-lg bg-stone-50 border border-stone-100 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-stone-400" />
          <div>
            <div className="text-[10px] uppercase font-semibold text-stone-500">No Change</div>
            <div className="text-sm font-bold text-stone-800 font-mono">{summary.noChange}</div>
          </div>
        </div>

        <div className="p-2 rounded-lg bg-amber-50/60 border border-amber-100 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <div>
            <div className="text-[10px] uppercase font-semibold text-amber-700">Manual Review</div>
            <div className="text-sm font-bold text-amber-900 font-mono">{summary.manualReview}</div>
          </div>
        </div>

        <div className="p-2 rounded-lg bg-rose-50/60 border border-rose-100 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600" />
          <div>
            <div className="text-[10px] uppercase font-semibold text-rose-700">Failed</div>
            <div className="text-sm font-bold text-rose-900 font-mono">{summary.failed}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
