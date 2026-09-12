import React, { useState, useEffect } from 'react';
import {
  Wrench,
  Download,
  FileSpreadsheet,
  FileCode,
  RotateCcw,
  CheckSquare,
  ShieldCheck,
  FolderDown,
  Info,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { PackageInspectionResult, BatchSummary } from './types';
import { Header } from './components/Header';
import { UploadZone } from './components/UploadZone';
import { ProgressBar } from './components/ProgressBar';
import { ResultsTable } from './components/ResultsTable';
import { PackageDetailModal, ModalTab } from './components/PackageDetailModal';
import { ExportLogModal } from './components/ExportLogModal';
import { TestModeModal } from './components/TestModeModal';
import { DeveloperDetails } from './components/DeveloperDetails';
import { DownloadEnvironmentPanel } from './components/DownloadEnvironmentPanel';
import { scanSinglePackage, patchSinglePackage } from './utils/packageProcessor';
import { generateCsvLog, generateJsonLog, downloadBlob } from './utils/exportLogs';
import { saveAllToFolder } from './utils/downloadManager';
import { createSyntheticSampleZips } from './utils/syntheticTestFixtures';

export default function App() {
  const [packages, setPackages] = useState<PackageInspectionResult[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<PackageInspectionResult | null>(null);
  const [selectedTab, setSelectedTab] = useState<ModalTab>('OVERVIEW');

  // Workflow state
  const [workflowStage, setWorkflowStage] = useState<'IDLE' | 'SCANNING' | 'SCANNED' | 'PATCHING' | 'COMPLETED'>('IDLE');
  const [currentStatusText, setCurrentStatusText] = useState('');
  const [confirmedSafetyRule, setConfirmedSafetyRule] = useState(true);

  // Test suite modal
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Export Log Modal
  const [exportModalData, setExportModalData] = useState<{
    isOpen: boolean;
    type: 'csv' | 'json';
    title: string;
    filename: string;
    content: string;
    blob: Blob;
  } | null>(null);

  // Sequential save progress state (Requirement 9)
  const [saveAllProgressText, setSaveAllProgressText] = useState<string | null>(null);

  // Download feedback toast notification
  const [toast, setToast] = useState<{
    id: string;
    message: string;
    type?: 'info' | 'success' | 'warning';
  } | null>(null);

  const showToast = (message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    const id = `${Date.now()}`;
    setToast({ id, message, type });
    setTimeout(() => {
      setToast((cur) => (cur?.id === id ? null : cur));
    }, 4500);
  };

  // Batch summary tracking
  const [batchSummary, setBatchSummary] = useState<BatchSummary>({
    total: 0,
    completed: 0,
    patched: 0,
    noChange: 0,
    manualReview: 0,
    failed: 0,
  });

  const isProcessing = workflowStage === 'SCANNING' || workflowStage === 'PATCHING';

  // Helper to recompute stats
  const computeStats = (items: PackageInspectionResult[]) => {
    let patched = 0;
    let noChange = 0;
    let manualReview = 0;
    let failed = 0;

    for (const p of items) {
      if (p.actionStatus === 'PATCHED') patched++;
      else if (p.actionStatus === 'NO CHANGE NEEDED') noChange++;
      else if (p.actionStatus === 'MANUAL REVIEW') manualReview++;
      else if (p.actionStatus === 'FAILED VALIDATION') failed++;
      else if (p.actionStatus === 'READY_TO_PATCH') {
        // counted in scanned
      }
    }

    return { patched, noChange, manualReview, failed };
  };

  // ==========================================
  // PHASE A: SCANNING (Sequential, Concurrency = 1)
  // ==========================================
  const handleFilesSelected = async (files: File[]) => {
    setPackages([]);
    setConfirmedSafetyRule(true);
    setWorkflowStage('SCANNING');

    const total = files.length;
    setBatchSummary({
      total,
      completed: 0,
      patched: 0,
      noChange: 0,
      manualReview: 0,
      failed: 0,
      currentIndex: 0,
      currentFileName: files[0]?.name,
    });

    const scannedResults: PackageInspectionResult[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBatchSummary((prev) => ({
        ...prev,
        currentIndex: i,
        currentFileName: file.name,
      }));

      setCurrentStatusText(`Inspecting archive [${i + 1}/${files.length}] ${file.name}: opening entries, parsing manifest & checking SCORM scripts...`);
      // Optical yield so the user clearly sees sequential scanning progression
      await new Promise((resolve) => setTimeout(resolve, 80));

      try {
        const inspected = await scanSinglePackage(file, (status) => {
          setCurrentStatusText(`[${file.name}] ${status}`);
        });
        scannedResults.push(inspected);
      } catch (err: any) {
        // Fallback for corrupt archive
        scannedResults.push({
          id: `${file.name}-${Date.now()}`,
          file,
          originalFileName: file.name,
          fileSize: file.size,
          originalSha256: 'ERROR_UNREADABLE',
          // Milestone 1 Verification Details
          zipEntriesCount: 0,
          scanDurationMs: 0,
          first20FilePaths: [],
          manifestFound: false,
          manifestExactPath: 'NOT FOUND (Corrupt Archive)',
          nestedZipCount: 0,
          nestedZipNames: [],
          inspectedCodeFilesCount: { jsCount: 0, htmlCount: 0, xmlCount: 0, total: 0 },
          runtimeFilesSearched: [],
          assessmentFilesSearched: [],
          scormApiStringsDetected: [],
          isOuterWrapper: false,
          nestedPackages: [],
          scormVersion: 'UNKNOWN',
          scormVersionReason: 'Failed to read archive as valid ZIP',
          runtimeApiType: 'None / Unknown',
          manifestVersion: 'N/A',
          manifestData: {
            present: false,
            atRoot: false,
            validXml: false,
            declaredVersion: null,
            masteryScore: null,
            masteryScoreStatus: 'MASTERY SCORE NOT FOUND',
            launchResource: null,
            referencedFiles: [],
          },
          masteryScore: 'N/A',
          detectedQuizThreshold: 'N/A',
          passScoreConsistency: 'INSUFFICIENT DATA',
          passScoreReferences: [],
          actualPackageName: file.name,
          outerFileName: undefined,
          statusWriteInventory: [],
          exitDefect: { detected: false },
          progressDefect: { detected: false },
          finishDefect: { detected: false },
          relaunchDefect: { detected: false },
          repairProfile: 'NONE',
          manualReviewReasons: [`Archive unreadable: ${err.message || 'Corrupt ZIP'}`],
          actionStatus: 'FAILED VALIDATION',
          allFiles: [],
          runtimeJsFiles: [],
          assessmentFiles: [],
          filesModified: [],
          codeChanges: [],
          validationChecks: [],
          validationPassed: false,
          warnings: [],
          error: err.message,
        });
      }

      setPackages([...scannedResults]);
      const stats = computeStats(scannedResults);
      setBatchSummary((prev) => ({
        ...prev,
        completed: i + 1,
        ...stats,
      }));
    }

    setCurrentStatusText('');
    setWorkflowStage('SCANNED');
  };

  // ==========================================
  // PHASE B: PATCHING (Sequential, Concurrency = 1)
  // ==========================================
  const handlePatchEligiblePackages = async () => {
    if (!confirmedSafetyRule) {
      setConfirmedSafetyRule(true);
    }

    const eligibleList = packages.filter((p) => p.actionStatus === 'READY_TO_PATCH');
    if (eligibleList.length === 0) return;

    setWorkflowStage('PATCHING');
    const total = eligibleList.length;

    setBatchSummary({
      total,
      completed: 0,
      patched: 0,
      noChange: 0,
      manualReview: 0,
      failed: 0,
      currentIndex: 0,
      currentFileName: eligibleList[0]?.originalFileName,
    });

    const updatedPackages = [...packages];

    for (let i = 0; i < eligibleList.length; i++) {
      const targetPkg = eligibleList[i];
      setBatchSummary((prev) => ({
        ...prev,
        currentIndex: i,
        currentFileName: targetPkg.originalFileName,
      }));

      try {
        const patchedPkg = await patchSinglePackage(targetPkg, (status) => {
          setCurrentStatusText(status);
        });

        const targetIdx = updatedPackages.findIndex((p) => p.id === targetPkg.id);
        if (targetIdx !== -1) {
          updatedPackages[targetIdx] = patchedPkg;
        }
      } catch (err: any) {
        const targetIdx = updatedPackages.findIndex((p) => p.id === targetPkg.id);
        if (targetIdx !== -1) {
          updatedPackages[targetIdx] = {
            ...targetPkg,
            actionStatus: 'FAILED VALIDATION',
            error: err.message,
          };
        }
      }

      setPackages([...updatedPackages]);
      const stats = computeStats(updatedPackages);
      setBatchSummary((prev) => ({
        ...prev,
        completed: i + 1,
        ...stats,
      }));
    }

    setCurrentStatusText('');
    setWorkflowStage('COMPLETED');
  };

  const handlePatchSinglePackage = async (targetPkg: PackageInspectionResult) => {
    setCurrentStatusText(`Remediating ${targetPkg.actualPackageName || targetPkg.originalFileName}...`);
    try {
      const patchedPkg = await patchSinglePackage(targetPkg, (st) => setCurrentStatusText(st));
      setPackages((prev) => {
        const updated = prev.map((p) => (p.id === targetPkg.id ? patchedPkg : p));
        const stats = computeStats(updated);
        setBatchSummary((prevSummary) => ({
          ...prevSummary,
          ...stats,
        }));
        return updated;
      });
      if (selectedPackage && selectedPackage.id === targetPkg.id) {
        setSelectedPackage(patchedPkg);
      }
    } catch (err: any) {
      console.error('Patch error:', err);
      alert(`Failed to patch package: ${err.message}`);
    } finally {
      setCurrentStatusText('');
    }
  };

  // Sequential save of all validated ZIPs directly to a chosen directory (Requirement 9)
  const handleSaveAllToFolder = async () => {
    const validatedList = packages.filter((p) => p.validationPassed && (p.patchedBlob || p.patchedZipBlob));
    if (validatedList.length === 0) {
      showToast('No validated packages available to save.', 'warning');
      return;
    }

    setSaveAllProgressText(`Preparing to save ${validatedList.length} files...`);
    try {
      const result = await saveAllToFolder(packages, (progress) => {
        setSaveAllProgressText(progress);
      });

      if (result.success) {
        setSaveAllProgressText(`${result.count} FILES SAVED SUCCESSFULLY`);
        showToast(`${result.count} FILES SAVED SUCCESSFULLY`, 'success');
        setTimeout(() => setSaveAllProgressText(null), 5000);
      } else if (result.status === 'FOLDER SAVING IS NOT AVAILABLE IN THIS EMBEDDED PREVIEW') {
        setSaveAllProgressText('FOLDER SAVING IS NOT AVAILABLE IN THIS EMBEDDED PREVIEW');
        showToast('FOLDER SAVING IS NOT AVAILABLE IN THIS EMBEDDED PREVIEW', 'warning');
        setTimeout(() => setSaveAllProgressText(null), 7000);
      } else if (result.status === 'CANCELLED BY USER') {
        setSaveAllProgressText(null);
      } else {
        setSaveAllProgressText(`Error: ${result.error || 'Failed saving files'}`);
        showToast(`Save error: ${result.error}`, 'warning');
        setTimeout(() => setSaveAllProgressText(null), 5000);
      }
    } catch (err: any) {
      setSaveAllProgressText(`Save error: ${err.message}`);
      showToast(`Error: ${err.message}`, 'warning');
      setTimeout(() => setSaveAllProgressText(null), 5000);
    }
  };

  // Download logs
  const handleDownloadCsv = () => {
    try {
      if (packages.length === 0) {
        showToast('No packages available to export.', 'warning');
        return;
      }
      const csv = generateCsvLog(packages);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, 'scorm_workday_repair_log.csv');
      setExportModalData({
        isOpen: true,
        type: 'csv',
        title: 'SCORM Workday Audit Log (CSV)',
        filename: 'scorm_workday_repair_log.csv',
        content: csv,
        blob,
      });
      showToast('Exporting scorm_workday_repair_log.csv...', 'success');
    } catch (err: any) {
      console.error('Failed to export CSV:', err);
      showToast(`Export error: ${err.message}`, 'warning');
    }
  };

  const handleDownloadJson = () => {
    try {
      if (packages.length === 0) {
        showToast('No packages available to export.', 'warning');
        return;
      }
      const json = generateJsonLog(packages);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
      downloadBlob(blob, 'scorm_workday_repair_log.json');
      setExportModalData({
        isOpen: true,
        type: 'json',
        title: 'SCORM Workday Audit Log (JSON)',
        filename: 'scorm_workday_repair_log.json',
        content: json,
        blob,
      });
      showToast('Exporting scorm_workday_repair_log.json...', 'success');
    } catch (err: any) {
      console.error('Failed to export JSON:', err);
      showToast(`Export error: ${err.message}`, 'warning');
    }
  };

  // Load in-memory synthetic packages for instant live demo/verification
  const handleLoadSyntheticSamples = async () => {
    try {
      const sampleFiles = await createSyntheticSampleZips();
      handleFilesSelected(sampleFiles);
    } catch (err: any) {
      alert(`Could not generate synthetic samples: ${err.message}`);
    }
  };

  // Reset entire batch
  const handleResetBatch = () => {
    setPackages([]);
    setSelectedPackage(null);
    setWorkflowStage('IDLE');
    setConfirmedSafetyRule(false);
  };

  const readyToPatchCount = packages.filter((p) => p.actionStatus === 'READY_TO_PATCH').length;
  const patchedCount = packages.filter((p) => p.actionStatus === 'PATCHED').length;
  const scannedCount = packages.length;
  const repairableCount = packages.filter(
    (p) => p.repairProfile && p.repairProfile !== 'NONE' && p.repairProfile !== 'UNSUPPORTED'
  ).length;
  const passedValidationCount = packages.filter((p) => p.validationPassed === true).length;
  const failedCount = packages.filter(
    (p) => p.actionStatus === 'FAILED VALIDATION' || (p.validationChecks.length > 0 && !p.validationPassed)
  ).length;
  const manualReviewCount = packages.filter((p) => p.actionStatus === 'MANUAL REVIEW').length;
  const downloadsReadyCount = packages.filter(
    (p) => p.validationPassed === true && Boolean(p.patchedBlob && p.patchedBlob.size > 0)
  ).length;

  return (
    <div className="min-h-screen bg-stone-100/70 text-stone-900 flex flex-col font-sans selection:bg-stone-900 selection:text-white">
      {/* Top Header */}
      <Header
        onOpenTestSuite={() => setIsTestModalOpen(true)}
        onLoadSyntheticSamples={handleLoadSyntheticSamples}
        isProcessing={isProcessing}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Requirement 1: Download Environment Audit Panel (Always determined on app load) */}
        <DownloadEnvironmentPanel
          packages={packages}
          onStatusMessage={(msg) => showToast(msg, 'info')}
        />

        {/* Requirement 9: Save All to Folder Progress / Status Banner */}
        {saveAllProgressText && (
          <div
            id="save-all-progress-banner"
            className="p-3.5 rounded-xl border border-stone-800 bg-stone-900 text-emerald-400 font-mono text-xs flex items-center justify-between shadow-xs"
          >
            <span className="font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              {saveAllProgressText}
            </span>
            <button
              type="button"
              onClick={() => setSaveAllProgressText(null)}
              className="text-stone-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Upload Zone (Step 1) - Only visible when IDLE or when user resets */}
        {workflowStage === 'IDLE' && (
          <UploadZone
            onFilesSelected={handleFilesSelected}
            isProcessing={isProcessing}
          />
        )}

        {/* Sequential Progress Bar during Scanning or Patching */}
        {isProcessing && (
          <ProgressBar
            phase={workflowStage === 'SCANNING' ? 'SCANNING' : 'PATCHING'}
            summary={batchSummary}
            currentStatusText={currentStatusText}
          />
        )}

        {/* Phase A Results & Phase B Trigger (Visible after scanning) */}
        {packages.length > 0 && (
          <div className="space-y-6">
            {/* TOP-LEVEL RESULT SUMMARY (Requirement 6) */}
            <div className="bg-stone-900 text-stone-100 rounded-xl p-4 shadow-sm border border-stone-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-2 shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                <span className="text-xs font-bold uppercase tracking-wider text-stone-300">
                  Batch Status:
                </span>
              </div>

              {/* Requirement 6: X packages scanned | X repairable | X patched | X passed validation | X failed | X manual review | X downloads ready */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <span className="bg-stone-800 px-2 py-1 rounded text-stone-200">
                  <strong className="text-white text-sm font-bold">{scannedCount}</strong> packages scanned
                </span>
                <span className="text-stone-600">|</span>
                <span className="bg-stone-800 px-2 py-1 rounded text-amber-300">
                  <strong className="text-amber-200 text-sm font-bold">{repairableCount}</strong> repairable
                </span>
                <span className="text-stone-600">|</span>
                <span className="bg-stone-800 px-2 py-1 rounded text-sky-300">
                  <strong className="text-sky-200 text-sm font-bold">{patchedCount}</strong> patched
                </span>
                <span className="text-stone-600">|</span>
                <span className="bg-stone-800 px-2 py-1 rounded text-emerald-300">
                  <strong className="text-emerald-200 text-sm font-bold">{passedValidationCount}</strong> passed validation
                </span>
                <span className="text-stone-600">|</span>
                <span className={`px-2 py-1 rounded ${failedCount > 0 ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-stone-800 text-stone-400'}`}>
                  <strong className={`text-sm font-bold ${failedCount > 0 ? 'text-rose-200' : 'text-stone-300'}`}>{failedCount}</strong> failed
                </span>
                <span className="text-stone-600">|</span>
                <span className={`px-2 py-1 rounded ${manualReviewCount > 0 ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'bg-stone-800 text-stone-400'}`}>
                  <strong className={`text-sm font-bold ${manualReviewCount > 0 ? 'text-amber-200' : 'text-stone-300'}`}>{manualReviewCount}</strong> manual review
                </span>
                <span className="text-stone-600">|</span>
                <span className={`px-2.5 py-1 rounded font-bold ${downloadsReadyCount > 0 ? 'bg-emerald-600 text-white shadow-xs' : 'bg-stone-800 text-stone-400'}`}>
                  <strong className="text-sm font-bold">{downloadsReadyCount}</strong> downloads ready
                </span>
              </div>
            </div>

            {/* Action Bar / Stage Controls */}
            <div className="bg-white rounded-xl border border-stone-200 shadow-xs p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 text-[11px] font-bold tracking-wide border border-emerald-300">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    MILESTONE 2 — CONTROLLED REMEDIATION ACTIVE
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-stone-900">
                    {workflowStage === 'SCANNED' ? 'STEP 3: REVIEW CLASSIFICATION' :
                     workflowStage === 'COMPLETED' ? 'STEP 5: DOWNLOAD RESULTS & AUDIT TRAIL' :
                     'BATCH OVERVIEW'}
                  </span>
                </div>

                {/* Batch reporting breakdown */}
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-semibold">
                    {packages.length} package{packages.length === 1 ? '' : 's'} inspected
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                    {packages.filter((p) => p.actionStatus === 'PATCHED' && p.validationPassed).length} patched successfully
                  </span>
                  {packages.some((p) => p.validationChecks.some((c) => c.outcome === 'TEST_ERROR')) && (
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold border border-amber-300">
                      {packages.filter((p) => p.validationChecks.some((c) => c.outcome === 'TEST_ERROR')).length} test error
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-semibold">
                    {packages.filter((p) => p.validationChecks.length > 0 && !p.validationPassed && !p.validationChecks.some((c) => c.outcome === 'TEST_ERROR')).length} failed validation
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                    {packages.filter((p) => p.actionStatus === 'MANUAL REVIEW').length} manual review
                  </span>
                </div>

                <p className="text-xs text-stone-500">
                  {readyToPatchCount > 0
                    ? `${readyToPatchCount} package(s) match known repair profiles and are ready for Workday remediation.`
                    : patchedCount > 0
                    ? `${packages.filter((p) => p.actionStatus === 'PATCHED' && p.validationPassed).length} package(s) successfully remediated with all validation checks passed.`
                    : 'Inspection complete. Review classification findings in the table below.'}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Apply Fixes (Primary Button) */}
                {readyToPatchCount > 0 && (
                  <button
                    type="button"
                    id="btn-apply-all-fixes"
                    disabled={isProcessing}
                    onClick={handlePatchEligiblePackages}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                    title="Remediate all eligible packages for Workday Learning"
                  >
                    <Wrench className="w-4 h-4" />
                    Apply Fixes ({readyToPatchCount})
                  </button>
                )}

                {/* Reset button */}
                <button
                  type="button"
                  id="btn-reset-batch"
                  disabled={isProcessing}
                  onClick={handleResetBatch}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-300 text-stone-700 text-xs font-semibold hover:bg-stone-50 transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  New Batch
                </button>

                {/* Export CSV Audit Log */}
                <button
                  type="button"
                  id="btn-export-csv"
                  disabled={isProcessing}
                  onClick={handleDownloadCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 transition-colors shadow-2xs"
                  title="Export audit log formatted for Microsoft Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  Export CSV Log
                </button>

                {/* Export JSON Audit Log */}
                <button
                  type="button"
                  id="btn-export-json"
                  disabled={isProcessing}
                  onClick={handleDownloadJson}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-300 bg-white text-stone-700 text-xs font-semibold hover:bg-stone-50 transition-colors shadow-2xs"
                >
                  <FileCode className="w-3.5 h-3.5 text-stone-600" />
                  Export JSON
                </button>

                {/* Save All to Folder (Requirement 9) */}
                {packages.some((p) => p.validationPassed && (p.patchedBlob || p.patchedZipBlob)) && (
                  <button
                    type="button"
                    id="btn-save-all-to-folder"
                    onClick={handleSaveAllToFolder}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 transition-colors shadow-xs cursor-pointer"
                    title="Sequential directory write via showDirectoryPicker"
                  >
                    <FolderDown className="w-3.5 h-3.5 text-emerald-400" />
                    {saveAllProgressText || `SAVE ALL TO FOLDER (${packages.filter((p) => p.validationPassed && (p.patchedBlob || p.patchedZipBlob)).length})`}
                  </button>
                )}
              </div>
            </div>

            {/* Remediation Action Panel when packages are ready */}
            {readyToPatchCount > 0 && (
              <div className="bg-emerald-50/90 rounded-xl border border-emerald-300 p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
                <div className="flex items-start gap-3.5">
                  <div className="p-2 bg-emerald-100 rounded-lg text-emerald-800 shrink-0 mt-0.5">
                    <Wrench className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                        {readyToPatchCount} Package{readyToPatchCount === 1 ? '' : 's'} Ready for Deterministic Remediation
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        Workday Learning Target
                      </span>
                    </div>
                    <p className="text-xs text-emerald-900 leading-relaxed">
                      Surgically neutralizes page progress completion overrides, finish button completion, and exit/unload completion, while guarding relaunch resets to preserve quiz pass/fail criteria (80%).
                    </p>
                    <div className="flex items-center gap-4 pt-1 text-[11px] text-emerald-800">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={confirmedSafetyRule}
                          onChange={(e) => setConfirmedSafetyRule(e.target.checked)}
                          className="rounded text-emerald-600 focus:ring-emerald-500 border-stone-300 w-3.5 h-3.5"
                        />
                        <span>Safety Guarantee: Non-destructive packaging (<code className="font-mono text-[10px]">* _WORKDAY_FIXED.zip</code>) — never overwrites original archives</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    type="button"
                    id="btn-banner-apply-fixes"
                    disabled={isProcessing}
                    onClick={handlePatchEligiblePackages}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    <Wrench className="w-4 h-4" />
                    Apply Fixes ({readyToPatchCount})
                  </button>
                </div>
              </div>
            )}

            {/* Results Table (7 Columns with Pre-Fix & Validation) */}
            <ResultsTable
              packages={packages}
              onSelectPackage={(pkg, tab) => {
                setSelectedPackage(pkg);
                setSelectedTab(tab || 'OVERVIEW');
              }}
              onPatchSingle={handlePatchSinglePackage}
              isProcessing={isProcessing}
            />

            {/* Developer / Verification Collapsible */}
            <DeveloperDetails packages={packages} />
          </div>
        )}
      </main>

      {/* Package Detail Modal */}
      <PackageDetailModal
        pkg={selectedPackage}
        initialTab={selectedTab}
        onClose={() => setSelectedPackage(null)}
        onPatchSingle={handlePatchSinglePackage}
      />

      {/* Synthetic Unit Test Suite Modal */}
      <TestModeModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
      />

      {/* Export Log Viewer & Clipboard Modal */}
      {exportModalData && (
        <ExportLogModal
          isOpen={exportModalData.isOpen}
          type={exportModalData.type}
          title={exportModalData.title}
          filename={exportModalData.filename}
          content={exportModalData.content}
          blob={exportModalData.blob}
          packagesCount={packages.length}
          onClose={() => setExportModalData(null)}
          onDownloadAgain={() => {
            showToast(`Initiated download of ${exportModalData.filename}`, 'success');
          }}
        />
      )}

      {/* Global Toast Notification */}
      {toast && (
        <div
          id="global-toast-notification"
          className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 bg-stone-900 text-white rounded-xl shadow-2xl border border-stone-700 text-xs animate-in slide-in-from-bottom-3 duration-200"
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : toast.type === 'warning' ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
          )}
          <span className="font-medium">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="p-1 text-stone-400 hover:text-white rounded hover:bg-stone-800 transition-colors ml-1 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white py-4 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-stone-500 gap-2">
          <span>SCORM → Workday Repair Tool • Deterministic Client-Side Remediation Engine</span>
          <span className="font-mono text-[11px]">Strict Sequential Concurrency = 1 • Web Crypto SHA-256</span>
        </div>
      </footer>
    </div>
  );
}
