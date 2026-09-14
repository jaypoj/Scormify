import JSZip from 'jszip';
import { PackageInspectionResult, NestedPackageInspection, CodeFilesCount, ValidationItem } from '../types';
import { calculateSha256 } from './crypto';
import { parseImsManifest } from './manifest';
import { detectScormDetails } from './detector';
import {
  patchScorm12Package,
  patchCompactScorm12Package,
  patchUniversalScorm12Package,
  patchStatefulCompactWorkdayPackage,
  PatchResult,
} from './patcher';
import { validatePatchedPackage } from './validator';
import { analyzeStatusWritesAndDefects, analyzeStatefulWorkdayFindings } from './statusInventory';
import { normalizeFinalNextPageCompletion, repairCompactFinishCompletion } from './codeTransformer';
import { findFunctionBlock } from './braceScanner';
import { verifyFinalZipIntegrity, FinalZipIntegrityResult } from './issue1StatefulRuntime';

export interface ProgressCallback {
  (current: number, total: number, fileName: string, currentStatus: string): void;
}

const SCORM_API_DEFINITIONS: { label: string; regex: RegExp }[] = [
  { label: 'window.API', regex: /\b(?:window\.)?API\b(?!\s*_\s*1484)/ },
  { label: 'window.API_1484_11', regex: /\b(?:window\.)?API_1484_11\b/ },
  { label: 'LMSInitialize', regex: /\bLMSInitialize\b/ },
  { label: 'LMSGetValue', regex: /\bLMSGetValue\b/ },
  { label: 'LMSSetValue', regex: /\bLMSSetValue\b/ },
  { label: 'LMSCommit', regex: /\bLMSCommit\b/ },
  { label: 'LMSFinish', regex: /\bLMSFinish\b/ },
  { label: 'LMSGetLastError', regex: /\bLMSGetLastError\b/ },
  { label: 'LMSGetErrorString', regex: /\bLMSGetErrorString\b/ },
  { label: 'LMSGetDiagnostic', regex: /\bLMSGetDiagnostic\b/ },
  { label: 'Initialize (2004)', regex: /\bInitialize\s*\(/ },
  { label: 'GetValue (2004)', regex: /\bGetValue\s*\(/ },
  { label: 'SetValue (2004)', regex: /\bSetValue\s*\(/ },
  { label: 'Commit (2004)', regex: /\bCommit\s*\(/ },
  { label: 'Terminate (2004)', regex: /\bTerminate\s*\(/ },
  { label: 'cmi.core.lesson_status', regex: /cmi\.core\.lesson_status/ },
  { label: 'cmi.core.score.raw', regex: /cmi\.core\.score\.raw/ },
  { label: 'cmi.core.score.min', regex: /cmi\.core\.score\.min/ },
  { label: 'cmi.core.score.max', regex: /cmi\.core\.score\.max/ },
  { label: 'cmi.core.lesson_location', regex: /cmi\.core\.lesson_location/ },
  { label: 'cmi.core.session_time', regex: /cmi\.core\.session_time/ },
  { label: 'cmi.core.suspend_data', regex: /cmi\.core\.suspend_data/ },
  { label: 'cmi.completion_status', regex: /cmi\.completion_status/ },
  { label: 'cmi.success_status', regex: /cmi\.success_status/ },
  { label: 'cmi.score.raw', regex: /cmi\.score\.raw/ },
  { label: 'cmi.score.scaled', regex: /cmi\.score\.scaled/ },
  { label: 'cmi.location', regex: /cmi\.location/ },
  { label: '<adlcp:masteryscore>', regex: /<adlcp:masteryscore>|<masteryscore>/i },
];

export function extractScormApiStrings(fileContents: { [path: string]: string }): string[] {
  const found = new Set<string>();
  for (const content of Object.values(fileContents)) {
    if (!content) continue;
    for (const def of SCORM_API_DEFINITIONS) {
      if (def.regex.test(content)) {
        found.add(def.label);
      }
    }
  }
  return Array.from(found);
}

/**
 * Inspects a candidate nested ZIP package (1 level deep)
 */
async function inspectNestedCandidateZip(
  nestedPath: string,
  nestedData: Uint8Array
): Promise<NestedPackageInspection> {
  const nestedStartTime = performance.now();
  const innerZip = await JSZip.loadAsync(nestedData);
  const innerFileList = Object.keys(innerZip.files).filter((name) => !innerZip.files[name].dir);
  const zipEntriesCount = innerFileList.length;
  const first20FilePaths = innerFileList.slice(0, 20);

  const nestedZipNames = innerFileList.filter((f) => f.toLowerCase().endsWith('.zip'));
  const nestedZipCount = nestedZipNames.length;

  const manifestFile =
    innerFileList.find((f) => f.toLowerCase() === 'imsmanifest.xml') ||
    innerFileList.find((f) => f.toLowerCase().endsWith('imsmanifest.xml'));
  const manifestFound = Boolean(manifestFile);
  const manifestExactPath = manifestFile || 'None found';

  const fileContents: { [path: string]: string } = {};
  let jsCount = 0;
  let htmlCount = 0;
  let xmlCount = 0;

  for (const f of innerFileList) {
    const lower = f.toLowerCase();
    const isJs = lower.endsWith('.js');
    const isHtml = lower.endsWith('.html') || lower.endsWith('.htm');
    const isXml = lower.endsWith('.xml');
    if (isJs) jsCount++;
    if (isHtml) htmlCount++;
    if (isXml) xmlCount++;

    if (isJs || isHtml || isXml || lower.endsWith('project.json')) {
      try {
        fileContents[f] = await innerZip.files[f].async('string');
      } catch {
        // Skip unreadable files
      }
    }
  }

  let manifestXml: string | null = null;
  if (manifestFile && fileContents[manifestFile]) {
    manifestXml = fileContents[manifestFile];
  } else if (manifestFile) {
    try {
      manifestXml = await innerZip.files[manifestFile].async('string');
      fileContents[manifestFile] = manifestXml;
    } catch {
      // Skip
    }
  }

  const manifestData = parseImsManifest(innerFileList, manifestXml);

  const mockFile = new File(
    [nestedData],
    nestedPath.split('/').pop() || nestedPath,
    { type: 'application/zip' }
  );

  const detected = detectScormDetails(
    mockFile,
    innerFileList,
    fileContents,
    manifestData,
    'nested-package-sha'
  );

  const scormApiStringsDetected = extractScormApiStrings(fileContents);
  const scanDurationMs = Math.round((performance.now() - nestedStartTime) * 10) / 10;

  return {
    nestedZipName: nestedPath.split('/').pop() || nestedPath,
    nestedZipPath: nestedPath,
    fileSize: nestedData.byteLength,
    zipEntriesCount,
    scanDurationMs,
    first20FilePaths,
    manifestFound,
    manifestExactPath,
    nestedZipCount,
    nestedZipNames,
    inspectedCodeFilesCount: {
      jsCount,
      htmlCount,
      xmlCount,
      total: jsCount + htmlCount + xmlCount,
    },
    runtimeFilesSearched: detected.runtimeJsFiles,
    assessmentFilesSearched: detected.assessmentFiles,
    scormApiStringsDetected,
    scormVersion: detected.scormVersion,
    scormVersionReason: detected.scormVersionReason,
    runtimeApiType: detected.runtimeApiType,
    manifestVersion: detected.manifestVersion,
    masteryScore: detected.masteryScore,
    detectedQuizThreshold: detected.detectedQuizThreshold,
    passScoreConsistency: detected.passScoreConsistency,
    defectsDetected: {
      progress: detected.progressDefect.detected,
      finish: detected.finishDefect.detected,
      relaunch: detected.relaunchDefect.detected,
      exit: detected.exitDefect.detected,
    },
    repairProfile: detected.repairProfile,
    actionStatus: detected.actionStatus,
    statusMessage: `${detected.scormVersion} package detected (${detected.runtimeApiType})`,
    statusWriteInventory: detected.statusWriteInventory,
    progressDefect: detected.progressDefect,
    finishDefect: detected.finishDefect,
    relaunchDefect: detected.relaunchDefect,
    exitDefect: detected.exitDefect,
    passScoreReferences: detected.passScoreReferences,
    manifestData: detected.manifestData,
  };
}

/**
 * Scan a single SCORM ZIP package strictly sequentially (concurrency 1).
 * Milestone 1 Scanner: Opens every archive, inspects directory, manifest, runtime/assessment files,
 * detects SCORM API strings, captures scan duration in ms, and supports one level of nested ZIP.
 */
export async function scanSinglePackage(
  file: File,
  onStatusUpdate?: (status: string) => void
): Promise<PackageInspectionResult> {
  const startTime = performance.now();

  onStatusUpdate?.('Calculating original SHA-256 hash...');
  const sha256 = await calculateSha256(file);

  onStatusUpdate?.('Opening archive & reading ZIP directory entries...');
  const zip = await JSZip.loadAsync(file);
  const allFileList = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const zipEntriesCount = allFileList.length;
  const first20FilePaths = allFileList.slice(0, 20);

  // Detect any nested .zip files
  const nestedZipNames = allFileList.filter((f) => f.toLowerCase().endsWith('.zip'));
  const nestedZipCount = nestedZipNames.length;

  // Search for imsmanifest.xml in this archive
  const manifestFile =
    allFileList.find((f) => f.toLowerCase() === 'imsmanifest.xml') ||
    allFileList.find((f) => f.toLowerCase().endsWith('imsmanifest.xml'));
  const manifestFound = Boolean(manifestFile);
  const manifestExactPath = manifestFile || 'None found';

  // Read .js, .html, .xml, and project.json files from outer archive
  const fileContents: { [path: string]: string } = {};
  let jsCount = 0;
  let htmlCount = 0;
  let xmlCount = 0;

  const runtimeFilesSearched: string[] = [];
  const assessmentFilesSearched: string[] = [];

  for (const f of allFileList) {
    const lower = f.toLowerCase();
    const isJs = lower.endsWith('.js');
    const isHtml = lower.endsWith('.html') || lower.endsWith('.htm');
    const isXml = lower.endsWith('.xml');

    if (isJs) {
      jsCount++;
      runtimeFilesSearched.push(f);
    }
    if (isHtml) htmlCount++;
    if (isXml) xmlCount++;

    if (
      lower.includes('assessment') ||
      lower.includes('quiz') ||
      lower.includes('exam') ||
      lower.includes('test') ||
      lower.includes('question')
    ) {
      assessmentFilesSearched.push(f);
    }

    if (isJs || isHtml || isXml || lower.endsWith('project.json')) {
      try {
        fileContents[f] = await zip.files[f].async('string');
      } catch {
        // Skip unreadable files
      }
    }
  }

  let manifestXml: string | null = null;
  if (manifestFile && fileContents[manifestFile]) {
    manifestXml = fileContents[manifestFile];
  } else if (manifestFile) {
    try {
      manifestXml = await zip.files[manifestFile].async('string');
      fileContents[manifestFile] = manifestXml;
    } catch {
      // Skip
    }
  }

  const scormApiStringsDetected = extractScormApiStrings(fileContents);

  // =========================================================================
  // NESTED ZIP SUPPORT (1 level automatic inspection)
  // If outer ZIP has NO imsmanifest.xml but contains nested ZIP files,
  // inspect those nested ZIPs individually as candidate SCORM packages.
  // Do NOT classify the outer wrapper as UNKNOWN until nested ZIP inspection completes.
  // =========================================================================
  if (!manifestFound && nestedZipCount > 0) {
    onStatusUpdate?.(`Outer wrapper detected without manifest. Inspecting ${nestedZipCount} nested ZIP candidate(s)...`);
    const nestedInspections: NestedPackageInspection[] = [];

    for (const nestedName of nestedZipNames) {
      onStatusUpdate?.(`Opening and analyzing nested candidate: ${nestedName}...`);
      try {
        const nestedData = await zip.files[nestedName].async('uint8array');
        const inspection = await inspectNestedCandidateZip(nestedName, nestedData);
        nestedInspections.push(inspection);
      } catch (err: any) {
        nestedInspections.push({
          nestedZipName: nestedName.split('/').pop() || nestedName,
          nestedZipPath: nestedName,
          fileSize: 0,
          zipEntriesCount: 0,
          scanDurationMs: 0,
          first20FilePaths: [],
          manifestFound: false,
          manifestExactPath: 'Corrupt nested archive',
          nestedZipCount: 0,
          nestedZipNames: [],
          inspectedCodeFilesCount: { jsCount: 0, htmlCount: 0, xmlCount: 0, total: 0 },
          runtimeFilesSearched: [],
          assessmentFilesSearched: [],
          scormApiStringsDetected: [],
          scormVersion: 'UNKNOWN',
          scormVersionReason: `Nested archive error: ${err.message}`,
          runtimeApiType: 'None / Unknown',
          manifestVersion: 'N/A',
          masteryScore: 'N/A',
          detectedQuizThreshold: 'N/A',
          passScoreConsistency: 'INSUFFICIENT DATA',
          defectsDetected: { progress: false, finish: false, relaunch: false, exit: false },
          repairProfile: 'NONE',
          actionStatus: 'FAILED VALIDATION',
          statusMessage: `Corrupt nested ZIP: ${err.message}`,
        });
      }
    }

    // Evaluate primary nested candidate
    const candidate12 = nestedInspections.find((n) => n.scormVersion === 'SCORM 1.2');
    const candidate2004 = nestedInspections.find((n) => n.scormVersion === 'SCORM 2004');
    const primaryCandidate = candidate12 || candidate2004 || nestedInspections[0];

    let outerStatusMessage = '';
    if (nestedZipCount === 1) {
      if (primaryCandidate && primaryCandidate.scormVersion === 'SCORM 1.2') {
        outerStatusMessage = 'Outer ZIP → 1 nested ZIP found → SCORM 1.2 package detected';
      } else if (primaryCandidate && primaryCandidate.scormVersion === 'SCORM 2004') {
        outerStatusMessage = 'Outer ZIP → 1 nested ZIP found → SCORM 2004 package detected';
      } else {
        outerStatusMessage = `Outer ZIP → 1 nested ZIP found → ${primaryCandidate?.scormVersion || 'Unknown'} candidate`;
      }
    } else {
      const scorm12Count = nestedInspections.filter((n) => n.scormVersion === 'SCORM 1.2').length;
      if (scorm12Count === nestedZipCount) {
        outerStatusMessage = `Outer ZIP → ${nestedZipCount} nested ZIPs found → SCORM 1.2 packages detected`;
      } else {
        outerStatusMessage = `Outer ZIP → ${nestedZipCount} nested ZIPs found → ${primaryCandidate?.scormVersion || 'SCORM'} packages detected`;
      }
    }

    // Aggregate files and strings
    const aggregateApiStrings = Array.from(
      new Set([
        ...scormApiStringsDetected,
        ...nestedInspections.flatMap((n) => n.scormApiStringsDetected),
      ])
    );

    const aggregateRuntimeFiles = Array.from(
      new Set([
        ...runtimeFilesSearched,
        ...nestedInspections.flatMap((n) => n.runtimeFilesSearched.map((f) => `[${n.nestedZipName}] ${f}`)),
      ])
    );

    const aggregateAssessmentFiles = Array.from(
      new Set([
        ...assessmentFilesSearched,
        ...nestedInspections.flatMap((n) => n.assessmentFilesSearched.map((f) => `[${n.nestedZipName}] ${f}`)),
      ])
    );

    const totalCodeFilesCount: CodeFilesCount = {
      jsCount: jsCount + nestedInspections.reduce((acc, n) => acc + n.inspectedCodeFilesCount.jsCount, 0),
      htmlCount: htmlCount + nestedInspections.reduce((acc, n) => acc + n.inspectedCodeFilesCount.htmlCount, 0),
      xmlCount: xmlCount + nestedInspections.reduce((acc, n) => acc + n.inspectedCodeFilesCount.xmlCount, 0),
      total:
        (jsCount + htmlCount + xmlCount) +
        nestedInspections.reduce((acc, n) => acc + n.inspectedCodeFilesCount.total, 0),
    };

    const scanDurationMs = Math.round((performance.now() - startTime) * 10) / 10;

    const actualPackageName = primaryCandidate ? primaryCandidate.nestedZipName : file.name;

    return {
      id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      file,
      originalFileName: file.name,
      outerFileName: file.name,
      actualPackageName,
      fileSize: file.size,
      originalSha256: sha256,
      zipEntriesCount: allFileList.length,
      scanDurationMs,
      first20FilePaths,
      manifestFound: Boolean(primaryCandidate?.manifestFound),
      manifestExactPath: primaryCandidate?.manifestFound
        ? `Not at outer root; detected in nested [${primaryCandidate.nestedZipName}]: ${primaryCandidate.manifestExactPath}`
        : 'None found (outer or nested)',
      nestedZipCount,
      nestedZipNames,
      inspectedCodeFilesCount: totalCodeFilesCount,
      runtimeFilesSearched: aggregateRuntimeFiles,
      assessmentFilesSearched: aggregateAssessmentFiles,
      scormApiStringsDetected: aggregateApiStrings,
      statusWriteInventory: primaryCandidate?.statusWriteInventory || [],
      isOuterWrapper: true,
      nestedPackages: nestedInspections,
      outerStatusMessage,
      scormVersion: primaryCandidate?.scormVersion || 'UNKNOWN',
      scormVersionReason: primaryCandidate
        ? `Outer container [${file.name}] with nested package [${primaryCandidate.nestedZipName}]: ${primaryCandidate.scormVersionReason}`
        : 'No SCORM manifest found in outer archive or nested candidates',
      runtimeApiType: (primaryCandidate?.runtimeApiType as any) || 'None / Unknown',
      manifestVersion: primaryCandidate?.manifestVersion || 'N/A',
      manifestData: primaryCandidate?.manifestData || {
        present: Boolean(primaryCandidate?.manifestFound),
        atRoot: false,
        validXml: true,
        declaredVersion: primaryCandidate?.manifestVersion || null,
        masteryScore: parseFloat(primaryCandidate?.masteryScore || '0') || null,
        masteryScoreStatus: primaryCandidate?.masteryScore.includes('PASS') ? 'PASS' : 'OTHER',
        launchResource: null,
        referencedFiles: [],
      },
      masteryScore: primaryCandidate?.masteryScore || 'MASTERY SCORE NOT FOUND',
      detectedQuizThreshold: primaryCandidate?.detectedQuizThreshold || 'Not Found',
      passScoreConsistency: (primaryCandidate?.passScoreConsistency as any) || 'INSUFFICIENT DATA',
      passScoreReferences: primaryCandidate?.passScoreReferences || [],
      progressDefect: primaryCandidate?.progressDefect || {
        detected: nestedInspections.some((n) => n.defectsDetected.progress),
        details: primaryCandidate ? `Detected in nested candidate: ${primaryCandidate.nestedZipName}` : undefined,
      },
      finishDefect: primaryCandidate?.finishDefect || {
        detected: nestedInspections.some((n) => n.defectsDetected.finish),
        details: primaryCandidate ? `Detected in nested candidate: ${primaryCandidate.nestedZipName}` : undefined,
      },
      relaunchDefect: primaryCandidate?.relaunchDefect || {
        detected: nestedInspections.some((n) => n.defectsDetected.relaunch),
        details: primaryCandidate ? `Detected in nested candidate: ${primaryCandidate.nestedZipName}` : undefined,
      },
      exitDefect: primaryCandidate?.exitDefect || {
        detected: nestedInspections.some((n) => n.defectsDetected.exit),
        details: primaryCandidate ? `Detected in nested candidate: ${primaryCandidate.nestedZipName}` : undefined,
      },
      repairProfile: primaryCandidate?.repairProfile || 'NONE',
      manualReviewReasons: primaryCandidate?.scormVersion === 'SCORM 1.2'
        ? []
        : ['Outer wrapper package requiring manual verification of nested archives'],
      actionStatus: primaryCandidate?.actionStatus || 'MANUAL REVIEW',
      allFiles: allFileList,
      runtimeJsFiles: aggregateRuntimeFiles,
      assessmentFiles: aggregateAssessmentFiles,
      filesModified: [],
      codeChanges: [],
      validationChecks: [],
      validationPassed: false,
      warnings: [`Outer container archive with ${nestedZipCount} nested ZIP(s). Nested package [${actualPackageName}] inspected as authoritative.`],
    };
  }

  // =========================================================================
  // STANDARD / DIRECT PACKAGE SCAN
  // Outer ZIP contains imsmanifest.xml or has no nested ZIP archives
  // =========================================================================
  onStatusUpdate?.('Parsing manifest & evaluating SCORM version...');
  const manifestData = parseImsManifest(allFileList, manifestXml);

  onStatusUpdate?.('Auditing pass-score thresholds & detecting defects...');
  const detected = detectScormDetails(file, allFileList, fileContents, manifestData, sha256);

  const scanDurationMs = Math.round((performance.now() - startTime) * 10) / 10;

  return {
    ...detected,
    actualPackageName: file.name,
    outerFileName: undefined,
    zipEntriesCount,
    scanDurationMs,
    first20FilePaths,
    manifestFound,
    manifestExactPath,
    nestedZipCount,
    nestedZipNames,
    inspectedCodeFilesCount: {
      jsCount,
      htmlCount,
      xmlCount,
      total: jsCount + htmlCount + xmlCount,
    },
    runtimeFilesSearched: detected.runtimeJsFiles,
    assessmentFilesSearched: detected.assessmentFiles,
    scormApiStringsDetected,
    isOuterWrapper: false,
    nestedPackages: [],
  };
}

/**
 * Patches a single eligible SCORM 1.2 package.
 * Produces a validated clean SCORM package with imsmanifest.xml at its root.
 */
export async function patchSinglePackage(
  pkg: PackageInspectionResult,
  onStatusUpdate?: (status: string) => void
): Promise<PackageInspectionResult> {
  const isEligible =
    pkg.actionStatus === 'READY_TO_PATCH' ||
    pkg.repairProfile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1' ||
    pkg.repairProfile === 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1' ||
    pkg.repairProfile === 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1' ||
    pkg.repairProfile === 'KNOWN_SCORM12_QUIZ_80_V1';

  if (!isEligible) {
    return pkg;
  }

  let zip: JSZip;
  let targetPackageName = pkg.actualPackageName || pkg.originalFileName;
  let primaryNested: NestedPackageInspection | undefined;

  // NESTED SCORM WORKFLOW:
  // Outer Files (x).zip -> open nested CourseName.zip -> extract actual SCORM contents
  // -> modify SCORM runtime files -> validate SCORM contents -> rebuild CourseName_WORKDAY_FIXED.zip
  if (pkg.isOuterWrapper && pkg.nestedPackages.length > 0) {
    onStatusUpdate?.(`Opening outer archive ${pkg.originalFileName}...`);
    const outerZip = await JSZip.loadAsync(pkg.file);
    primaryNested =
      pkg.nestedPackages.find((n) => n.scormVersion === 'SCORM 1.2') ||
      pkg.nestedPackages[0];

    const nestedEntry = outerZip.file(primaryNested.nestedZipPath);
    if (!nestedEntry) {
      throw new Error(`Nested SCORM archive ${primaryNested.nestedZipPath} not found in outer archive`);
    }

    targetPackageName = primaryNested.nestedZipName;
    onStatusUpdate?.(`Extracting authoritative SCORM package: ${targetPackageName}...`);
    const innerZipData = await nestedEntry.async('arraybuffer');
    zip = await JSZip.loadAsync(innerZipData);
  } else {
    onStatusUpdate?.(`Loading ${pkg.originalFileName} for remediation...`);
    zip = await JSZip.loadAsync(pkg.file);
  }

  // Authoritative SCORM file tree
  const fileList = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

  const fileContents: { [path: string]: string } = {};
  for (const f of fileList) {
    const lower = f.toLowerCase();
    if (
      lower.endsWith('.js') ||
      lower.endsWith('.html') ||
      lower.endsWith('.htm') ||
      lower.endsWith('.xml') ||
      lower.endsWith('.json')
    ) {
      try {
        fileContents[f] = await zip.files[f].async('string');
      } catch {
        // Skip binary or unreadable files
      }
    }
  }

  // Candidate internal files for repair (exact paths relative to SCORM package root)
  const candidateJsFiles = fileList.filter(
    (f) =>
      f.toLowerCase().endsWith('.js') ||
      f.toLowerCase().endsWith('.html') ||
      f.toLowerCase().endsWith('.htm')
  );

  // Invoke profile-specific deterministic patch function
  let patchResult: PatchResult;
  onStatusUpdate?.('PATCHING...');
  onStatusUpdate?.(`Applying profile ${pkg.repairProfile} to ${targetPackageName}...`);

  if (pkg.repairProfile === 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1') {
    patchResult = patchUniversalScorm12Package(fileContents, candidateJsFiles, pkg);
  } else if (pkg.repairProfile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {
    patchResult = patchStatefulCompactWorkdayPackage(fileContents, candidateJsFiles, pkg);
  } else if (pkg.repairProfile === 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1') {
    patchResult = patchCompactScorm12Package(fileContents, candidateJsFiles, pkg);
  } else {
    patchResult = patchScorm12Package(pkg, fileContents, candidateJsFiles);
  }

  // REQUIREMENT 3: DO NOT VALIDATE AN UNCHANGED PACKAGE AS PATCHED
  // If Files Modified == 0, the app must stop and report:
  // PATCH NOT APPLIED — EXPECTED DEFECT PATTERN NOT MODIFIED
  if (patchResult.filesModified.length === 0) {
    onStatusUpdate?.('PATCH NOT APPLIED — EXPECTED DEFECT PATTERN NOT MODIFIED');
    const failChecks: ValidationItem[] = [
      {
        id: 1,
        title: 'Deterministic Patch Application',
        ruleName: 'Target files modified',
        file: candidateJsFiles.join(', ') || 'scripts/scorm-api.js',
        passed: false,
        details: 'FAIL — PATCH NOT APPLIED — EXPECTED DEFECT PATTERN NOT MODIFIED: 0 files were modified.',
      },
      {
        id: 2,
        title: 'Profile Pattern Search Results',
        ruleName: 'Expected profile modification',
        file: candidateJsFiles.join(', ') || 'scripts/scorm-api.js',
        passed: false,
        details:
          patchResult.executionReport.zeroModifiedExplanation ||
          'FAIL — Target defect pattern was not found in opened candidate scripts.',
      },
    ];

    return {
      ...pkg,
      filesModified: [],
      codeChanges: [],
      validationChecks: failChecks,
      validationPassed: false,
      actionStatus: 'FAILED VALIDATION',
      error: 'PATCH NOT APPLIED — EXPECTED DEFECT PATTERN NOT MODIFIED',
      patchExecutionReport: patchResult.executionReport,
    };
  }

  // Safeguard: Ensure final completion normalization is applied to all navigation scripts
  for (const f of Object.keys(patchResult.updatedContents)) {
    if (f.toLowerCase().includes('nav') || (f.endsWith('.js') && !f.toLowerCase().includes('scorm-api') && !f.toLowerCase().includes('page-content'))) {
      const code = patchResult.updatedContents[f];
      if (code) {
        const norm = normalizeFinalNextPageCompletion(code);
        const fin = repairCompactFinishCompletion(norm.code);
        if (fin.code !== code) {
          patchResult.updatedContents[f] = fin.code;
          if (!patchResult.filesModified.includes(f)) {
            patchResult.filesModified.push(f);
          }
        }
      }
    }
  }

  // =========================================================================
  // HARD FINAL ASSERTION: FINAL FINISH COMPLETION INVARIANT
  // Immediately BEFORE generating the ZIP, scan the FINAL navigation.js.
  // For KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1:
  // FAIL BUILD if the final-page branch contains any unconditional:
  // cmi.core.lesson_status = completed
  // or equivalent: SCORM.set(..., 'completed'), LMSSetValue(..., 'completed')
  // Do not wait until normal post-fix validation.
  // Treat this as a build-blocking invariant: FINAL FINISH COMPLETION INVARIANT
  // =========================================================================
  let hardFinishDefectDetected = false;
  let hardFinishDefectFile = 'scripts/navigation.js';
  let hardFinishDefectReason = '';

  const navFilesToCheck = Object.keys(patchResult.updatedContents).filter(
    (f) => f.toLowerCase().includes('nav') || (f.endsWith('.js') && !f.toLowerCase().includes('scorm-api') && !f.toLowerCase().includes('page-content'))
  );

  for (const f of navFilesToCheck) {
    const content = patchResult.updatedContents[f];
    if (!content) continue;

    // 1. Check nextPage block
    const nextPageBlock = findFunctionBlock(
      content,
      /(?:(?:var|let|const)\s+nextPage\s*=\s*function|function\s+nextPage|nextPage\s*:\s*function|nextPage\s*\([^)]*\)\s*\{)/i
    );
    if (nextPageBlock) {
      const body = nextPageBlock.block.body;
      if (
        /(?:set|setValue|LMSSetValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\)/i.test(body) ||
        /(?:cmi\.core\.lesson_status\s*=\s*['"]completed['"])/i.test(body)
      ) {
        hardFinishDefectDetected = true;
        hardFinishDefectFile = f;
        hardFinishDefectReason = `Unconditional completed status write in nextPage() in ${f}`;
        break;
      }
    }

    // 2. Check finish / onFinish blocks
    const finishBlock = findFunctionBlock(
      content,
      /(?:(?:var|let|const)\s+(?:finish|onFinish|finishCourse|handleFinish|completeCourse)\s*=\s*function|function\s+(?:finish|onFinish|finishCourse|handleFinish|completeCourse)|(?:finish|onFinish)\s*:\s*function)\s*\([^)]*\)\s*\{/i
    );
    if (finishBlock) {
      const body = finishBlock.block.body;
      if (
        /(?:set|setValue|LMSSetValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\)/i.test(body) ||
        /(?:cmi\.core\.lesson_status\s*=\s*['"]completed['"])/i.test(body)
      ) {
        hardFinishDefectDetected = true;
        hardFinishDefectFile = f;
        hardFinishDefectReason = `Unconditional completed status write in Finish handler in ${f}`;
        break;
      }
    }

    // 3. File-level check in navigation file for unconditional completed write
    if (f.toLowerCase().includes('nav')) {
      if (
        /(?:set|setValue|LMSSetValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\)/i.test(content)
      ) {
        hardFinishDefectDetected = true;
        hardFinishDefectFile = f;
        hardFinishDefectReason = `Unconditional completed status write in ${f}`;
        break;
      }
    }
  }

  if (hardFinishDefectDetected) {
    const invariantFailCheck: ValidationItem = {
      id: 99,
      title: 'FINAL FINISH COMPLETION INVARIANT',
      ruleName: 'Hard Finish Completion Invariant',
      file: hardFinishDefectFile,
      passed: false,
      details: `FAIL — FINAL FINISH COMPLETION INVARIANT: ${hardFinishDefectReason}. Downloadable output blocked.`,
    };

    return {
      ...pkg,
      actualPackageName: targetPackageName,
      allFiles: fileList,
      filesModified: patchResult.filesModified,
      codeChanges: patchResult.codeChanges,
      patchedBlob: undefined,
      patchedFileName: undefined,
      patchedSha256: undefined,
      validationChecks: [invariantFailCheck],
      validationPassed: false,
      actionStatus: 'FAILED VALIDATION',
      patchExecutionReport: patchResult.executionReport,
      error: `BUILD BLOCKED — FINAL FINISH COMPLETION INVARIANT: ${hardFinishDefectReason}`,
    };
  }

  // Write modified files to the SCORM ZIP
  for (const filePath of patchResult.filesModified) {
    zip.file(filePath, patchResult.updatedContents[filePath]);
  }

  onStatusUpdate?.('Repackaging repaired archive...');
  const patchedBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  let issue1ZipIntegrity: FinalZipIntegrityResult | null = null;
  if (pkg.repairProfile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {
    onStatusUpdate?.('Reopening final ZIP for integrity verification...');
    issue1ZipIntegrity = await verifyFinalZipIntegrity(zip, patchedBlob, true);
  }

  onStatusUpdate?.('Calculating repaired package SHA-256...');
  const patchedSha256 = await calculateSha256(patchedBlob);

  const baseName = targetPackageName.replace(/\.zip$/i, '');
  const patchedFileName = `${baseName}_WORKDAY_FIXED.zip`;

  // Post-patch defect re-scan
  onStatusUpdate?.('Re-scanning for defect neutralization...');
  const postScan = analyzeStatusWritesAndDefects(patchResult.updatedContents);
  const postWorkdayFindings = analyzeStatefulWorkdayFindings(patchResult.updatedContents);

  const targetDefectsRemaining =
    (pkg.progressDefect.detected && postScan.progressDefect.detected) ||
    (pkg.finishDefect.detected && postScan.finishDefect.detected) ||
    (pkg.relaunchDefect.detected && postScan.relaunchDefect.detected) ||
    (pkg.exitDefect.detected && postScan.exitDefect.detected) ||
    postScan.finishDefect.detected; // Defect #2 must NEVER remain

  const statefulDefectsRemaining = postWorkdayFindings ? (
    postWorkdayFindings.globalStorageKey === 'DETECTED' ||
    postWorkdayFindings.stalePageStateRisk === 'DETECTED' ||
    postWorkdayFindings.progressExceed100Risk === 'DETECTED' ||
    postWorkdayFindings.passDowngradeRisk === 'DETECTED' ||
    postWorkdayFindings.failedQuizExitUx === 'MISSING' ||
    postWorkdayFindings.saveAndExit === 'MISSING'
  ) : false;

  onStatusUpdate?.('VALIDATING...');
  onStatusUpdate?.('Running automated validation checks...');
  const effectivePkg: PackageInspectionResult = {
    ...pkg,
    allFiles: fileList,
    runtimeJsFiles: candidateJsFiles,
    assessmentFiles: (primaryNested?.assessmentFilesSearched || pkg.assessmentFiles).map((f) =>
      f.replace(/^\[[^\]]+\]\s*/, '')
    ),
    manifestData: primaryNested?.manifestData || pkg.manifestData,
  };

  const validation = validatePatchedPackage({
    originalPackage: effectivePkg,
    allOriginalFiles: fileList,
    updatedFilesMap: patchResult.updatedContents,
    filesModified: patchResult.filesModified,
    zipFileList: Object.keys(zip.files),
    recreatedZipBlob: patchedBlob,
  });

  if (issue1ZipIntegrity) {
    validation.checks.push({
      id: 98,
      title: 'FINAL ZIP REOPEN / BINARY INTEGRITY',
      ruleName: 'Final ZIP Integrity',
      file: 'Recreated ZIP',
      passed: issue1ZipIntegrity.passed,
      details: issue1ZipIntegrity.details,
    });
  }

  // Add the passing invariant check
  validation.checks.push({
    id: 99,
    title: 'FINAL FINISH COMPLETION INVARIANT',
    ruleName: 'Hard Finish Completion Invariant',
    file: 'scripts/navigation.js',
    passed: true,
    details: 'PASS — no Finish/last-page completion write exists in scripts/navigation.js',
  });

  const validationPassed =
    validation.allPassed &&
    (!issue1ZipIntegrity || issue1ZipIntegrity.passed) &&
    !targetDefectsRemaining &&
    !statefulDefectsRemaining &&
    !postScan.finishDefect.detected;

  const patchedZipSizeBytes = patchedBlob ? patchedBlob.size : 0;
  const patchedZipGenerated = Boolean(patchedBlob && patchedBlob.size > 0);
  const downloadReady = validationPassed && patchedZipGenerated;
  const downloadDiagnosticReason = !validationPassed
    ? 'Validation failed'
    : !patchedZipGenerated
    ? 'generated Blob not retained'
    : 'READY';

  const updatedPkg: PackageInspectionResult = {
    ...pkg,
    actualPackageName: targetPackageName,
    allFiles: fileList,
    filesModified: patchResult.filesModified,
    codeChanges: patchResult.codeChanges,
    patchedBlob: validationPassed ? patchedBlob : undefined,
    patchedZipBlob: validationPassed ? patchedBlob : undefined,
    patchedFileName: validationPassed ? patchedFileName : undefined,
    patchedSha256: validationPassed ? patchedSha256 : undefined,
    patchedZipGenerated,
    patchedZipSizeBytes,
    patchedZipBytes: patchedZipSizeBytes,
    downloadReady,
    downloadDiagnosticReason,
    validationChecks: validation.checks,
    validationPassed,
    actionStatus: validationPassed ? 'PATCHED' : 'FAILED VALIDATION',
    patchExecutionReport: patchResult.executionReport,
    error: validationPassed ? undefined : 'Validation failed after remediation attempt',
  };

  return updatedPkg;
}
