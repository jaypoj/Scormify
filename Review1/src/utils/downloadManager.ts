import { PackageInspectionResult } from '../types';

export interface EnvironmentCapabilities {
  isEmbeddedIframe: boolean;
  isTopLevel: boolean;
  hasFileSystemAccess: boolean;
  hasShowSaveFilePicker: boolean;
  hasShowDirectoryPicker: boolean;
  hasBlobUrl: boolean;
  hasDownloadAttribute: boolean;
}

export type DownloadStatusState =
  | 'READY TO SAVE'
  | 'SAVE DIALOG OPENING'
  | 'SAVING'
  | 'FILE SAVED SUCCESSFULLY'
  | 'DOWNLOAD REQUEST SENT'
  | 'BLOCKED BY EMBEDDED PREVIEW'
  | 'OUTPUT GENERATION ERROR'
  | 'CANCELLED BY USER'
  | 'FOLDER SAVING IS NOT AVAILABLE IN THIS EMBEDDED PREVIEW'
  | 'BROWSER/PREVIEW BLOCKED OPENING THE GENERATED FILE'
  | 'GENERATED FILE OPENED IN NEW TAB';

export interface DownloadDiagnosticRecord {
  id: string;
  timestamp: string;
  packageName: string;
  filename: string;
  validationPassed: boolean;
  blobPresent: boolean;
  blobType: string;
  blobSize: number;
  isEmbedded: boolean;
  showSaveFilePicker: 'available' | 'unavailable';
  showDirectoryPicker: 'available' | 'unavailable';
  actionAttempted: 'SAVE_FIXED_ZIP' | 'BROWSER_DOWNLOAD' | 'OPEN_GENERATED_ZIP' | 'SAVE_ALL_TO_FOLDER' | 'TEST_DOWNLOAD';
  blobUrlCreated: boolean;
  anchorCreated: boolean;
  anchorAttached: boolean;
  anchorClickExecuted: boolean;
  urlRevokedTimestamp?: string;
  exceptionName?: string;
  exceptionMessage?: string;
  savePickerWriteCompleted: boolean;
  statusOutcome: DownloadStatusState | string;
  details?: string;
}

// In-memory diagnostics store
const diagnosticsListeners = new Set<(records: DownloadDiagnosticRecord[]) => void>();
let diagnosticRecords: DownloadDiagnosticRecord[] = [];

export function addDiagnosticRecord(record: DownloadDiagnosticRecord): void {
  diagnosticRecords = [record, ...diagnosticRecords];
  diagnosticsListeners.forEach((listener) => {
    try {
      listener([...diagnosticRecords]);
    } catch {
      // ignore
    }
  });
}

export function getDiagnosticRecords(): DownloadDiagnosticRecord[] {
  return [...diagnosticRecords];
}

export function subscribeToDiagnostics(callback: (records: DownloadDiagnosticRecord[]) => void): () => void {
  diagnosticsListeners.add(callback);
  callback([...diagnosticRecords]);
  return () => {
    diagnosticsListeners.delete(callback);
  };
}

export function clearDiagnosticRecords(): void {
  diagnosticRecords = [];
  diagnosticsListeners.forEach((listener) => listener([]));
}

/**
 * Requirement 1: Determine the actual browsing environment
 */
export function detectDownloadEnvironment(): EnvironmentCapabilities {
  let isEmbedded = false;
  try {
    isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    // Cross-origin iframe throws SecurityError on window.top, confirming it is embedded
    isEmbedded = true;
  }

  const hasFileSystemAccess =
    typeof window !== 'undefined' &&
    ('showSaveFilePicker' in window || 'showDirectoryPicker' in window);

  const hasShowSaveFilePicker =
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    typeof (window as any).showSaveFilePicker === 'function';

  const hasShowDirectoryPicker =
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    typeof (window as any).showDirectoryPicker === 'function';

  const hasBlobUrl =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

  let hasDownloadAttribute = false;
  if (typeof document !== 'undefined') {
    try {
      const a = document.createElement('a');
      hasDownloadAttribute = 'download' in a;
    } catch {
      hasDownloadAttribute = false;
    }
  }

  return {
    isEmbeddedIframe: isEmbedded,
    isTopLevel: !isEmbedded,
    hasFileSystemAccess,
    hasShowSaveFilePicker,
    hasShowDirectoryPicker,
    hasBlobUrl,
    hasDownloadAttribute,
  };
}

/**
 * Requirement 2: Verify the actual output exists before showing/enabling download
 */
export interface OutputVerificationResult {
  isValid: boolean;
  status: DownloadStatusState;
  missingCondition?: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  blob?: Blob;
}

export function verifyOutputForDownload(pkg: PackageInspectionResult): OutputVerificationResult {
  const blob = pkg.patchedBlob || pkg.patchedZipBlob;
  const filename = pkg.patchedFileName || '';
  const sha256 = pkg.patchedSha256 || '';

  // Condition 1: validationPassed === true
  if (pkg.validationPassed !== true) {
    return {
      isValid: false,
      status: 'OUTPUT GENERATION ERROR',
      missingCondition: 'validationPassed === true (Package validation failed)',
      filename,
      sizeBytes: 0,
      sha256,
    };
  }

  // Condition 2: patchedZipBlob instanceof Blob
  if (!(blob instanceof Blob)) {
    return {
      isValid: false,
      status: 'OUTPUT GENERATION ERROR',
      missingCondition: 'patchedZipBlob instanceof Blob (Output ZIP blob is missing from memory)',
      filename,
      sizeBytes: 0,
      sha256,
    };
  }

  // Condition 3: patchedZipBlob.size > 0
  if (blob.size <= 0) {
    return {
      isValid: false,
      status: 'OUTPUT GENERATION ERROR',
      missingCondition: `patchedZipBlob.size > 0 (Output ZIP blob has 0 bytes)`,
      filename,
      sizeBytes: blob.size,
      sha256,
    };
  }

  // Condition 4: patchedFileName ends with .zip
  if (!filename.toLowerCase().endsWith('.zip')) {
    return {
      isValid: false,
      status: 'OUTPUT GENERATION ERROR',
      missingCondition: `patchedFileName ends with .zip (Filename "${filename}" does not end with .zip)`,
      filename,
      sizeBytes: blob.size,
      sha256,
      blob,
    };
  }

  return {
    isValid: true,
    status: 'READY TO SAVE',
    filename,
    sizeBytes: blob.size,
    sha256,
    blob,
  };
}

/**
 * Requirement 4: Primary save method — Save Fixed ZIP using window.showSaveFilePicker()
 */
export async function saveFixedZipWithPicker(
  pkg: PackageInspectionResult,
  onStatusChange?: (status: DownloadStatusState, detail?: string) => void
): Promise<{ success: boolean; status: DownloadStatusState; error?: string }> {
  const env = detectDownloadEnvironment();
  const verification = verifyOutputForDownload(pkg);
  const pkgName = pkg.actualPackageName || pkg.originalFileName;

  if (!verification.isValid || !verification.blob) {
    const status: DownloadStatusState = 'OUTPUT GENERATION ERROR';
    onStatusChange?.(status, verification.missingCondition);
    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: pkgName,
      filename: verification.filename,
      validationPassed: pkg.validationPassed,
      blobPresent: Boolean(verification.blob),
      blobType: verification.blob?.type || 'none',
      blobSize: verification.sizeBytes,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: env.hasShowSaveFilePicker ? 'available' : 'unavailable',
      showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
      actionAttempted: 'SAVE_FIXED_ZIP',
      blobUrlCreated: false,
      anchorCreated: false,
      anchorAttached: false,
      anchorClickExecuted: false,
      savePickerWriteCompleted: false,
      statusOutcome: status,
      exceptionMessage: verification.missingCondition,
    });
    return { success: false, status, error: verification.missingCondition };
  }

  const blob = verification.blob;
  const filename = verification.filename;

  // Check if showSaveFilePicker is available
  if (!env.hasShowSaveFilePicker) {
    // If showSaveFilePicker is unavailable, fallback to browser download (Requirement 5)
    return fallbackBrowserDownload(pkg, onStatusChange);
  }

  onStatusChange?.('SAVE DIALOG OPENING');

  let fileHandle: any = null;
  try {
    fileHandle = await (window as any).showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: 'SCORM ZIP package',
          accept: {
            'application/zip': ['.zip'],
          },
        },
      ],
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      const status: DownloadStatusState = 'CANCELLED BY USER';
      onStatusChange?.(status);
      addDiagnosticRecord({
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        packageName: pkgName,
        filename,
        validationPassed: pkg.validationPassed,
        blobPresent: true,
        blobType: blob.type || 'application/zip',
        blobSize: blob.size,
        isEmbedded: env.isEmbeddedIframe,
        showSaveFilePicker: 'available',
        showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
        actionAttempted: 'SAVE_FIXED_ZIP',
        blobUrlCreated: false,
        anchorCreated: false,
        anchorAttached: false,
        anchorClickExecuted: false,
        savePickerWriteCompleted: false,
        statusOutcome: status,
        exceptionName: err.name,
        exceptionMessage: 'User cancelled the save file picker dialog.',
      });
      return { success: false, status };
    }

    // If restricted in iframe / cross-origin
    const isSecurityOrRestricted =
      err.name === 'SecurityError' ||
      /cross-origin|sandboxed|restricted|iframe/i.test(err.message || '');

    if (isSecurityOrRestricted || env.isEmbeddedIframe) {
      addDiagnosticRecord({
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        packageName: pkgName,
        filename,
        validationPassed: pkg.validationPassed,
        blobPresent: true,
        blobType: blob.type || 'application/zip',
        blobSize: blob.size,
        isEmbedded: env.isEmbeddedIframe,
        showSaveFilePicker: 'available',
        showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
        actionAttempted: 'SAVE_FIXED_ZIP',
        blobUrlCreated: false,
        anchorCreated: false,
        anchorAttached: false,
        anchorClickExecuted: false,
        savePickerWriteCompleted: false,
        statusOutcome: 'BLOCKED BY EMBEDDED PREVIEW',
        exceptionName: err.name,
        exceptionMessage: err.message,
      });

      // Automatically attempt fallback browser download
      return fallbackBrowserDownload(pkg, onStatusChange);
    }

    const status: DownloadStatusState = 'OUTPUT GENERATION ERROR';
    onStatusChange?.(status, err.message);
    return { success: false, status, error: err.message };
  }

  // User selected destination file, now write
  onStatusChange?.('SAVING');
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    const status: DownloadStatusState = 'FILE SAVED SUCCESSFULLY';
    onStatusChange?.(status);

    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: pkgName,
      filename,
      validationPassed: pkg.validationPassed,
      blobPresent: true,
      blobType: blob.type || 'application/zip',
      blobSize: blob.size,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: 'available',
      showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
      actionAttempted: 'SAVE_FIXED_ZIP',
      blobUrlCreated: false,
      anchorCreated: false,
      anchorAttached: false,
      anchorClickExecuted: false,
      savePickerWriteCompleted: true,
      statusOutcome: status,
      details: `Successfully wrote ${blob.size} bytes directly to file via showSaveFilePicker.`,
    });

    return { success: true, status };
  } catch (err: any) {
    const status: DownloadStatusState = 'OUTPUT GENERATION ERROR';
    onStatusChange?.(status, err.message);
    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: pkgName,
      filename,
      validationPassed: pkg.validationPassed,
      blobPresent: true,
      blobType: blob.type || 'application/zip',
      blobSize: blob.size,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: 'available',
      showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
      actionAttempted: 'SAVE_FIXED_ZIP',
      blobUrlCreated: false,
      anchorCreated: false,
      anchorAttached: false,
      anchorClickExecuted: false,
      savePickerWriteCompleted: false,
      statusOutcome: status,
      exceptionName: err.name,
      exceptionMessage: err.message,
    });
    return { success: false, status, error: err.message };
  }
}

/**
 * Requirement 5 & 7: Fallback Normal Browser Download using <a> anchor tag
 */
export function fallbackBrowserDownload(
  pkg: PackageInspectionResult,
  onStatusChange?: (status: DownloadStatusState, detail?: string) => void
): { success: boolean; status: DownloadStatusState; error?: string } {
  const env = detectDownloadEnvironment();
  const verification = verifyOutputForDownload(pkg);
  const pkgName = pkg.actualPackageName || pkg.originalFileName;

  if (!verification.isValid || !verification.blob) {
    const status: DownloadStatusState = 'OUTPUT GENERATION ERROR';
    onStatusChange?.(status, verification.missingCondition);
    return { success: false, status, error: verification.missingCondition };
  }

  const blob = verification.blob;
  const filename = verification.filename;

  let url = '';
  let a: HTMLAnchorElement | null = null;
  let blobUrlCreated = false;
  let anchorCreated = false;
  let anchorAttached = false;
  let anchorClickExecuted = false;
  let exceptionName: string | undefined;
  let exceptionMessage: string | undefined;

  try {
    url = URL.createObjectURL(blob);
    blobUrlCreated = true;

    a = document.createElement('a');
    anchorCreated = true;
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';

    document.body.appendChild(a);
    anchorAttached = true;

    a.click();
    anchorClickExecuted = true;

    // Requirement 5: Wait at least 30 seconds before revoking
    const revokeDelayMs = 30000;
    setTimeout(() => {
      try {
        if (a && a.parentNode) {
          a.parentNode.removeChild(a);
        }
        URL.revokeObjectURL(url);
        // Record timestamp of revocation
        const currentRecords = getDiagnosticRecords();
        const rec = currentRecords.find((r) => r.filename === filename && !r.urlRevokedTimestamp);
        if (rec) {
          rec.urlRevokedTimestamp = new Date().toISOString();
        }
      } catch {
        // ignore
      }
    }, revokeDelayMs);

    // Requirement 7: If the app is embedded, show DOWNLOAD REQUEST SENT and preview warning
    const finalStatus: DownloadStatusState = env.isEmbeddedIframe
      ? 'DOWNLOAD REQUEST SENT'
      : 'DOWNLOAD REQUEST SENT';

    onStatusChange?.(
      finalStatus,
      env.isEmbeddedIframe
        ? 'The embedded preview may block downloads. If no file appears, use the published/top-level version of this app.'
        : undefined
    );

    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: pkgName,
      filename,
      validationPassed: pkg.validationPassed,
      blobPresent: true,
      blobType: blob.type || 'application/zip',
      blobSize: blob.size,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: env.hasShowSaveFilePicker ? 'available' : 'unavailable',
      showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
      actionAttempted: 'BROWSER_DOWNLOAD',
      blobUrlCreated,
      anchorCreated,
      anchorAttached,
      anchorClickExecuted,
      savePickerWriteCompleted: false,
      statusOutcome: finalStatus,
      details: env.isEmbeddedIframe
        ? 'Embedded iframe context detected. Anchor clicked; browser sandbox may silently block download if allow-downloads is omitted.'
        : 'Anchor click dispatched to browser download manager.',
    });

    return { success: true, status: finalStatus };
  } catch (err: any) {
    exceptionName = err.name;
    exceptionMessage = err.message;
    const status: DownloadStatusState = env.isEmbeddedIframe
      ? 'BLOCKED BY EMBEDDED PREVIEW'
      : 'OUTPUT GENERATION ERROR';

    onStatusChange?.(status, err.message);

    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: pkgName,
      filename,
      validationPassed: pkg.validationPassed,
      blobPresent: true,
      blobType: blob.type || 'application/zip',
      blobSize: blob.size,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: env.hasShowSaveFilePicker ? 'available' : 'unavailable',
      showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
      actionAttempted: 'BROWSER_DOWNLOAD',
      blobUrlCreated,
      anchorCreated,
      anchorAttached,
      anchorClickExecuted,
      exceptionName,
      exceptionMessage,
      savePickerWriteCompleted: false,
      statusOutcome: status,
    });

    return { success: false, status, error: err.message };
  }
}

/**
 * Requirement 6: Third fallback — Open Generated File in new tab
 */
export function openGeneratedZipInNewTab(
  pkg: PackageInspectionResult,
  onStatusChange?: (status: DownloadStatusState, detail?: string) => void
): { success: boolean; status: DownloadStatusState; error?: string } {
  const env = detectDownloadEnvironment();
  const verification = verifyOutputForDownload(pkg);
  const pkgName = pkg.actualPackageName || pkg.originalFileName;

  if (!verification.isValid || !verification.blob) {
    const status: DownloadStatusState = 'OUTPUT GENERATION ERROR';
    onStatusChange?.(status, verification.missingCondition);
    return { success: false, status, error: verification.missingCondition };
  }

  const blob = verification.blob;
  const filename = verification.filename;

  let url = '';
  try {
    url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');

    if (win === null) {
      const status: DownloadStatusState = 'BROWSER/PREVIEW BLOCKED OPENING THE GENERATED FILE';
      onStatusChange?.(status, 'Popup or new window was blocked by the browser/preview.');
      addDiagnosticRecord({
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        packageName: pkgName,
        filename,
        validationPassed: pkg.validationPassed,
        blobPresent: true,
        blobType: blob.type || 'application/zip',
        blobSize: blob.size,
        isEmbedded: env.isEmbeddedIframe,
        showSaveFilePicker: env.hasShowSaveFilePicker ? 'available' : 'unavailable',
        showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
        actionAttempted: 'OPEN_GENERATED_ZIP',
        blobUrlCreated: true,
        anchorCreated: false,
        anchorAttached: false,
        anchorClickExecuted: false,
        savePickerWriteCompleted: false,
        statusOutcome: status,
        details: 'window.open returned null (popup blocker or iframe sandbox without allow-popups).',
      });
      return { success: false, status };
    }

    const status: DownloadStatusState = 'GENERATED FILE OPENED IN NEW TAB';
    onStatusChange?.(status, 'Generated file opened in new tab.');

    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }, 60000);

    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: pkgName,
      filename,
      validationPassed: pkg.validationPassed,
      blobPresent: true,
      blobType: blob.type || 'application/zip',
      blobSize: blob.size,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: env.hasShowSaveFilePicker ? 'available' : 'unavailable',
      showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
      actionAttempted: 'OPEN_GENERATED_ZIP',
      blobUrlCreated: true,
      anchorCreated: false,
      anchorAttached: false,
      anchorClickExecuted: false,
      savePickerWriteCompleted: false,
      statusOutcome: status,
      details: 'Successfully opened Blob URL in a new window tab.',
    });

    return { success: true, status };
  } catch (err: any) {
    const status: DownloadStatusState = 'BROWSER/PREVIEW BLOCKED OPENING THE GENERATED FILE';
    onStatusChange?.(status, err.message);
    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: pkgName,
      filename,
      validationPassed: pkg.validationPassed,
      blobPresent: true,
      blobType: blob.type || 'application/zip',
      blobSize: blob.size,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: env.hasShowSaveFilePicker ? 'available' : 'unavailable',
      showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
      actionAttempted: 'OPEN_GENERATED_ZIP',
      blobUrlCreated: Boolean(url),
      anchorCreated: false,
      anchorAttached: false,
      anchorClickExecuted: false,
      savePickerWriteCompleted: false,
      statusOutcome: status,
      exceptionName: err.name,
      exceptionMessage: err.message,
    });
    return { success: false, status, error: err.message };
  }
}

/**
 * Requirement 9: Save All to Folder
 */
export async function saveAllToFolder(
  packages: PackageInspectionResult[],
  onProgress?: (progressText: string) => void
): Promise<{ success: boolean; count: number; status: DownloadStatusState; error?: string }> {
  const env = detectDownloadEnvironment();

  if (!env.hasShowDirectoryPicker) {
    const status: DownloadStatusState = 'FOLDER SAVING IS NOT AVAILABLE IN THIS EMBEDDED PREVIEW';
    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: 'ALL_VALIDATED_PACKAGES',
      filename: 'BATCH_FOLDER',
      validationPassed: true,
      blobPresent: true,
      blobType: 'application/zip',
      blobSize: 0,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: env.hasShowSaveFilePicker ? 'available' : 'unavailable',
      showDirectoryPicker: 'unavailable',
      actionAttempted: 'SAVE_ALL_TO_FOLDER',
      blobUrlCreated: false,
      anchorCreated: false,
      anchorAttached: false,
      anchorClickExecuted: false,
      savePickerWriteCompleted: false,
      statusOutcome: status,
      exceptionMessage: 'showDirectoryPicker is not supported or restricted in this environment',
    });
    return { success: false, count: 0, status, error: status };
  }

  // Only validated packages with valid outputs
  const validatedList = packages.filter((p) => {
    const v = verifyOutputForDownload(p);
    return v.isValid && v.blob;
  });

  if (validatedList.length === 0) {
    const status: DownloadStatusState = 'OUTPUT GENERATION ERROR';
    return { success: false, count: 0, status, error: 'No validated packages with output blobs available.' };
  }

  let dirHandle: any = null;
  try {
    dirHandle = await (window as any).showDirectoryPicker();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, count: 0, status: 'CANCELLED BY USER' };
    }
    const isRestricted =
      err.name === 'SecurityError' ||
      /cross-origin|sandboxed|restricted|iframe/i.test(err.message || '');
    const status: DownloadStatusState = isRestricted
      ? 'FOLDER SAVING IS NOT AVAILABLE IN THIS EMBEDDED PREVIEW'
      : 'OUTPUT GENERATION ERROR';

    addDiagnosticRecord({
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      packageName: 'ALL_VALIDATED_PACKAGES',
      filename: 'BATCH_FOLDER',
      validationPassed: true,
      blobPresent: true,
      blobType: 'application/zip',
      blobSize: 0,
      isEmbedded: env.isEmbeddedIframe,
      showSaveFilePicker: env.hasShowSaveFilePicker ? 'available' : 'unavailable',
      showDirectoryPicker: 'available',
      actionAttempted: 'SAVE_ALL_TO_FOLDER',
      blobUrlCreated: false,
      anchorCreated: false,
      anchorAttached: false,
      anchorClickExecuted: false,
      savePickerWriteCompleted: false,
      statusOutcome: status,
      exceptionName: err.name,
      exceptionMessage: err.message,
    });

    return { success: false, count: 0, status, error: err.message };
  }

  const total = validatedList.length;
  for (let i = 0; i < total; i++) {
    const pkg = validatedList[i];
    const blob = (pkg.patchedBlob || pkg.patchedZipBlob)!;
    const filename = pkg.patchedFileName!;

    onProgress?.(`Saving ${i + 1} of ${total}...`);

    try {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (err: any) {
      addDiagnosticRecord({
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        packageName: pkg.actualPackageName || pkg.originalFileName,
        filename,
        validationPassed: true,
        blobPresent: true,
        blobType: blob.type || 'application/zip',
        blobSize: blob.size,
        isEmbedded: env.isEmbeddedIframe,
        showSaveFilePicker: 'available',
        showDirectoryPicker: 'available',
        actionAttempted: 'SAVE_ALL_TO_FOLDER',
        blobUrlCreated: false,
        anchorCreated: false,
        anchorAttached: false,
        anchorClickExecuted: false,
        savePickerWriteCompleted: false,
        statusOutcome: 'OUTPUT GENERATION ERROR',
        exceptionName: err.name,
        exceptionMessage: `Error writing ${filename}: ${err.message}`,
      });
      return {
        success: false,
        count: i,
        status: 'OUTPUT GENERATION ERROR',
        error: `Failed writing ${filename}: ${err.message}`,
      };
    }
  }

  const status: DownloadStatusState = 'FILE SAVED SUCCESSFULLY';
  addDiagnosticRecord({
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    packageName: `BATCH_${total}_PACKAGES`,
    filename: `${total} ZIP files`,
    validationPassed: true,
    blobPresent: true,
    blobType: 'application/zip',
    blobSize: validatedList.reduce((acc, p) => acc + ((p.patchedBlob || p.patchedZipBlob)?.size || 0), 0),
    isEmbedded: env.isEmbeddedIframe,
    showSaveFilePicker: 'available',
    showDirectoryPicker: 'available',
    actionAttempted: 'SAVE_ALL_TO_FOLDER',
    blobUrlCreated: false,
    anchorCreated: false,
    anchorAttached: false,
    anchorClickExecuted: false,
    savePickerWriteCompleted: true,
    statusOutcome: status,
    details: `${total} FILES SAVED SUCCESSFULLY to user directory`,
  });

  return { success: true, count: total, status };
}

/**
 * Requirement 11: Top-Level / Published Test Mode
 * Generates tiny local text/blob file scorm-download-test.txt
 */
export async function runTestDownloadEnvironment(
  onStatusChange?: (status: string, details?: string) => void
): Promise<{ success: boolean; report: string; isRestrictionConfirmed: boolean }> {
  const env = detectDownloadEnvironment();
  const testContent = 'SCORM Workday Repair Tool download test\nEnvironment Verification File';
  const testBlob = new Blob([testContent], { type: 'text/plain;charset=utf-8;' });
  const testFilename = 'scorm-download-test.txt';

  onStatusChange?.('TESTING DOWNLOAD CAPABILITY', 'Preparing test blob...');

  if (env.isEmbeddedIframe) {
    // In an embedded iframe, test showSaveFilePicker or fallback
    if (env.hasShowSaveFilePicker) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: testFilename,
          types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(testBlob);
        await writable.close();

        addDiagnosticRecord({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: new Date().toISOString(),
          packageName: 'ENVIRONMENT_TEST',
          filename: testFilename,
          validationPassed: true,
          blobPresent: true,
          blobType: testBlob.type,
          blobSize: testBlob.size,
          isEmbedded: true,
          showSaveFilePicker: 'available',
          showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
          actionAttempted: 'TEST_DOWNLOAD',
          blobUrlCreated: false,
          anchorCreated: false,
          anchorAttached: false,
          anchorClickExecuted: false,
          savePickerWriteCompleted: true,
          statusOutcome: 'FILE SAVED SUCCESSFULLY',
          details: 'Test file saved successfully via showSaveFilePicker in iframe',
        });

        return {
          success: true,
          report: 'Test file saved successfully via File System Access API in this context.',
          isRestrictionConfirmed: false,
        };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return {
            success: false,
            report: 'Test save dialog cancelled by user.',
            isRestrictionConfirmed: false,
          };
        }

        // Restriction encountered
        addDiagnosticRecord({
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: new Date().toISOString(),
          packageName: 'ENVIRONMENT_TEST',
          filename: testFilename,
          validationPassed: true,
          blobPresent: true,
          blobType: testBlob.type,
          blobSize: testBlob.size,
          isEmbedded: true,
          showSaveFilePicker: 'available',
          showDirectoryPicker: env.hasShowDirectoryPicker ? 'available' : 'unavailable',
          actionAttempted: 'TEST_DOWNLOAD',
          blobUrlCreated: false,
          anchorCreated: false,
          anchorAttached: false,
          anchorClickExecuted: false,
          savePickerWriteCompleted: false,
          statusOutcome: 'PREVIEW ENVIRONMENT RESTRICTION CONFIRMED',
          exceptionName: err.name,
          exceptionMessage: err.message,
          details: 'PREVIEW ENVIRONMENT RESTRICTION CONFIRMED: Google AI Studio Preview iframe sandbox blocks showSaveFilePicker.',
        });

        return {
          success: false,
          report: 'PREVIEW ENVIRONMENT RESTRICTION CONFIRMED: File saving is restricted inside Google AI Studio Preview iframe. Open the app in a published or top-level browser tab.',
          isRestrictionConfirmed: true,
        };
      }
    } else {
      // No File System Access API in iframe
      return {
        success: false,
        report: 'PREVIEW ENVIRONMENT RESTRICTION CONFIRMED: File System Access API unavailable in this embedded preview.',
        isRestrictionConfirmed: true,
      };
    }
  } else {
    // Top-level context
    if (env.hasShowSaveFilePicker) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: testFilename,
          types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(testBlob);
        await writable.close();

        return {
          success: true,
          report: 'Top-level browsing context confirmed: File System Access API saved test file successfully to disk.',
          isRestrictionConfirmed: false,
        };
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return { success: false, report: 'Test save cancelled by user.', isRestrictionConfirmed: false };
        }
        return { success: false, report: `Save error: ${err.message}`, isRestrictionConfirmed: false };
      }
    } else {
      // Fallback anchor download in top level
      const url = URL.createObjectURL(testBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = testFilename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          a.remove();
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }, 30000);

      return {
        success: true,
        report: 'Top-level browser download triggered via anchor download attribute.',
        isRestrictionConfirmed: false,
      };
    }
  }
}
