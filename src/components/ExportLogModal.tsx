import React, { useState } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  FileSpreadsheet,
  FileCode,
  AlertCircle,
  Table as TableIcon,
  Code as CodeIcon,
  ExternalLink,
} from 'lucide-react';
import { copyTextToClipboard, downloadBlob } from '../utils/exportLogs';

interface ExportLogModalProps {
  isOpen: boolean;
  type: 'csv' | 'json';
  title: string;
  filename: string;
  content: string;
  blob: Blob;
  packagesCount: number;
  onClose: () => void;
  onDownloadAgain?: () => void;
}

export const ExportLogModal: React.FC<ExportLogModalProps> = ({
  isOpen,
  type,
  title,
  filename,
  content,
  blob,
  packagesCount,
  onClose,
  onDownloadAgain,
}) => {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'raw'>(type === 'csv' ? 'preview' : 'raw');

  if (!isOpen) return null;

  const handleCopy = async () => {
    const success = await copyTextToClipboard(content);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownload = () => {
    downloadBlob(blob, filename);
    if (onDownloadAgain) {
      onDownloadAgain();
    }
  };

  // Parse CSV for quick table preview if CSV
  const parseCsvPreview = () => {
    if (type !== 'csv') return { headers: [], rows: [] };
    const lines = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    if (lines.length === 0) return { headers: [], rows: [] };

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current);
      return result;
    };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);
    return { headers, rows };
  };

  const { headers, rows } = parseCsvPreview();

  return (
    <div
      id="export-log-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between bg-stone-50/80">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border shadow-2xs ${
                type === 'csv'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-indigo-50 border-indigo-200 text-indigo-700'
              }`}
            >
              {type === 'csv' ? <FileSpreadsheet className="w-5 h-5" /> : <FileCode className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-stone-900">{title}</h2>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-stone-200/80 text-stone-700 font-semibold">
                  {filename}
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Audit trail for {packagesCount} SCORM package{packagesCount === 1 ? '' : 's'} ({new Blob([content]).size.toLocaleString()} bytes)
              </p>
            </div>
          </div>

          {/* Quick Action Toolbar */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-modal-copy-clipboard"
              onClick={handleCopy}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-2xs border ${
                copied
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-stone-300 text-stone-700 hover:bg-stone-50'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied to Clipboard!' : 'Copy to Clipboard'}
            </button>

            <button
              type="button"
              id="btn-modal-download-again"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-stone-900 hover:bg-stone-800 text-white transition-colors shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              Download File
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-200/60 transition-colors ml-1"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Informational Callout / Iframe notice */}
        <div className="px-6 py-2.5 bg-emerald-50/70 border-b border-emerald-100 flex items-center justify-between text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              <strong>Download initiated:</strong> Your browser has been prompted to save{' '}
              <code className="font-mono text-[11px] bg-emerald-100 px-1 py-0.5 rounded">{filename}</code>.
            </span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-stone-500">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Browser blocking downloads? Click <strong>Copy to Clipboard</strong> to paste directly.</span>
          </div>
        </div>

        {/* View Toggle Tabs (if CSV) */}
        {type === 'csv' && (
          <div className="px-6 pt-3 pb-2 border-b border-stone-200 flex items-center gap-3 bg-white">
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'preview'
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              Formatted Table ({rows.length} rows)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('raw')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === 'raw'
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              <CodeIcon className="w-3.5 h-3.5" />
              Raw CSV Output
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6 bg-stone-50/50">
          {type === 'csv' && activeTab === 'preview' ? (
            <div className="border border-stone-200 rounded-xl overflow-hidden shadow-2xs bg-white">
              <div className="overflow-x-auto max-h-[55vh]">
                <table className="w-full text-left text-xs border-collapse font-sans">
                  <thead className="bg-stone-100/90 sticky top-0 border-b border-stone-200 text-stone-700 font-semibold tracking-wider text-[11px] uppercase">
                    <tr>
                      {headers.map((h, idx) => (
                        <th key={idx} className="p-2.5 whitespace-nowrap border-r border-stone-200 last:border-r-0">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {rows.map((row, rIdx) => (
                      <tr key={rIdx} className="hover:bg-stone-50/80 transition-colors">
                        {row.map((val, cIdx) => (
                          <td
                            key={cIdx}
                            className={`p-2.5 whitespace-nowrap text-stone-700 border-r border-stone-100 last:border-r-0 font-mono text-[11px] ${
                              cIdx === 0 ? 'font-semibold text-stone-900' : ''
                            }`}
                          >
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="relative border border-stone-200 rounded-xl overflow-hidden shadow-2xs bg-stone-950 text-stone-100">
              <div className="flex items-center justify-between px-4 py-2 bg-stone-900 border-b border-stone-800 text-[11px] text-stone-400 font-mono">
                <span>{filename}</span>
                <span>{content.length.toLocaleString()} characters</span>
              </div>
              <pre className="p-4 font-mono text-xs overflow-auto max-h-[55vh] leading-relaxed text-emerald-400 selection:bg-emerald-900 selection:text-white">
                <code>{content}</code>
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-stone-200 flex items-center justify-between bg-stone-50 text-xs text-stone-500">
          <span>Excel-compatible with UTF-8 BOM encoding</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="text-stone-700 hover:text-stone-900 font-semibold underline underline-offset-2 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
            <span>•</span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-stone-200 hover:bg-stone-300 text-stone-800 font-semibold transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
