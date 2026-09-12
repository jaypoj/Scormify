import React, { useState } from 'react';
import {
  Download,
  Save,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  HardDrive,
  FileCheck,
  ShieldAlert,
} from 'lucide-react';
import { PackageInspectionResult } from '../types';
import {
  verifyOutputForDownload,
  saveFixedZipWithPicker,
  fallbackBrowserDownload,
  openGeneratedZipInNewTab,
  detectDownloadEnvironment,
  DownloadStatusState,
} from '../utils/downloadManager';

interface PackageDownloadActionsProps {
  pkg: PackageInspectionResult;
  variant?: 'table' | 'modal' | 'full-card';
  onStatusMessage?: (msg: string) => void;
}

export const PackageDownloadActions: React.FC<PackageDownloadActionsProps> = ({
  pkg,
  variant = 'table',
  onStatusMessage,
}) => {
  const env = detectDownloadEnvironment();
  const verification = verifyOutputForDownload(pkg);

  const [currentStatus, setCurrentStatus] = useState<DownloadStatusState>(
    verification.isValid ? 'READY TO SAVE' : 'OUTPUT GENERATION ERROR'
  );
  const [statusDetail, setStatusDetail] = useState<string | undefined>(
    verification.missingCondition
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [savedDetails, setSavedDetails] = useState<{ filename: string; size: number } | null>(null);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // Requirement 4: Primary Save Method — SAVE FIXED ZIP
  const handlePrimarySaveAs = async () => {
    setIsProcessing(true);
    try {
      const result = await saveFixedZipWithPicker(pkg, (st, detail) => {
        setCurrentStatus(st);
        setStatusDetail(detail);
        if (detail) onStatusMessage?.(detail);
      });

      if (result.success) {
        setSavedDetails({
          filename: verification.filename,
          size: verification.sizeBytes,
        });
        onStatusMessage?.(`FILE SAVED SUCCESSFULLY: ${verification.filename}`);
      }
    } catch (err: any) {
      setCurrentStatus('OUTPUT GENERATION ERROR');
      setStatusDetail(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Requirement 5: Fallback — Normal Browser Download
  const handleBrowserDownload = () => {
    setIsProcessing(true);
    try {
      const result = fallbackBrowserDownload(pkg, (st, detail) => {
        setCurrentStatus(st);
        setStatusDetail(detail);
        if (detail) onStatusMessage?.(detail);
      });

      if (result.status === 'DOWNLOAD REQUEST SENT') {
        onStatusMessage?.(
          `DOWNLOAD REQUEST SENT for ${verification.filename}${
            env.isEmbeddedIframe
              ? ' — Note: The embedded preview may block downloads. Use published/top-level app if no file appears.'
              : ''
          }`
        );
      }
    } catch (err: any) {
      setCurrentStatus('OUTPUT GENERATION ERROR');
      setStatusDetail(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Requirement 6: Third fallback — Open Generated File in New Tab
  const handleOpenGeneratedZip = () => {
    try {
      const result = openGeneratedZipInNewTab(pkg, (st, detail) => {
        setCurrentStatus(st);
        setStatusDetail(detail);
      });
      if (result.success) {
        onStatusMessage?.(`GENERATED FILE OPENED IN NEW TAB for ${verification.filename}`);
      } else {
        onStatusMessage?.(`BROWSER/PREVIEW BLOCKED OPENING THE GENERATED FILE for ${verification.filename}`);
      }
    } catch (err: any) {
      setCurrentStatus('BROWSER/PREVIEW BLOCKED OPENING THE GENERATED FILE');
      setStatusDetail(err.message);
    }
  };

  // ==========================================
  // If verification failed: Show OUTPUT GENERATION ERROR (Requirement 2)
  // ==========================================
  if (!verification.isValid) {
    if (variant === 'table') {
      return (
        <div className="flex flex-col items-end gap-1 text-right">
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-800 border border-rose-300 rounded text-[11px] font-bold"
            title={verification.missingCondition}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            OUTPUT GENERATION ERROR
          </span>
          {verification.missingCondition && (
            <span className="text-[10px] text-rose-600 font-mono max-w-[200px] truncate" title={verification.missingCondition}>
              {verification.missingCondition}
            </span>
          )}
        </div>
      );
    }

    return (
      <div className="p-3.5 rounded-xl border border-rose-300 bg-rose-50/90 text-rose-950 space-y-2 text-xs">
        <div className="flex items-center gap-2 font-bold text-rose-900 uppercase tracking-wide">
          <XCircle className="w-4 h-4 text-rose-700 shrink-0" />
          OUTPUT GENERATION ERROR
        </div>
        <p className="text-rose-800 text-[11px] leading-relaxed">
          The repaired output ZIP package cannot be downloaded because safety criteria were not met:
        </p>
        <div className="p-2 rounded bg-white border border-rose-200 font-mono text-[11px] text-rose-700">
          Missing Condition: {verification.missingCondition}
        </div>
      </div>
    );
  }

  // ==========================================
  // Table Action Variant (Compact)
  // ==========================================
  if (variant === 'table') {
    return (
      <div className="flex flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          {/* Primary Save As Button (Requirement 4) */}
          <button
            type="button"
            id={`btn-save-fixed-zip-${pkg.id}`}
            disabled={isProcessing}
            onClick={handlePrimarySaveAs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            title={`Save As to disk: ${verification.filename}`}
          >
            <Save className="w-3.5 h-3.5" />
            SAVE FIXED ZIP
          </button>

          {/* Browser Download Fallback (Requirement 5) */}
          <button
            type="button"
            id={`btn-browser-download-${pkg.id}`}
            disabled={isProcessing}
            onClick={handleBrowserDownload}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            title={`Browser Download (Anchor): ${verification.filename}`}
          >
            <Download className="w-3.5 h-3.5 text-stone-600" />
            Download
          </button>

          {/* Open Generated ZIP (Requirement 6) */}
          <button
            type="button"
            id={`btn-open-zip-${pkg.id}`}
            onClick={handleOpenGeneratedZip}
            className="p-1.5 text-stone-500 hover:text-stone-900 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
            title="Open Generated ZIP in New Tab (Diagnostic)"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Status Indicator (Requirement 10) */}
        <div className="flex items-center gap-1 text-[10px] font-mono">
          {currentStatus === 'FILE SAVED SUCCESSFULLY' ? (
            <span className="text-emerald-700 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              FILE SAVED SUCCESSFULLY
            </span>
          ) : currentStatus === 'DOWNLOAD REQUEST SENT' ? (
            <span className="text-sky-700 font-semibold flex items-center gap-1">
              <Clock className="w-3 h-3 text-sky-600" />
              DOWNLOAD REQUEST SENT
              {env.isEmbeddedIframe && (
                <span className="text-amber-700 text-[9px] font-bold">(Preview)</span>
              )}
            </span>
          ) : currentStatus === 'SAVING' ? (
            <span className="text-amber-700 font-semibold flex items-center gap-1 animate-pulse">
              <Clock className="w-3 h-3" /> SAVING...
            </span>
          ) : currentStatus === 'SAVE DIALOG OPENING' ? (
            <span className="text-stone-600 font-semibold">SAVE DIALOG OPENING</span>
          ) : currentStatus === 'CANCELLED BY USER' ? (
            <span className="text-stone-500">CANCELLED BY USER</span>
          ) : currentStatus === 'BLOCKED BY EMBEDDED PREVIEW' ? (
            <span className="text-rose-700 font-bold">BLOCKED BY EMBEDDED PREVIEW</span>
          ) : (
            <span className="text-stone-500">READY TO SAVE</span>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // Full Card Variant (Modal / Detail View)
  // ==========================================
  return (
    <div
      id={`package-download-card-${pkg.id}`}
      className="p-4 rounded-xl border border-stone-200 bg-white space-y-3.5 shadow-2xs"
    >
      {/* Requirement 2: OUTPUT ZIP READY Details Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800">
            <FileCheck className="w-4 h-4 text-emerald-700" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-stone-900 uppercase tracking-wide flex items-center gap-2">
              OUTPUT ZIP READY
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                Blob Present: YES
              </span>
            </h4>
            <span className="text-[11px] text-stone-500 font-mono truncate block max-w-md">
              Filename: {verification.filename}
            </span>
          </div>
        </div>

        {/* Status Badge (Requirement 10) */}
        <div className="shrink-0 font-mono text-xs">
          {currentStatus === 'FILE SAVED SUCCESSFULLY' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              FILE SAVED SUCCESSFULLY
            </span>
          ) : currentStatus === 'DOWNLOAD REQUEST SENT' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-100 text-sky-800 border border-sky-300 font-semibold">
              <Clock className="w-3.5 h-3.5 text-sky-600" />
              DOWNLOAD REQUEST SENT
            </span>
          ) : currentStatus === 'SAVING' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold animate-pulse">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              SAVING...
            </span>
          ) : currentStatus === 'SAVE DIALOG OPENING' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-stone-100 text-stone-700 border border-stone-300 font-semibold">
              SAVE DIALOG OPENING
            </span>
          ) : currentStatus === 'CANCELLED BY USER' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-stone-100 text-stone-600 border border-stone-300 font-medium">
              CANCELLED BY USER
            </span>
          ) : currentStatus === 'BLOCKED BY EMBEDDED PREVIEW' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-100 text-rose-800 border border-rose-300 font-bold">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              BLOCKED BY EMBEDDED PREVIEW
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-stone-100 text-stone-700 border border-stone-200 font-bold">
              READY TO SAVE
            </span>
          )}
        </div>
      </div>

      {/* Requirement 2 & 12: Package Metadata & SHA-256 Audit Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70">
          <span className="text-[10px] text-stone-400 block font-bold">SIZE:</span>
          <span className="font-bold text-stone-900">{formatBytes(verification.sizeBytes)}</span>
          <span className="text-[10px] text-stone-500 block">({verification.sizeBytes.toLocaleString()} bytes)</span>
        </div>

        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70">
          <span className="text-[10px] text-stone-400 block font-bold">VALIDATION STATUS:</span>
          <span className="font-bold text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> PASS (All 38 Rules + Invariant)
          </span>
          <span className="text-[10px] text-stone-500 block">Retained in application state</span>
        </div>

        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70">
          <span className="text-[10px] text-stone-400 block font-bold">EXPECTED SHA-256:</span>
          <span className="font-bold text-stone-900 truncate block text-[11px]" title={verification.sha256}>
            {verification.sha256 ? `${verification.sha256.substring(0, 16)}...` : 'N/A'}
          </span>
          <span className="text-[10px] text-stone-500 block">Calculated from validated Blob</span>
        </div>
      </div>

      {/* Saved Success Banner (Requirement 4) */}
      {currentStatus === 'FILE SAVED SUCCESSFULLY' && savedDetails && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-950 font-mono text-xs space-y-1">
          <div className="font-bold text-emerald-900 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            FILE SAVED SUCCESSFULLY
          </div>
          <div className="text-[11px] text-emerald-800">
            Filename: <strong>{savedDetails.filename}</strong>
          </div>
          <div className="text-[11px] text-emerald-800">
            Size: <strong>{formatBytes(savedDetails.size)}</strong> ({savedDetails.size.toLocaleString()} bytes)
          </div>
        </div>
      )}

      {/* Embedded warning if in iframe (Requirement 7) */}
      {env.isEmbeddedIframe && (
        <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-300 text-amber-900 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-[11px]">
            <span className="font-bold">The embedded preview may block downloads.</span>
            <p className="text-amber-800">
              If no file appears in your browser downloads, launch the published or top-level version of this app.
            </p>
          </div>
        </div>
      )}

      {/* Download Action Buttons */}
      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        {/* Primary Save As Button (Requirement 4) */}
        <button
          type="button"
          id={`btn-modal-save-fixed-zip-${pkg.id}`}
          disabled={isProcessing}
          onClick={handlePrimarySaveAs}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          SAVE FIXED ZIP (Save As)
        </button>

        {/* Fallback Browser Download Button (Requirement 5) */}
        <button
          type="button"
          id={`btn-modal-browser-download-${pkg.id}`}
          disabled={isProcessing}
          onClick={handleBrowserDownload}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-300 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 text-stone-600" />
          BROWSER DOWNLOAD
        </button>

        {/* Third Fallback: Open Generated ZIP in New Tab (Requirement 6) */}
        <button
          type="button"
          id={`btn-modal-open-zip-${pkg.id}`}
          onClick={handleOpenGeneratedZip}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-stone-50 text-stone-700 border border-stone-300 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          title="Open Generated ZIP in New Tab (Diagnostic)"
        >
          <ExternalLink className="w-3.5 h-3.5 text-stone-500" />
          OPEN GENERATED ZIP
        </button>
      </div>
    </div>
  );
};
