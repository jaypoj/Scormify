import {
  ScormVersion,
  ManifestData,
  RepairProfile,
  PackageInspectionResult,
} from '../types';
import { analyzeStatusWritesAndDefects, analyzeStatefulWorkdayFindings, FileContentMap } from './statusInventory';
import { detectAllPassScores } from './passScoreDetector';

export function detectScormDetails(
  file: File,
  fileList: string[],
  fileContents: FileContentMap,
  manifestData: ManifestData,
  sha256: string
): PackageInspectionResult {
  const manualReviewReasons: string[] = [];
  const warnings: string[] = [];

  // 1. Identify JS, HTML, JSON files
  const runtimeJsFiles: string[] = [];
  const assessmentFiles: string[] = [];
  let projectJsonContent: string | null = null;

  for (const fileName of fileList) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.js')) {
      runtimeJsFiles.push(fileName);
    }
    if (
      lower.includes('assessment') ||
      lower.includes('quiz') ||
      lower.includes('exam') ||
      lower.includes('test') ||
      lower.includes('question')
    ) {
      assessmentFiles.push(fileName);
    }
    if (lower.endsWith('project.json')) {
      projectJsonContent = fileContents[fileName] || null;
    }
  }

  // 2. SCORM Version Detection Hierarchy
  // Check manifest first
  const manifestDecl = manifestData.declaredVersion || '';
  const manifestIs12 =
    manifestDecl.includes('1.2') ||
    manifestData.masteryScore !== null ||
    (manifestData.rawXmlSnippet &&
      (manifestData.rawXmlSnippet.includes('adlcp_rootv1p2') ||
        manifestData.rawXmlSnippet.includes('<schemaversion>1.2</schemaversion>') ||
        manifestData.rawXmlSnippet.includes('adlcp:scormtype="sco"')));

  const manifestIs2004 =
    manifestDecl.includes('2004') ||
    manifestDecl.includes('CAM 1.3') ||
    (manifestData.rawXmlSnippet &&
      (manifestData.rawXmlSnippet.includes('adlcp_v1p3') ||
        manifestData.rawXmlSnippet.includes('2004 3rd') ||
        manifestData.rawXmlSnippet.includes('2004 4th')));

  // Check runtime for API presence
  let hasScorm12Api = false;
  let hasScorm2004Api = false;
  let hasUniversalScorm = false;
  let hasSafeScorm = false;
  let hasCompactScorm = false;
  let scorm12CallsCount = 0;
  let scorm2004CallsCount = 0;

  const scorm12ApiRegex = /\b(?:window\.)?API\b(?!\s*_\s*1484)/;
  const scorm2004ApiRegex = /\b(?:window\.)?API_1484_11\b/;
  const lms12CallsRegex = /\b(?:LMSInitialize|LMSGetValue|LMSSetValue|LMSCommit|LMSFinish)\b/g;
  const scorm2004CallsRegex = /\b(?:Initialize|GetValue|SetValue|Commit|Terminate)\s*\(/g;

  for (const fileName of runtimeJsFiles) {
    const content = fileContents[fileName];
    if (!content) continue;

    if (scorm12ApiRegex.test(content)) hasScorm12Api = true;
    if (scorm2004ApiRegex.test(content)) hasScorm2004Api = true;
    if (content.includes('UniversalSCORM')) hasUniversalScorm = true;
    if (content.includes('SafeSCORM')) hasSafeScorm = true;
    if (content.includes('SCORM.init') || content.includes('SCORM.set')) hasCompactScorm = true;

    const m12 = content.match(lms12CallsRegex);
    if (m12) scorm12CallsCount += m12.length;

    const m2004 = content.match(scorm2004CallsRegex);
    if (m2004) scorm2004CallsCount += m2004.length;
  }

  // Also check HTML files
  for (const fileName of fileList) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      const content = fileContents[fileName];
      if (!content) continue;
      if (scorm12ApiRegex.test(content)) hasScorm12Api = true;
      if (scorm2004ApiRegex.test(content)) hasScorm2004Api = true;
      if (content.includes('UniversalSCORM')) hasUniversalScorm = true;
      if (content.includes('SafeSCORM')) hasSafeScorm = true;
      if (content.includes('SCORM.init')) hasCompactScorm = true;
    }
  }

  // Check project.json warning if applicable
  let projectJsonSays2004 = false;
  if (projectJsonContent) {
    if (projectJsonContent.includes('SCORM_2004') || projectJsonContent.includes('2004')) {
      projectJsonSays2004 = true;
    }
  }

  // Determine runtimeApiType label
  let runtimeApiType: PackageInspectionResult['runtimeApiType'] = 'None / Unknown';
  const isDualCapable =
    hasUniversalScorm ||
    hasSafeScorm ||
    (hasScorm12Api && hasScorm2004Api) ||
    (scorm12CallsCount > 0 && scorm2004CallsCount > 0);

  if (isDualCapable) {
    runtimeApiType = 'Dual-Capable / UniversalSCORM wrapper';
  } else if (hasCompactScorm || (hasScorm12Api && !hasScorm2004Api)) {
    runtimeApiType = 'Compact SCORM 1.2 wrapper';
  } else if (hasScorm2004Api && !hasScorm12Api) {
    runtimeApiType = 'SCORM 2004 (window.API_1484_11)';
  } else if (hasScorm12Api) {
    runtimeApiType = 'SCORM 1.2 (window.API)';
  }

  // Authoritative SCORM version determination:
  // Manifest is primary authority!
  let scormVersion: ScormVersion = 'UNKNOWN';
  let scormVersionReason = '';

  if (manifestIs12 && (hasScorm12Api || scorm12CallsCount > 0 || isDualCapable || hasCompactScorm)) {
    scormVersion = 'SCORM 1.2';
    if (isDualCapable) {
      scormVersionReason = 'imsmanifest.xml declares SCORM 1.2 with Dual-Capable / UniversalSCORM runtime wrapper';
    } else {
      scormVersionReason = 'imsmanifest.xml declares SCORM 1.2 with compact SCORM 1.2 runtime API';
    }
    if (projectJsonSays2004) {
      warnings.push(
        'project.json declares SCORM_2004, but manifest and runtime launch as SCORM 1.2 (project.json is non-authoritative).'
      );
    }
  } else if (manifestIs2004 && (hasScorm2004Api || scorm2004CallsCount > 0)) {
    scormVersion = 'SCORM 2004';
    scormVersionReason = 'imsmanifest.xml declares SCORM 2004 standard';
  } else if (manifestData.present && manifestIs12 && !hasScorm12Api && !isDualCapable) {
    scormVersion = 'AMBIGUOUS';
    scormVersionReason = 'Manifest declares SCORM 1.2 but no functioning SCORM 1.2 runtime API implementation found';
    manualReviewReasons.push('AMBIGUOUS SCORM VERSION — MANUAL REVIEW');
  } else if (manifestData.present && manifestIs2004 && !hasScorm2004Api) {
    scormVersion = 'AMBIGUOUS';
    scormVersionReason = 'Manifest declares SCORM 2004 but no functioning SCORM 2004 runtime API implementation found';
    manualReviewReasons.push('AMBIGUOUS SCORM VERSION — MANUAL REVIEW');
  } else if (!manifestData.present) {
    scormVersion = 'UNKNOWN';
    scormVersionReason = 'Missing imsmanifest.xml; delivery standard cannot be verified';
    manualReviewReasons.push('MISSING MANIFEST — MANUAL REVIEW');
  } else {
    scormVersion = 'UNKNOWN';
    scormVersionReason = 'Could not determine authoritative SCORM runtime version';
    manualReviewReasons.push('UNKNOWN SCORM VERSION — MANUAL REVIEW');
  }

  // 3. Deterministic Status Write Inventory & Defect Detection
  const { inventory, progressDefect, finishDefect, relaunchDefect, exitDefect } =
    analyzeStatusWritesAndDefects(fileContents);

  // 3b. Stateful Workday profile defect analysis
  const statefulWorkdayFindings = analyzeStatefulWorkdayFindings(fileContents);

  // 4. Pass Score Detection (Search every source independently)
  const passScoreResult = detectAllPassScores(manifestData, fileContents);
  warnings.push(...passScoreResult.warnings);

  // 5. Check manifest requirements
  if (!manifestData.present) {
    manualReviewReasons.push('imsmanifest.xml is missing from package');
  } else if (!manifestData.atRoot) {
    manualReviewReasons.push('imsmanifest.xml is nested in a subfolder rather than package root');
  } else if (!manifestData.validXml) {
    manualReviewReasons.push('imsmanifest.xml contains invalid XML');
  }

  // 6. Repair Profile & Action Status Determination
  let repairProfile: RepairProfile = 'NONE';
  let actionStatus: PackageInspectionResult['actionStatus'] = 'MANUAL REVIEW';

  const isScorm12 = scormVersion === 'SCORM 1.2';
  const hasMastery80 = manifestData.masteryScore === 80;
  const isQuiz80 = passScoreResult.runtimeQuizThreshold === '80' || hasMastery80;
  const passScoreConsistent = passScoreResult.passScoreConsistency === 'CONSISTENT';

  if (isScorm12 && (hasMastery80 || isQuiz80 || passScoreConsistent)) {
    // Check Profile B: UniversalSCORM
    if (isDualCapable || hasUniversalScorm || hasSafeScorm) {
      repairProfile = 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1';
      const hasUniversalDefect = relaunchDefect.detected || exitDefect.detected;
      if (hasUniversalDefect && manualReviewReasons.length === 0) {
        actionStatus = 'READY_TO_PATCH';
      } else if (!hasUniversalDefect && manualReviewReasons.length === 0) {
        actionStatus = 'NO CHANGE NEEDED';
      } else {
        actionStatus = 'MANUAL REVIEW';
      }
    } else if (statefulWorkdayFindings !== undefined) {
      // Check Profile C: Stateful Compact Workday V1
      repairProfile = 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1';
      const hasWorkdayDefect =
        statefulWorkdayFindings.globalStorageKey === 'DETECTED' ||
        statefulWorkdayFindings.stalePageStateRisk === 'DETECTED' ||
        statefulWorkdayFindings.progressExceed100Risk === 'DETECTED' ||
        statefulWorkdayFindings.passDowngradeRisk === 'DETECTED' ||
        statefulWorkdayFindings.failedQuizExitUx === 'MISSING' ||
        statefulWorkdayFindings.saveAndExit === 'MISSING' ||
        statefulWorkdayFindings.dynamicPageFetch === 'DETECTED' ||
        progressDefect.detected ||
        finishDefect.detected ||
        relaunchDefect.detected ||
        exitDefect.detected;

      if (hasWorkdayDefect && manualReviewReasons.length === 0) {
        actionStatus = 'READY_TO_PATCH';
      } else if (!hasWorkdayDefect && manualReviewReasons.length === 0) {
        actionStatus = 'NO CHANGE NEEDED';
      } else {
        actionStatus = 'MANUAL REVIEW';
      }
    } else {
      // Check Profile A: Compact SCORM 1.2
      repairProfile = 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1';
      const hasCompactDefect =
        progressDefect.detected || finishDefect.detected || relaunchDefect.detected || exitDefect.detected;
      if (hasCompactDefect && manualReviewReasons.length === 0) {
        actionStatus = 'READY_TO_PATCH';
      } else if (!hasCompactDefect && manualReviewReasons.length === 0) {
        actionStatus = 'NO CHANGE NEEDED';
      } else {
        actionStatus = 'MANUAL REVIEW';
      }
    }
  } else if (scormVersion === 'SCORM 2004') {
    actionStatus = 'UNSUPPORTED';
    manualReviewReasons.push('SCORM 2004 — MANUAL REVIEW (SCORM 2004 packages are protected in V1)');
  } else {
    actionStatus = 'MANUAL REVIEW';
  }

  return {
    id: `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    file,
    originalFileName: file.name,
    actualPackageName: file.name,
    fileSize: file.size,
    originalSha256: sha256,
    zipEntriesCount: fileList.length,
    scanDurationMs: 0,
    first20FilePaths: fileList.slice(0, 20),
    manifestFound: manifestData.present,
    manifestExactPath: manifestData.present ? 'imsmanifest.xml' : 'None found',
    nestedZipCount: fileList.filter((f) => f.toLowerCase().endsWith('.zip')).length,
    nestedZipNames: fileList.filter((f) => f.toLowerCase().endsWith('.zip')),
    inspectedCodeFilesCount: {
      jsCount: fileList.filter((f) => f.toLowerCase().endsWith('.js')).length,
      htmlCount: fileList.filter((f) => f.toLowerCase().endsWith('.html') || f.toLowerCase().endsWith('.htm')).length,
      xmlCount: fileList.filter((f) => f.toLowerCase().endsWith('.xml')).length,
      total: fileList.filter((f) => {
        const l = f.toLowerCase();
        return l.endsWith('.js') || l.endsWith('.html') || l.endsWith('.htm') || l.endsWith('.xml');
      }).length,
    },
    runtimeFilesSearched: runtimeJsFiles,
    assessmentFilesSearched: assessmentFiles,
    scormApiStringsDetected: [],
    statusWriteInventory: inventory,
    isOuterWrapper: false,
    nestedPackages: [],
    scormVersion,
    scormVersionReason,
    runtimeApiType,
    manifestVersion: manifestData.declaredVersion || (manifestIs12 ? '1.2' : 'Not Declared'),
    manifestData,
    masteryScore:
      manifestData.masteryScore !== null
        ? `${manifestData.masteryScore} (${manifestData.masteryScoreStatus})`
        : 'MASTERY SCORE NOT FOUND',
    detectedQuizThreshold: passScoreResult.runtimeQuizThreshold,
    passScoreConsistency: passScoreResult.passScoreConsistency,
    passScoreReferences: passScoreResult.passScoreReferences,
    progressDefect,
    finishDefect,
    relaunchDefect,
    exitDefect,
    statefulWorkdayFindings,
    repairProfile,
    manualReviewReasons,
    actionStatus,
    allFiles: fileList,
    runtimeJsFiles,
    assessmentFiles,
    filesModified: [],
    codeChanges: [],
    validationChecks: [],
    validationPassed: false,
    warnings,
  };
}
