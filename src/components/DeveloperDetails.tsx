import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Terminal,
  Shield,
  FileCheck,
  Layers,
  FolderArchive,
  FileCode2,
  Cpu,
  Clock,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
} from 'lucide-react';
import { PackageInspectionResult } from '../types';
import { DownloadDiagnosticsPanel } from './DownloadDiagnosticsPanel';

interface DeveloperDetailsProps {
  packages: PackageInspectionResult[];
}

export const DeveloperDetails: React.FC<DeveloperDetailsProps> = ({ packages }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [expandedPkgId, setExpandedPkgId] = useState<string | null>(packages[0]?.id || null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const hasFileSystemAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="bg-white rounded-xl border border-stone-200 shadow-xs overflow-hidden mt-6">
      <button
        type="button"
        id="btn-toggle-dev-details"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-3.5 bg-stone-50 hover:bg-stone-100 transition-colors flex items-center justify-between text-left text-xs font-bold text-stone-900"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-stone-600" />
          <span>Developer / Verification Details & Milestone 1 Inspection Evidence</span>
          <span className="text-stone-400 font-normal">
            ({packages.length} package{packages.length === 1 ? '' : 's'} inspected in memory)
          </span>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-stone-500" /> : <ChevronDown className="w-4 h-4 text-stone-500" />}
      </button>

      {isOpen && (
        <div className="p-5 border-t border-stone-200 space-y-6 text-xs text-stone-700">
          {/* Architecture & Verification Guarantees */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50">
              <div className="font-semibold text-stone-900 flex items-center gap-1.5 mb-1">
                <Shield className="w-3.5 h-3.5 text-stone-600" />
                Local Memory Sandbox
              </div>
              <p className="text-[11px] text-stone-500 leading-relaxed">
                100% in-browser archive extraction & SHA-256 calculation. Zero external API calls, zero remote uploads.
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-stone-200 bg-stone-50/50">
              <div className="font-semibold text-stone-900 flex items-center gap-1.5 mb-1">
                <Layers className="w-3.5 h-3.5 text-stone-600" />
                Deterministic Queue
              </div>
              <p className="text-[11px] text-stone-500 leading-relaxed">
                Strict sequential execution (Concurrency = 1) with automatic 1-level nested ZIP recursion.
              </p>
            </div>

            <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50/50">
              <div className="font-semibold text-emerald-900 flex items-center gap-1.5 mb-1">
                <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                Milestone 2 Scope
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed font-semibold">
                MILESTONE 2 — CONTROLLED REMEDIATION ACTIVE
              </p>
              <p className="text-[10px] text-emerald-700 leading-relaxed mt-0.5">
                Deterministic code patching and 20-rule post-patch verification active.
              </p>
            </div>
          </div>

          {/* Package Inspection Evidence Cards */}
          {packages.length === 0 ? (
            <div className="p-6 text-center text-stone-400 bg-stone-50 rounded-lg border border-dashed border-stone-200">
              No packages scanned yet. Upload SCORM ZIP files above to see live inspection evidence.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-stone-900 uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-stone-600" />
                  Milestone 1 Verification Evidence Audit (Per-Package Inspection Details)
                </h4>
                <span className="text-[11px] text-stone-500 font-mono">
                  {packages.length} archive{packages.length === 1 ? '' : 's'} opened and inspected
                </span>
              </div>

              <div className="space-y-3">
                {packages.map((pkg, idx) => {
                  const isExpanded = expandedPkgId === pkg.id || packages.length === 1;

                  return (
                    <div
                      key={pkg.id}
                      className="border border-stone-200 rounded-lg overflow-hidden bg-white shadow-2xs"
                    >
                      {/* Package Header Row */}
                      <div
                        onClick={() => setExpandedPkgId(isExpanded ? null : pkg.id)}
                        className="p-3.5 bg-stone-50 hover:bg-stone-100/80 cursor-pointer transition-colors flex items-center justify-between border-b border-stone-200"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <FolderArchive className="w-4 h-4 text-stone-500 shrink-0" />
                          <span className="font-mono font-bold text-stone-900 truncate">
                            {idx + 1}. {pkg.originalFileName}
                          </span>
                          {pkg.outerStatusMessage ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 whitespace-nowrap">
                              {pkg.outerStatusMessage}
                            </span>
                          ) : (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              pkg.scormVersion === 'SCORM 1.2' ? 'bg-sky-100 text-sky-800' :
                              pkg.scormVersion === 'SCORM 2004' ? 'bg-purple-100 text-purple-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {pkg.scormVersion}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 shrink-0 text-[11px] text-stone-500 font-mono">
                          <span className="inline-flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-stone-200">
                            <Clock className="w-3 h-3 text-stone-400" />
                            {pkg.scanDurationMs} ms
                          </span>
                          <span>{pkg.zipEntriesCount} entries</span>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>

                      {/* Package Expanded Audit Details */}
                      {isExpanded && (
                        <div className="p-4 space-y-4 bg-white text-xs">
                          {/* 12 Required Fields Grid */}
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 font-mono">
                            {/* 1. Original ZIP filename */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                Original ZIP Filename
                              </span>
                              <div className="mt-1 flex items-center justify-between text-stone-900 font-semibold truncate">
                                <span className="truncate" title={pkg.originalFileName}>{pkg.originalFileName}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopy(pkg.originalFileName, `fn-${pkg.id}`);
                                  }}
                                  className="text-stone-400 hover:text-stone-700 ml-1 p-0.5"
                                  title="Copy filename"
                                >
                                  {copiedId === `fn-${pkg.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>

                            {/* 2. ZIP file size */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                ZIP File Size
                              </span>
                              <div className="mt-1 text-stone-900 font-semibold">
                                {(pkg.fileSize / 1024).toFixed(1)} KB{' '}
                                <span className="text-stone-500 font-normal text-[10px]">
                                  ({pkg.fileSize.toLocaleString()} bytes)
                                </span>
                              </div>
                            </div>

                            {/* 3. Number of entries in ZIP */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                Number of Entries in ZIP
                              </span>
                              <div className="mt-1 text-stone-900 font-semibold">
                                {pkg.zipEntriesCount} total archive entries
                              </div>
                            </div>

                            {/* 4. Scan duration in milliseconds */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                Scan Duration in Milliseconds
                              </span>
                              <div className="mt-1 text-stone-900 font-semibold flex items-center gap-1.5">
                                <span className="text-emerald-700 font-bold">{pkg.scanDurationMs} ms</span>
                                <span className="text-stone-400 font-normal text-[10px]">(performance.now)</span>
                              </div>
                            </div>

                            {/* 5. Whether imsmanifest.xml was found */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                Whether imsmanifest.xml Found
                              </span>
                              <div className="mt-1 flex items-center gap-1.5 font-semibold">
                                {pkg.manifestFound ? (
                                  <span className="text-emerald-700 inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                    Yes (true)
                                  </span>
                                ) : (
                                  <span className="text-amber-700 inline-flex items-center gap-1">
                                    <XCircle className="w-3.5 h-3.5 text-amber-600" />
                                    No (false)
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 6. Exact path of imsmanifest.xml */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                Exact Path of imsmanifest.xml
                              </span>
                              <div className="mt-1 text-stone-900 font-semibold truncate" title={pkg.manifestExactPath}>
                                <code className="bg-white px-1.5 py-0.5 rounded border border-stone-200 text-stone-800 text-[11px]">
                                  {pkg.manifestExactPath}
                                </code>
                              </div>
                            </div>

                            {/* 7. Number and names of nested .zip files found */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                Nested .zip Files Found
                              </span>
                              <div className="mt-1 text-stone-900 font-semibold">
                                {pkg.nestedZipCount > 0 ? (
                                  <span className="text-purple-700 font-bold">
                                    {pkg.nestedZipCount} nested ZIP{pkg.nestedZipCount > 1 ? 's' : ''}: [{pkg.nestedZipNames.join(', ')}]
                                  </span>
                                ) : (
                                  <span className="text-stone-500 font-normal">0 (None found)</span>
                                )}
                              </div>
                            </div>

                            {/* 8. Number of .js, .html, and .xml files inspected */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                Code Files Inspected (.js, .html, .xml)
                              </span>
                              <div className="mt-1 text-stone-900 font-semibold">
                                {pkg.inspectedCodeFilesCount.total} total{' '}
                                <span className="text-stone-500 font-normal text-[10px]">
                                  ({pkg.inspectedCodeFilesCount.jsCount} .js, {pkg.inspectedCodeFilesCount.htmlCount} .html, {pkg.inspectedCodeFilesCount.xmlCount} .xml)
                                </span>
                              </div>
                            </div>

                            {/* Original Archive SHA-256 */}
                            <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/50">
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">
                                Archive SHA-256 Hash
                              </span>
                              <div className="mt-1 text-stone-900 truncate flex items-center justify-between">
                                <span className="truncate text-[10px]" title={pkg.originalSha256}>
                                  {pkg.originalSha256}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopy(pkg.originalSha256, `hash-${pkg.id}`);
                                  }}
                                  className="text-stone-400 hover:text-stone-700 ml-1 p-0.5"
                                  title="Copy hash"
                                >
                                  {copiedId === `hash-${pkg.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* 9. Exact runtime files searched */}
                          <div className="p-3 rounded-lg border border-stone-200 bg-stone-50/40">
                            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block mb-1.5">
                              Exact Runtime Files Searched ({pkg.runtimeFilesSearched.length})
                            </span>
                            {pkg.runtimeFilesSearched.length === 0 ? (
                              <p className="text-stone-400 italic text-[11px]">No runtime JavaScript files found.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                                {pkg.runtimeFilesSearched.map((f, i) => (
                                  <span key={i} className="px-2 py-0.5 bg-white rounded border border-stone-200 text-stone-800">
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* 10. Exact assessment files searched */}
                          <div className="p-3 rounded-lg border border-stone-200 bg-stone-50/40">
                            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block mb-1.5">
                              Exact Assessment Files Searched ({pkg.assessmentFilesSearched.length})
                            </span>
                            {pkg.assessmentFilesSearched.length === 0 ? (
                              <p className="text-stone-400 italic text-[11px]">No dedicated assessment or quiz files found.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                                {pkg.assessmentFilesSearched.map((f, i) => (
                                  <span key={i} className="px-2 py-0.5 bg-white rounded border border-stone-200 text-stone-800">
                                    {f}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* 11. Any SCORM API strings detected */}
                          <div className="p-3 rounded-lg border border-stone-200 bg-stone-50/40">
                            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block mb-1.5">
                              SCORM API Strings Detected ({pkg.scormApiStringsDetected.length})
                            </span>
                            {pkg.scormApiStringsDetected.length === 0 ? (
                              <p className="text-stone-400 italic text-[11px]">No standard SCORM API strings detected in scanned code files.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                                {pkg.scormApiStringsDetected.map((str, i) => (
                                  <span
                                    key={i}
                                    className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${
                                      str.includes('LMS') || str.includes('window.API') ? 'bg-sky-50 text-sky-800 border-sky-200' :
                                      str.includes('2004') || str.includes('1484') ? 'bg-purple-50 text-purple-800 border-purple-200' :
                                      'bg-stone-100 text-stone-800 border-stone-200'
                                    }`}
                                  >
                                    {str}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* 12. First 20 internal file paths */}
                          <div className="p-3 rounded-lg border border-stone-200 bg-stone-50/40">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                                First 20 Internal File Paths (Showing {pkg.first20FilePaths.length} of {pkg.zipEntriesCount} total paths)
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(pkg.first20FilePaths.join('\n'), `paths-${pkg.id}`)}
                                className="inline-flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-900 font-mono"
                              >
                                {copiedId === `paths-${pkg.id}` ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                                Copy paths
                              </button>
                            </div>
                            <div className="font-mono text-[11px] bg-white p-2.5 rounded border border-stone-200 max-h-48 overflow-y-auto space-y-0.5 text-stone-800">
                              {pkg.first20FilePaths.map((path, i) => (
                                <div key={i} className="flex items-center gap-2 hover:bg-stone-50 px-1 rounded">
                                  <span className="text-stone-400 select-none w-5 text-right text-[10px]">{i + 1}.</span>
                                  <span className="truncate">{path}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Nested Candidate Inspection Breakdown (if outer wrapper) */}
                          {pkg.nestedPackages && pkg.nestedPackages.length > 0 && (
                            <div className="p-3.5 rounded-lg border-2 border-purple-200 bg-purple-50/40 space-y-3">
                              <div className="flex items-center gap-2 font-bold text-purple-900 text-xs">
                                <FolderArchive className="w-4 h-4 text-purple-700" />
                                <span>Nested Candidate SCORM Inspection (1-Level Recursion)</span>
                              </div>

                              <div className="space-y-2">
                                {pkg.nestedPackages.map((nested, nIdx) => (
                                  <div key={nIdx} className="p-3 rounded bg-white border border-purple-200 font-mono text-[11px] space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="font-bold text-stone-900">{nested.nestedZipName}</span>
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                                        {nested.scormVersion} ({nested.runtimeApiType})
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-stone-600">
                                      <div>Entries: <span className="font-bold text-stone-900">{nested.zipEntriesCount}</span></div>
                                      <div>Scan Time: <span className="font-bold text-stone-900">{nested.scanDurationMs} ms</span></div>
                                      <div>Manifest: <span className="font-bold text-stone-900">{nested.manifestExactPath}</span></div>
                                      <div>Mastery: <span className="font-bold text-stone-900">{nested.masteryScore}</span></div>
                                    </div>
                                    <div className="text-[10px] text-stone-500">
                                      Status: <span className="font-semibold text-stone-800">{nested.statusMessage}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Requirement 8: Developer > Download Diagnostics */}
          <div className="pt-4 border-t border-stone-200">
            <DownloadDiagnosticsPanel />
          </div>
        </div>
      )}
    </div>
  );
};
