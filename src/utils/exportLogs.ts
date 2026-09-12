import { PackageInspectionResult } from '../types';

function escapeCsv(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export function generateCsvLog(packages: PackageInspectionResult[]): string {
  const headers = [
    'Original Filename',
    'Outer Status / Nested Finding',
    'ZIP File Size (Bytes)',
    'ZIP Entries Count',
    'Scan Duration (ms)',
    'Manifest Found',
    'Manifest Exact Path',
    'Nested ZIP Count',
    'Nested ZIP Names',
    'Code Files Inspected (.js, .html, .xml)',
    'Runtime Files Searched',
    'Assessment Files Searched',
    'SCORM API Strings Detected',
    'Original SHA-256',
    'Detected SCORM Version',
    'Runtime API Type',
    'Manifest Version',
    'Mastery Score',
    'Detected Quiz Threshold',
    'Pass Score Consistency',
    'Progress Defect (Defect #1)',
    'Finish Defect (Defect #2)',
    'Relaunch Defect (Defect #3)',
    'Exit Defect (Defect #4)',
    'Repair Profile',
    'Action Status',
    'Patched Filename',
    'Patched SHA-256',
    'Files Modified Count',
    'Validation Status',
    'Manual Review / Notes',
  ];

  const rows = packages.map((pkg) => {
    const codeFilesSummary = pkg.inspectedCodeFilesCount
      ? `${pkg.inspectedCodeFilesCount.total ?? 0} total (${pkg.inspectedCodeFilesCount.jsCount ?? 0} js, ${pkg.inspectedCodeFilesCount.htmlCount ?? 0} html, ${pkg.inspectedCodeFilesCount.xmlCount ?? 0} xml)`
      : '0 total';

    const notes = [
      ...(pkg.manualReviewReasons || []),
      ...(pkg.warnings || []),
      ...(pkg.error ? [`Error: ${pkg.error}`] : []),
    ].join(' | ');

    const valStatus =
      pkg.validationChecks && pkg.validationChecks.length > 0
        ? pkg.validationPassed
          ? `PASSED (${pkg.validationChecks.length}/${pkg.validationChecks.length})`
          : `FAILED (${pkg.validationChecks.filter((c) => !c.passed).length} failed)`
        : 'N/A';

    return [
      escapeCsv(pkg.originalFileName),
      escapeCsv(pkg.outerStatusMessage || 'Direct SCORM package'),
      escapeCsv(pkg.fileSize),
      escapeCsv(pkg.zipEntriesCount),
      escapeCsv(pkg.scanDurationMs),
      escapeCsv(pkg.manifestFound ? 'YES' : 'NO'),
      escapeCsv(pkg.manifestExactPath),
      escapeCsv(pkg.nestedZipCount),
      escapeCsv(pkg.nestedZipNames?.join('; ') || 'None'),
      escapeCsv(codeFilesSummary),
      escapeCsv(pkg.runtimeFilesSearched?.join('; ') || 'None'),
      escapeCsv(pkg.assessmentFilesSearched?.join('; ') || 'None'),
      escapeCsv(pkg.scormApiStringsDetected?.join('; ') || 'None'),
      escapeCsv(pkg.originalSha256),
      escapeCsv(pkg.scormVersion),
      escapeCsv(pkg.runtimeApiType),
      escapeCsv(pkg.manifestVersion),
      escapeCsv(pkg.masteryScore),
      escapeCsv(pkg.detectedQuizThreshold),
      escapeCsv(pkg.passScoreConsistency),
      escapeCsv(pkg.progressDefect?.detected ? 'YES' : 'NO'),
      escapeCsv(pkg.finishDefect?.detected ? 'YES' : 'NO'),
      escapeCsv(pkg.relaunchDefect?.detected ? 'YES' : 'NO'),
      escapeCsv(pkg.exitDefect?.detected ? 'YES' : 'NO'),
      escapeCsv(pkg.repairProfile),
      escapeCsv(pkg.actionStatus),
      escapeCsv(pkg.patchedFileName || 'N/A'),
      escapeCsv(pkg.patchedSha256 || 'N/A'),
      escapeCsv(pkg.filesModified?.length ?? 0),
      escapeCsv(valStatus),
      escapeCsv(notes || 'None'),
    ].join(',');
  });

  // Prepend UTF-8 BOM for seamless Microsoft Excel compatibility
  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
}

export function generateJsonLog(packages: PackageInspectionResult[]): string {
  const data = packages.map((pkg) => ({
    originalFileName: pkg.originalFileName,
    fileSizeBytes: pkg.fileSize,
    originalSha256: pkg.originalSha256,
    verificationEvidence: {
      zipEntriesCount: pkg.zipEntriesCount,
      scanDurationMs: pkg.scanDurationMs,
      first20FilePaths: pkg.first20FilePaths || [],
      manifestFound: pkg.manifestFound,
      manifestExactPath: pkg.manifestExactPath,
      nestedZipCount: pkg.nestedZipCount,
      nestedZipNames: pkg.nestedZipNames || [],
      inspectedCodeFilesCount: pkg.inspectedCodeFilesCount || { jsCount: 0, htmlCount: 0, xmlCount: 0, total: 0 },
      runtimeFilesSearched: pkg.runtimeFilesSearched || [],
      assessmentFilesSearched: pkg.assessmentFilesSearched || [],
      scormApiStringsDetected: pkg.scormApiStringsDetected || [],
      isOuterWrapper: pkg.isOuterWrapper,
      outerStatusMessage: pkg.outerStatusMessage || null,
      nestedPackages: pkg.nestedPackages || [],
    },
    scormVersion: pkg.scormVersion,
    scormVersionReason: pkg.scormVersionReason,
    runtimeApiType: pkg.runtimeApiType,
    manifestVersion: pkg.manifestVersion,
    masteryScore: pkg.masteryScore,
    detectedQuizThreshold: pkg.detectedQuizThreshold,
    passScoreConsistency: pkg.passScoreConsistency,
    passScoreReferences: pkg.passScoreReferences || [],
    defects: {
      progressDefect: pkg.progressDefect || { detected: false },
      finishDefect: pkg.finishDefect || { detected: false },
      relaunchDefect: pkg.relaunchDefect || { detected: false },
      exitDefect: pkg.exitDefect || { detected: false },
    },
    statefulWorkdayFindings: pkg.statefulWorkdayFindings || null,
    repairProfile: pkg.repairProfile,
    actionStatus: pkg.actionStatus,
    patchedFileName: pkg.patchedFileName || null,
    patchedSha256: pkg.patchedSha256 || null,
    filesModified: pkg.filesModified || [],
    codeChanges: pkg.codeChanges || [],
    validationPassed: pkg.validationPassed,
    validationChecks: pkg.validationChecks || [],
    manualReviewReasons: pkg.manualReviewReasons || [],
    warnings: pkg.warnings || [],
    error: pkg.error || null,
  }));

  return JSON.stringify(data, null, 2);
}

/**
 * Robust clipboard copy utility that works across modern browsers
 * as well as restricted iframe preview environments.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Proceed to fallback
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback clipboard copy failed:', err);
    return false;
  }
}

/**
 * Restored exact last-known-working direct synchronous download path.
 * Direct user-gesture -> createObjectURL -> anchor.click() -> cleanup with 60s revocation delay.
 */
export function downloadBlob(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  } catch (err) {
    console.error('downloadBlob failed:', err);
    return false;
  }
}
