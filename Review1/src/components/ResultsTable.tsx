import React, { useState } from 'react';
import {
  Download,
  Eye,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Search,
  ShieldCheck,
  Wrench,
  Loader2,
  Info,
  FolderDown,
} from 'lucide-react';
import { PackageInspectionResult, ActionStatus } from '../types';
import { downloadBlob } from '../utils/exportLogs';
import { getPreFixIssues, getProfileShortName, formatBytes } from '../utils/packageSummary';
import { PackageDownloadActions } from './PackageDownloadActions';

interface ResultsTableProps {
  packages: PackageInspectionResult[];
  onSelectPackage: (
    pkg: PackageInspectionResult,
    initialTab?: 'OVERVIEW' | 'PRE_FIX' | 'PATCH_CHANGES' | 'VALIDATION' | 'FILES' | 'AUDIT'
  ) => void;
  onPatchSingle?: (pkg: PackageInspectionResult) => void;
  isProcessing: boolean;
  packageProgressStates?: Record<string, 'PATCHING' | 'VALIDATING'>;
}

export const ResultsTable: React.FC<ResultsTableProps> = ({
  packages,
  onSelectPackage,
  onPatchSingle,
  isProcessing,
  packageProgressStates = {},
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ActionStatus>('ALL');

  const filtered = packages.filter((pkg) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      pkg.originalFileName.toLowerCase().includes(term) ||
      (pkg.actualPackageName && pkg.actualPackageName.toLowerCase().includes(term));
    if (statusFilter === 'ALL') return matchesSearch;
    return matchesSearch && pkg.actionStatus === statusFilter;
  });

  const getResultBadge = (pkg: PackageInspectionResult) => {
    const progressState = packageProgressStates[pkg.id];
    if (progressState === 'PATCHING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
          PATCHING...
        </span>
      );
    }
    if (progressState === 'VALIDATING') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-sky-100 text-sky-900 border border-sky-300 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-700" />
          VALIDATING...
        </span>
      );
    }

    switch (pkg.actionStatus) {
      case 'PATCHED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-700" />
            PATCHED
          </span>
        );
      case 'READY_TO_PATCH':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
            READY TO PATCH
          </span>
        );
      case 'NO CHANGE NEEDED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-stone-100 text-stone-700 border border-stone-200">
            NO CHANGE NEEDED
          </span>
        );
      case 'MANUAL REVIEW':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
            MANUAL REVIEW
          </span>
        );
      case 'FAILED VALIDATION':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
            FAILED VALIDATION
          </span>
        );
      case 'UNSUPPORTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            UNSUPPORTED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-stone-100 text-stone-600">
            {pkg.actionStatus}
          </span>
        );
    }
  };

  return (
    <section className="bg-white rounded-xl border border-stone-200 shadow-xs overflow-hidden">
      {/* Table toolbar */}
      <div className="p-4 border-b border-stone-200 bg-stone-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              id="search-packages-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search package name..."
              className="pl-9 pr-3 py-1.5 text-xs bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400 w-60 font-mono"
            />
          </div>
          <span className="text-xs text-stone-500 font-mono">
            {filtered.length} of {packages.length} package{packages.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'ALL' ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            All ({packages.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('READY_TO_PATCH')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'READY_TO_PATCH' ? 'bg-emerald-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Eligible ({packages.filter((p) => p.actionStatus === 'READY_TO_PATCH').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PATCHED')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'PATCHED' ? 'bg-emerald-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Patched ({packages.filter((p) => p.actionStatus === 'PATCHED').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('FAILED VALIDATION')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'FAILED VALIDATION' ? 'bg-rose-700 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Failed ({packages.filter((p) => p.actionStatus === 'FAILED VALIDATION').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('MANUAL REVIEW')}
            className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
              statusFilter === 'MANUAL REVIEW' ? 'bg-amber-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Review ({packages.filter((p) => p.actionStatus === 'MANUAL REVIEW').length})
          </button>
        </div>
      </div>

      {/* Table Container with Requirement 5 layout */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-stone-700 border-collapse">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-100/80 font-bold text-stone-800 uppercase tracking-wider text-[11px]">
              <th className="py-3 px-4 min-w-[220px]">Package</th>
              <th className="py-3 px-3 min-w-[140px]">Profile</th>
              <th className="py-3 px-3 min-w-[150px]">Pre-Fix Issues</th>
              <th className="py-3 px-3 min-w-[110px]">Files Modified</th>
              <th className="py-3 px-3 min-w-[140px]">Validation</th>
              <th className="py-3 px-3 min-w-[130px]">Result</th>
              <th className="py-3 px-4 text-right min-w-[200px]">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-stone-400">
                  No packages match the current filter or search.
                </td>
              </tr>
            ) : (
              filtered.map((pkg) => {
                const preFixIssues = getPreFixIssues(pkg);
                const progressState = packageProgressStates[pkg.id];
                const isPatched = pkg.actionStatus === 'PATCHED';
                const hasOuter = Boolean(pkg.outerFileName && pkg.outerFileName !== pkg.actualPackageName);
                const passedCount = pkg.validationChecks.filter((c) => c.passed).length;
                const totalChecks = pkg.validationChecks.length;
                const testErrorsCount = pkg.validationChecks.filter((c) => c.outcome === 'TEST_ERROR').length;
                const failedCount = totalChecks - passedCount;
                const genuineFailCount = pkg.validationChecks.filter((c) => !c.passed && c.outcome !== 'TEST_ERROR').length;

                return (
                  <tr
                    key={pkg.id}
                    onClick={() => onSelectPackage(pkg, 'OVERVIEW')}
                    className="hover:bg-stone-50/80 cursor-pointer transition-colors"
                  >
                    {/* 1. Package */}
                    <td className="py-3.5 px-4 font-mono text-stone-900" title={pkg.originalFileName}>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-stone-900 truncate max-w-[260px]">
                            {pkg.actualPackageName || pkg.originalFileName}
                          </span>
                          {pkg.isOuterWrapper && (
                            <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 text-[9px] font-bold rounded shrink-0">
                              NESTED SCORM
                            </span>
                          )}
                        </div>
                        {hasOuter && (
                          <span className="text-[10px] text-purple-700 font-normal truncate mt-0.5">
                            Outer: {pkg.outerFileName}
                          </span>
                        )}
                        <div className="text-[10px] text-stone-500 font-normal flex items-center gap-1.5 mt-1 font-mono">
                          <span className="text-emerald-700 font-semibold flex items-center gap-0.5">
                            <CheckCircle className="w-3 h-3 text-emerald-600 inline" />
                            Scanned
                          </span>
                          <span>•</span>
                          <span>{pkg.zipEntriesCount} files</span>
                          <span>•</span>
                          <span>{pkg.scanDurationMs} ms</span>
                          <span>•</span>
                          <span>{formatBytes(pkg.fileSize)}</span>
                        </div>
                      </div>
                    </td>

                    {/* 2. Profile */}
                    <td className="py-3.5 px-3 font-mono">
                      <div className="flex flex-col">
                        <span className="font-bold text-stone-800 text-[11px]" title={pkg.repairProfile}>
                          {getProfileShortName(pkg.repairProfile)}
                        </span>
                        <span className="text-[10px] text-stone-500 mt-0.5 truncate max-w-[130px]" title={pkg.repairProfile}>
                          {pkg.scormVersion}
                        </span>
                      </div>
                    </td>

                    {/* 3. Pre-Fix Issues */}
                    <td className="py-3.5 px-3">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPackage(pkg, 'PRE_FIX');
                        }}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer hover:underline border bg-amber-50 text-amber-900 border-amber-200"
                        title={preFixIssues.join('\n') || 'No defects detected'}
                      >
                        <AlertTriangle className="w-3 h-3 text-amber-700 shrink-0" />
                        <span>{preFixIssues.length} issue{preFixIssues.length === 1 ? '' : 's'} detected</span>
                      </div>
                    </td>

                    {/* 4. Files Modified */}
                    <td className="py-3.5 px-3 font-mono">
                      {pkg.filesModified.length > 0 ? (
                        <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          {pkg.filesModified.length} file{pkg.filesModified.length === 1 ? '' : 's'} modified
                        </span>
                      ) : (
                        <span className="text-stone-400">0 files</span>
                      )}
                    </td>

                    {/* 5. Validation */}
                    <td className="py-3.5 px-3">
                      {progressState === 'VALIDATING' ? (
                        <span className="inline-flex items-center gap-1 text-sky-800 bg-sky-50 px-2 py-0.5 rounded text-[11px] font-bold border border-sky-200 animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin text-sky-600" />
                          VALIDATING...
                        </span>
                      ) : progressState === 'PATCHING' ? (
                        <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 px-2 py-0.5 rounded text-[11px] font-bold border border-amber-200 animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                          PATCHING...
                        </span>
                      ) : totalChecks > 0 ? (
                        pkg.validationPassed ? (
                          <span className="inline-flex items-center gap-1 text-emerald-800 font-bold bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-300 text-[11px]">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                            {totalChecks}/{totalChecks} PASS
                          </span>
                        ) : testErrorsCount > 0 && genuineFailCount === 0 ? (
                          <span className="inline-flex items-center gap-1 text-amber-900 font-bold bg-amber-100/80 px-2 py-0.5 rounded border border-amber-300 text-[11px]">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />
                            {passedCount}/{totalChecks} PASS ({testErrorsCount} test error)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-800 font-bold bg-rose-100/80 px-2 py-0.5 rounded border border-rose-300 text-[11px]">
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            {passedCount}/{totalChecks} PASS ({failedCount} failed)
                          </span>
                        )
                      ) : pkg.actionStatus === 'READY_TO_PATCH' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-bold border border-emerald-200">
                          <CheckCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                          Pre-Scan Ready
                        </span>
                      ) : pkg.actionStatus === 'NO CHANGE NEEDED' ? (
                        <span className="inline-flex items-center gap-1 text-stone-600 bg-stone-100 px-2 py-0.5 rounded text-[10px] font-medium">
                          No Fix Required
                        </span>
                      ) : (
                        <span className="text-stone-400 text-[10px] italic">Awaiting Patch</span>
                      )}
                    </td>

                    {/* 6. Result */}
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      {getResultBadge(pkg)}
                    </td>

                    {/* 7. Action */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {/* Primary Download Fixed ZIP (Direct synchronous anchor download) */}
                        {pkg.validationPassed && (pkg.patchedZipBlob || pkg.patchedBlob) && pkg.patchedFileName ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              id={`btn-download-${pkg.id}`}
                              onClick={() => {
                                const blob = pkg.patchedZipBlob || pkg.patchedBlob;
                                if (blob && pkg.patchedFileName) {
                                  downloadBlob(blob, pkg.patchedFileName);
                                }
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
                              title="Direct synchronous download of repaired SCORM ZIP"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download Fixed ZIP
                            </button>
                            {typeof window !== 'undefined' && 'showSaveFilePicker' in window && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const blob = pkg.patchedZipBlob || pkg.patchedBlob;
                                    if (!blob || !pkg.patchedFileName) return;
                                    const handle = await (window as any).showSaveFilePicker({
                                      suggestedName: pkg.patchedFileName,
                                      types: [{ description: 'SCORM Package (.zip)', accept: { 'application/zip': ['.zip'] } }],
                                    });
                                    const writable = await handle.createWritable();
                                    await writable.write(blob);
                                    await writable.close();
                                  } catch {
                                    // optional picker cancelled or restricted
                                  }
                                }}
                                className="p-1.5 text-stone-500 hover:text-stone-800 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                                title="Secondary enhancement: Save As (File System Picker)"
                              >
                                <FolderDown className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ) : pkg.actionStatus === 'FAILED VALIDATION' ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <button
                              type="button"
                              onClick={() => onSelectPackage(pkg, 'VALIDATION')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 rounded text-[11px] font-bold transition-colors cursor-pointer"
                              title="Inspect failing post-patch validation rules"
                            >
                              <XCircle className="w-3 h-3 text-rose-600" />
                              View Failed Rule
                            </button>
                            <span className="text-[9px] text-rose-600 font-bold uppercase tracking-wider">
                              DOWNLOAD DISABLED — VALIDATION FAILED
                            </span>
                          </div>
                        ) : pkg.actionStatus === 'READY_TO_PATCH' && onPatchSingle ? (
                          <button
                            type="button"
                            onClick={() => onPatchSingle(pkg)}
                            disabled={isProcessing}
                            className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
                            title="Apply Workday remediation fixes to this package"
                          >
                            <Wrench className="w-3.5 h-3.5" />
                            Apply Fix
                          </button>
                        ) : null}

                        {/* Inspect detail modal button */}
                        <button
                          type="button"
                          onClick={() => onSelectPackage(pkg, 'OVERVIEW')}
                          className="p-1.5 text-stone-500 hover:text-stone-900 rounded-lg hover:bg-stone-100 transition-colors"
                          title="Inspect package audit details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
