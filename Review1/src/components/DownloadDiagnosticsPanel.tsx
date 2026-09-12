import React, { useState, useEffect } from 'react';
import {
  Activity,
  Trash2,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Terminal,
  FileCode,
} from 'lucide-react';
import {
  DownloadDiagnosticRecord,
  subscribeToDiagnostics,
  clearDiagnosticRecords,
} from '../utils/downloadManager';

export const DownloadDiagnosticsPanel: React.FC = () => {
  const [records, setRecords] = useState<DownloadDiagnosticRecord[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToDiagnostics((newRecords) => {
      setRecords(newRecords);
    });
    return unsubscribe;
  }, []);

  const handleCopy = (text: string, id: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleClear = () => {
    clearDiagnosticRecords();
  };

  return (
    <div id="developer-download-diagnostics" className="space-y-4 font-mono text-xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200 pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-stone-700" />
          <h4 className="font-bold text-stone-900 uppercase tracking-wider text-xs">
            Developer &gt; Download Diagnostics
          </h4>
          <span className="px-2 py-0.5 rounded text-[10px] bg-stone-100 text-stone-700 border border-stone-200">
            {records.length} audit record{records.length === 1 ? '' : 's'}
          </span>
        </div>

        {records.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-stone-500 hover:text-rose-700 text-[11px] rounded hover:bg-rose-50 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Clear Audit Logs
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div className="p-6 rounded-lg border border-dashed border-stone-200 text-center text-stone-400 bg-stone-50/50">
          No download interactions logged yet. Click &quot;SAVE FIXED ZIP&quot;, &quot;Download&quot;, or &quot;TEST DOWNLOAD ENVIRONMENT&quot; to log diagnostic events.
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((rec) => (
            <div
              key={rec.id}
              className="p-4 rounded-xl border border-stone-200 bg-stone-50/60 space-y-3 shadow-2xs"
            >
              {/* Top summary row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200/80 pb-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-stone-900">{rec.actionAttempted}</span>
                  <span className="text-stone-400">|</span>
                  <span className="text-stone-600 truncate max-w-xs">{rec.filename}</span>
                  <span className="text-stone-400">|</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      rec.statusOutcome.includes('SUCCESS')
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : rec.statusOutcome.includes('BLOCKED') || rec.statusOutcome.includes('ERROR')
                        ? 'bg-rose-100 text-rose-800 border border-rose-300'
                        : 'bg-amber-100 text-amber-900 border border-amber-300'
                    }`}
                  >
                    {rec.statusOutcome}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-stone-500">
                  <Clock className="w-3 h-3 text-stone-400" />
                  <span>{new Date(rec.timestamp).toLocaleTimeString()}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(JSON.stringify(rec, null, 2), rec.id)}
                    className="p-1 hover:bg-stone-200 rounded text-stone-500 hover:text-stone-900 ml-1"
                    title="Copy full JSON record"
                  >
                    {copiedId === rec.id ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>

              {/* Exact Requirement 8 Field Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                {/* Package */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Package:</span>
                  <span className="font-semibold text-stone-800 truncate block" title={rec.packageName}>
                    {rec.packageName}
                  </span>
                </div>

                {/* Validation passed */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Validation passed:</span>
                  <span className={`font-bold ${rec.validationPassed ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {rec.validationPassed ? 'true' : 'false'}
                  </span>
                </div>

                {/* Blob present */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Blob present:</span>
                  <span className={`font-bold ${rec.blobPresent ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {rec.blobPresent ? 'true' : 'false'}
                  </span>
                </div>

                {/* Blob type */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Blob type:</span>
                  <span className="text-stone-800 truncate block font-mono">
                    {rec.blobType || 'application/zip'}
                  </span>
                </div>

                {/* Blob size */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Blob size:</span>
                  <span className="text-stone-800 font-mono">
                    {rec.blobSize.toLocaleString()} bytes
                  </span>
                </div>

                {/* Filename */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Filename:</span>
                  <span className="text-stone-800 truncate block font-mono" title={rec.filename}>
                    {rec.filename}
                  </span>
                </div>

                {/* Embedded */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Embedded:</span>
                  <span className={`font-bold ${rec.isEmbedded ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {rec.isEmbedded ? 'true' : 'false'}
                  </span>
                </div>

                {/* showSaveFilePicker */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">showSaveFilePicker:</span>
                  <span className={`font-semibold ${rec.showSaveFilePicker === 'available' ? 'text-emerald-700' : 'text-stone-500'}`}>
                    {rec.showSaveFilePicker}
                  </span>
                </div>

                {/* showDirectoryPicker */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">showDirectoryPicker:</span>
                  <span className={`font-semibold ${rec.showDirectoryPicker === 'available' ? 'text-emerald-700' : 'text-stone-500'}`}>
                    {rec.showDirectoryPicker}
                  </span>
                </div>

                {/* Blob URL created */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Blob URL created:</span>
                  <span className="text-stone-800 font-semibold">{rec.blobUrlCreated ? 'true' : 'false'}</span>
                </div>

                {/* Anchor created */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Anchor created:</span>
                  <span className="text-stone-800 font-semibold">{rec.anchorCreated ? 'true' : 'false'}</span>
                </div>

                {/* Anchor attached */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Anchor attached:</span>
                  <span className="text-stone-800 font-semibold">{rec.anchorAttached ? 'true' : 'false'}</span>
                </div>

                {/* Anchor click executed */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Anchor click executed:</span>
                  <span className="text-stone-800 font-semibold">{rec.anchorClickExecuted ? 'true' : 'false'}</span>
                </div>

                {/* URL revoked */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">URL revoked:</span>
                  <span className="text-stone-800 font-mono text-[10px]">
                    {rec.urlRevokedTimestamp ? new Date(rec.urlRevokedTimestamp).toLocaleTimeString() : 'Pending (30s+)'}
                  </span>
                </div>

                {/* Save picker write completed */}
                <div className="p-2 rounded bg-white border border-stone-200">
                  <span className="text-[10px] text-stone-400 block font-bold">Save picker write completed:</span>
                  <span className={`font-bold ${rec.savePickerWriteCompleted ? 'text-emerald-700' : 'text-stone-600'}`}>
                    {rec.savePickerWriteCompleted ? 'true' : 'false'}
                  </span>
                </div>

                {/* Exception Name / Message */}
                <div className="p-2 rounded bg-white border border-stone-200 col-span-2 sm:col-span-4">
                  <span className="text-[10px] text-stone-400 block font-bold">Exception Details:</span>
                  {rec.exceptionName || rec.exceptionMessage ? (
                    <span className="text-rose-700 font-mono text-[10px]">
                      {rec.exceptionName ? `[${rec.exceptionName}] ` : ''}
                      {rec.exceptionMessage}
                    </span>
                  ) : (
                    <span className="text-stone-400 italic text-[10px]">None (clean execution)</span>
                  )}
                  {rec.details && (
                    <div className="text-[10px] text-stone-600 mt-0.5">{rec.details}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
