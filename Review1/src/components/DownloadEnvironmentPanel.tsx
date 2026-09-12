import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  ExternalLink,
  FlaskConical,
  RefreshCw,
  AlertTriangle,
  Monitor,
  HardDrive,
  FileDown,
  Download,
  FileCheck2,
  Play,
  Check,
  HelpCircle,
  FolderDown,
} from 'lucide-react';
import {
  detectDownloadEnvironment,
  runTestDownloadEnvironment,
  EnvironmentCapabilities,
} from '../utils/downloadManager';
import { downloadBlob } from '../utils/exportLogs';
import { getRealValidatedWorkdayPackage } from '../utils/syntheticTestFixtures';
import { PackageInspectionResult } from '../types';

interface DownloadRegressionTestResult {
  textActionStatus: 'DISPATCHED' | 'FAILED';
  zipActionStatus: 'DISPATCHED' | 'FAILED';
  blobPresentAndSizeGt0: 'YES' | 'NO';
  helperThrewException: 'YES' | 'NO';
  zipFilename: string;
  zipSize: number;
  zipSizeFormatted: string;
  physicalSaveStatus: 'AWAITING_CONFIRMATION' | 'USER_CONFIRMED' | 'PREVIEW_BLOCKED';
  timestamp: string;
}

interface DownloadEnvironmentPanelProps {
  packages?: PackageInspectionResult[];
  onStatusMessage?: (msg: string) => void;
}

export const DownloadEnvironmentPanel: React.FC<DownloadEnvironmentPanelProps> = ({
  packages = [],
  onStatusMessage,
}) => {
  const [env, setEnv] = useState<EnvironmentCapabilities>(detectDownloadEnvironment());
  const [isTesting, setIsTesting] = useState(false);
  const [isRunningRegression, setIsRunningRegression] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    report: string;
    isRestrictionConfirmed: boolean;
  } | null>(null);

  const [regressionResult, setRegressionResult] = useState<DownloadRegressionTestResult | null>(null);
  const [testZipBlobData, setTestZipBlobData] = useState<{ blob: Blob; filename: string } | null>(null);
  const [isSavingWithPicker, setIsSavingWithPicker] = useState(false);

  const refreshEnv = () => {
    setEnv(detectDownloadEnvironment());
  };

  useEffect(() => {
    refreshEnv();
  }, []);

  const handleTestEnvironment = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await runTestDownloadEnvironment((st, detail) => {
        onStatusMessage?.(`[Test Download] ${st}${detail ? ` — ${detail}` : ''}`);
      });
      setTestResult(result);
      if (result.report) {
        onStatusMessage?.(result.report);
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        report: `Test failed: ${err.message}`,
        isRestrictionConfirmed: true,
      });
    } finally {
      setIsTesting(false);
      refreshEnv();
    }
  };

  // Known-working Preview download regression test:
  // 1. download-regression-test.txt
  // 2. ACTUAL multi-megabyte validated _WORKDAY_FIXED.zip (NOT a synthetic 674-byte ZIP)
  // Both using exact restored downloadBlob() helper
  const handleRunRegressionTest = async () => {
    setIsRunningRegression(true);
    let threwException = false;
    let textOk = false;
    let zipOk = false;
    let blobValid = false;
    let zipBlob: Blob | null = null;
    let zipFilename = 'Roadside_Safety_Compact_Workday_WORKDAY_FIXED.zip';
    let zipSize = 0;
    let zipSizeFormatted = '';

    try {
      // 1. Text Blob
      const textContent = `SCORM Workday Repair Tool — Preview Download Regression Test\nExecution Time: ${new Date().toISOString()}\nTarget: download-regression-test.txt\nStatus: Testing direct synchronous anchor download path.`;
      const textBlob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });

      // 2. ACTUAL Patched Package: Real multi-megabyte validated _WORKDAY_FIXED.zip
      const validatedPkg = packages.find(
        (p) => p.validationPassed && (p.patchedZipBlob || p.patchedBlob)
      );

      if (validatedPkg && (validatedPkg.patchedZipBlob || validatedPkg.patchedBlob)) {
        zipBlob = (validatedPkg.patchedZipBlob || validatedPkg.patchedBlob)!;
        zipFilename = validatedPkg.patchedFileName || `${validatedPkg.name.replace(/\.zip$/i, '')}_WORKDAY_FIXED.zip`;
      } else {
        // Generate, scan, and patch the actual Workday pilot package with real multi-megabyte course asset payload
        const actualPkg = await getRealValidatedWorkdayPackage();
        zipBlob = actualPkg.blob;
        zipFilename = actualPkg.filename;
      }

      zipSize = zipBlob.size;
      zipSizeFormatted = `${(zipSize / (1024 * 1024)).toFixed(2)} MB (${zipSize.toLocaleString()} bytes)`;
      blobValid = Boolean(textBlob && textBlob.size > 0 && zipBlob && zipBlob.size > 0);

      setTestZipBlobData({ blob: zipBlob, filename: zipFilename });

      // Invoke exact restored downloadBlob helper on both
      textOk = downloadBlob(textBlob, 'download-regression-test.txt');
      zipOk = downloadBlob(zipBlob, zipFilename);
    } catch (err: any) {
      threwException = true;
      console.error('Regression test exception:', err);
    } finally {
      const result: DownloadRegressionTestResult = {
        textActionStatus: textOk ? 'DISPATCHED' : 'FAILED',
        zipActionStatus: zipOk ? 'DISPATCHED' : 'FAILED',
        blobPresentAndSizeGt0: blobValid ? 'YES' : 'NO',
        helperThrewException: threwException ? 'YES' : 'NO',
        zipFilename,
        zipSize,
        zipSizeFormatted,
        physicalSaveStatus: 'AWAITING_CONFIRMATION',
        timestamp: new Date().toLocaleTimeString(),
      };
      setRegressionResult(result);
      setIsRunningRegression(false);
      onStatusMessage?.(
        `Preview Regression Test: a.click() dispatched for ${zipFilename} (${zipSizeFormatted}). Verify physical file in your Downloads folder.`
      );
    }
  };

  const handleSaveTestZipViaPicker = async () => {
    if (!testZipBlobData) return;
    setIsSavingWithPicker(true);
    try {
      if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: testZipBlobData.filename,
          types: [{ description: 'SCORM Package (.zip)', accept: { 'application/zip': ['.zip'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(testZipBlobData.blob);
        await writable.close();
        if (regressionResult) {
          setRegressionResult({
            ...regressionResult,
            physicalSaveStatus: 'USER_CONFIRMED',
          });
        }
        onStatusMessage?.(`File successfully written to disk via Save As picker: ${testZipBlobData.filename}`);
      } else {
        alert('File System Access API (showSaveFilePicker) is not supported in this browser. Please open in a top-level tab.');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Save picker error:', err);
      }
    } finally {
      setIsSavingWithPicker(false);
    }
  };

  const handleOpenTopLevel = () => {
    try {
      window.open(window.location.href, '_blank', 'noopener,noreferrer');
    } catch {
      alert('Could not open top-level tab. Please copy the URL and paste in a new browser tab.');
    }
  };

  return (
    <div
      id="download-environment-section"
      className="bg-white rounded-xl border border-stone-200 shadow-xs p-4 sm:p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-stone-100 text-stone-700">
            <Monitor className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-900 flex items-center gap-2">
              DOWNLOAD ENVIRONMENT
              {env.isEmbeddedIframe && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                  <AlertTriangle className="w-3 h-3 text-amber-700 shrink-0" />
                  PREVIEW DOWNLOAD RESTRICTION POSSIBLE
                </span>
              )}
            </h3>
            <p className="text-[11px] text-stone-500">
              Browser capability audit and iframe sandbox restriction detector
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            id="btn-test-download-env"
            disabled={isTesting}
            onClick={handleTestEnvironment}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            title="Generate scorm-download-test.txt to test saving capability without modifying packages"
          >
            <FlaskConical className="w-3.5 h-3.5 text-amber-300" />
            {isTesting ? 'Testing...' : 'TEST DOWNLOAD ENVIRONMENT'}
          </button>

          {env.isEmbeddedIframe && (
            <button
              type="button"
              id="btn-open-top-level-app"
              onClick={handleOpenTopLevel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
              title="Open this application in a top-level browser tab to bypass iframe download sandbox restrictions"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in Top-Level Tab
            </button>
          )}

          <button
            type="button"
            id="btn-refresh-env"
            onClick={refreshEnv}
            className="p-1.5 text-stone-400 hover:text-stone-700 rounded-lg hover:bg-stone-100 transition-colors"
            title="Refresh environment detection"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Embedded Warning Banner if window.self !== window.top */}
      {env.isEmbeddedIframe && (
        <div
          id="embedded-preview-detected-banner"
          className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 flex items-start gap-3 text-xs"
        >
          <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-amber-950 uppercase tracking-wide flex items-center gap-2">
              EMBEDDED PREVIEW DETECTED
              <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-200 text-amber-900 font-mono">
                window.self !== window.top
              </span>
            </div>
            <p className="text-amber-900 leading-relaxed">
              Google AI Studio Preview or another embedded environment may block browser file downloads.
              Use the published/top-level app for reliable file saving.
            </p>
            <div className="pt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={handleOpenTopLevel}
                className="underline font-bold text-amber-950 hover:text-amber-800 flex items-center gap-1"
              >
                Launch Top-Level Session <ExternalLink className="w-3 h-3 inline" />
              </button>
              <span className="text-amber-700 text-[11px]">(Recommended for writing .zip files to disk)</span>
            </div>
          </div>
        </div>
      )}

      {/* 7 Requirement 1 Environment Attributes Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs font-mono">
        {/* 1. Embedded iframe */}
        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70 flex flex-col justify-between">
          <span className="text-[10px] text-stone-500 block leading-tight">
            Embedded iframe:
          </span>
          <span
            className={`font-bold text-xs mt-1 flex items-center gap-1 ${
              env.isEmbeddedIframe ? 'text-amber-700' : 'text-stone-700'
            }`}
          >
            {env.isEmbeddedIframe ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" /> YES
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-stone-400" /> NO
              </>
            )}
          </span>
        </div>

        {/* 2. Top-level page */}
        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70 flex flex-col justify-between">
          <span className="text-[10px] text-stone-500 block leading-tight">
            Top-level page:
          </span>
          <span
            className={`font-bold text-xs mt-1 flex items-center gap-1 ${
              env.isTopLevel ? 'text-emerald-700' : 'text-stone-600'
            }`}
          >
            {env.isTopLevel ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> YES
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-stone-400" /> NO
              </>
            )}
          </span>
        </div>

        {/* 3. File System Access API */}
        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70 flex flex-col justify-between">
          <span className="text-[10px] text-stone-500 block leading-tight">
            File System Access API:
          </span>
          <span
            className={`font-bold text-xs mt-1 flex items-center gap-1 ${
              env.hasFileSystemAccess ? 'text-emerald-700' : 'text-stone-600'
            }`}
          >
            {env.hasFileSystemAccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> YES
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-stone-400" /> NO
              </>
            )}
          </span>
        </div>

        {/* 4. showSaveFilePicker */}
        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70 flex flex-col justify-between">
          <span className="text-[10px] text-stone-500 block leading-tight">
            showSaveFilePicker:
          </span>
          <span
            className={`font-bold text-xs mt-1 flex items-center gap-1 ${
              env.hasShowSaveFilePicker ? 'text-emerald-700' : 'text-stone-600'
            }`}
          >
            {env.hasShowSaveFilePicker ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> YES
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-stone-400" /> NO
              </>
            )}
          </span>
        </div>

        {/* 5. showDirectoryPicker */}
        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70 flex flex-col justify-between">
          <span className="text-[10px] text-stone-500 block leading-tight">
            showDirectoryPicker:
          </span>
          <span
            className={`font-bold text-xs mt-1 flex items-center gap-1 ${
              env.hasShowDirectoryPicker ? 'text-emerald-700' : 'text-stone-600'
            }`}
          >
            {env.hasShowDirectoryPicker ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> YES
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-stone-400" /> NO
              </>
            )}
          </span>
        </div>

        {/* 6. Blob URL supported */}
        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70 flex flex-col justify-between">
          <span className="text-[10px] text-stone-500 block leading-tight">
            Blob URL supported:
          </span>
          <span
            className={`font-bold text-xs mt-1 flex items-center gap-1 ${
              env.hasBlobUrl ? 'text-emerald-700' : 'text-stone-600'
            }`}
          >
            {env.hasBlobUrl ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> YES
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-stone-400" /> NO
              </>
            )}
          </span>
        </div>

        {/* 7. Download attribute supported */}
        <div className="p-2.5 rounded-lg border border-stone-200 bg-stone-50/70 flex flex-col justify-between">
          <span className="text-[10px] text-stone-500 block leading-tight">
            Download attribute:
          </span>
          <span
            className={`font-bold text-xs mt-1 flex items-center gap-1 ${
              env.hasDownloadAttribute ? 'text-emerald-700' : 'text-stone-600'
            }`}
          >
            {env.hasDownloadAttribute ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> YES
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5 text-stone-400" /> NO
              </>
            )}
          </span>
        </div>
      </div>

      {/* Requirement 11 Test Results Banner */}
      {testResult && (
        <div
          id="test-download-environment-result"
          className={`p-3.5 rounded-lg border text-xs font-mono ${
            testResult.isRestrictionConfirmed
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : testResult.success
              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
              : 'bg-stone-50 border-stone-300 text-stone-900'
          }`}
        >
          <div className="flex items-center justify-between font-bold mb-1">
            <span className="flex items-center gap-2">
              {testResult.isRestrictionConfirmed ? (
                <ShieldAlert className="w-4 h-4 text-amber-700" />
              ) : testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-stone-600" />
              )}
              {testResult.isRestrictionConfirmed
                ? 'PREVIEW ENVIRONMENT RESTRICTION CONFIRMED'
                : testResult.success
                ? 'TEST DOWNLOAD SUCCEEDED'
                : 'TEST DOWNLOAD RESULT'}
            </span>
            <span className="text-[10px] text-stone-500 font-normal">scorm-download-test.txt</span>
          </div>
          <p className="text-[11px] leading-relaxed">{testResult.report}</p>
        </div>
      )}

      {/* Known-working Preview Download Regression Test Banner & Outcomes */}
      <div className="p-4 rounded-xl border border-stone-200 bg-stone-50/50 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-200/80 pb-2.5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-emerald-700" />
              Known-Working Preview Download Regression Test
            </div>
            <p className="text-[11px] text-stone-600">
              Verifies dual delivery of <code className="font-mono text-[10px] bg-white px-1 py-0.5 rounded border border-stone-200">download-regression-test.txt</code> and validated <code className="font-mono text-[10px] bg-white px-1 py-0.5 rounded border border-stone-200">_WORKDAY_FIXED.zip</code> via exact restored direct anchor download helper.
            </p>
          </div>
          <button
            type="button"
            id="btn-run-download-regression-test"
            disabled={isRunningRegression}
            onClick={handleRunRegressionTest}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {isRunningRegression ? 'Testing...' : 'Run Regression Test'}
          </button>
        </div>

        {regressionResult && (
          <div
            id="preview-regression-test-results"
            className="p-3.5 rounded-lg border border-stone-200 bg-white space-y-2.5 text-xs font-mono"
          >
            <div className="text-[11px] font-bold text-stone-800 uppercase tracking-wide flex items-center justify-between">
              <span>Regression Test Outcome Verification (Restored Direct Download)</span>
              <span className="text-[10px] text-stone-500 font-normal">{regressionResult.timestamp}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {/* 1. Text test dispatched */}
              <div className="p-2 rounded bg-stone-50 border border-stone-200 flex flex-col justify-between">
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">Text test dispatched:</span>
                <span
                  className={`text-xs font-bold mt-1 flex items-center gap-1.5 ${
                    regressionResult.textActionStatus === 'DISPATCHED' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {regressionResult.textActionStatus === 'DISPATCHED' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                  )}
                  {regressionResult.textActionStatus}
                </span>
                <span className="text-[9px] text-stone-400 mt-0.5">download-regression-test.txt (a.click dispatched)</span>
              </div>

              {/* 2. Fixed ZIP dispatched */}
              <div className="p-2 rounded bg-stone-50 border border-stone-200 flex flex-col justify-between">
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">Fixed ZIP dispatched:</span>
                <span
                  className={`text-xs font-bold mt-1 flex items-center gap-1.5 ${
                    regressionResult.zipActionStatus === 'DISPATCHED' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {regressionResult.zipActionStatus === 'DISPATCHED' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                  )}
                  {regressionResult.zipActionStatus}
                </span>
                <span className="text-[9px] text-stone-400 mt-0.5 truncate" title={regressionResult.zipFilename}>
                  {regressionResult.zipFilename}
                </span>
              </div>

              {/* 3. Blob present and size > 0 */}
              <div className="p-2 rounded bg-stone-50 border border-stone-200 flex flex-col justify-between">
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                  Blob present &amp; size &gt; 0:
                </span>
                <span
                  className={`text-xs font-bold mt-1 flex items-center gap-1.5 ${
                    regressionResult.blobPresentAndSizeGt0 === 'YES' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {regressionResult.blobPresentAndSizeGt0 === 'YES' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                  )}
                  {regressionResult.blobPresentAndSizeGt0}
                </span>
                <span className="text-[9px] text-stone-400 mt-0.5">
                  {regressionResult.zipSizeFormatted}
                </span>
              </div>

              {/* 4. Download helper threw exception */}
              <div className="p-2 rounded bg-stone-50 border border-stone-200 flex flex-col justify-between">
                <span className="text-[10px] text-stone-500 uppercase tracking-wider">
                  Download helper threw exception:
                </span>
                <span
                  className={`text-xs font-bold mt-1 flex items-center gap-1.5 ${
                    regressionResult.helperThrewException === 'NO' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {regressionResult.helperThrewException === 'NO' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-600" />
                  )}
                  {regressionResult.helperThrewException}
                </span>
                <span className="text-[9px] text-stone-400 mt-0.5">Direct anchor.click() synchronous</span>
              </div>
            </div>

            {/* Physical Save Acceptance Verification */}
            <div className="mt-3 pt-3 border-t border-stone-200 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-stone-700" />
                  Physical Save Acceptance Verification
                </div>
                <div className="text-[10px] font-sans">
                  {regressionResult.physicalSaveStatus === 'USER_CONFIRMED' && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold">
                      <Check className="w-3 h-3 text-emerald-600" />
                      PHYSICALLY CONFIRMED IN DOWNLOADS
                    </span>
                  )}
                  {regressionResult.physicalSaveStatus === 'AWAITING_CONFIRMATION' && (
                    <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-semibold">
                      <HelpCircle className="w-3 h-3 text-amber-600" />
                      AWAITING BROWSER DISK VERIFICATION
                    </span>
                  )}
                  {regressionResult.physicalSaveStatus === 'PREVIEW_BLOCKED' && (
                    <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 font-semibold">
                      <XCircle className="w-3 h-3 text-rose-600" />
                      PREVIEW IFRAME BLOCKED DISK SAVE
                    </span>
                  )}
                </div>
              </div>

              <div className="text-[11px] text-stone-600 font-sans leading-relaxed bg-stone-50 p-2.5 rounded border border-stone-200/80">
                <p>
                  <strong>Acceptance Criterion:</strong> A real multi-megabyte validated <code className="font-mono text-[10px] bg-white px-1 py-0.5 rounded border border-stone-200">{regressionResult.zipFilename}</code> ({regressionResult.zipSizeFormatted}) must be physically saved to disk. In browser JavaScript, dispatching <code className="font-mono text-[10px]">a.click()</code> dispatches the download intent, but iframe sandboxing can silently drop the file write.
                </p>
                <p className="mt-1">
                  Please check your browser's Downloads folder now. Did the file physically appear?
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setRegressionResult({
                      ...regressionResult,
                      physicalSaveStatus: 'USER_CONFIRMED',
                    });
                    onStatusMessage?.(`User confirmed physical save of ${regressionResult.zipFilename} in browser Downloads folder.`);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    regressionResult.physicalSaveStatus === 'USER_CONFIRMED'
                      ? 'bg-emerald-700 text-white shadow-xs'
                      : 'bg-stone-100 hover:bg-emerald-50 hover:text-emerald-800 text-stone-700 border border-stone-300'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  Yes, File Physically Saved to Downloads
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRegressionResult({
                      ...regressionResult,
                      physicalSaveStatus: 'PREVIEW_BLOCKED',
                    });
                    onStatusMessage?.(`User indicated physical download was blocked by Preview iframe sandbox.`);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    regressionResult.physicalSaveStatus === 'PREVIEW_BLOCKED'
                      ? 'bg-rose-700 text-white shadow-xs'
                      : 'bg-stone-100 hover:bg-rose-50 hover:text-rose-800 text-stone-700 border border-stone-300'
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Not in Downloads (Preview Blocked Save)
                </button>

                {/* If user needs alternative delivery methods */}
                {testZipBlobData && (
                  <button
                    type="button"
                    disabled={isSavingWithPicker}
                    onClick={handleSaveTestZipViaPicker}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-900 text-white text-xs font-bold transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <FolderDown className="w-3.5 h-3.5" />
                    {isSavingWithPicker ? 'Saving via Picker...' : 'Save As (File System Picker)'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleOpenTopLevel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold transition-colors cursor-pointer border border-stone-300"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in Top-Level Tab
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
