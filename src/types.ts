export type ScormVersion = 'SCORM 1.2' | 'SCORM 2004' | 'AMBIGUOUS' | 'UNKNOWN';

export type RepairProfile =
  | 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1'
  | 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1'
  | 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1'
  | 'KNOWN_SCORM12_QUIZ_80_V1'
  | 'NONE';

export type ActionStatus =
  | 'PENDING_SCAN'
  | 'READY_TO_PATCH'
  | 'PATCHED'
  | 'NO CHANGE NEEDED'
  | 'MANUAL REVIEW'
  | 'FAILED VALIDATION'
  | 'UNSUPPORTED'
  | 'OUTER_WRAPPER_SCANNED';

export interface CodeFilesCount {
  jsCount: number;
  htmlCount: number;
  xmlCount: number;
  total: number;
}

export type StatusWriteClassification =
  | 'INVALID PROGRESS COMPLETION'
  | 'INVALID FINISH COMPLETION'
  | 'INVALID RELAUNCH RESET'
  | 'INVALID EXIT COMPLETION'
  | 'CONDITIONAL COMPLETION — PASS-GATED'
  | 'VALID ASSESSMENT STATUS'
  | 'BENIGN / NORMAL WRITE';

export interface StatusWriteRecord {
  id: string;
  filePath: string;
  lineNumber?: number;
  enclosingFunction?: string;
  enclosingEventHandler?: string;
  cmiField: string;
  valueWritten: string;
  isLiteral: boolean;
  guardOrCondition?: string;
  contextSnippet: string;
  classification: StatusWriteClassification;
}

export interface CrossProfileWorkdayFindings {
  exitControl: 'PRESENT' | 'MISSING' | 'NOT_APPLICABLE';
  exitHandler: 'SAFE' | 'MISSING_OR_UNSAFE' | 'NOT_APPLICABLE';
  exitWiring: 'WIRED' | 'MISSING_OR_BROKEN' | 'NOT_APPLICABLE';
  assessmentRetake: 'SAFE' | 'UNSAFE' | 'NOT_APPLICABLE';
  assessmentFeedbackProtection: 'SAFE' | 'UNSAFE' | 'NOT_APPLICABLE';
}

export interface NestedPackageInspection {
  nestedZipName: string;
  nestedZipPath: string;
  fileSize: number;
  zipEntriesCount: number;
  scanDurationMs: number;
  first20FilePaths: string[];
  manifestFound: boolean;
  manifestExactPath: string;
  nestedZipCount: number;
  nestedZipNames: string[];
  inspectedCodeFilesCount: CodeFilesCount;
  runtimeFilesSearched: string[];
  assessmentFilesSearched: string[];
  scormApiStringsDetected: string[];
  scormVersion: ScormVersion;
  scormVersionReason: string;
  runtimeApiType: string;
  manifestVersion: string;
  masteryScore: string;
  detectedQuizThreshold: string;
  passScoreConsistency: string;
  defectsDetected: {
    progress: boolean;
    finish: boolean;
    relaunch: boolean;
    exit: boolean;
  };
  repairProfile: RepairProfile;
  actionStatus: ActionStatus;
  statusMessage: string;
  statusWriteInventory?: StatusWriteRecord[];
  progressDefect?: DefectItem;
  finishDefect?: DefectItem;
  relaunchDefect?: DefectItem;
  exitDefect?: DefectItem;
  passScoreReferences?: PassScoreEvidence[];
  manifestData?: ManifestData;
  statefulWorkdayFindings?: StatefulWorkdayFindings;
  crossProfileWorkdayFindings?: CrossProfileWorkdayFindings;
}

export interface StatefulWorkdayFindings {
  globalStorageKey: 'DETECTED' | 'NOT_DETECTED' | 'NAMESPACED / SAFE';
  stalePageStateRisk: 'DETECTED' | 'SAFE / ISOLATED';
  progressExceed100Risk: 'DETECTED' | 'PROTECTED (0-100%)';
  passDowngradeRisk: 'DETECTED' | 'PRESERVED';
  failedQuizExitUx: 'MISSING' | 'PRESENT';
  saveAndExit: 'MISSING' | 'PRESENT';
  dynamicPageFetch: 'DETECTED' | 'INLINED' | 'NOT_DETECTED';
  inlinePageCompatibility: 'APPLIED' | 'AVAILABLE' | 'NOT_APPLICABLE';
}

export interface ManifestData {
  present: boolean;
  atRoot: boolean;
  validXml: boolean;
  declaredVersion: string | null;
  masteryScore: number | null;
  masteryScoreStatus: 'PASS' | 'OTHER' | 'MASTERY SCORE NOT FOUND';
  launchResource: string | null;
  referencedFiles: string[];
  rawXmlSnippet?: string;
}

export interface PassScoreEvidence {
  source: string;
  fieldOrPattern: string;
  score: number;
  sourceType?: 'Manifest' | 'Runtime' | 'Configuration' | 'ProjectJson' | 'UI';
  context?: string;
}

export interface DefectItem {
  detected: boolean;
  isPassGated?: boolean;
  filePath?: string;
  snippet?: string;
  details?: string;
}

export interface CodeChange {
  filePath: string;
  description: string;
  beforeSnippet: string;
  afterSnippet: string;
}

export interface PatchPatternAudit {
  filePath: string;
  patternExpected: string;
  matchFound: boolean;
  replacementApplied: boolean;
  contentChanged: boolean;
  reason?: string;
}

export interface PatchExecutionReport {
  repairProfileSelected: RepairProfile;
  patchFunctionInvoked: string;
  candidateInternalFiles: string[];
  filesOpenedForModification: string[];
  patternsSearchedCount: number;
  patternsMatchedCount: number;
  replacementsAttemptedCount: number;
  replacementsSuccessfullyAppliedCount: number;
  exactFilesModified: string[];
  patchException?: string;
  modifiedTextDiffers: boolean;
  zeroModifiedExplanation?: string;
  patternAudits: PatchPatternAudit[];
  logs: string[];
}

export type ValidationOutcome = 'PASS' | 'FAIL' | 'TEST_ERROR';

export interface ValidationItem {
  id: number;
  title: string;
  ruleName: string;
  file?: string;
  passed: boolean;
  outcome?: ValidationOutcome;
  details: string;
}

export interface PackageInspectionResult {
  id: string;
  file: File;
  originalFileName: string;
  outerFileName?: string;
  actualPackageName: string;
  fileSize: number;
  originalSha256: string;

  // Milestone 1 Verification Details & Clear Evidence of Inspection
  zipEntriesCount: number;
  scanDurationMs: number;
  first20FilePaths: string[];
  manifestFound: boolean;
  manifestExactPath: string;
  nestedZipCount: number;
  nestedZipNames: string[];
  inspectedCodeFilesCount: CodeFilesCount;
  runtimeFilesSearched: string[];
  assessmentFilesSearched: string[];
  scormApiStringsDetected: string[];

  // Deterministic Status Write Inventory
  statusWriteInventory: StatusWriteRecord[];

  // Nested ZIP Support (1 level automatic inspection)
  isOuterWrapper: boolean;
  nestedPackages: NestedPackageInspection[];
  outerStatusMessage?: string;

  // SCORM & Manifest classification
  scormVersion: ScormVersion;
  scormVersionReason: string;
  runtimeApiType:
    | 'Dual-Capable / UniversalSCORM wrapper'
    | 'Compact SCORM 1.2 wrapper'
    | 'SCORM 1.2 (window.API)'
    | 'SCORM 2004 (window.API_1484_11)'
    | 'None / Unknown'
    | 'Ambiguous'
    | string;
  manifestVersion: string;
  manifestData: ManifestData;

  // Score analysis
  masteryScore: string; // e.g. "80 (PASS)" or "Not Found"
  detectedQuizThreshold: string; // e.g. "80"
  passScoreConsistency: 'CONSISTENT' | 'PASS SCORE CONFLICT — MANUAL REVIEW' | 'INSUFFICIENT DATA';
  passScoreReferences: PassScoreEvidence[];

  // Known Defects (Defects 1, 2, 3, 4)
  progressDefect: DefectItem;
  finishDefect: DefectItem;
  relaunchDefect: DefectItem;
  exitDefect: DefectItem;
  statefulWorkdayFindings?: StatefulWorkdayFindings;
  crossProfileWorkdayFindings?: CrossProfileWorkdayFindings;

  // Profile & Status
  repairProfile: RepairProfile;
  manualReviewReasons: string[];
  actionStatus: ActionStatus;

  // File structure
  allFiles: string[];
  runtimeJsFiles: string[];
  assessmentFiles: string[];

  // Patch outcome (when patched)
  patchedSha256?: string;
  patchedBlob?: Blob;
  patchedZipBlob?: Blob;
  patchedFileName?: string;
  filesModified: string[];
  codeChanges: CodeChange[];
  validationChecks: ValidationItem[];
  validationPassed: boolean;
  warnings: string[];
  error?: string;
  patchExecutionReport?: PatchExecutionReport;

  // Download Diagnostics (Requirement 10)
  patchedZipGenerated?: boolean;
  patchedZipSizeBytes?: number;
  patchedZipBytes?: number;
  downloadReady?: boolean;
  downloadDiagnosticReason?: string;
}

export interface BatchSummary {
  total: number;
  completed: number;
  patched: number;
  noChange: number;
  manualReview: number;
  failed: number;
  currentFileName?: string;
  currentIndex?: number;
}

export interface SyntheticTestResult {
  testId: string;
  title: string;
  passed: boolean;
  expected: string;
  actual: string;
  details: string;
}
