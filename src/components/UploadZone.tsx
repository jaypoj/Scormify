import React, { useState, useRef } from 'react';
import { UploadCloud, FileArchive, X, AlertCircle } from 'lucide-react';

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  isProcessing: boolean;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ onFilesSelected, isProcessing }) => {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (incomingFiles: FileList | File[]) => {
    setError(null);
    const filesArray = Array.from(incomingFiles);
    const zipFiles = filesArray.filter((f) => f.name.toLowerCase().endsWith('.zip'));

    if (zipFiles.length === 0) {
      setError('Please select valid .zip SCORM packages.');
      return;
    }

    setSelectedFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const newFiles = zipFiles.filter((f) => !existingKeys.has(`${f.name}-${f.size}`));
      const combined = [...prev, ...newFiles];

      if (combined.length > 25) {
        setError('Batch limit exceeded. A maximum of 25 SCORM ZIP packages can be processed per batch.');
        return combined.slice(0, 25);
      }
      return combined;
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (isProcessing) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearAll = () => {
    setSelectedFiles([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStartScan = () => {
    if (selectedFiles.length === 0) return;
    onFilesSelected(selectedFiles);
  };

  const handleDropzoneClick = (e: React.MouseEvent) => {
    if (isProcessing) return;
    const target = e.target as HTMLElement;
    // Do not trigger file input if clicking on button, label, or interactive controls
    if (target.closest('button') || target.closest('label') || target.closest('input')) {
      return;
    }
    if (selectedFiles.length === 0 && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const totalBytes = selectedFiles.reduce((acc, f) => acc + f.size, 0);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
  const isLargeBatch = totalBytes > 150 * 1024 * 1024; // > 150MB warning

  return (
    <section className="bg-white rounded-xl border border-stone-200 shadow-xs p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-base font-bold text-stone-900 tracking-tight flex items-center gap-2">
            <span>STEP 1</span>
            <span className="text-stone-300">•</span>
            <span>Select SCORM Packages</span>
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Select 1 to 25 SCORM ZIP packages (Hard limit: 25 files per batch for browser memory safety)
          </p>
        </div>

        {selectedFiles.length > 0 && !isProcessing && (
          <button
            type="button"
            id="btn-clear-selection"
            onClick={handleClearAll}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 transition-colors"
          >
            Clear Selected ({selectedFiles.length})
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {isLargeBatch && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            <strong>Large Batch Warning:</strong> Total size is {totalMb} MB. Processing will occur strictly one package at a time (sequential Concurrency = 1) to conserve browser memory.
          </span>
        </div>
      )}

      <div
        onClick={handleDropzoneClick}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isProcessing) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
          selectedFiles.length === 0 ? 'cursor-pointer' : ''
        } ${
          dragOver ? 'border-stone-900 bg-stone-50/80 scale-[0.995]' : 'border-stone-200 hover:border-stone-400 bg-stone-50/40'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          id="file-upload-input"
          accept=".zip,application/zip,application/x-zip,application/x-zip-compressed"
          multiple
          disabled={isProcessing}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              handleFiles(e.target.files);
            }
          }}
          onClick={(e) => {
            // Reset input value to guarantee change events fire on subsequent selections
            (e.target as HTMLInputElement).value = '';
          }}
          className="sr-only opacity-0 absolute -z-10 w-px h-px overflow-hidden pointer-events-none"
        />

        <label
          htmlFor="file-upload-input"
          className="w-12 h-12 rounded-full bg-white border border-stone-200 text-stone-600 flex items-center justify-center mx-auto mb-3 shadow-xs cursor-pointer hover:border-stone-400 hover:text-stone-900 transition-colors"
          title="Click to browse SCORM packages"
        >
          <UploadCloud className="w-6 h-6" />
        </label>

        <p className="text-sm font-semibold text-stone-800">
          Drag & drop SCORM ZIP packages here, or{' '}
          <label
            htmlFor="file-upload-input"
            id="btn-browse-files"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            className="text-stone-900 underline underline-offset-2 hover:text-stone-700 font-bold cursor-pointer inline-block"
          >
            browse files
          </label>
        </p>
        <p className="text-xs text-stone-500 mt-1">
          Supports .zip archives containing imsmanifest.xml • Original files remain completely read-only
        </p>

        {selectedFiles.length > 0 && (
          <div className="mt-5 pt-5 border-t border-stone-200 text-left">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Selected Packages ({selectedFiles.length} / 25) • Total: {totalMb} MB
              </span>
              <span className="text-xs text-stone-500 font-mono">Sequential Queue: Concurrency = 1</span>
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
              {selectedFiles.map((file, idx) => (
                <div key={`${file.name}-${idx}`} className="px-3 py-2 flex items-center justify-between text-xs hover:bg-stone-50">
                  <div className="flex items-center gap-2 min-w-0 pr-2">
                    <FileArchive className="w-4 h-4 text-stone-400 shrink-0" />
                    <span className="font-mono text-stone-800 truncate">{file.name}</span>
                    <span className="text-stone-400 shrink-0">({(file.size / 1024).toFixed(0)} KB)</span>
                  </div>
                  {!isProcessing && (
                    <button
                      type="button"
                      onClick={() => handleRemoveFile(idx)}
                      className="text-stone-400 hover:text-rose-600 p-1 rounded-sm"
                      title="Remove from batch"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                id="btn-start-scan"
                disabled={isProcessing}
                onClick={handleStartScan}
                className="px-5 py-2.5 rounded-lg bg-stone-900 text-white font-semibold text-xs tracking-wide hover:bg-stone-800 transition-colors shadow-xs flex items-center gap-2 disabled:opacity-50"
              >
                <span>STEP 2: SCAN {selectedFiles.length} PACKAGE{selectedFiles.length > 1 ? 'S' : ''}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
