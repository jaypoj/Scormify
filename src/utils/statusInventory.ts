import { StatusWriteRecord, StatusWriteClassification, DefectItem, StatefulWorkdayFindings } from '../types';

export interface FileContentMap {
  [fileName: string]: string;
}

export interface DefectAnalysisResult {
  inventory: StatusWriteRecord[];
  progressDefect: DefectItem;
  finishDefect: DefectItem;
  relaunchDefect: DefectItem;
  exitDefect: DefectItem;
}

/**
 * Finds the enclosing function name around a character index in a file.
 */
function findEnclosingFunction(content: string, index: number): string | undefined {
  const lookback = content.slice(Math.max(0, index - 1000), index);
  const matches = Array.from(
    lookback.matchAll(
      /(?:function\s+([a-zA-Z0-9_$]+)|([a-zA-Z0-9_$]+)\s*:\s*function|([a-zA-Z0-9_$]+)\s*=\s*(?:function|\([^)]*\)\s*=>)|async\s+function\s+([a-zA-Z0-9_$]+)|([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{)/g
    )
  );

  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    return last[1] || last[2] || last[3] || last[4] || last[5];
  }
  return undefined;
}

/**
 * Finds the enclosing event handler around a character index in a file.
 */
function findEnclosingEventHandler(content: string, index: number): string | undefined {
  const lookback = content.slice(Math.max(0, index - 800), index);

  const eventPatterns = [
    /addEventListener\s*\(\s*['"](beforeunload|unload|pagehide|load|DOMContentLoaded|click)['"]/i,
    /\.(onbeforeunload|onunload|onload|onclick)\s*=/i,
    /window\.(beforeunload|unload|pagehide|load)/i,
  ];

  for (const pat of eventPatterns) {
    const m = lookback.match(pat);
    if (m) return m[1];
  }
  return undefined;
}

function extractContextSnippet(content: string, startIdx: number, endIdx: number): string {
  const start = Math.max(0, startIdx - 150);
  const end = Math.min(content.length, endIdx + 150);
  return content.slice(start, end).trim();
}

function getLineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

export function analyzeStatusWritesAndDefects(fileContents: FileContentMap): DefectAnalysisResult {
  const inventory: StatusWriteRecord[] = [];
  const progressDefect: DefectItem = { detected: false };
  const finishDefect: DefectItem = { detected: false };
  const relaunchDefect: DefectItem = { detected: false };
  const exitDefect: DefectItem = { detected: false };
  const statusFieldRegex = /(?:cmi\.core\.lesson_status|cmi\.completion_status|cmi\.success_status)/g;

  for (const [filePath, content] of Object.entries(fileContents)) {
    if (!content) continue;
    const lowerPath = filePath.toLowerCase();
    const isCode = lowerPath.endsWith('.js') || lowerPath.endsWith('.html') || lowerPath.endsWith('.htm');
    if (!isCode) continue;

    let fieldMatch: RegExpExecArray | null;
    statusFieldRegex.lastIndex = 0;

    while ((fieldMatch = statusFieldRegex.exec(content)) !== null) {
      const matchIndex = fieldMatch.index;
      const cmiField = fieldMatch[0];
      const stmtStart = Math.max(0, matchIndex - 200);
      const stmtEnd = Math.min(content.length, matchIndex + 300);
      const stmtWindow = content.slice(stmtStart, stmtEnd);
      const relIdx = matchIndex - stmtStart;
      const beforeWindow = stmtWindow.slice(0, relIdx);
      const isWriteCall =
        /(?:\.set|\.setValue|LMSSetValue|SetValue|setStatus)\s*\(\s*['"]?$/i.test(beforeWindow.trimEnd()) ||
        /(?:\.set|\.setValue|LMSSetValue|SetValue|setStatus)\s*\(\s*['"][^'"]*$/i.test(beforeWindow);

      if (!isWriteCall) continue;

      const afterWindow = stmtWindow.slice(relIdx + cmiField.length);
      const valMatch = afterWindow.match(/^\s*['"]?\s*,\s*([^);,\n]+)/);
      let rawValue = valMatch ? valMatch[1].trim() : 'unknown';
      let valueWritten = rawValue;
      let isLiteral = false;
      const literalMatch = rawValue.match(/^['"]([a-zA-Z0-9_\s]+)['"]/);
      if (literalMatch) {
        valueWritten = literalMatch[1];
        isLiteral = true;
      }

      const lineNumber = getLineNumber(content, matchIndex);
      const enclosingFunction = findEnclosingFunction(content, matchIndex);
      const enclosingEventHandler = findEnclosingEventHandler(content, matchIndex);
      const contextSnippet = extractContextSnippet(content, stmtStart, stmtEnd);
      let guardOrCondition: string | undefined;
      const nearbyLookback = content.slice(Math.max(0, matchIndex - 350), matchIndex);
      const ifMatch = nearbyLookback.match(/if\s*\(([^)]+)\)\s*\{?[^}]*$/);
      if (ifMatch) guardOrCondition = ifMatch[1].trim();
      else if (rawValue.includes('?')) guardOrCondition = 'ternary: ' + rawValue.split('?')[0].trim();

      let classification: StatusWriteClassification = 'BENIGN / NORMAL WRITE';
      const isExitContext =
        enclosingEventHandler === 'beforeunload' ||
        enclosingEventHandler === 'unload' ||
        enclosingEventHandler === 'pagehide' ||
        (enclosingFunction && /^(?:beforeunload|onUnload|exit|terminate|finishSession)/i.test(enclosingFunction)) ||
        /window\.addEventListener\s*\(\s*['"](?:beforeunload|unload|pagehide)['"]/i.test(contextSnippet);

      const writesCompleted = valueWritten === 'completed' || (rawValue.includes('completed') && !rawValue.includes('failed'));

      if (isExitContext && writesCompleted) {
        const hasQuizGuard =
          contextSnippet.includes('checkAssessmentPassed') ||
          contextSnippet.includes('isPassed') ||
          contextSnippet.includes('passed');
        if (!hasQuizGuard) {
          classification = 'INVALID EXIT COMPLETION';
          exitDefect.detected = true;
          exitDefect.filePath = filePath;
          exitDefect.snippet = contextSnippet;
          exitDefect.details = `Unconditional course completion write during ${enclosingEventHandler || 'unload/exit'} event handler`;
        }
      }

      const isInitContext =
        enclosingEventHandler === 'load' ||
        enclosingEventHandler === 'DOMContentLoaded' ||
        (enclosingFunction && /^(?:init|initialize|onLoad|startCourse)/i.test(enclosingFunction)) ||
        /init\s*:\s*function/i.test(nearbyLookback) ||
        /\b(?:SCORM\.init|SafeSCORM\.init|UniversalSCORM\.init)\b/i.test(nearbyLookback);

      const writesIncomplete = valueWritten === 'incomplete';
      if (isInitContext && writesIncomplete) {
        const hasStatusCheck =
          content.includes("SCORM.get('cmi.core.lesson_status')") ||
          content.includes('SCORM.get("cmi.core.lesson_status")') ||
          content.includes("this.get('cmi.core.lesson_status')") ||
          content.includes('this.get("cmi.core.lesson_status")') ||
          content.includes('LMSGetValue("cmi.core.lesson_status")') ||
          content.includes("LMSGetValue('cmi.core.lesson_status')") ||
          content.includes("getValue('cmi.core.lesson_status')") ||
          content.includes('getValue("cmi.core.lesson_status")') ||
          content.includes('priorStatus') ||
          content.includes('_priorStatus') ||
          (nearbyLookback.includes('lesson_status') && (nearbyLookback.includes('not attempted') || nearbyLookback.includes('empty')));

        if (!hasStatusCheck) {
          classification = 'INVALID RELAUNCH RESET';
          relaunchDefect.detected = true;
          relaunchDefect.filePath = filePath;
          relaunchDefect.snippet = contextSnippet;
          relaunchDefect.details = 'Initialization unconditionally resets lesson_status to "incomplete" without preserving existing status';
        }
      }

      const isPassGated =
        (guardOrCondition && (
          guardOrCondition.includes('checkCompletionCriteria') ||
          guardOrCondition.includes('isComplete') ||
          guardOrCondition.includes('checkAssessmentPassed') ||
          guardOrCondition.includes('isPassed') ||
          guardOrCondition.includes('assessmentPassed')
        )) ||
        (content.includes('checkCompletionCriteria') && content.includes('checkAssessmentPassed'));

      if (writesCompleted && isPassGated && !isExitContext) {
        classification = 'CONDITIONAL COMPLETION — PASS-GATED';
        if (!progressDefect.detected) {
          progressDefect.isPassGated = true;
          progressDefect.filePath = filePath;
          progressDefect.snippet = contextSnippet;
          progressDefect.details = 'Course completion is conditionally pass-gated behind checkAssessmentPassed (score >= passMark)';
        }
      } else if (writesCompleted && !isExitContext) {
        const isNavigationOrFinish =
          (enclosingFunction && /^(?:nextPage|finish|finishCourse|onFinish|completeCourse|handleFinish)/i.test(enclosingFunction)) ||
          /nextPage|finishBtn|#finish/i.test(contextSnippet) ||
          /(?:last page|page progress|progress >= 100|visitedPages)/i.test(contextSnippet);
        const isProgressWrite =
          rawValue.includes('progress >= 100') ||
          (guardOrCondition && guardOrCondition.includes('progress')) ||
          contextSnippet.includes('progress >= 100') ||
          contextSnippet.includes('visitedPages');

        if (isProgressWrite) {
          classification = 'INVALID PROGRESS COMPLETION';
          progressDefect.detected = true;
          progressDefect.filePath = filePath;
          progressDefect.snippet = contextSnippet;
          progressDefect.details = 'Page visitation or progress calculation sets cmi.core.lesson_status = "completed" before quiz evaluation';
        } else if (isNavigationOrFinish) {
          classification = 'INVALID FINISH COMPLETION';
          finishDefect.detected = true;
          finishDefect.filePath = filePath;
          finishDefect.snippet = contextSnippet;
          finishDefect.details = `Final navigation action (${enclosingFunction || 'finish'}) sets cmi.core.lesson_status = "completed" without verifying quiz pass`;
        }
      } else if (valueWritten === 'passed' || valueWritten === 'failed') {
        classification = 'VALID ASSESSMENT STATUS';
      }

      inventory.push({
        id: `${filePath}-${lineNumber}-${matchIndex}`,
        filePath,
        lineNumber,
        enclosingFunction,
        enclosingEventHandler,
        cmiField,
        valueWritten,
        isLiteral,
        guardOrCondition,
        contextSnippet,
        classification,
      });
    }

    const setStatusRegex = /SafeSCORM\.setStatus\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let setStatusMatch: RegExpExecArray | null;
    while ((setStatusMatch = setStatusRegex.exec(content)) !== null) {
      const matchIndex = setStatusMatch.index;
      const val = setStatusMatch[1];
      const lineNumber = getLineNumber(content, matchIndex);
      const enclosingFunction = findEnclosingFunction(content, matchIndex);
      const enclosingEventHandler = findEnclosingEventHandler(content, matchIndex);
      const contextSnippet = extractContextSnippet(content, matchIndex - 50, matchIndex + 100);
      const isExit =
        enclosingEventHandler === 'beforeunload' ||
        enclosingEventHandler === 'unload' ||
        contextSnippet.includes('beforeunload');

      let classification: StatusWriteClassification = 'BENIGN / NORMAL WRITE';
      if (val === 'completed' && isExit) {
        classification = 'INVALID EXIT COMPLETION';
        exitDefect.detected = true;
        exitDefect.filePath = filePath;
        exitDefect.snippet = contextSnippet;
        exitDefect.details = 'SafeSCORM.setStatus("completed") in exit/beforeunload handler';
      } else if (val === 'completed') {
        classification = 'INVALID FINISH COMPLETION';
      }

      inventory.push({
        id: `${filePath}-${lineNumber}-${matchIndex}-setStatus`,
        filePath,
        lineNumber,
        enclosingFunction,
        enclosingEventHandler,
        cmiField: 'cmi.core.lesson_status (via SafeSCORM.setStatus)',
        valueWritten: val,
        isLiteral: true,
        guardOrCondition: undefined,
        contextSnippet,
        classification,
      });
    }
  }

  return { inventory, progressDefect, finishDefect, relaunchDefect, exitDefect };
}

/**
 * Analyzes codebase for Stateful Compact Workday profile findings and defect signatures.
 */
export function analyzeStatefulWorkdayFindings(fileContents: FileContentMap): StatefulWorkdayFindings | undefined {
  // UniversalSCORM/SafeSCORM packages are a separate supported family and must not be
  // subjected to Stateful Compact-specific post-validation blockers.
  const combinedSource = Object.values(fileContents).join('\n');
  const isUniversalRuntime =
    combinedSource.includes('UniversalSCORM') &&
    combinedSource.includes('SafeSCORM') &&
    combinedSource.includes('COURSE_SETTINGS');
  if (isUniversalRuntime) return undefined;

  let isStatefulArchitecture = false;
  let hasGlobalStorageKey = false;
  let isStorageNamespaced = false;
  let hasStaleStateRisk = false;
  let hasProgress100Risk = false;
  let hasProgressProtected = false;
  let hasPassDowngradeRisk = false;
  let hasBestScorePreserved = false;
  let hasFailedQuizModal = false;
  let hasSaveAndExit = false;
  let hasDynamicFetch = false;
  let hasInlinePageContent = false;

  for (const [filePath, content] of Object.entries(fileContents)) {
    if (!content) continue;

    if (content.includes('scormArchitectProgress') || content.includes('STORAGE_KEY')) {
      isStatefulArchitecture = true;
      if (
        content.includes('scormArchitectProgress::') ||
        content.includes('scormArchitectProgress:') ||
        (content.includes('STORAGE_KEY') && content.includes('COURSE_IDENTIFIER'))
      ) {
        isStorageNamespaced = true;
      } else if (content.includes('scormArchitectProgress')) {
        hasGlobalStorageKey = true;
      }
    }

    if (content.includes('fromScorm') && content.includes('fromLocal')) {
      isStatefulArchitecture = true;
      if (!(content.includes('isLmsAvailable') && (content.includes('resume') || content.includes('ab-initio')))) {
        hasStaleStateRisk = true;
      }
    }

    if (
      (content.includes('visited.size') || content.includes('visited.length') || content.includes('visited')) &&
      content.includes('PAGES.length')
    ) {
      isStatefulArchitecture = true;
      if (content.includes('validPageIds') && content.includes('Math.min(100')) {
        hasProgressProtected = true;
      } else if (!content.includes('validPageIds')) {
        hasProgress100Risk = true;
      }
    }

    if (
      content.includes('submitQuiz') ||
      content.includes('onQuizSubmit') ||
      content.includes('checkScore') ||
      ((content.includes('cmi.core.score.raw') || content.includes('score')) && content.includes('cmi.core.lesson_status'))
    ) {
      if (content.includes("priorStatus === 'passed'") || content.includes('bestScore') || content.includes('Math.max(priorScore')) {
        hasBestScorePreserved = true;
      } else if (
        content.includes("passed ? 'passed' : 'failed'") ||
        content.includes('score >= 80') ||
        content.includes('lesson_status')
      ) {
        if (!content.includes('priorStatus')) hasPassDowngradeRisk = true;
      }
    }

    if (
      content.includes('scorm-assessment-modal') ||
      (content.includes('Assessment Not Passed') && content.includes('TRY AGAIN') && content.includes('SAVE & EXIT')) ||
      (content.includes('showAssessmentModal') && content.includes('TRY AGAIN'))
    ) {
      hasFailedQuizModal = true;
    }

    if (
      content.includes('saveAndExitCourse') ||
      content.includes('btn-save-exit') ||
      (content.includes('cmi.core.exit') && content.includes('suspend') && content.includes('LMSCommit') && content.includes('LMSFinish'))
    ) {
      hasSaveAndExit = true;
    }

    if (
      content.includes("fetch('pages/") ||
      content.includes('fetch("pages/') ||
      content.includes('fetch(`pages/') ||
      content.includes("fetch('pages/'") ||
      content.includes('fetch("pages/"')
    ) {
      hasDynamicFetch = true;
      isStatefulArchitecture = true;
    }

    if (content.includes('SCORM_PAGE_CONTENT') || content.includes('window.SCORM_PAGE_CONTENT')) {
      hasInlinePageContent = true;
    }
  }

  if (!isStatefulArchitecture && !hasDynamicFetch && !hasGlobalStorageKey) return undefined;

  const globalStorageKey = isStorageNamespaced ? 'NAMESPACED / SAFE' : (hasGlobalStorageKey ? 'DETECTED' : 'NOT_DETECTED');
  const stalePageStateRisk = hasStaleStateRisk ? 'DETECTED' : 'SAFE / ISOLATED';
  const progressExceed100Risk = hasProgress100Risk ? 'DETECTED' : 'PROTECTED (0-100%)';
  const passDowngradeRisk = (hasPassDowngradeRisk && !hasBestScorePreserved) ? 'DETECTED' : 'PRESERVED';
  const failedQuizExitUx = hasFailedQuizModal ? 'PRESENT' : 'MISSING';
  const saveAndExit = hasSaveAndExit ? 'PRESENT' : 'MISSING';
  const dynamicPageFetch = hasInlinePageContent ? 'INLINED' : (hasDynamicFetch ? 'DETECTED' : 'NOT_DETECTED');
  const inlinePageCompatibility = hasInlinePageContent ? 'APPLIED' : 'AVAILABLE';

  return {
    globalStorageKey,
    stalePageStateRisk,
    progressExceed100Risk,
    passDowngradeRisk,
    failedQuizExitUx,
    saveAndExit,
    dynamicPageFetch,
    inlinePageCompatibility,
  };
}
