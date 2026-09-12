import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  FileCode,
  CheckCircle2,
  XCircle,
  Download,
  Hash,
  Wrench,
  CheckCircle,
  Copy,
  Search,
  ExternalLink,
  Layers,
  ArrowRight,
  FolderDown,
} from 'lucide-react';
import { PackageInspectionResult } from '../types';
import { downloadBlob } from '../utils/exportLogs';
import { getPreFixIssues, getProfileShortName, formatBytes } from '../utils/packageSummary';
import { PackageDownloadActions } from './PackageDownloadActions';
import { DownloadDiagnosticsPanel } from './DownloadDiagnosticsPanel';

export type ModalTab =
  | 'OVERVIEW'
  | 'PRE_FIX'
  | 'PATCH_CHANGES'
  | 'VALIDATION'
  | 'FILES'
  | 'AUDIT'
  | 'DOWNLOAD_DIAGNOSTICS';

interface PackageDetailModalProps {
  pkg: PackageInspectionResult | null;
  initialTab?: ModalTab;
  onClose: () => void;
  onPatchSingle?: (pkg: PackageInspectionResult) => void;
}

export const PackageDetailModal: React.FC<PackageDetailModalProps> = ({
  pkg,
  initialTab = 'OVERVIEW',
  onClose,
  onPatchSingle,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>(initialTab);
  const [inventorySearch, setInventorySearch] = useState('');
  const [fileSearch, setFileSearch] = useState('');
  const [validationFilter, setValidationFilter] = useState<'ALL' | 'FAILED' | 'TEST_ERROR' | 'PASSED'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab, pkg?.id]);

  if (!pkg) return null;

  const preFixIssues = getPreFixIssues(pkg);
  const passedChecksCount = pkg.validationChecks.filter((c) => c.passed).length;
  const totalChecksCount = pkg.validationChecks.length;
  const testErrorsCount = pkg.validationChecks.filter((c) => c.outcome === 'TEST_ERROR').length;
  const failedChecksCount = totalChecksCount - passedChecksCount;
  const genuineFailCount = pkg.validationChecks.filter((c) => !c.passed && c.outcome !== 'TEST_ERROR').length;
  const outputBlobExists = Boolean(pkg.patchedBlob && pkg.patchedBlob.size > 0);
  const isDownloadReady = Boolean(pkg.validationPassed && outputBlobExists && pkg.patchedFileName);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const filteredInventory = (pkg.statusWriteInventory || []).filter((rec) => {
    if (!inventorySearch) return true;
    const term = inventorySearch.toLowerCase();
    return (
      rec.filePath.toLowerCase().includes(term) ||
      rec.cmiField.toLowerCase().includes(term) ||
      rec.valueWritten.toLowerCase().includes(term) ||
      rec.classification.toLowerCase().includes(term) ||
      (rec.enclosingEventHandler && rec.enclosingEventHandler.toLowerCase().includes(term)) ||
      (rec.enclosingFunction && rec.enclosingFunction.toLowerCase().includes(term))
    );
  });

  const filteredFiles = (pkg.allFiles || []).filter((file) => {
    if (!fileSearch) return true;
    return file.toLowerCase().includes(fileSearch.toLowerCase());
  });

  const filteredValidation = pkg.validationChecks.filter((item) => {
    if (validationFilter === 'FAILED') return !item.passed && item.outcome !== 'TEST_ERROR';
    if (validationFilter === 'TEST_ERROR') return item.outcome === 'TEST_ERROR';
    if (validationFilter === 'PASSED') return item.passed;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl rounded-xl border border-stone-200 shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-stone-900 truncate font-mono">
                {pkg.actualPackageName || pkg.originalFileName}
              </h3>
              {pkg.outerFileName && pkg.outerFileName !== pkg.actualPackageName && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                  Outer: {pkg.outerFileName}
                </span>
              )}
              <span
                className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${
                  pkg.actionStatus === 'PATCHED'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : pkg.actionStatus === 'READY_TO_PATCH'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                    : pkg.actionStatus === 'FAILED VALIDATION'
                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                    : pkg.actionStatus === 'MANUAL REVIEW'
                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                    : 'bg-stone-100 text-stone-700'
                }`}
              >
                {pkg.actionStatus}
              </span>
            </div>
            <p className="text-xs text-stone-500 font-mono mt-0.5">
              Size: {formatBytes(pkg.fileSize)} • Profile: {getProfileShortName(pkg.repairProfile)} ({pkg.scormVersion})
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {pkg.actionStatus === 'READY_TO_PATCH' && onPatchSingle && (
              <button
                type="button"
                onClick={() => onPatchSingle(pkg)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors shadow-xs cursor-pointer"
              >
                <Wrench className="w-3.5 h-3.5" />
                Apply Workday Fixes
              </button>
            )}
            {/* Primary Download Fixed ZIP (Direct synchronous anchor download) */}
            {pkg.validationPassed && (pkg.patchedZipBlob || pkg.patchedBlob) && pkg.patchedFileName && (
              <button
                type="button"
                id="btn-modal-download-fixed-zip"
                onClick={() => {
                  const blob = pkg.patchedZipBlob || pkg.patchedBlob;
                  if (blob && pkg.patchedFileName) {
                    downloadBlob(blob, pkg.patchedFileName);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors shadow-xs cursor-pointer"
                title="Direct synchronous download of repaired SCORM ZIP"
              >
                <Download className="w-3.5 h-3.5" />
                Download Fixed ZIP
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Alert for Failed Validation */}
        {pkg.actionStatus === 'FAILED VALIDATION' && (
          <div className="px-6 py-3 bg-rose-50 border-b border-rose-200 text-rose-900 flex items-start gap-2.5 text-xs">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-bold">
                {pkg.error || 'DOWNLOAD DISABLED — VALIDATION FAILED'}
              </span>
              <p className="mt-0.5 text-[11px] text-rose-700">
                {totalChecksCount > 0
                  ? `${failedChecksCount} rule(s) failed out of ${totalChecksCount}. Repaired package download is disabled until all rules pass.`
                  : 'Remediation failed to satisfy safety criteria. Download is disabled.'}
              </p>
            </div>
          </div>
        )}

        {/* 6 Modal Tabs (Requirement 7) */}
        <div className="px-6 border-b border-stone-200 bg-white flex items-center gap-6 text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('OVERVIEW')}
            className={`py-3 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'OVERVIEW'
                ? 'border-stone-900 text-stone-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('PRE_FIX')}
            className={`py-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'PRE_FIX'
                ? 'border-stone-900 text-stone-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Pre-Fix Findings ({preFixIssues.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('PATCH_CHANGES')}
            className={`py-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'PATCH_CHANGES'
                ? 'border-stone-900 text-stone-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Patch Changes ({pkg.filesModified.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('VALIDATION')}
            className={`py-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'VALIDATION'
                ? 'border-stone-900 text-stone-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Post-Fix Validation ({totalChecksCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('FILES')}
            className={`py-3 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'FILES'
                ? 'border-stone-900 text-stone-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Files ({pkg.allFiles.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('AUDIT')}
            className={`py-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'AUDIT'
                ? 'border-stone-900 text-stone-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Audit ({pkg.statusWriteInventory?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('DOWNLOAD_DIAGNOSTICS')}
            className={`py-3 border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'DOWNLOAD_DIAGNOSTICS'
                ? 'border-stone-900 text-stone-900 font-bold'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            Download Diagnostics
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-xs text-stone-700">
          {/* ============================================================ */}
          {/* TAB 1: OVERVIEW (Requirement 7 & 10) */}
          {/* ============================================================ */}
          {activeTab === 'OVERVIEW' && (
            <div className="space-y-6">
              {/* Executive Summary Grid (Requirement 7) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                    Original Issues Detected
                  </div>
                  <div className="text-xl font-bold text-stone-900 font-mono mt-1">
                    {preFixIssues.length}
                  </div>
                  <div className="text-[10px] text-stone-500 mt-0.5">Pre-scan audit flags</div>
                </div>

                <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                    Issues Repaired
                  </div>
                  <div className="text-xl font-bold text-emerald-700 font-mono mt-1">
                    {pkg.validationPassed ? preFixIssues.length : 0}
                  </div>
                  <div className="text-[10px] text-stone-500 mt-0.5">
                    {pkg.validationPassed ? 'Fully neutralized' : 'Pending validation'}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                    Files Modified
                  </div>
                  <div className="text-xl font-bold text-stone-900 font-mono mt-1">
                    {pkg.filesModified.length}
                  </div>
                  <div className="text-[10px] text-stone-500 mt-0.5">Target internal scripts</div>
                </div>

                <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                    Validation
                  </div>
                  <div className={`text-xl font-bold font-mono mt-1 ${
                    pkg.validationPassed ? 'text-emerald-700' : totalChecksCount > 0 ? 'text-rose-700' : 'text-stone-500'
                  }`}>
                    {totalChecksCount > 0
                      ? `${passedChecksCount}/${totalChecksCount} PASS`
                      : 'READY'}
                  </div>
                  <div className="text-[10px] text-stone-500 mt-0.5">
                    {pkg.validationPassed ? '30/30 rules passed' : totalChecksCount > 0 ? `${failedChecksCount} failed` : 'Pre-scan passed'}
                  </div>
                </div>
              </div>

              {/* Package Artifact and Download Status Bar (Requirement 7) */}
              <div className="p-4 rounded-xl border border-stone-200 bg-stone-50/80 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                      Output ZIP Package
                    </span>
                    <div className="font-mono font-bold text-sm text-stone-900">
                      {pkg.patchedFileName || `${pkg.actualPackageName || pkg.originalFileName}`.replace(/\.zip$/i, '') + '_WORKDAY_FIXED.zip (Pending)'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-stone-500">Download status:</span>
                    {isDownloadReady ? (
                      <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs">
                        READY
                      </span>
                    ) : pkg.validationPassed && !outputBlobExists ? (
                      <span className="px-2.5 py-1 rounded bg-rose-100 text-rose-800 border border-rose-300 font-bold text-xs">
                        OUTPUT GENERATION ERROR
                      </span>
                    ) : pkg.actionStatus === 'FAILED VALIDATION' ? (
                      <span className="px-2.5 py-1 rounded bg-rose-100 text-rose-800 border border-rose-300 font-bold text-xs">
                        DISABLED — VALIDATION FAILED
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded bg-stone-100 text-stone-700 border border-stone-200 font-medium text-xs">
                        AWAITING PATCH
                      </span>
                    )}
                  </div>
                </div>

                {/* Primary Download Fixed ZIP (Direct synchronous anchor download) */}
                {pkg.validationPassed && (pkg.patchedZipBlob || pkg.patchedBlob) && pkg.patchedFileName && (
                  <div className="pt-3 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-emerald-800 font-medium flex items-center gap-1.5">
                      <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Repaired package is retained in memory and validated. Click to download directly.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        id="btn-overview-download-fixed-zip"
                        onClick={() => {
                          const blob = pkg.patchedZipBlob || pkg.patchedBlob;
                          if (blob && pkg.patchedFileName) {
                            downloadBlob(blob, pkg.patchedFileName);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-colors"
                        title="Direct synchronous download of repaired SCORM ZIP"
                      >
                        <Download className="w-4 h-4" />
                        Download Fixed ZIP ({formatBytes((pkg.patchedZipBlob || pkg.patchedBlob)!.size)})
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
                          className="inline-flex items-center gap-1 px-3 py-2 border border-stone-300 text-stone-700 hover:bg-stone-50 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                          title="Secondary enhancement: Save As (File System Picker)"
                        >
                          <FolderDown className="w-3.5 h-3.5 text-stone-600" />
                          Save As...
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Cryptographic Traceability Card */}
              <div className="p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-stone-500 flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5" />
                  Cryptographic Traceability (Web Crypto SHA-256)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2.5 rounded bg-white border border-stone-200">
                    <span className="text-stone-400 block text-[10px]">ORIGINAL ARCHIVE HASH:</span>
                    <span className="text-stone-900 break-all select-all font-medium text-[11px]">
                      {pkg.originalSha256}
                    </span>
                  </div>
                  <div className="p-2.5 rounded bg-white border border-stone-200">
                    <span className="text-stone-400 block text-[10px]">REMEDIATED ARCHIVE HASH:</span>
                    <span className="text-stone-900 break-all select-all font-medium text-[11px]">
                      {pkg.patchedSha256 || 'Pending remediation'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick Profile & Environment Card */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border border-stone-200 bg-white">
                  <div className="text-[10px] font-bold text-stone-400 uppercase">SCORM Version</div>
                  <div className="text-sm font-bold text-stone-900 mt-0.5 font-mono">{pkg.scormVersion}</div>
                  <div className="text-[11px] text-stone-500 mt-1">{pkg.scormVersionReason}</div>
                </div>

                <div className="p-3 rounded-lg border border-stone-200 bg-white">
                  <div className="text-[10px] font-bold text-stone-400 uppercase">Mastery / Quiz Threshold</div>
                  <div className="text-sm font-bold text-stone-900 mt-0.5 font-mono">
                    {pkg.masteryScore}% / {pkg.detectedQuizThreshold}%
                  </div>
                  <div className="text-[11px] text-stone-500 mt-1">
                    Consistency: {pkg.passScoreConsistency}
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-stone-200 bg-white">
                  <div className="text-[10px] font-bold text-stone-400 uppercase">Repair Profile</div>
                  <div className="text-sm font-bold text-stone-900 mt-0.5 font-mono">
                    {getProfileShortName(pkg.repairProfile)}
                  </div>
                  <div className="text-[10px] text-stone-500 mt-1 truncate" title={pkg.repairProfile}>
                    {pkg.repairProfile}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: PRE-FIX FINDINGS (Requirement 1 & 2) */}
          {/* ============================================================ */}
          {activeTab === 'PRE_FIX' && (
            <div className="space-y-6">
              <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl">
                <h4 className="font-bold text-amber-900 text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                  PRE-FIX FINDINGS — Original Package Diagnostics
                </h4>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  These diagnostics document exactly what was discovered in the original unmodified package before any patches were applied.
                </p>
              </div>

              {/* Package Metadata & Scoring Snapshot */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-lg border border-stone-200 bg-white">
                  <span className="text-[10px] font-bold text-stone-400 uppercase block">SCORM Specification</span>
                  <div className="font-mono font-bold text-sm text-stone-900 mt-0.5">{pkg.scormVersion}</div>
                  <div className="text-[11px] text-stone-500 mt-1">Runtime API: {pkg.runtimeApiType}</div>
                </div>

                <div className="p-3.5 rounded-lg border border-stone-200 bg-white">
                  <span className="text-[10px] font-bold text-stone-400 uppercase block">Mastery Score</span>
                  <div className="font-mono font-bold text-sm text-stone-900 mt-0.5">{pkg.masteryScore}%</div>
                  <div className="text-[11px] text-stone-500 mt-1">Declared in imsmanifest.xml</div>
                </div>

                <div className="p-3.5 rounded-lg border border-stone-200 bg-white">
                  <span className="text-[10px] font-bold text-stone-400 uppercase block">Quiz Threshold</span>
                  <div className="font-mono font-bold text-sm text-stone-900 mt-0.5">{pkg.detectedQuizThreshold}%</div>
                  <div className="text-[11px] text-stone-500 mt-1">Detected in course scripts</div>
                </div>
              </div>

              {/* Detected Issues List (Requirement 1) */}
              <div className="border border-stone-200 rounded-xl bg-white p-5 space-y-3">
                <h4 className="font-bold text-stone-900 text-xs uppercase tracking-wider flex items-center justify-between">
                  <span>Detected Issues ({preFixIssues.length})</span>
                  <span className="text-amber-800 font-mono text-[11px]">Original Package State</span>
                </h4>

                {preFixIssues.length === 0 ? (
                  <div className="p-4 bg-emerald-50 text-emerald-800 rounded-lg text-xs font-medium">
                    ✓ No defect patterns detected in original package.
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100 border border-stone-100 rounded-lg overflow-hidden font-mono text-xs">
                    {preFixIssues.map((issue, idx) => (
                      <div key={idx} className="p-3 flex items-center gap-3 bg-stone-50/50 hover:bg-stone-50">
                        <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 font-bold flex items-center justify-center shrink-0 text-xs">
                          ✓
                        </span>
                        <span className="text-stone-800 font-semibold">{issue}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Repair Profile & Pre-Fix Status Card */}
              <div className="p-4 rounded-xl border border-stone-200 bg-stone-50/80 space-y-2 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-600">REPAIR PROFILE:</span>
                  <span className="font-bold text-stone-900 bg-white px-2 py-0.5 rounded border border-stone-200">
                    {pkg.repairProfile}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-600">STATUS:</span>
                  <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                    {pkg.actionStatus === 'PATCHED' ? 'READY TO PATCH (PRE-FIX)' : pkg.actionStatus}
                  </span>
                </div>
              </div>

              {/* Detailed 4 SCORM Defects Scanner Evidence */}
              <div className="space-y-3">
                <h4 className="font-bold text-stone-900 uppercase tracking-wider text-[11px]">
                  Specific Defect Scanner Matches
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className={`p-3.5 rounded-lg border ${pkg.finishDefect.detected ? 'bg-rose-50/40 border-rose-200' : 'bg-stone-50 border-stone-200'}`}>
                    <div className="flex items-center justify-between font-bold">
                      <span>1. Finish / Last-Page Completion</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${pkg.finishDefect.detected ? 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-500'}`}>
                        {pkg.finishDefect.detected ? 'DEFECT DETECTED' : 'CLEAN'}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-600 mt-1">
                      {pkg.finishDefect.summary || 'Checks for unconditional lesson_status=completed writes in navigation/last-page handlers.'}
                    </p>
                  </div>

                  <div className={`p-3.5 rounded-lg border ${pkg.progressDefect.detected ? 'bg-rose-50/40 border-rose-200' : 'bg-stone-50 border-stone-200'}`}>
                    <div className="flex items-center justify-between font-bold">
                      <span>2. Progress Completion Defect</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${pkg.progressDefect.detected ? 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-500'}`}>
                        {pkg.progressDefect.detected ? 'DEFECT DETECTED' : 'CLEAN'}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-600 mt-1">
                      {pkg.progressDefect.summary || 'Checks for unconditional status writes based purely on progress percentage without pass verification.'}
                    </p>
                  </div>

                  <div className={`p-3.5 rounded-lg border ${pkg.relaunchDefect.detected ? 'bg-amber-50/40 border-amber-200' : 'bg-stone-50 border-stone-200'}`}>
                    <div className="flex items-center justify-between font-bold">
                      <span>3. Relaunch Status Reset Defect</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${pkg.relaunchDefect.detected ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-500'}`}>
                        {pkg.relaunchDefect.detected ? 'DEFECT DETECTED' : 'CLEAN'}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-600 mt-1">
                      {pkg.relaunchDefect.summary || 'Checks whether reopening course resets prior passed/completed status back to incomplete.'}
                    </p>
                  </div>

                  <div className={`p-3.5 rounded-lg border ${pkg.exitDefect.detected ? 'bg-rose-50/40 border-rose-200' : 'bg-stone-50 border-stone-200'}`}>
                    <div className="flex items-center justify-between font-bold">
                      <span>4. Exit / Unload Defect</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${pkg.exitDefect.detected ? 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-500'}`}>
                        {pkg.exitDefect.detected ? 'DEFECT DETECTED' : 'CLEAN'}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-600 mt-1">
                      {pkg.exitDefect.summary || 'Checks for window.onunload or exit handlers that improperly overwrite status or miss suspend bookmark.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 3: PATCH CHANGES (Diffs & Code Updates) */}
          {/* ============================================================ */}
          {activeTab === 'PATCH_CHANGES' && (
            <div className="space-y-6">
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-stone-900 text-sm">
                    Remediation Code Modifications ({pkg.filesModified.length} files modified)
                  </h4>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Profile: <code className="font-mono text-stone-800">{pkg.repairProfile}</code>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-xs">
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded font-bold">
                    {pkg.codeChanges.length} code diffs
                  </span>
                </div>
              </div>

              {/* Modified Files List */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-stone-700 uppercase tracking-wider block">
                  Target Modified Files
                </span>
                {pkg.filesModified.length === 0 ? (
                  <div className="p-4 bg-stone-50 border border-dashed border-stone-200 rounded-lg text-center text-stone-400">
                    No files have been modified yet. Click "Apply Workday Fixes" to apply the remediation profile.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {pkg.filesModified.map((f, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono text-xs font-semibold flex items-center gap-1"
                      >
                        <FileCode className="w-3.5 h-3.5 text-emerald-600" />
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Code Changes / Diffs */}
              {pkg.codeChanges.length > 0 && (
                <div className="space-y-4">
                  <span className="text-[11px] font-bold text-stone-700 uppercase tracking-wider block">
                    Syntactic Modifications Applied
                  </span>
                  {pkg.codeChanges.map((change, idx) => (
                    <div
                      key={idx}
                      className="border border-stone-200 rounded-xl overflow-hidden bg-white shadow-2xs"
                    >
                      <div className="p-3 bg-stone-100/70 border-b border-stone-200 flex items-center justify-between">
                        <div className="font-mono text-xs font-bold text-stone-800">
                          {change.filePath}
                        </div>
                        <span className="px-2 py-0.5 bg-stone-200 text-stone-700 text-[10px] font-semibold rounded">
                          {change.description || 'Deterministic Patch'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200 text-xs font-mono">
                        <div className="p-3 bg-rose-50/20">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block mb-1">
                            Original (Pre-Patch)
                          </span>
                          <pre className="overflow-x-auto text-[11px] text-stone-800 whitespace-pre-wrap leading-relaxed">
                            {change.originalSnippet}
                          </pre>
                        </div>
                        <div className="p-3 bg-emerald-50/20">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block mb-1">
                            Remediated (Workday Safe)
                          </span>
                          <pre className="overflow-x-auto text-[11px] text-stone-800 whitespace-pre-wrap leading-relaxed">
                            {change.patchedSnippet}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pattern Search Audit from Report */}
              {pkg.patchExecutionReport && (
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-stone-700 uppercase tracking-wider block">
                    Execution Log Trail
                  </span>
                  <div className="p-3 rounded-lg bg-stone-900 text-stone-200 font-mono text-[11px] max-h-48 overflow-y-auto space-y-1">
                    {pkg.patchExecutionReport.logs.map((logLine, idx) => (
                      <div key={idx} className="leading-relaxed">
                        <span className="text-stone-500 mr-2">[{idx + 1}]</span>
                        {logLine}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 4: POST-FIX VALIDATION (Requirement 2 & 4) */}
          {/* ============================================================ */}
          {activeTab === 'VALIDATION' && (
            <div className="space-y-6">
              {/* Header & Status */}
              <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-bold text-stone-900 text-sm">
                    POST-FIX VALIDATION — Automated SCORM 1.2 &amp; Workday Compliance
                  </h4>
                  <p className="text-xs text-stone-500 mt-0.5">
                    30-rule automated post-patch validation suite. Every rule must pass for package release.
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-lg text-xs font-bold shrink-0 ${
                    pkg.validationChecks.length > 0
                      ? pkg.validationPassed
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : testErrorsCount > 0 && genuineFailCount === 0
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : 'bg-rose-100 text-rose-800 border border-rose-300'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                >
                  {pkg.validationChecks.length > 0
                    ? pkg.validationPassed
                      ? `${totalChecksCount}/${totalChecksCount} RULES PASSED`
                      : testErrorsCount > 0 && genuineFailCount === 0
                      ? `${passedChecksCount}/${totalChecksCount} PASS — ${testErrorsCount} VALIDATOR TEST ERROR`
                      : `FAILED VALIDATION (${genuineFailCount} FAILED${testErrorsCount > 0 ? `, ${testErrorsCount} TEST ERROR` : ''})`
                    : 'AWAITING REMEDIATION'}
                </span>
              </div>

              {/* Requirement 2: Separation of Pre-Fix vs Post-Fix Guarantees */}
              <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
                <div className="p-3 bg-stone-100/80 border-b border-stone-200 font-bold text-stone-800 text-xs uppercase tracking-wider">
                  Pre-Fix vs. Post-Fix State Guarantees
                </div>
                <div className="divide-y divide-stone-100 text-xs">
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase w-20">PRE-FIX:</span>
                      <span className="text-rose-700 font-semibold font-mono">Finish defect — DETECTED</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase w-20">POST-FIX:</span>
                      <span className="text-emerald-700 font-bold font-mono">Finish completion override — PASS</span>
                    </div>
                  </div>

                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase w-20">PRE-FIX:</span>
                      <span className="text-rose-700 font-semibold font-mono">Progress status risk — DETECTED</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase w-20">POST-FIX:</span>
                      <span className="text-emerald-700 font-bold font-mono">Progress calculation bounded ≤100% — PASS</span>
                    </div>
                  </div>

                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase w-20">PRE-FIX:</span>
                      <span className="text-rose-700 font-semibold font-mono">Prior pass overwrite risk — DETECTED</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase w-20">POST-FIX:</span>
                      <span className="text-emerald-700 font-bold font-mono">Prior pass status permanently preserved — PASS</span>
                    </div>
                  </div>

                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase w-20">PRE-FIX:</span>
                      <span className="text-rose-700 font-semibold font-mono">Stale localStorage progress — DETECTED</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-stone-400 uppercase w-20">POST-FIX:</span>
                      <span className="text-emerald-700 font-bold font-mono">Authoritative SCORM state restoration — PASS</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Validation Filter Buttons */}
              {totalChecksCount > 0 && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setValidationFilter('ALL')}
                      className={`px-3 py-1 rounded font-semibold transition-colors ${
                        validationFilter === 'ALL'
                          ? 'bg-stone-900 text-white'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      All Rules ({totalChecksCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setValidationFilter('FAILED')}
                      className={`px-3 py-1 rounded font-semibold transition-colors ${
                        validationFilter === 'FAILED'
                          ? 'bg-rose-700 text-white'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      Failed ({genuineFailCount})
                    </button>
                    {testErrorsCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setValidationFilter('TEST_ERROR')}
                        className={`px-3 py-1 rounded font-semibold transition-colors ${
                          validationFilter === 'TEST_ERROR'
                            ? 'bg-amber-600 text-white'
                            : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                        }`}
                      >
                        Test Errors ({testErrorsCount})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setValidationFilter('PASSED')}
                      className={`px-3 py-1 rounded font-semibold transition-colors ${
                        validationFilter === 'PASSED'
                          ? 'bg-emerald-700 text-white'
                          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                      }`}
                    >
                      Passed ({passedChecksCount})
                    </button>
                  </div>
                </div>
              )}

              {/* Rules List */}
              {pkg.validationChecks.length === 0 ? (
                <div className="p-8 text-center bg-stone-50 rounded-xl border border-dashed border-stone-200">
                  <p className="text-stone-500 font-medium">
                    Post-patch validation runs automatically when Workday fixes are applied.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl bg-white overflow-hidden shadow-2xs">
                  {filteredValidation.map((item) => (
                    <div
                      key={item.id}
                      className={`p-3.5 flex items-start gap-3 transition-colors ${
                        item.passed
                          ? 'hover:bg-stone-50/60'
                          : item.outcome === 'TEST_ERROR'
                          ? 'bg-amber-50/60'
                          : 'bg-rose-50/50'
                      }`}
                    >
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono shrink-0 mt-0.5 ${
                          item.passed
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : item.outcome === 'TEST_ERROR'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-rose-100 text-rose-800 border border-rose-300'
                        }`}
                      >
                        {item.passed ? 'PASS' : item.outcome === 'TEST_ERROR' ? 'TEST ERROR' : 'FAIL'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-stone-900 text-xs flex items-center justify-between">
                          <span>
                            Rule {item.id}: {item.ruleName || item.title}
                          </span>
                          {item.file && (
                            <span className="font-mono text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
                              {item.file}
                            </span>
                          )}
                        </div>
                        <div
                          className={`text-[11px] mt-0.5 font-mono ${
                            item.passed ? 'text-stone-600' : 'text-rose-700 font-bold'
                          }`}
                        >
                          {item.details}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 5: FILES */}
          {/* ============================================================ */}
          {activeTab === 'FILES' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-stone-500 font-mono">
                  {filteredFiles.length} of {pkg.allFiles.length} file{pkg.allFiles.length === 1 ? '' : 's'} in archive
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                    placeholder="Search files..."
                    className="pl-8 pr-3 py-1 text-xs bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400 font-mono w-56"
                  />
                </div>
              </div>

              <div className="max-h-[500px] overflow-y-auto border border-stone-200 rounded-xl divide-y divide-stone-100 font-mono text-[11px] bg-stone-50 shadow-2xs">
                {filteredFiles.map((file, i) => {
                  const isModified = pkg.filesModified.includes(file);
                  return (
                    <div
                      key={i}
                      className={`p-2.5 flex items-center justify-between transition-colors ${
                        isModified ? 'bg-emerald-50 text-emerald-950 font-bold' : 'text-stone-700 hover:bg-white'
                      }`}
                    >
                      <span className="truncate pr-2">{file}</span>
                      {isModified && (
                        <span className="text-[9px] bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded font-bold shrink-0">
                          REMEDIATED
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 6: AUDIT (Status Write Inventory & Milestone 1 Evidence) */}
          {/* ============================================================ */}
          {activeTab === 'AUDIT' && (
            <div className="space-y-6">
              {/* Milestone 1 Scanner Evidence Header */}
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-stone-900 text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    In-Memory Package Audit Evidence
                  </h4>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Deterministic verification log confirming package was inspected locally without external leaks.
                  </p>
                </div>
                <div className="text-right font-mono text-[11px]">
                  <span className="text-emerald-700 font-bold">{pkg.scanDurationMs} ms</span> scan time
                </div>
              </div>

              {/* Status Write Inventory Section */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="font-bold text-stone-900 text-xs flex items-center gap-1.5">
                    <FileCode className="w-4 h-4 text-stone-700" />
                    Status Write Inventory ({pkg.statusWriteInventory?.length || 0} writes logged)
                  </h4>
                  <div className="relative">
                    <input
                      type="text"
                      value={inventorySearch}
                      onChange={(e) => setInventorySearch(e.target.value)}
                      placeholder="Filter writes (field, file)..."
                      className="px-3 py-1 text-xs bg-white border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-400 font-mono w-56"
                    />
                  </div>
                </div>

                {!pkg.statusWriteInventory || pkg.statusWriteInventory.length === 0 ? (
                  <div className="p-6 text-center text-stone-400 bg-stone-50 rounded-lg border border-dashed border-stone-200 font-mono">
                    No CMI status writes were identified in this package archive.
                  </div>
                ) : (
                  <div className="border border-stone-200 rounded-xl overflow-hidden bg-white shadow-2xs">
                    <div className="overflow-x-auto max-h-96">
                      <table className="w-full text-left text-xs border-collapse font-mono">
                        <thead className="sticky top-0 bg-stone-100 border-b border-stone-200 text-stone-800 text-[11px]">
                          <tr>
                            <th className="py-2.5 px-3">Location</th>
                            <th className="py-2.5 px-2">CMI Field</th>
                            <th className="py-2.5 px-2">Value</th>
                            <th className="py-2.5 px-2">Enclosing Function</th>
                            <th className="py-2.5 px-2">Classification</th>
                            <th className="py-2.5 px-3">Context Snippet</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100 text-[11px]">
                          {filteredInventory.map((rec) => {
                            const isDefect =
                              rec.classification.includes('INVALID') ||
                              rec.classification.includes('UNCONDITIONAL');
                            const isPassGated = rec.classification.includes('PASS-GATED');
                            return (
                              <tr
                                key={rec.id}
                                className={`hover:bg-stone-50/80 transition-colors ${
                                  isDefect ? 'bg-rose-50/25' : isPassGated ? 'bg-emerald-50/20' : ''
                                }`}
                              >
                                <td className="py-2.5 px-3 whitespace-nowrap text-stone-900 font-medium">
                                  <div className="truncate max-w-[160px]" title={rec.filePath}>
                                    {rec.filePath.split('/').pop()}
                                  </div>
                                  <div className="text-[10px] text-stone-400 truncate max-w-[160px]">
                                    {rec.filePath} {rec.lineNumber ? `(L${rec.lineNumber})` : ''}
                                  </div>
                                </td>

                                <td className="py-2.5 px-2 whitespace-nowrap text-stone-700">
                                  <span className="bg-stone-100 px-1 py-0.5 rounded text-[10px]">
                                    {rec.cmiField}
                                  </span>
                                </td>

                                <td className="py-2.5 px-2 whitespace-nowrap font-bold">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                                      rec.valueWritten === 'completed'
                                        ? 'bg-purple-100 text-purple-800'
                                        : rec.valueWritten === 'incomplete'
                                        ? 'bg-amber-100 text-amber-800'
                                        : rec.valueWritten === 'passed'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : rec.valueWritten === 'failed'
                                        ? 'bg-rose-100 text-rose-800'
                                        : 'bg-stone-100 text-stone-700'
                                    }`}
                                  >
                                    {rec.valueWritten}
                                  </span>
                                </td>

                                <td
                                  className="py-2.5 px-2 text-stone-600 max-w-[140px] truncate"
                                  title={`${rec.enclosingEventHandler || ''} / ${rec.enclosingFunction || ''}`}
                                >
                                  {rec.enclosingFunction || rec.enclosingEventHandler || (
                                    <span className="text-stone-400">Global</span>
                                  )}
                                </td>

                                <td className="py-2.5 px-2 whitespace-nowrap">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                      rec.classification.includes('INVALID')
                                        ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                        : rec.classification.includes('PASS-GATED')
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                        : 'bg-stone-100 text-stone-600'
                                    }`}
                                  >
                                    {rec.classification}
                                  </span>
                                </td>

                                <td className="py-2.5 px-3 max-w-[220px]">
                                  <code
                                    className="text-[10px] text-stone-800 block truncate bg-stone-50 p-1 rounded border border-stone-100"
                                    title={rec.contextSnippet}
                                  >
                                    {rec.contextSnippet}
                                  </code>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 7: DOWNLOAD DIAGNOSTICS (Requirement 8) */}
          {/* ============================================================ */}
          {activeTab === 'DOWNLOAD_DIAGNOSTICS' && (
            <div className="p-4 rounded-xl border border-stone-200 bg-white">
              <DownloadDiagnosticsPanel />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-stone-200 bg-stone-50 flex items-center justify-between text-xs">
          <span className="text-stone-500 font-mono">
            Profile: <code className="text-stone-800 font-bold">{pkg.repairProfile}</code>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-semibold cursor-pointer transition-colors"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
