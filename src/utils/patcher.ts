import { CodeChange, PackageInspectionResult, PatchExecutionReport, PatchPatternAudit, RepairProfile } from '../types';
import {
  transformCompactNavigation,
  transformCompactScormApi,
  transformUniversalScormApi,
  transformStatefulWorkdayNavigation,
  generateWorkdayPageContentMap,
  getTraceSnapshot,
  normalizeFinalNextPageCompletion,
  repairCompactFinishCompletion,
} from './codeTransformer';
import { ensurePageContentManifestEntry } from './issue1StatefulRuntime';

export interface PatchResult {
  updatedContents: { [filePath: string]: string };
  filesModified: string[];
  codeChanges: CodeChange[];
  executionReport: PatchExecutionReport;
}

function getSurroundingSnippet(fullText: string, startIndex: number, length: number): string {
  const lineStart = fullText.lastIndexOf('\n', Math.max(0, startIndex - 100));
  const effectiveStart = lineStart === -1 ? 0 : lineStart + 1;
  const lineEnd = fullText.indexOf('\n', startIndex + length + 100);
  const effectiveEnd = lineEnd === -1 ? fullText.length : lineEnd;
  return fullText.slice(effectiveStart, effectiveEnd);
}

/**
 * Deterministic patch for KNOWN_SCORM12_COMPACT_QUIZ_80_V1
 * - scripts/navigation.js: remove page progress completion
 * - scripts/navigation.js: remove Finish button completion, display pass/requirement message
 * - scripts/scorm-api.js: inject functioning SCORM.get() using this.api
 * - scripts/scorm-api.js: guard relaunch initialization using this.get()
 */
export function patchCompactScorm12Package(
  fileContents: { [filePath: string]: string },
  candidateFiles: string[],
  pkg: PackageInspectionResult
): PatchResult {
  const updatedContents: { [filePath: string]: string } = { ...fileContents };
  const filesModified: string[] = [];
  const codeChanges: CodeChange[] = [];
  const audits: PatchPatternAudit[] = [];
  const logs: string[] = [];

  const profileSelected: RepairProfile = 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1';
  const functionInvoked = 'patchCompactScorm12Package';
  logs.push(`Profile selected: ${profileSelected}`);
  logs.push(`Patch function invoked: ${functionInvoked}`);

  let patternsSearched = 0;
  let patternsMatched = 0;
  let replacementsAttempted = 0;
  let replacementsApplied = 0;

  const openedFiles = candidateFiles.filter(f => Boolean(updatedContents[f]));
  logs.push(`Candidate internal files: ${candidateFiles.length} found, ${openedFiles.length} opened for inspection`);

  // 1. Navigation Scripts (scripts/navigation.js)
  const navCandidates = openedFiles.filter(f =>
    f.toLowerCase().includes('nav') ||
    pkg.statusWriteInventory?.some(w => w.filePath === f && (w.classification === 'INVALID PROGRESS COMPLETION' || w.classification === 'INVALID FINISH COMPLETION'))
  );
  const filesForNav = navCandidates.length > 0 ? navCandidates : openedFiles.filter(f => f.endsWith('.js'));

  for (const filePath of filesForNav) {
    const original = updatedContents[filePath];
    if (!original) continue;

    patternsSearched += 2;
    try {
      const result = transformCompactNavigation(original);
      for (const a of result.audits) {
        audits.push({
          filePath,
          patternExpected: a.patternExpected,
          matchFound: a.matchFound,
          replacementApplied: a.replacementApplied,
          contentChanged: a.replacementApplied,
          reason: a.reason,
        });
        if (a.matchFound) patternsMatched++;
        if (a.replacementApplied) {
          replacementsAttempted++;
          replacementsApplied++;
        }
      }

      if (result.modified && result.code !== original) {
        updatedContents[filePath] = result.code;
        if (!filesModified.includes(filePath)) {
          filesModified.push(filePath);
        }
        for (const desc of result.changes) {
          codeChanges.push({
            filePath,
            description: desc,
            beforeSnippet: original.slice(0, 300),
            afterSnippet: result.code.slice(0, 300),
          });
        }
        logs.push(`Applied Compact navigation remediation to ${filePath}: ${result.changes.join('; ')}`);
      }
    } catch (err: any) {
      logs.push(`Error transforming ${filePath}: ${err.message}`);
    }
  }

  // 2. SCORM API Scripts (scripts/scorm-api.js)
  const apiCandidates = openedFiles.filter(f =>
    f.toLowerCase().includes('scorm') ||
    f.toLowerCase().includes('api') ||
    pkg.statusWriteInventory?.some(w => w.filePath === f && w.classification === 'INVALID RELAUNCH RESET')
  );
  const filesForApi = apiCandidates.length > 0 ? apiCandidates : openedFiles.filter(f => f.endsWith('.js'));

  for (const filePath of filesForApi) {
    const original = updatedContents[filePath];
    if (!original) continue;

    patternsSearched += 2;
    try {
      const result = transformCompactScormApi(original);
      for (const a of result.audits) {
        audits.push({
          filePath,
          patternExpected: a.patternExpected,
          matchFound: a.matchFound,
          replacementApplied: a.replacementApplied,
          contentChanged: a.replacementApplied,
          reason: a.reason,
        });
        if (a.matchFound) patternsMatched++;
        if (a.replacementApplied) {
          replacementsAttempted++;
          replacementsApplied++;
        }
      }

      if (result.modified && result.code !== original) {
        updatedContents[filePath] = result.code;
        if (!filesModified.includes(filePath)) {
          filesModified.push(filePath);
        }
        for (const desc of result.changes) {
          codeChanges.push({
            filePath,
            description: desc,
            beforeSnippet: original.slice(0, 300),
            afterSnippet: result.code.slice(0, 300),
          });
        }
        logs.push(`Applied Compact SCORM API remediation to ${filePath}: ${result.changes.join('; ')}`);
      }
    } catch (err: any) {
      logs.push(`Error transforming SCORM API ${filePath}: ${err.message}`);
    }
  }

  // Inventory-guided fallback if any defects remain un-neutralized
  if (pkg.statusWriteInventory) {
    for (const record of pkg.statusWriteInventory) {
      const cleanPath = record.filePath.replace(/^\[[^\]]+\]\s*/, '');
      const content = updatedContents[cleanPath];
      if (content && content.includes(record.contextSnippet)) {
        patternsSearched++;
        patternsMatched++;
        replacementsAttempted++;
        const beforeSnippet = record.contextSnippet;
        let neutralizedSnippet = beforeSnippet;

        if (record.classification === 'INVALID RELAUNCH RESET') {
          neutralizedSnippet = beforeSnippet.replace(
            /(?:(?:SCORM|this)\s*\.)?set\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]incomplete['"]\s*\);?/g,
            `var priorStatus = (typeof SCORM !== 'undefined' && SCORM.get) ? SCORM.get('cmi.core.lesson_status') : '';
    if (!priorStatus || priorStatus === 'not attempted' || priorStatus === '') {
      SCORM.set('cmi.core.lesson_status', 'incomplete');
    }`
          );
        } else if (record.classification === 'INVALID FINISH COMPLETION' || record.classification === 'INVALID PROGRESS COMPLETION') {
          neutralizedSnippet = beforeSnippet.replace(
            /(?:(?:SCORM|this)\s*\.)?set\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?/g,
            `/* SCORM remediation: neutralized completed override */`
          );
        }

        if (neutralizedSnippet !== beforeSnippet) {
          updatedContents[cleanPath] = content.replace(beforeSnippet, neutralizedSnippet);
          replacementsApplied++;
          if (!filesModified.includes(cleanPath)) filesModified.push(cleanPath);
          codeChanges.push({
            filePath: cleanPath,
            description: `Inventory fallback: neutralized ${record.classification}`,
            beforeSnippet,
            afterSnippet: neutralizedSnippet,
          });
        }
      }
    }
  }

  const modifiedTextDiffers = filesModified.some(f => updatedContents[f] !== fileContents[f]);
  logs.push(`Patch function completed: ${filesModified.length} file(s) modified: ${filesModified.join(', ') || 'NONE'}`);

  let zeroModifiedExplanation: string | undefined;
  if (filesModified.length === 0) {
    zeroModifiedExplanation = 'PATCH NOT APPLIED — EXPECTED DEFECT PATTERN NOT MODIFIED: Target defect patterns were not matched in opened candidate scripts.';
    logs.push(zeroModifiedExplanation);
  }

  return {
    updatedContents,
    filesModified,
    codeChanges,
    executionReport: {
      repairProfileSelected: profileSelected,
      patchFunctionInvoked: functionInvoked,
      candidateInternalFiles: candidateFiles,
      filesOpenedForModification: openedFiles,
      patternsSearchedCount: patternsSearched,
      patternsMatchedCount: patternsMatched,
      replacementsAttemptedCount: replacementsAttempted,
      replacementsSuccessfullyAppliedCount: replacementsApplied,
      exactFilesModified: filesModified,
      modifiedTextDiffers,
      zeroModifiedExplanation,
      patternAudits: audits,
      logs,
    },
  };
}

/**
 * Deterministic patch for KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1
 * Targets scripts/scorm-api.js:
 * 1. Removes unconditional status writes in beforeunload/unload/pagehide
 * 2. Neutralizes relaunch reset in init() by using this.getValue()
 */
export function patchUniversalScorm12Package(
  fileContents: { [filePath: string]: string },
  candidateFiles: string[],
  pkg: PackageInspectionResult
): PatchResult {
  const updatedContents: { [filePath: string]: string } = { ...fileContents };
  const filesModified: string[] = [];
  const codeChanges: CodeChange[] = [];
  const audits: PatchPatternAudit[] = [];
  const logs: string[] = [];

  const profileSelected: RepairProfile = 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1';
  const functionInvoked = 'patchUniversalScorm12Package';
  logs.push(`Profile selected: ${profileSelected}`);
  logs.push(`Patch function invoked: ${functionInvoked}`);

  let patternsSearched = 0;
  let patternsMatched = 0;
  let replacementsAttempted = 0;
  let replacementsApplied = 0;

  const openedFiles = candidateFiles.filter(f => Boolean(updatedContents[f]));
  logs.push(`Candidate internal files: ${candidateFiles.length} found, ${openedFiles.length} opened for inspection`);

  // Target: scripts/scorm-api.js or files containing UniversalSCORM
  const targetFiles = openedFiles.filter(f =>
    f.toLowerCase().includes('scorm') ||
    f.toLowerCase().includes('api') ||
    (updatedContents[f] && updatedContents[f].includes('UniversalSCORM'))
  );
  const filesToScan = targetFiles.length > 0 ? targetFiles : openedFiles.filter(f => f.endsWith('.js'));

  for (const filePath of filesToScan) {
    const original = updatedContents[filePath];
    if (!original) continue;

    patternsSearched += 2;
    try {
      const result = transformUniversalScormApi(original);
      for (const a of result.audits) {
        audits.push({
          filePath,
          patternExpected: a.patternExpected,
          matchFound: a.matchFound,
          replacementApplied: a.replacementApplied,
          contentChanged: a.replacementApplied,
          reason: a.reason,
        });
        if (a.matchFound) patternsMatched++;
        if (a.replacementApplied) {
          replacementsAttempted++;
          replacementsApplied++;
        }
      }

      if (result.modified && result.code !== original) {
        updatedContents[filePath] = result.code;
        if (!filesModified.includes(filePath)) {
          filesModified.push(filePath);
        }
        for (const desc of result.changes) {
          codeChanges.push({
            filePath,
            description: desc,
            beforeSnippet: original.slice(0, 300),
            afterSnippet: result.code.slice(0, 300),
          });
        }
        logs.push(`Applied Universal SCORM API remediation to ${filePath}: ${result.changes.join('; ')}`);
      }
    } catch (err: any) {
      logs.push(`Error transforming Universal SCORM API ${filePath}: ${err.message}`);
    }
  }

  // Inventory-guided fallback for remaining defects
  if (pkg.statusWriteInventory) {
    for (const record of pkg.statusWriteInventory) {
      if (record.classification === 'INVALID EXIT COMPLETION' || record.classification === 'INVALID RELAUNCH RESET') {
        const cleanPath = record.filePath.replace(/^\[[^\]]+\]\s*/, '');
        const content = updatedContents[cleanPath];
        if (content && content.includes(record.contextSnippet)) {
          patternsSearched++;
          patternsMatched++;
          replacementsAttempted++;
          const beforeSnippet = record.contextSnippet;
          let neutralizedSnippet = beforeSnippet;

          if (record.classification === 'INVALID EXIT COMPLETION') {
            neutralizedSnippet = beforeSnippet.replace(
              /(?:(?:UniversalSCORM|SafeSCORM|this)\s*\.)?setValue\s*\(\s*(?:['"](?:cmi\.core\.lesson_status|cmi\.completion_status)['"]\s*,\s*)?['"]completed['"]\s*\);?/g,
              `/* SCORM remediation: neutralized exit completed override */`
            );
          } else if (record.classification === 'INVALID RELAUNCH RESET') {
            neutralizedSnippet = beforeSnippet.replace(
              /(?:(?:UniversalSCORM|SafeSCORM|this)\s*\.)?setValue\s*\(\s*(?:['"]cmi\.core\.lesson_status['"]\s*,\s*)?['"]incomplete['"]\s*\);?/g,
              `const priorStatus = (this.getValue ? this.getValue('cmi.core.lesson_status') : '');
    if (!priorStatus || priorStatus === 'not attempted') {
      this.setValue('cmi.core.lesson_status', 'incomplete');
    }`
            );
          }

          if (neutralizedSnippet !== beforeSnippet) {
            updatedContents[cleanPath] = content.replace(beforeSnippet, neutralizedSnippet);
            replacementsApplied++;
            if (!filesModified.includes(cleanPath)) filesModified.push(cleanPath);
            codeChanges.push({
              filePath: cleanPath,
              description: `Inventory fallback: neutralized ${record.classification}`,
              beforeSnippet,
              afterSnippet: neutralizedSnippet,
            });
          }
        }
      }
    }
  }

  const modifiedTextDiffers = filesModified.some(f => updatedContents[f] !== fileContents[f]);
  logs.push(`Patch function completed: ${filesModified.length} file(s) modified: ${filesModified.join(', ') || 'NONE'}`);

  let zeroModifiedExplanation: string | undefined;
  if (filesModified.length === 0) {
    zeroModifiedExplanation = 'PATCH NOT APPLIED — EXPECTED DEFECT PATTERN NOT MODIFIED: Target defect patterns were not matched in opened candidate scripts.';
    logs.push(zeroModifiedExplanation);
  }

  return {
    updatedContents,
    filesModified,
    codeChanges,
    executionReport: {
      repairProfileSelected: profileSelected,
      patchFunctionInvoked: functionInvoked,
      candidateInternalFiles: candidateFiles,
      filesOpenedForModification: openedFiles,
      patternsSearchedCount: patternsSearched,
      patternsMatchedCount: patternsMatched,
      replacementsAttemptedCount: replacementsAttempted,
      replacementsSuccessfullyAppliedCount: replacementsApplied,
      exactFilesModified: filesModified,
      modifiedTextDiffers,
      zeroModifiedExplanation,
      patternAudits: audits,
      logs,
    },
  };
}

/**
 * Deterministic patch for KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1
 * 1. scripts/navigation.js:
 *    - Namespace STORAGE_KEY for isolated standalone fallback; makes LMS state authoritative
 *    - Validates visited page IDs and clamps progress Math.min(100, Math.max(0, ...))
 *    - Preserves prior pass and bestScore on quiz submit; prevents downgrade
 *    - Injects accessible Failed-Assessment Modal with Try Again and Save & Exit
 *    - Injects Save & Exit control with cmi.core.exit = 'suspend' and no completion write
 *    - Updates loadPage to use window.SCORM_PAGE_CONTENT without runtime fetch
 *    - Ensures Finish button is conditional on cmi.core.lesson_status === 'passed'
 * 2. scripts/scorm-api.js:
 *    - Injects SCORM.get(k) if missing
 *    - Guards launch/load initialization with priorStatus check
 * 3. scripts/page-content.js:
 *    - Generates bundled window.SCORM_PAGE_CONTENT map for Workday inline page mode
 * 4. index.html:
 *    - Injects scripts/page-content.js script tag and Save & Exit shell button
 */
export function patchStatefulCompactWorkdayPackage(
  fileContents: { [filePath: string]: string },
  candidateFiles: string[],
  pkg: PackageInspectionResult
): PatchResult {
  const updatedContents: { [filePath: string]: string } = { ...fileContents };
  const filesModified: string[] = [];
  const codeChanges: CodeChange[] = [];
  const audits: PatchPatternAudit[] = [];
  const logs: string[] = [];

  const profileSelected: RepairProfile = 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1';
  const functionInvoked = 'patchStatefulCompactWorkdayPackage';
  logs.push(`Profile selected: ${profileSelected}`);
  logs.push(`Patch function invoked: ${functionInvoked}`);

  let patternsSearched = 0;
  let patternsMatched = 0;
  let replacementsAttempted = 0;
  let replacementsApplied = 0;

  const openedFiles = candidateFiles.filter(f => Boolean(updatedContents[f]));
  logs.push(`Candidate internal files: ${candidateFiles.length} found, ${openedFiles.length} opened for inspection`);

  const courseId = (pkg.manifestData?.launchResource || pkg.actualPackageName || 'ScormCourse')
    .replace(/\.zip$/i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  // 1. Navigation Scripts (scripts/navigation.js)
  const navCandidates = openedFiles.filter(f =>
    f.toLowerCase().includes('nav') ||
    pkg.statusWriteInventory?.some(w => w.filePath === f && (w.classification === 'INVALID PROGRESS COMPLETION' || w.classification === 'INVALID FINISH COMPLETION'))
  );
  const filesForNav = navCandidates.length > 0 ? navCandidates : openedFiles.filter(f => f.endsWith('.js') && !f.toLowerCase().includes('scorm'));

  const primaryNavPath = filesForNav[0] || 'scripts/navigation.js';
  const origNavCode = updatedContents[primaryNavPath] || '';
  if (origNavCode) {
    const snapA = getTraceSnapshot(origNavCode);
    logs.push(`[STAGE A] Original ${primaryNavPath} (hash: ${snapA.hash}, snippet: "${snapA.snippet}")`);
    console.log(`[STAGE A] Original ${primaryNavPath}:`, snapA);
  }

  for (const filePath of filesForNav) {
    const original = updatedContents[filePath];
    if (!original) continue;

    patternsSearched += 6;
    try {
      const result = transformStatefulWorkdayNavigation(original, courseId);
      for (const a of result.audits) {
        audits.push({
          filePath,
          patternExpected: a.patternExpected,
          matchFound: a.matchFound,
          replacementApplied: a.replacementApplied,
          contentChanged: a.replacementApplied,
          reason: a.reason,
        });
        if (a.matchFound) patternsMatched++;
        if (a.replacementApplied) {
          replacementsAttempted++;
          replacementsApplied++;
        }
      }

      if (result.modified && result.code !== original) {
        updatedContents[filePath] = result.code;
        if (!filesModified.includes(filePath)) {
          filesModified.push(filePath);
        }
        for (const desc of result.changes) {
          codeChanges.push({
            filePath,
            description: desc,
            beforeSnippet: original.slice(0, 300),
            afterSnippet: result.code.slice(0, 300),
          });
        }
        logs.push(`Applied Stateful Workday navigation remediation to ${filePath}: ${result.changes.join('; ')}`);
        
        if (filePath === primaryNavPath) {
          const snapC = getTraceSnapshot(result.code);
          logs.push(`[STAGE C] After Stateful remediation on ${filePath} (hash: ${snapC.hash}, snippet: "${snapC.snippet}")`);
          console.log(`[STAGE C] After Stateful remediation on ${filePath}:`, snapC);
        }
      }
    } catch (err: any) {
      logs.push(`Error transforming ${filePath}: ${err.message}`);
    }
  }

  // 2. SCORM API Scripts (scripts/scorm-api.js)
  const apiCandidates = openedFiles.filter(f =>
    f.toLowerCase().includes('scorm') ||
    f.toLowerCase().includes('api') ||
    pkg.statusWriteInventory?.some(w => w.filePath === f && w.classification === 'INVALID RELAUNCH RESET')
  );
  const filesForApi = apiCandidates.length > 0 ? apiCandidates : openedFiles.filter(f => f.endsWith('.js'));

  for (const filePath of filesForApi) {
    const original = updatedContents[filePath];
    if (!original) continue;

    patternsSearched += 2;
    try {
      const result = transformCompactScormApi(original);
      for (const a of result.audits) {
        audits.push({
          filePath,
          patternExpected: a.patternExpected,
          matchFound: a.matchFound,
          replacementApplied: a.replacementApplied,
          contentChanged: a.replacementApplied,
          reason: a.reason,
        });
        if (a.matchFound) patternsMatched++;
        if (a.replacementApplied) {
          replacementsAttempted++;
          replacementsApplied++;
        }
      }

      if (result.modified && result.code !== original) {
        updatedContents[filePath] = result.code;
        if (!filesModified.includes(filePath)) {
          filesModified.push(filePath);
        }
        for (const desc of result.changes) {
          codeChanges.push({
            filePath,
            description: desc,
            beforeSnippet: original.slice(0, 300),
            afterSnippet: result.code.slice(0, 300),
          });
        }
        logs.push(`Applied Compact SCORM API remediation to ${filePath}: ${result.changes.join('; ')}`);
      }
    } catch (err: any) {
      logs.push(`Error transforming ${filePath}: ${err.message}`);
    }
  }

  // 2.5. Inventory-guided fallback for remaining defects in other files
  if (pkg.statusWriteInventory) {
    for (const record of pkg.statusWriteInventory) {
      const cleanPath = record.filePath.replace(/^\[[^\]]+\]\s*/, '');
      const content = updatedContents[cleanPath];
      if (content && content.includes(record.contextSnippet)) {
        patternsSearched++;
        patternsMatched++;
        replacementsAttempted++;
        const beforeSnippet = record.contextSnippet;
        let neutralizedSnippet = beforeSnippet;

        if (record.classification === 'INVALID RELAUNCH RESET') {
          neutralizedSnippet = beforeSnippet.replace(
            /(?:(?:SCORM|this)\s*\.)?set\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]incomplete['"]\s*\);?/g,
            `var priorStatus = (typeof SCORM !== 'undefined' && SCORM.get) ? SCORM.get('cmi.core.lesson_status') : '';
    if (!priorStatus || priorStatus === 'not attempted' || priorStatus === '') {
      SCORM.set('cmi.core.lesson_status', 'incomplete');
    }`
          );
        } else if (record.classification === 'INVALID FINISH COMPLETION' || record.classification === 'INVALID PROGRESS COMPLETION') {
          neutralizedSnippet = beforeSnippet.replace(
            /(?:(?:SCORM|this)\s*\.)?set\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?/g,
            `/* SCORM remediation: neutralized completed override */`
          );
        }

        if (neutralizedSnippet !== beforeSnippet) {
          updatedContents[cleanPath] = content.replace(beforeSnippet, neutralizedSnippet);
          replacementsApplied++;
          if (!filesModified.includes(cleanPath)) filesModified.push(cleanPath);
          codeChanges.push({
            filePath: cleanPath,
            description: `Inventory fallback: neutralized ${record.classification}`,
            beforeSnippet,
            afterSnippet: neutralizedSnippet,
          });
        }
      }
    }
  }

  // 3. Generate scripts/page-content.js for Workday Inline Page Mode
  const pageMapResult = generateWorkdayPageContentMap(updatedContents);
  if (pageMapResult.pageCount > 0) {
    const pageContentPath = 'scripts/page-content.js';
    updatedContents[pageContentPath] = pageMapResult.code;
    if (!filesModified.includes(pageContentPath)) {
      filesModified.push(pageContentPath);
    }
    replacementsAttempted++;
    replacementsApplied++;
    codeChanges.push({
      filePath: pageContentPath,
      description: `Generated Workday inline page content map (${pageMapResult.pageCount} page(s) bundled: ${pageMapResult.pageIds.join(', ')})`,
      beforeSnippet: '/* Not present in original package */',
      afterSnippet: pageMapResult.code.slice(0, 300),
    });
    logs.push(`WORKDAY INLINE PAGE COMPATIBILITY: Generated ${pageContentPath} bundling ${pageMapResult.pageCount} page(s)`);
    if (pageMapResult.unsafeScriptsDetected) {
      logs.push(`WARNING: Unsafe inline scripts detected in pages: ${pageMapResult.unsafeScriptDetails}`);
    }
  }

  // 3b. Ensure generated page-content.js is declared in the active SCORM resource.
  if (pageMapResult.pageCount > 0 && updatedContents['imsmanifest.xml']) {
    const originalManifest = updatedContents['imsmanifest.xml'];
    const manifestResult = ensurePageContentManifestEntry(originalManifest);
    if (manifestResult.modified) {
      updatedContents['imsmanifest.xml'] = manifestResult.xml;
      if (!filesModified.includes('imsmanifest.xml')) filesModified.push('imsmanifest.xml');
      replacementsAttempted++;
      replacementsApplied++;
      codeChanges.push({
        filePath: 'imsmanifest.xml',
        description: 'Added scripts/page-content.js to the SCORM resource file list',
        beforeSnippet: originalManifest.slice(0, 300),
        afterSnippet: manifestResult.xml.slice(0, 300),
      });
      logs.push('Added scripts/page-content.js to imsmanifest.xml resource dependencies');
    }
  }

  // 4. Update index.html for script include and Save & Exit control
  const htmlFile = Object.keys(updatedContents).find(f => f.toLowerCase() === 'index.html' || f.toLowerCase().endsWith('/index.html'));
  if (htmlFile && updatedContents[htmlFile]) {
    let indexHtml = updatedContents[htmlFile];
    let indexModified = false;
    const origIndexHtml = indexHtml;

    // Inject scripts/page-content.js script include if missing
    if (pageMapResult.pageCount > 0 && !indexHtml.includes('scripts/page-content.js')) {
      if (indexHtml.includes('scripts/navigation.js')) {
        indexHtml = indexHtml.replace(
          /(<script\b[^>]*src=['"]scripts\/navigation\.js['"][^>]*><\/script>)/i,
          `<script src="scripts/page-content.js"></script>\n  $1`
        );
        indexModified = true;
      } else if (indexHtml.includes('</head>')) {
        indexHtml = indexHtml.replace('</head>', `  <script src="scripts/page-content.js"></script>\n</head>`);
        indexModified = true;
      } else if (indexHtml.includes('</body>')) {
        indexHtml = indexHtml.replace('</body>', `  <script src="scripts/page-content.js"></script>\n</body>`);
        indexModified = true;
      }
    }

    // Workday Learner-UX Normalization: Responsive viewport meta tag
    if (!indexHtml.includes('name="viewport"') && !indexHtml.includes("name='viewport'")) {
      if (indexHtml.includes('</head>')) {
        indexHtml = indexHtml.replace('</head>', `  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>`);
        indexModified = true;
      }
    }

    // Workday Learner-UX Normalization: Persistent header Exit/Save control visible across 1400px, 1200px, 1024px, and 900px
    const responsiveStyles = `  <style id="workday-learner-ux-styles">
    header, .scorm-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      box-sizing: border-box !important;
      min-width: 100% !important;
      padding: 10px 20px !important;
    }
    #btn-save-exit, .scorm-header-save-exit {
      display: inline-flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      flex-shrink: 0 !important;
      white-space: nowrap !important;
      cursor: pointer !important;
      margin-left: auto !important;
    }
    @media (max-width: 1400px) { #btn-save-exit, .scorm-header-save-exit { display: inline-flex !important; visibility: visible !important; } }
    @media (max-width: 1200px) { #btn-save-exit, .scorm-header-save-exit { display: inline-flex !important; visibility: visible !important; } }
    @media (max-width: 1024px) { #btn-save-exit, .scorm-header-save-exit { display: inline-flex !important; visibility: visible !important; } }
    @media (max-width: 900px) { #btn-save-exit, .scorm-header-save-exit { display: inline-flex !important; visibility: visible !important; } }
  </style>`;

    if (!indexHtml.includes('workday-learner-ux-styles')) {
      if (indexHtml.includes('</head>')) {
        indexHtml = indexHtml.replace('</head>', `${responsiveStyles}\n</head>`);
        indexModified = true;
      } else if (indexHtml.includes('<body>')) {
        indexHtml = indexHtml.replace('<body>', `<body>\n${responsiveStyles}`);
        indexModified = true;
      }
    }

    // Workday Learner-UX Normalization: Ensure responsive header container exists
    if (!/<header\b|<div\b[^>]*class=['"][^'"]*header/i.test(indexHtml)) {
      if (indexHtml.includes('<body>')) {
        indexHtml = indexHtml.replace('<body>', `<body>\n  <header class="scorm-header"></header>`);
        indexModified = true;
      }
    }

    // Inject Save & Exit shell button into header if missing
    if (!/<button\b[^>]*id=['"]btn-save-exit['"]/i.test(indexHtml) && !/<button\b[^>]*class=['"][^'"]*scorm-header-save-exit/i.test(indexHtml)) {
      const saveExitBtnHtml = `\n    <button id="btn-save-exit" class="scorm-header-save-exit" type="button" onclick="if(typeof saveAndExitCourse==='function'){saveAndExitCourse();}" style="padding:7px 16px;border-radius:6px;background:#1e293b;color:#ffffff;font-size:12px;font-weight:600;border:1px solid #475569;cursor:pointer;margin-left:auto;white-space:nowrap;display:inline-flex;align-items:center;flex-shrink:0;visibility:visible;">Save &amp; Exit</button>`;
      if (indexHtml.includes('</header>')) {
        indexHtml = indexHtml.replace('</header>', `${saveExitBtnHtml}\n  </header>`);
        indexModified = true;
      } else if (indexHtml.includes('</nav>')) {
        indexHtml = indexHtml.replace('</nav>', `${saveExitBtnHtml}\n  </nav>`);
        indexModified = true;
      } else if (indexHtml.includes('<body>')) {
        indexHtml = indexHtml.replace('<body>', `<body>\n  <header class="scorm-header">${saveExitBtnHtml}\n  </header>`);
        indexModified = true;
      }
    }

    if (indexModified && indexHtml !== origIndexHtml) {
      updatedContents[htmlFile] = indexHtml;
      if (!filesModified.includes(htmlFile)) {
        filesModified.push(htmlFile);
      }
      replacementsAttempted++;
      replacementsApplied++;
      codeChanges.push({
        filePath: htmlFile,
        description: 'Injected scripts/page-content.js script include and Save & Exit shell button',
        beforeSnippet: origIndexHtml.slice(0, 300),
        afterSnippet: indexHtml.slice(0, 300),
      });
      logs.push(`Updated ${htmlFile} with script include and Save & Exit button`);
    }
  }

  // Record Stage D snapshot after inline-page compatibility transformation
  const navCodeAfterInline = updatedContents[primaryNavPath] || '';
  if (navCodeAfterInline) {
    const snapD = getTraceSnapshot(navCodeAfterInline);
    logs.push(`[STAGE D] After inline-page compatibility on ${primaryNavPath} (hash: ${snapD.hash}, snippet: "${snapD.snippet}")`);
    console.log(`[STAGE D] After inline-page compatibility on ${primaryNavPath}:`, snapD);
  }

  // =========================================================================
  // STEP 4b: APPLY FINAL COMPACT COMPLETION NORMALIZATION (Mandatory Final Pass)
  // Regardless of internal transformation order, the Stateful Compact profile must
  // run the approved Compact completion normalization against the FINAL transformed
  // navigation.js.
  // =========================================================================
  for (const filePath of Object.keys(updatedContents)) {
    if (filePath.toLowerCase().includes('nav') || (filePath.endsWith('.js') && !filePath.toLowerCase().includes('scorm-api') && !filePath.toLowerCase().includes('page-content'))) {
      const currentCode = updatedContents[filePath];
      if (!currentCode) continue;

      const normResult = normalizeFinalNextPageCompletion(currentCode);
      const finResult = repairCompactFinishCompletion(normResult.code);
      const finalCode = finResult.code;

      if (finalCode !== currentCode) {
        updatedContents[filePath] = finalCode;
        if (!filesModified.includes(filePath)) {
          filesModified.push(filePath);
        }
        replacementsAttempted++;
        replacementsApplied++;
        for (const desc of [...normResult.changes, ...finResult.changes]) {
          codeChanges.push({
            filePath,
            description: desc,
            beforeSnippet: currentCode.slice(0, 300),
            afterSnippet: finalCode.slice(0, 300),
          });
        }
        logs.push(`[FINAL NORMALIZATION] Applied final completion normalization to ${filePath}`);
      }
    }
  }

  // Record Stage E snapshot: FINAL navigation.js immediately before ZIP packaging
  const finalNavCode = updatedContents[primaryNavPath] || '';
  if (finalNavCode) {
    const snapE = getTraceSnapshot(finalNavCode);
    logs.push(`[STAGE E] FINAL ${primaryNavPath} immediately before packaging (hash: ${snapE.hash}, snippet: "${snapE.snippet}")`);
    console.log(`[STAGE E] FINAL ${primaryNavPath} immediately before packaging:`, snapE);
  }

  const modifiedTextDiffers = filesModified.some(f => updatedContents[f] !== fileContents[f]);
  logs.push(`Patch function completed: ${filesModified.length} file(s) modified: ${filesModified.join(', ') || 'NONE'}`);

  let zeroModifiedExplanation: string | undefined;
  if (filesModified.length === 0) {
    zeroModifiedExplanation = 'PATCH NOT APPLIED — EXPECTED DEFECT PATTERN NOT MODIFIED: Target defect patterns were not matched in opened candidate scripts.';
    logs.push(zeroModifiedExplanation);
  }

  return {
    updatedContents,
    filesModified,
    codeChanges,
    executionReport: {
      repairProfileSelected: profileSelected,
      patchFunctionInvoked: functionInvoked,
      candidateInternalFiles: candidateFiles,
      filesOpenedForModification: openedFiles,
      patternsSearchedCount: patternsSearched,
      patternsMatchedCount: patternsMatched,
      replacementsAttemptedCount: replacementsAttempted,
      replacementsSuccessfullyAppliedCount: replacementsApplied,
      exactFilesModified: filesModified,
      modifiedTextDiffers,
      zeroModifiedExplanation,
      patternAudits: audits,
      logs,
    },
  };
}

/**
 * Universal dispatcher for SCORM 1.2 remediation:
 * Selects profile-specific patch function deterministically.
 */
export function patchScorm12Package(
  pkg: PackageInspectionResult,
  fileContents: { [filePath: string]: string },
  candidateFiles?: string[]
): PatchResult {
  const actualCandidates = candidateFiles && candidateFiles.length > 0
    ? candidateFiles
    : Object.keys(fileContents).filter(f => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.htm'));

  if (pkg.repairProfile === 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1') {
    return patchUniversalScorm12Package(fileContents, actualCandidates, pkg);
  } else if (pkg.repairProfile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {
    return patchStatefulCompactWorkdayPackage(fileContents, actualCandidates, pkg);
  } else if (pkg.repairProfile === 'KNOWN_SCORM12_COMPACT_QUIZ_80_V1') {
    return patchCompactScorm12Package(fileContents, actualCandidates, pkg);
  }

  // Fallback default (Compact)
  return patchCompactScorm12Package(fileContents, actualCandidates, pkg);
}
