/**
 * Deterministic code transformers for SCORM 1.2 remediation profiles.
 * Implements token/brace-aware block parsing to replace multi-brace regex patterns.
 */

import { findBalancedBlock, findEventListeners, findFunctionBlock } from './braceScanner';
import { hardenStatefulRuntimeCode } from './issue1StatefulRuntime';

export interface TransformResult {
  code: string;
  modified: boolean;
  changes: string[];
  audits: Array<{
    patternExpected: string;
    matchFound: boolean;
    replacementApplied: boolean;
    reason?: string;
  }>;
}

/**
 * Computes a short deterministic hash and code snippet for pipeline tracing.
 */
export function getTraceSnapshot(code: string): { hash: string; snippet: string } {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const hash = (h >>> 0).toString(16).padStart(8, '0');

  // Extract nextPage or finish block snippet, or first 120 chars
  const nextPagePattern = /(?:(?:var|let|const)\s+nextPage\s*=\s*function|function\s+nextPage|nextPage\s*:\s*function|nextPage\s*\([^)]*\)\s*\{)/i;
  const match = findFunctionBlock(code, nextPagePattern);
  let snippet = '';
  if (match) {
    const compactBody = match.block.body.replace(/\s+/g, ' ').trim();
    snippet = `nextPage(){ ${compactBody.slice(0, 100)}${compactBody.length > 100 ? '...' : ''} }`;
  } else {
    snippet = code.replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  return { hash, snippet };
}

/**
 * Deterministic Final-Pass Completion Normalization for nextPage() and Finish Handlers:
 * Structurally scans and normalizes nextPage() and finish handlers so that:
 * 1. The final-page branch NEVER writes cmi.core.lesson_status = 'completed'.
 * 2. Unconditional showAlert('Course complete') is replaced with conditional check requiring 'passed'.
 * 3. Neutralizes any remaining global unconditional completed overrides.
 */
export function normalizeFinalNextPageCompletion(originalCode: string): TransformResult {
  let code = originalCode;
  let modified = false;
  const changes: string[] = [];
  const audits: TransformResult['audits'] = [];

  // 1. STRUCTURAL nextPage() TRANSFORMATION
  const nextPagePattern = /(?:(?:var|let|const)\s+nextPage\s*=\s*function|function\s+nextPage|nextPage\s*:\s*function|nextPage\s*\([^)]*\)\s*\{)/i;
  const nextPageBlock = findFunctionBlock(code, nextPagePattern);

  if (nextPageBlock) {
    const body = nextPageBlock.block.body;
    let newBody = body;
    let nextPageModified = false;

    // Check if body follows the compact navigation pattern: if(current < PAGES.length - 1) ...
    const hasCurrentPagesBranch = /if\s*\(\s*current\s*<\s*PAGES\.length\s*-\s*1\s*\)/i.test(body);
    const hasCurrentPageTotalBranch = /if\s*\(\s*currentPage\s*<\s*totalPages\s*\)/i.test(body);

    if (hasCurrentPagesBranch) {
      // Approved canonical Workday Compact nextPage implementation
      newBody = `
    if (current < PAGES.length - 1) {
        loadPage(current + 1);
        return;
    }

    var status = '';
    if (typeof SCORM !== 'undefined' && SCORM.get) {
        status = SCORM.get('cmi.core.lesson_status') || '';
    } else if (typeof window !== 'undefined' && window.SCORM && window.SCORM.get) {
        status = window.SCORM.get('cmi.core.lesson_status') || '';
    }

    if (status === 'passed') {
        showAlert('Course complete');
    } else {
        showAlert('A score of 80% or higher is required to complete this course.');
    }
`;
      nextPageModified = true;
      changes.push('Canonical rewrite: nextPage() final-page branch conditionally checks status without writing completed');
      audits.push({
        patternExpected: 'nextPage compact navigation structure',
        matchFound: true,
        replacementApplied: true,
      });
    } else if (hasCurrentPageTotalBranch) {
      newBody = `
    if (currentPage < totalPages) {
        currentPage++;
        if (typeof updateProgress === 'function') {
            updateProgress(Math.round((currentPage / totalPages) * 100));
        }
        return;
    }

    var status = '';
    if (typeof SCORM !== 'undefined' && SCORM.get) {
        status = SCORM.get('cmi.core.lesson_status') || '';
    } else if (typeof window !== 'undefined' && window.SCORM && window.SCORM.get) {
        status = window.SCORM.get('cmi.core.lesson_status') || '';
    }

    if (status === 'passed') {
        showAlert('Course complete');
    } else {
        showAlert('A score of 80% or higher is required to complete this course.');
    }
`;
      nextPageModified = true;
      changes.push('Canonical rewrite: nextPage() (currentPage < totalPages) conditionally checks status without writing completed');
      audits.push({
        patternExpected: 'nextPage (currentPage < totalPages) structure',
        matchFound: true,
        replacementApplied: true,
      });
    } else {
      // General nextPage handler: remove any cmi.core.lesson_status = completed write
      const setCompletedRegex = /(?:(?:window\.)?(?:SCORM|SafeSCORM|this|API)\.)?(?:set|setValue|LMSSetValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?/gi;
      if (setCompletedRegex.test(newBody)) {
        newBody = newBody.replace(
          setCompletedRegex,
          `/* SCORM remediation: final-page navigation does not write completed status */`
        );
        nextPageModified = true;
        changes.push('Removed completed status write from nextPage');
        audits.push({
          patternExpected: "nextPage: set('cmi.core.lesson_status', 'completed')",
          matchFound: true,
          replacementApplied: true,
        });
      }

      // Rewrite any unconditional showAlert / alert 'Course complete'
      const alertRegex = /(showAlert|alert)\s*\(\s*(['"])Course complete(?:d)?(?:!)?\2\s*\)/gi;
      if (alertRegex.test(newBody)) {
        const condAlert = `((typeof SCORM !== 'undefined' && SCORM.get ? SCORM.get('cmi.core.lesson_status') : ((typeof window !== 'undefined' && window.SCORM && window.SCORM.get) ? window.SCORM.get('cmi.core.lesson_status') : '')) === 'passed' ? 'Course complete' : 'A score of 80% or higher is required to complete this course.')`;
        newBody = newBody.replace(alertRegex, `$1(${condAlert})`);
        nextPageModified = true;
        changes.push('Updated nextPage Finish message to conditionally check passed status');
        audits.push({
          patternExpected: 'nextPage unconditional Course complete alert',
          matchFound: true,
          replacementApplied: true,
        });
      }
    }

    if (nextPageModified) {
      code = code.slice(0, nextPageBlock.block.contentStart) + newBody + code.slice(nextPageBlock.block.contentEnd);
      modified = true;
    }
  }

  // 2. STRUCTURAL finish / onFinish TRANSFORMATION
  const finishPattern = /(?:(?:var|let|const)\s+(?:finish|onFinish|finishCourse|handleFinish|completeCourse)\s*=\s*function|function\s+(?:finish|onFinish|finishCourse|handleFinish|completeCourse)|(?:finish|onFinish)\s*:\s*function)\s*\([^)]*\)\s*\{/i;
  const finishBlock = findFunctionBlock(code, finishPattern);
  if (finishBlock) {
    let newFinishBody = finishBlock.block.body;
    let finishModified = false;

    const setCompletedRegex = /(?:(?:window\.)?(?:SCORM|SafeSCORM|this|API)\.)?(?:set|setValue|LMSSetValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?/gi;
    if (setCompletedRegex.test(newFinishBody)) {
      newFinishBody = newFinishBody.replace(
        setCompletedRegex,
        `/* SCORM remediation: Finish handler does not write or alter LMS status */`
      );
      finishModified = true;
      changes.push('Removed completed status write from finish handler');
      audits.push({
        patternExpected: "Finish handler: set('cmi.core.lesson_status', 'completed')",
        matchFound: true,
        replacementApplied: true,
      });
    }

    const alertRegex = /(showAlert|alert)\s*\(\s*(['"])Course complete(?:d)?(?:!)?\2\s*\)/gi;
    if (alertRegex.test(newFinishBody)) {
      const condAlert = `((typeof SCORM !== 'undefined' && SCORM.get ? SCORM.get('cmi.core.lesson_status') : ((typeof window !== 'undefined' && window.SCORM && window.SCORM.get) ? window.SCORM.get('cmi.core.lesson_status') : '')) === 'passed' ? 'Course complete' : 'A score of 80% or higher is required to complete this course.')`;
      newFinishBody = newFinishBody.replace(alertRegex, `$1(${condAlert})`);
      finishModified = true;
      changes.push('Updated Finish handler message to conditionally check passed status');
      audits.push({
        patternExpected: 'Finish handler unconditional Course complete alert',
        matchFound: true,
        replacementApplied: true,
      });
    }

    if (finishModified) {
      code = code.slice(0, finishBlock.block.contentStart) + newFinishBody + code.slice(finishBlock.block.contentEnd);
      modified = true;
    }
  }

  // 3. FILE-WIDE SCAN FOR ANY REMAINING UNCONDITIONAL COMPLETED STATUS OVERRIDES
  const globalCompletedRegex = /(?:(?:window\.)?(?:SCORM|SafeSCORM|this|API)\.)?(?:set|setValue|LMSSetValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?/gi;
  if (globalCompletedRegex.test(code)) {
    code = code.replace(
      globalCompletedRegex,
      `/* SCORM remediation: neutralized completed override */`
    );
    modified = true;
    changes.push('Neutralized remaining global completed lesson_status override');
    audits.push({
      patternExpected: "Global set('cmi.core.lesson_status', 'completed')",
      matchFound: true,
      replacementApplied: true,
    });
  }

  // 4. FILE-WIDE SCAN FOR UNCONDITIONAL Course complete ALERT
  const globalAlertRegex = /(showAlert|alert)\s*\(\s*(['"])Course complete(?:d)?(?:!)?\2\s*\)/gi;
  if (globalAlertRegex.test(code)) {
    const condAlert = `((typeof SCORM !== 'undefined' && SCORM.get ? SCORM.get('cmi.core.lesson_status') : ((typeof window !== 'undefined' && window.SCORM && window.SCORM.get) ? window.SCORM.get('cmi.core.lesson_status') : '')) === 'passed' ? 'Course complete' : 'A score of 80% or higher is required to complete this course.')`;
    code = code.replace(globalAlertRegex, `$1(${condAlert})`);
    modified = true;
    changes.push('Replaced remaining global unconditional Course complete alert with conditional check');
    audits.push({
      patternExpected: 'Global unconditional Course complete alert',
      matchFound: true,
      replacementApplied: true,
    });
  }

  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after normalizeFinalNextPageCompletion: ${err.message}`);
  }

  return { code, modified, changes, audits };
}
export function transformUniversalScormApi(originalCode: string): TransformResult {
  let code = originalCode;
  let modified = false;
  const changes: string[] = [];
  const audits: TransformResult['audits'] = [];

  // =========================================================================
  // 1. BEFOREUNLOAD REMEDIATION (Brace-aware block scan)
  // =========================================================================
  const exitListeners = findEventListeners(code, ['beforeunload', 'unload', 'pagehide']);
  let beforeunloadHandled = false;

  for (const listener of exitListeners) {
    const body = listener.functionBlock.body;

    // Check if this listener contains UniversalSCORM or status writes
    if (
      body.includes('UniversalSCORM') ||
      body.includes('cmi.core.lesson_status') ||
      body.includes('cmi.completion_status') ||
      body.includes('completed')
    ) {
      // Look for the version-checking block: if (....version === "1.2") { ... } else { ... }
      const versionIfMatch = /(?:if\s*\(\s*(?:window\.)?UniversalSCORM\.version\s*===?\s*['"]1\.2['"]|if\s*\(\s*this\.version\s*===?\s*['"]1\.2['"])/.exec(body);
      
      if (versionIfMatch) {
        // Find the balanced if-block
        const ifBlock = findBalancedBlock(body, versionIfMatch.index, '{', '}');
        if (ifBlock) {
          // Check for trailing else { ... }
          let fullReplaceStart = versionIfMatch.index;
          let fullReplaceEnd = ifBlock.end;

          const afterIf = body.slice(ifBlock.end);
          const elseMatch = /^\s*else\s*\{/.exec(afterIf);
          if (elseMatch) {
            const elseBlock = findBalancedBlock(body, ifBlock.end + elseMatch.index, '{', '}');
            if (elseBlock) {
              fullReplaceEnd = elseBlock.end;
            }
          }

          const beforeTarget = body.slice(0, fullReplaceStart);
          const afterTarget = body.slice(fullReplaceEnd);
          const replacement = `console.log('[UniversalSCORM] Page unloading, finishing session...');`;

          const newBody = beforeTarget + replacement + afterTarget;
          code = code.slice(0, listener.functionBlock.contentStart) + newBody + code.slice(listener.functionBlock.contentEnd);
          modified = true;
          beforeunloadHandled = true;
          changes.push('Neutralized beforeunload unconditional lesson_status / completion_status = "completed" branch');
          audits.push({
            patternExpected: 'beforeunload: if (version === "1.2") status write block',
            matchFound: true,
            replacementApplied: true,
          });
          break; // Listener updated
        }
      } else {
        // If not structured as version check, look for direct setValue(..., 'completed') calls
        const setValRegex = /(?:window\.)?UniversalSCORM\.setValue\s*\(\s*['"](?:cmi\.core\.lesson_status|cmi\.completion_status)['"]\s*,\s*['"]completed['"]\s*\);?/g;
        if (setValRegex.test(body)) {
          const newBody = body.replace(
            setValRegex,
            `/* SCORM remediation: exit status write neutralized */`
          );
          code = code.slice(0, listener.functionBlock.contentStart) + newBody + code.slice(listener.functionBlock.contentEnd);
          modified = true;
          beforeunloadHandled = true;
          changes.push('Neutralized direct UniversalSCORM.setValue completed calls in beforeunload');
          audits.push({
            patternExpected: 'beforeunload: direct setValue("completed")',
            matchFound: true,
            replacementApplied: true,
          });
          break;
        }
      }
    }
  }

  if (!beforeunloadHandled) {
    audits.push({
      patternExpected: 'beforeunload status write block',
      matchFound: false,
      replacementApplied: false,
      reason: 'No matching beforeunload status write structure located',
    });
  }

  // =========================================================================
  // 2. UNIVERSAL INIT REMEDIATION (Brace-aware block scan)
  // =========================================================================
  // Locate the init function/method in UniversalSCORM
  const initPattern = /(?:init\s*:\s*function\s*\([^)]*\)|init\s*\([^)]*\))\s*\{/;
  const initMatch = findFunctionBlock(code, initPattern);
  let initHandled = false;

  if (initMatch) {
    const initBody = initMatch.block.body;

    // Check if initBody already has priorStatus check
    if (!initBody.includes('priorStatus') && !initBody.includes('_priorStatus')) {
      // Look for if (this.version === "1.2") or if (window.UniversalSCORM.version === "1.2")
      const versionIfMatch = /(?:if\s*\(\s*(?:this\.|(?:window\.)?UniversalSCORM\.)version\s*===?\s*['"]1\.2['"])/.exec(initBody);

      if (versionIfMatch) {
        const caller = versionIfMatch[0].includes('this') ? 'this' : 'window.UniversalSCORM';
        const ifBlock = findBalancedBlock(initBody, versionIfMatch.index, '{', '}');

        if (ifBlock) {
          let replaceStart = versionIfMatch.index;
          let replaceEnd = ifBlock.end;

          const afterIf = initBody.slice(ifBlock.end);
          const elseMatch = /^\s*else\s*\{/.exec(afterIf);
          if (elseMatch) {
            const elseBlock = findBalancedBlock(initBody, ifBlock.end + elseMatch.index, '{', '}');
            if (elseBlock) {
              replaceEnd = elseBlock.end;
            }
          }

          const beforeTarget = initBody.slice(0, replaceStart);
          const afterTarget = initBody.slice(replaceEnd);

          const replacement = `if (${caller}.version === "1.2") {
          const priorStatus = ${caller}.getValue('cmi.core.lesson_status');
          if (!priorStatus || priorStatus === 'not attempted') {
            ${caller}.setValue('cmi.core.lesson_status', 'incomplete');
          }
        } else {
          const priorStatus = ${caller}.getValue('cmi.completion_status');
          if (!priorStatus || priorStatus === 'unknown' || priorStatus === 'not attempted') {
            ${caller}.setValue('cmi.completion_status', 'incomplete');
          }
        }`;

          const newInitBody = beforeTarget + replacement + afterTarget;
          code = code.slice(0, initMatch.block.contentStart) + newInitBody + code.slice(initMatch.block.contentEnd);
          modified = true;
          initHandled = true;
          changes.push('Guarded UniversalSCORM.init() with this.getValue() to preserve passed/failed/completed on relaunch');
          audits.push({
            patternExpected: 'init: if (this.version === "1.2") status reset block',
            matchFound: true,
            replacementApplied: true,
          });
        }
      } else {
        // Look for direct this.setValue('cmi.core.lesson_status', 'incomplete')
        const directSet = /(this|(?:window\.)?UniversalSCORM)\.setValue\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]incomplete['"]\s*\);?/.exec(initBody);
        if (directSet) {
          const caller = directSet[1];
          const replacement = `const priorStatus = ${caller}.getValue('cmi.core.lesson_status');
        if (!priorStatus || priorStatus === 'not attempted') {
          ${caller}.setValue('cmi.core.lesson_status', 'incomplete');
        }`;
          const newInitBody = initBody.replace(directSet[0], replacement);
          code = code.slice(0, initMatch.block.contentStart) + newInitBody + code.slice(initMatch.block.contentEnd);
          modified = true;
          initHandled = true;
          changes.push('Guarded direct UniversalSCORM.setValue("incomplete") in init()');
          audits.push({
            patternExpected: 'init: direct setValue("incomplete")',
            matchFound: true,
            replacementApplied: true,
          });
        }
      }
    } else {
      initHandled = true;
      audits.push({
        patternExpected: 'init: priorStatus guard',
        matchFound: true,
        replacementApplied: false,
        reason: 'Already guarded with priorStatus check',
      });
    }
  }

  if (!initHandled) {
    audits.push({
      patternExpected: 'init: function block',
      matchFound: false,
      replacementApplied: false,
      reason: 'init() function block not detected',
    });
  }

  // Final sanity check: verify JavaScript syntax
  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after Universal SCORM transformation: ${err.message}`);
  }

  return { code, modified, changes, audits };
}

/**
 * Compact SCORM 1.2 Profile Transformer (KNOWN_SCORM12_COMPACT_QUIZ_80_V1)
 * Targets scorm-api.js
 * 1. Injects a real get(k) method into the SCORM object using this.api.LMSGetValue.
 * 2. Guards launch/load initialization using SCORM.get().
 */
export function transformCompactScormApi(originalCode: string): TransformResult {
  let code = originalCode;
  let modified = false;
  const changes: string[] = [];
  const audits: TransformResult['audits'] = [];

  // =========================================================================
  // 1. INJECT SCORM.get(k) IF MISSING
  // =========================================================================
  // Check if SCORM object exists and whether it already has a get method
  const scormObjMatch = /(?:window\.)?SCORM\s*=\s*\{/.exec(code) || /var\s+SCORM\s*=\s*\{/.exec(code) || /const\s+SCORM\s*=\s*\{/.exec(code);
  
  if (scormObjMatch) {
    const objBlock = findBalancedBlock(code, scormObjMatch.index, '{', '}');
    if (objBlock) {
      const hasGet = /\bget\s*:\s*function|\bget\s*\(/.test(objBlock.body);

      if (!hasGet) {
        // Insert getter right before set: or init: or at top of SCORM object
        const targetPos = objBlock.body.search(/\b(?:set|init)\s*:\s*function|\b(?:set|init)\s*\(/);
        const getterSnippet = `
  get: function(k) {
    try {
      if (this.api) {
        return this.api.LMSGetValue(k) || '';
      }
      return '';
    } catch (e) {
      return '';
    }
  },`;

        let newObjBody: string;
        if (targetPos !== -1) {
          newObjBody = objBlock.body.slice(0, targetPos) + getterSnippet + '\n  ' + objBlock.body.slice(targetPos);
        } else {
          newObjBody = getterSnippet + '\n' + objBlock.body;
        }

        code = code.slice(0, objBlock.contentStart) + newObjBody + code.slice(objBlock.contentEnd);
        modified = true;
        changes.push('Added SCORM.get(k) method using this.api.LMSGetValue to SCORM object');
        audits.push({
          patternExpected: 'SCORM.get getter method',
          matchFound: false, // wasn't there before
          replacementApplied: true,
        });
      } else {
        audits.push({
          patternExpected: 'SCORM.get getter method',
          matchFound: true,
          replacementApplied: false,
          reason: 'Getter already exists on SCORM object',
        });
      }
    }
  }

  // =========================================================================
  // 2. GUARD LAUNCH INITIALIZATION
  // =========================================================================
  // Check if init() sets incomplete unconditionally
  const initPattern = /(?:init\s*:\s*function\s*\([^)]*\)|init\s*\([^)]*\))\s*\{/;
  const initBlockMatch = findFunctionBlock(code, initPattern);
  if (initBlockMatch && !initBlockMatch.block.body.includes('priorStatus')) {
    const initBody = initBlockMatch.block.body;
    const setIncompleteMatch = /(?:this|SCORM)\.set\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]incomplete['"]\s*\);?/.exec(initBody);
    
    if (setIncompleteMatch) {
      const replacement = `var priorStatus = this.get ? this.get('cmi.core.lesson_status') : (this.api ? this.api.LMSGetValue('cmi.core.lesson_status') : '');
    if (!priorStatus || priorStatus === 'not attempted' || priorStatus === '') {
      this.set('cmi.core.lesson_status', 'incomplete');
    }`;
      const newInitBody = initBody.replace(setIncompleteMatch[0], replacement);
      code = code.slice(0, initBlockMatch.block.contentStart) + newInitBody + code.slice(initBlockMatch.block.contentEnd);
      modified = true;
      changes.push('Guarded SCORM.init() status write with this.get() to preserve prior status');
      audits.push({
        patternExpected: 'SCORM.init status reset',
        matchFound: true,
        replacementApplied: true,
      });
    }
  }

  // Also check window.addEventListener('load') or window.onload in scorm-api.js
  const loadListeners = findEventListeners(code, ['load']);
  for (const listener of loadListeners) {
    const body = listener.functionBlock.body;
    if (body.includes('cmi.core.lesson_status') && body.includes('incomplete') && !body.includes('priorStatus')) {
      const setIncomplete = /SCORM\.set\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]incomplete['"]\s*\);?/.exec(body);
      if (setIncomplete) {
        const replacement = `var priorStatus = (typeof SCORM !== 'undefined' && SCORM.get) ? SCORM.get('cmi.core.lesson_status') : '';
    if (!priorStatus || priorStatus === 'not attempted' || priorStatus === '') {
      SCORM.set('cmi.core.lesson_status', 'incomplete');
    }`;
        const newBody = body.replace(setIncomplete[0], replacement);
        code = code.slice(0, listener.functionBlock.contentStart) + newBody + code.slice(listener.functionBlock.contentEnd);
        modified = true;
        changes.push('Guarded load event listener status write with SCORM.get()');
        audits.push({
          patternExpected: 'load listener status reset',
          matchFound: true,
          replacementApplied: true,
        });
        break;
      }
    }
  }

  // Final sanity check: verify JavaScript syntax
  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after Compact SCORM API transformation: ${err.message}`);
  }

  return { code, modified, changes, audits };
}

/**
 * Shared Deterministic Remediation: Removes progress-based completion
 * - Removes SCORM.set('cmi.core.lesson_status', progress >= 100 ? 'completed' : 'incomplete')
 * - Removes if (progress >= 100) { SCORM.set('cmi.core.lesson_status', 'completed'); }
 * - Keeps location updates and commit intact
 */
export function repairCompactProgressCompletion(originalCode: string): TransformResult {
  let code = originalCode;
  let modified = false;
  const changes: string[] = [];
  const audits: TransformResult['audits'] = [];

  const patProgressTernary = /(?:(?:window\.)?(?:SCORM|SafeSCORM)\.)?(?:set|setValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*progress(?:Percent)?\s*>=\s*100\s*\?\s*['"]completed['"]\s*:\s*['"]incomplete['"]\s*\);?/g;
  if (patProgressTernary.test(code)) {
    code = code.replace(
      patProgressTernary,
      `/* SCORM remediation: progress updates location only, does not force completed */`
    );
    modified = true;
    changes.push('Removed progress >= 100 completed status override');
    audits.push({
      patternExpected: 'progress >= 100 ternary completion write',
      matchFound: true,
      replacementApplied: true,
    });
  }

  const patProgressIf = /if\s*\(\s*progress(?:Percent)?\s*>=\s*100\s*\)\s*\{\s*(?:(?:window\.)?(?:SCORM|SafeSCORM)\.)?(?:set|setValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?\s*\}/g;
  if (patProgressIf.test(code)) {
    code = code.replace(
      patProgressIf,
      `/* SCORM remediation: progress updates location only */`
    );
    modified = true;
    changes.push('Removed if (progress >= 100) completion block');
    audits.push({
      patternExpected: 'if (progress >= 100) completion block',
      matchFound: true,
      replacementApplied: true,
    });
  }

  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after repairCompactProgressCompletion: ${err.message}`);
  }

  return { code, modified, changes, audits };
}

/**
 * Shared Deterministic Remediation: Neutralizes Finish-based completion
 * - Removes any SCORM.set('cmi.core.lesson_status', 'completed') from finish or navigation handlers (including nextPage)
 * - Conditionals completion message on cmi.core.lesson_status === 'passed'
 * - Does not manufacture or alter LMS status from Finish
 */
export function repairCompactFinishCompletion(originalCode: string): TransformResult {
  let code = originalCode;
  let modified = false;
  const changes: string[] = [];
  const audits: TransformResult['audits'] = [];

  const messageReplacement = `((typeof SCORM !== 'undefined' && SCORM.get ? SCORM.get('cmi.core.lesson_status') : '') === 'passed' ? 'Course complete' : 'A score of 80% or higher is required to complete this course.')`;

  function transformFinishBody(body: string, blockName: string): { newBody: string; wasModified: boolean } {
    let newBody = body;
    let wasModified = false;

    // Remove any status write in finish / nextPage handler so it does not alter LMS status
    // Matches single-line and multi-line SCORM.set('cmi.core.lesson_status', 'completed')
    const setStatusRegex = /(?:(?:window\.)?(?:SCORM|SafeSCORM)\.)?(?:set|setValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?/g;
    if (setStatusRegex.test(newBody)) {
      newBody = newBody.replace(
        setStatusRegex,
        `/* SCORM remediation: Finish handler does not write or alter LMS status */`
      );
      wasModified = true;
      changes.push(`Removed LMS status write from ${blockName} handler`);
      audits.push({
        patternExpected: `${blockName} handler: SCORM.set lesson_status = 'completed'`,
        matchFound: true,
        replacementApplied: true,
      });
    }

    // Replace showAlert('Course complete') or alert('Course complete') with conditional check
    const courseCompleteCallRegex = /(showAlert|alert)\s*\(\s*(['"])Course complete(?:d)?(?:!)?\2\s*\)/gi;
    if (courseCompleteCallRegex.test(newBody)) {
      newBody = newBody.replace(courseCompleteCallRegex, `$1(${messageReplacement})`);
      wasModified = true;
      changes.push(`Updated ${blockName} Finish message to read cmi.core.lesson_status`);
      audits.push({
        patternExpected: `${blockName} Finish message: showAlert("Course complete")`,
        matchFound: true,
        replacementApplied: true,
      });
    }

    // Also handle showAlert('Course complete', callback)
    const courseCompleteWithArgsRegex = /(showAlert|alert)\s*\(\s*(['"])Course complete(?:d)?(?:!)?\2\s*,/gi;
    if (courseCompleteWithArgsRegex.test(newBody)) {
      newBody = newBody.replace(courseCompleteWithArgsRegex, `$1(${messageReplacement},`);
      wasModified = true;
      changes.push(`Updated ${blockName} Finish message with callback to read cmi.core.lesson_status`);
      audits.push({
        patternExpected: `${blockName} Finish message with callback`,
        matchFound: true,
        replacementApplied: true,
      });
    }

    // Also replace any remaining literal string 'Course complete' inside this block
    const courseCompleteLiteralRegex = /(['"])(?:Course complete(?:d)?(?:!)?|You have completed the course)\1/gi;
    if (courseCompleteLiteralRegex.test(newBody) && !newBody.includes("'A score of 80% or higher")) {
      newBody = newBody.replace(courseCompleteLiteralRegex, messageReplacement);
      wasModified = true;
      changes.push(`Updated ${blockName} completion message string to conditionally check cmi.core.lesson_status`);
      audits.push({
        patternExpected: `${blockName} message string: "Course complete"`,
        matchFound: true,
        replacementApplied: true,
      });
    }

    return { newBody, wasModified };
  }

  // Scan and transform ALL finish-related functions:
  // 1. nextPage
  const nextPagePattern = /(?:(?:var|let|const)\s+nextPage\s*=\s*function|function\s+nextPage|nextPage\s*:\s*function|nextPage\s*\([^)]*\)\s*\{)/i;
  const nextPageBlock = findFunctionBlock(code, nextPagePattern);
  if (nextPageBlock) {
    const { newBody, wasModified } = transformFinishBody(nextPageBlock.block.body, 'nextPage');
    if (wasModified) {
      code = code.slice(0, nextPageBlock.block.contentStart) + newBody + code.slice(nextPageBlock.block.contentEnd);
      modified = true;
    }
  }

  // 2. finish / onFinish / finishCourse / handleFinish / completeCourse
  const finishFuncPattern = /(?:(?:var|let|const)\s+(?:finish|onFinish|finishCourse|handleFinish|completeCourse)\s*=\s*function|(?:function\s+(?:finish|onFinish|finishCourse|handleFinish|completeCourse))|(?:finish|onFinish)\s*:\s*function)\s*\([^)]*\)\s*\{/i;
  const finishBlock = findFunctionBlock(code, finishFuncPattern);
  if (finishBlock) {
    const { newBody, wasModified } = transformFinishBody(finishBlock.block.body, 'Finish');
    if (wasModified) {
      code = code.slice(0, finishBlock.block.contentStart) + newBody + code.slice(finishBlock.block.contentEnd);
      modified = true;
    }
  }

  // 3. finish / next button event listener
  const finishBtnPattern = /(?:finishBtn|finishButton|btnFinish|finish_btn|#finish|nextBtn|btnNext|\$\(['"]#?(?:finish|next)[^'"]*['"]\))\s*\.addEventListener\s*\(\s*['"]click['"]\s*,\s*function\s*\([^)]*\)\s*\{/i;
  const finishEventBlock = findFunctionBlock(code, finishBtnPattern);
  if (finishEventBlock) {
    const { newBody, wasModified } = transformFinishBody(finishEventBlock.block.body, 'Finish/Next button');
    if (wasModified) {
      code = code.slice(0, finishEventBlock.block.contentStart) + newBody + code.slice(finishEventBlock.block.contentEnd);
      modified = true;
    }
  }

  // 4. File-wide scan for any remaining SCORM.set('cmi.core.lesson_status', 'completed')
  const globalSetCompletedRegex = /(?:(?:window\.)?(?:SCORM|SafeSCORM)\.)?(?:set|setValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?/g;
  if (globalSetCompletedRegex.test(code)) {
    code = code.replace(
      globalSetCompletedRegex,
      `/* SCORM remediation: Finish handler does not write or alter LMS status */`
    );
    modified = true;
    changes.push('Neutralized remaining global completed lesson_status override');
    audits.push({
      patternExpected: "Global SCORM.set('cmi.core.lesson_status', 'completed')",
      matchFound: true,
      replacementApplied: true,
    });
  }

  // 5. File-wide scan for unconditional showAlert('Course complete')
  const remainingAlertRegex = /(showAlert|alert)\s*\(\s*(['"])Course complete(?:d)?(?:!)?\2\s*\)/gi;
  if (remainingAlertRegex.test(code)) {
    code = code.replace(remainingAlertRegex, `$1(${messageReplacement})`);
    modified = true;
    changes.push('Replaced unconditional showAlert/alert Course complete with conditional status check');
    audits.push({
      patternExpected: 'Global unconditional Course complete alert',
      matchFound: true,
      replacementApplied: true,
    });
  }

  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after repairCompactFinishCompletion: ${err.message}`);
  }

  return { code, modified, changes, audits };
}

/**
 * Shared Deterministic Remediation: Neutralizes unconditional relaunch reset to incomplete
 * - Ensures SCORM.get(k) exists
 * - In init(): verifies priorStatus before writing cmi.core.lesson_status = 'incomplete'
 */
export function repairCompactRelaunch(originalCode: string): TransformResult {
  let code = originalCode;
  let modified = false;
  const changes: string[] = [];
  const audits: TransformResult['audits'] = [];

  // 1. Ensure SCORM.get is implemented
  const scormObjRegex = /var\s+SCORM\s*=\s*\{[\s\S]*?\n\};/m;
  const scormMatch = scormObjRegex.exec(code);
  if (scormMatch && !scormMatch[0].includes('get:') && !scormMatch[0].includes('get(')) {
    const oldScorm = scormMatch[0];
    const newScorm = oldScorm.replace(
      /(set\s*:\s*function\s*\([^\)]*\)\s*\{)/,
      `get: function(k) {\n    return this.api ? this.api.LMSGetValue(k) : '';\n  },\n  $1`
    );
    if (newScorm !== oldScorm) {
      code = code.replace(oldScorm, newScorm);
      modified = true;
      changes.push('Injected SCORM.get(k) implementation for status inspection');
      audits.push({
        patternExpected: 'SCORM object definition lacking get()',
        matchFound: true,
        replacementApplied: true,
      });
    }
  }

  // 2. Neutralize relaunch reset in init()
  const initPattern = /(init\s*:\s*function\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\})/m;
  const initMatch = initPattern.exec(code);
  if (initMatch) {
    let initBody = initMatch[1];
    const unconditionalResetRegex = /(?:(?:this|SCORM)\.)?(?:set|setValue)\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]incomplete['"]\s*\);?/g;
    if (unconditionalResetRegex.test(initBody)) {
      initBody = initBody.replace(
        unconditionalResetRegex,
        `var priorStatus = (this.get ? this.get('cmi.core.lesson_status') : (typeof SCORM !== 'undefined' && SCORM.get ? SCORM.get('cmi.core.lesson_status') : ''));
    if (!priorStatus || priorStatus === 'not attempted' || priorStatus === '') {
      this.set('cmi.core.lesson_status', 'incomplete');
    }`
      );
      code = code.replace(initMatch[1], initBody);
      modified = true;
      changes.push('Neutralized relaunch reset in init(): preserved existing lesson_status');
      audits.push({
        patternExpected: 'unconditional lesson_status = "incomplete" in init()',
        matchFound: true,
        replacementApplied: true,
      });
    }
  }

  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after repairCompactRelaunch: ${err.message}`);
  }

  return { code, modified, changes, audits };
}

/**
 * Shared Deterministic Remediation: Preserves assessment score and threshold 80 logic
 * - Preserves score >= 80 ? 'passed' : 'failed'
 * - Preserves raw score write
 */
export function repairCompactAssessmentStatus(originalCode: string): TransformResult {
  let code = originalCode;
  let modified = false;
  const changes: string[] = [];
  const audits: TransformResult['audits'] = [];

  const submitQuizPattern = /(?:(?:var|let|const)\s+submitQuiz\s*=\s*function|function\s+submitQuiz|submitQuiz\s*\([^)]*\))\s*\{/i;
  const quizBlock = findFunctionBlock(code, submitQuizPattern);
  if (quizBlock) {
    const body = quizBlock.block.body;
    if (body.includes("'completed'")) {
      const fixedBody = body.replace(
        /(?:(?:window\.)?SCORM\.)?set\s*\(\s*['"]cmi\.core\.lesson_status['"]\s*,\s*['"]completed['"]\s*\);?/g,
        `/* SCORM remediation: quiz sets passed/failed based on mastery score */`
      );
      if (fixedBody !== body) {
        code = code.slice(0, quizBlock.block.contentStart) + fixedBody + code.slice(quizBlock.block.contentEnd);
        modified = true;
        changes.push('Removed completed override from submitQuiz');
        audits.push({
          patternExpected: "submitQuiz completed write",
          matchFound: true,
          replacementApplied: true,
        });
      }
    }
  }

  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after repairCompactAssessmentStatus: ${err.message}`);
  }

  return { code, modified, changes, audits };
}

/**
 * Compact Navigation Transformer (scripts/navigation.js)
 * Composes the approved shared deterministic remediation functions:
 * 1. repairCompactProgressCompletion
 * 2. repairCompactFinishCompletion
 * 3. repairCompactAssessmentStatus
 */
export function transformCompactNavigation(originalCode: string): TransformResult {
  const progRes = repairCompactProgressCompletion(originalCode);
  const finRes = repairCompactFinishCompletion(progRes.code);
  const assessRes = repairCompactAssessmentStatus(finRes.code);

  return {
    code: assessRes.code,
    modified: progRes.modified || finRes.modified || assessRes.modified,
    changes: [...progRes.changes, ...finRes.changes, ...assessRes.changes],
    audits: [...progRes.audits, ...finRes.audits, ...assessRes.audits],
  };
}

export interface PageContentMapResult {
  code: string;
  pageCount: number;
  pageIds: string[];
  unsafeScriptsDetected: boolean;
  unsafeScriptDetails?: string;
}

/**
 * Builds window.SCORM_PAGE_CONTENT JavaScript content map for Workday inline page compatibility.
 */
export function generateWorkdayPageContentMap(
  pageFilesMap: { [filePath: string]: string }
): PageContentMapResult {
  const pageEntries: { [id: string]: string } = {};
  const pageIds: string[] = [];
  let unsafeScriptsDetected = false;
  let unsafeScriptDetails: string | undefined;

  for (const [filePath, content] of Object.entries(pageFilesMap)) {
    const normPath = filePath.replace(/\\/g, '/');
    if (!normPath.startsWith('pages/') || (!normPath.endsWith('.html') && !normPath.endsWith('.htm'))) {
      continue;
    }

    const pageId = normPath.replace(/^pages\//, '').replace(/\.html?$/i, '');
    pageIds.push(pageId);

    // Check for unsafe executable inline script tags
    const scriptMatches = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
    if (scriptMatches) {
      for (const sm of scriptMatches) {
        const scriptInner = sm.replace(/<script\b[^>]*>|<\/script>/gi, '').trim();
        if (scriptInner.length > 0 && !scriptInner.startsWith('//') && !scriptInner.startsWith('/*')) {
          unsafeScriptsDetected = true;
          unsafeScriptDetails = `Page ${filePath} contains executable inline <script> element`;
        }
      }
    }

    pageEntries[pageId] = content;
  }

  const serializedMap = JSON.stringify(pageEntries, null, 2);
  const code = `/**
 * WORKDAY INLINE PAGE COMPATIBILITY
 * Generated content map to eliminate runtime HTTP/fetch dependency for lesson text in Workday.
 * Bundled pages count: ${pageIds.length}
 */
window.SCORM_PAGE_CONTENT = ${serializedMap};
`;

  return {
    code,
    pageCount: pageIds.length,
    pageIds,
    unsafeScriptsDetected,
    unsafeScriptDetails,
  };
}

/**
 * Stateful Compact Workday Profile Transformer (KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1)
 * Targets scripts/navigation.js and course shell scripts:
 * 1. Namespaces STORAGE_KEY for isolated standalone fallback; makes LMS state authoritative
 * 2. Fixes progress clamping (Math.min(100, Math.max(0, ...))) and filters out invalid page IDs
 * 3. Preserves prior pass and bestScore on quiz submit; prevents downgrade
 * 4. Injects accessible Failed-Assessment Modal with Try Again and Save & Exit
 * 5. Injects Save & Exit control with cmi.core.exit = 'suspend' and no completion write
 * 6. Updates loadPage to use window.SCORM_PAGE_CONTENT without runtime fetch
 * 7. Ensures Finish button is conditional on cmi.core.lesson_status === 'passed'
 */
export function transformStatefulWorkdayNavigation(
  originalCode: string,
  courseId: string = 'ScormCourse'
): TransformResult {
  // =========================================================================
  // STEP A: APPLY APPROVED COMPACT SCORM REMEDIATION (COMPOSITION)
  // KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1 EXTENDS / COMPOSES THE APPROVED
  // COMPACT REMEDIATION LOGIC INSTEAD OF REPLACING IT.
  // =========================================================================
  const progRes = repairCompactProgressCompletion(originalCode);
  const finRes = repairCompactFinishCompletion(progRes.code);
  const assessRes = repairCompactAssessmentStatus(finRes.code);

  let code = assessRes.code;
  let modified = progRes.modified || finRes.modified || assessRes.modified;
  const changes = [...progRes.changes, ...finRes.changes, ...assessRes.changes];
  const audits = [...progRes.audits, ...finRes.audits, ...assessRes.audits];

  // =========================================================================
  // STEP B: APPLY STATEFUL COMPACT WORKDAY ADDITIONS
  // =========================================================================

  // 1. NAMESPACE STORAGE KEY FOR NON-LMS PREVIEW ONLY
  const storageKeyAssignRegex = /(?:const|var|let)\s+STORAGE_KEY\s*=\s*['"]([^'"]+)['"];?/;
  const storageKeyMatch = storageKeyAssignRegex.exec(code);
  if (storageKeyMatch) {
    const oldKey = storageKeyMatch[1];
    const newStorageDecl = `var STORAGE_KEY = '${oldKey}::${courseId}';`;
    code = code.replace(storageKeyMatch[0], newStorageDecl);
    modified = true;
    changes.push(`Namespaced STORAGE_KEY with course identifier: ${oldKey} -> ${oldKey}::${courseId}`);
    audits.push({
      patternExpected: 'STORAGE_KEY declaration',
      matchFound: true,
      replacementApplied: true,
    });
  } else if (code.includes("'scormArchitectProgress'") && !code.includes("'scormArchitectProgress::'")) {
    code = code.replace(/'scormArchitectProgress'/g, `'scormArchitectProgress::${courseId}'`);
    modified = true;
    changes.push(`Namespaced raw 'scormArchitectProgress' key with course identifier`);
    audits.push({
      patternExpected: "raw 'scormArchitectProgress' string",
      matchFound: true,
      replacementApplied: true,
    });
  }

  // 2. AUTHORITATIVE SCORM STATE RESTORATION
  const authoritativeStateFunctions = `
var isLmsAvailable = false;
var LMS_CONTEXT = {
  initialized: false,
  available: false,
  entry: ''
};

function initializeLmsContext() {
  if (LMS_CONTEXT.initialized) return LMS_CONTEXT;
  LMS_CONTEXT.initialized = true;
  try {
    var scormObj = (typeof SCORM !== 'undefined' && SCORM) ? SCORM : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
    if (scormObj) {
      if (typeof scormObj.init === 'function') {
        LMS_CONTEXT.available = Boolean(scormObj.init());
      } else if (scormObj.api || typeof scormObj.get === 'function') {
        LMS_CONTEXT.available = true;
      }
      if (LMS_CONTEXT.available && typeof scormObj.get === 'function') {
        LMS_CONTEXT.entry = String(scormObj.get('cmi.core.entry') || '').toLowerCase();
      }
    }
  } catch (e) {}
  isLmsAvailable = LMS_CONTEXT.available;
  return LMS_CONTEXT;
}

function clearBrowserStoredState() {
  try {
    if (typeof localStorage !== 'undefined' && typeof STORAGE_KEY !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {}
  try {
    if (typeof sessionStorage !== 'undefined' && typeof STORAGE_KEY !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {}
}

function readBrowserStorage(storageType) {
  try {
    if (storageType === 'localStorage' && typeof localStorage !== 'undefined' && typeof STORAGE_KEY !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY);
    }
    if (storageType === 'sessionStorage' && typeof sessionStorage !== 'undefined' && typeof STORAGE_KEY !== 'undefined') {
      return sessionStorage.getItem(STORAGE_KEY);
    }
  } catch (e) {}
  return null;
}

function writeBrowserStorage(storageType, data) {
  try {
    if (storageType === 'localStorage' && typeof localStorage !== 'undefined' && typeof STORAGE_KEY !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, data);
    }
    if (storageType === 'sessionStorage' && typeof sessionStorage !== 'undefined' && typeof STORAGE_KEY !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY, data);
    }
  } catch (e) {}
}

function safeParseJson(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch (e) { return null; }
}

function readStoredState() {
  initializeLmsContext();

  if (LMS_CONTEXT.available) {
    var entry = LMS_CONTEXT.entry;
    var parseFn = (typeof parseJson === 'function') ? parseJson : safeParseJson;
    var scormObj = (typeof SCORM !== 'undefined' && SCORM) ? SCORM : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
    var scormRaw = (scormObj && typeof scormObj.get === 'function') ? scormObj.get('cmi.suspend_data') : '';
    var fromScorm = parseFn(scormRaw);
    if (!fromScorm && scormRaw) {
      try { fromScorm = JSON.parse(scormRaw); } catch (e) {}
    }

    if (entry === 'resume') {
      return fromScorm || {};
    }

    // ab-initio or blank/non-resume launch:
    // This is a fresh/replay UI state.
    clearBrowserStoredState();
    return {};
  }

  // Only standalone/non-LMS mode may use browser storage.
  var parseFnLocal = (typeof parseJson === 'function') ? parseJson : safeParseJson;
  var fromLocal = parseFnLocal(readBrowserStorage('localStorage'));
  var fromSession = parseFnLocal(readBrowserStorage('sessionStorage'));

  return fromLocal || fromSession || {};
}

function restoreProgress() {
  return readStoredState();
}

function save(state) {
  initializeLmsContext();
  var serialized = (typeof state === 'string') ? state : JSON.stringify(state || {});
  if (LMS_CONTEXT.available) {
    var scormObj = (typeof SCORM !== 'undefined' && SCORM) ? SCORM : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
    if (scormObj && scormObj.set) {
      scormObj.set('cmi.suspend_data', serialized);
      if (typeof scormObj.commit === 'function') scormObj.commit();
    }
  } else {
    writeBrowserStorage('sessionStorage', serialized);
    writeBrowserStorage('localStorage', serialized);
  }
}

function saveProgress(state) {
  save(state);
}

function getInitialPageIndex() {
  initializeLmsContext();
  var pageList = (typeof PAGES !== 'undefined' && Array.isArray(PAGES))
    ? PAGES
    : ((typeof validPageIds !== 'undefined' && Array.isArray(validPageIds)) ? validPageIds : []);

  if (LMS_CONTEXT.available) {
    if (LMS_CONTEXT.entry === 'resume') {
      var scormObj = (typeof SCORM !== 'undefined' && SCORM) ? SCORM : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
      var bookmark = (scormObj && typeof scormObj.get === 'function') ? scormObj.get('cmi.core.lesson_location') : '';
      var stored = readStoredState();
      var target = bookmark || stored.currentPageId || stored.currentPage || '';
      if (target) {
        for (var i = 0; i < pageList.length; i++) {
          var p = pageList[i];
          var pid = typeof p === 'string' ? p : (p && p.id ? p.id : '');
          if (pid === target || 'page_' + i === target || 'page_' + pid === target || pid.indexOf(target) !== -1 || target.indexOf(pid) !== -1) {
            return i;
          }
        }
        var numMatch = String(target).match(/\\d+/);
        if (numMatch) {
          var parsedIdx = parseInt(numMatch[0], 10);
          if (parsedIdx >= 0 && parsedIdx < pageList.length) {
            return parsedIdx;
          }
        }
      }
    }
    // ab-initio or blank/non-resume launch: start at page index 0
    return 0;
  }

  // Standalone non-LMS preview fallback:
  var fallbackState = readStoredState();
  var localTarget = fallbackState.currentPageId || fallbackState.currentPage || '';
  if (localTarget) {
    for (var j = 0; j < pageList.length; j++) {
      var p2 = pageList[j];
      var pid2 = typeof p2 === 'string' ? p2 : (p2 && p2.id ? p2.id : '');
      if (pid2 === localTarget || 'page_' + j === localTarget || 'page_' + pid2 === localTarget || pid2.indexOf(localTarget) !== -1 || localTarget.indexOf(pid2) !== -1) {
        return j;
      }
    }
    var localNumMatch = String(localTarget).match(/\\d+/);
    if (localNumMatch) {
      var parsedLocalIdx = parseInt(localNumMatch[0], 10);
      if (parsedLocalIdx >= 0 && parsedLocalIdx < pageList.length) {
        return parsedLocalIdx;
      }
    }
  }
  return 0;
}

function getInitialPageId() {
  initializeLmsContext();
  var pageList = (typeof PAGES !== 'undefined' && Array.isArray(PAGES))
    ? PAGES
    : ((typeof validPageIds !== 'undefined' && Array.isArray(validPageIds)) ? validPageIds : []);

  if (LMS_CONTEXT.available) {
    if (LMS_CONTEXT.entry === 'resume') {
      var scormObj = (typeof SCORM !== 'undefined' && SCORM) ? SCORM : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
      var bookmark = (scormObj && typeof scormObj.get === 'function') ? scormObj.get('cmi.core.lesson_location') : '';
      var stored = readStoredState();
      return bookmark || stored.currentPageId || stored.currentPage || (pageList[0] ? (typeof pageList[0] === 'string' ? pageList[0] : pageList[0].id) : '');
    }
    return pageList[0] ? (typeof pageList[0] === 'string' ? pageList[0] : pageList[0].id) : '';
  }
  var fallbackState = readStoredState();
  return fallbackState.currentPageId || fallbackState.currentPage || (pageList[0] ? (typeof pageList[0] === 'string' ? pageList[0] : pageList[0].id) : '');
}
`;

  const loadProgressPattern = /(?:(?:var|let|const)\s+(?:getStoredProgress|loadProgress|restoreProgress|restoreState|getProgressState|readStoredState|getStoredState)\s*=\s*function|function\s+(?:getStoredProgress|loadProgress|restoreProgress|restoreState|getProgressState|readStoredState|getStoredState))\s*\([^)]*\)\s*\{/i;
  const loadBlock = findFunctionBlock(code, loadProgressPattern);

  if (loadBlock) {
    code = code.slice(0, loadBlock.patternIndex) + authoritativeStateFunctions + code.slice(loadBlock.block.end);
    modified = true;
    changes.push('Replaced state loader with Authoritative SCORM state restoration (handles resume, ab-initio, and isolates browser storage)');
    audits.push({
      patternExpected: 'getStoredProgress / loadProgress / restoreProgress / readStoredState function block',
      matchFound: true,
      replacementApplied: true,
    });
  } else if (code.includes('fromScorm') && code.includes('fromLocal')) {
    const inlineFallbackPattern = /(?:const|var|let)\s+fromScorm\s*=\s*[^;]+;\s*(?:const|var|let)\s+fromLocal\s*=\s*[^;]+;\s*return\s+fromScorm\s*\|\|\s*fromLocal(?:\s*\|\|\s*\{\})?;/g;
    if (inlineFallbackPattern.test(code)) {
      code = code.replace(inlineFallbackPattern, authoritativeStateFunctions);
      modified = true;
      changes.push('Replaced inline fromScorm || fromLocal with Authoritative SCORM state restoration');
      audits.push({
        patternExpected: 'inline fromScorm || fromLocal pattern',
        matchFound: true,
        replacementApplied: true,
      });
    }
  } else if (!code.includes('LMS_CONTEXT')) {
    code += `\n\n${authoritativeStateFunctions}\n`;
    modified = true;
    changes.push('Injected authoritative state restoration functions');
    audits.push({
      patternExpected: 'authoritative state restoration injection',
      matchFound: true,
      replacementApplied: true,
    });
  }

  // Authoritative bookmark / page restoration pattern
  const bookmarkPattern = /(?:const|var|let)\s+bookmark\s*=\s*[^;]+;\s*(?:const|var|let)\s+pageId\s*=\s*bookmark\s*\|\|\s*[^;]+;/g;
  if (bookmarkPattern.test(code)) {
    code = code.replace(bookmarkPattern, `var pageId = (typeof getInitialPageId === 'function') ? getInitialPageId() : '';`);
    modified = true;
    changes.push('Replaced bookmark || storedState.currentPageId with authoritative getInitialPageId()');
  }

  // 3. PROGRESS CALCULATION & CLAMPING (Never > 100% or < 0%, discard invalid page IDs, zero browser writes in LMS mode)
  const updateProgressBlock = findFunctionBlock(
    code,
    /(?:(?:var|let|const)\s+updateProgress\s*=\s*function|function\s+updateProgress|updateProgress\s*:\s*function)\s*\([^)]*\)\s*\{/i
  );
  if (updateProgressBlock) {
    const safeUpdateBody = `
  var validList = (typeof validPageIds !== 'undefined' && Array.isArray(validPageIds))
    ? validPageIds
    : (typeof PAGES !== 'undefined' ? PAGES.map(function(p) { return typeof p === 'string' ? p : p.id; }) : []);
  if (validList.length > 0 && validList.indexOf(pageId) === -1) {
    return; // Discard invalid page ID
  }
  if (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages)) {
    if (visitedPages.indexOf(pageId) === -1) {
      visitedPages.push(pageId);
    }
  } else if (typeof visited !== 'undefined') {
    if (Array.isArray(visited)) {
      if (visited.indexOf(pageId) === -1) visited.push(pageId);
    } else if (visited instanceof Set) {
      visited.add(pageId);
    }
  }
  var rawCount = (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages)) ? visitedPages.length : ((typeof visited !== 'undefined' && (visited.length || visited.size)) || 0);
  var totalCount = (typeof TOTAL_PAGES !== 'undefined' && Number(TOTAL_PAGES)) ? TOTAL_PAGES : ((typeof PAGES !== 'undefined' && PAGES.length) || validList.length || 1);
  var calculated = Math.round((rawCount / totalCount) * 100);
  var progress = Math.min(100, Math.max(0, calculated));
  var progressPercent = progress;

  // Workday Learner-UX Normalization:
  // Disambiguate "% viewed" vs "% complete".
  // A learner who views all pages has 100% viewed.
  // ONLY if cmi.core.lesson_status is 'passed' do they see "% complete" or "100% complete".
  // A failed or incomplete learner who views 100% of pages sees "100% viewed", NEVER "100% complete".
  var currentLmsStatus = (typeof SCORM !== 'undefined' && SCORM.get)
    ? SCORM.get('cmi.core.lesson_status')
    : ((typeof window !== 'undefined' && window.SCORM && window.SCORM.get) ? window.SCORM.get('cmi.core.lesson_status') : '');
  var isCoursePassed = currentLmsStatus === 'passed';
  var progressLabelText = isCoursePassed ? (progress + '% complete') : (progress + '% viewed');

  if (typeof document !== 'undefined') {
    var progressLabel = document.getElementById('progress-text') ||
      document.getElementById('progress-label') ||
      document.getElementById('progress-status') ||
      (document.querySelector ? document.querySelector('.progress-text') : null) ||
      (document.querySelector ? document.querySelector('.progress-label') : null);
    if (progressLabel) {
      progressLabel.textContent = progressLabelText;
      if (progressLabel.setAttribute) {
        progressLabel.setAttribute('data-progress-type', isCoursePassed ? 'complete' : 'viewed');
      }
    }
    var progressBar = document.getElementById('progress-bar') ||
      document.getElementById('progress-fill') ||
      (document.querySelector ? document.querySelector('.progress-bar') : null);
    if (progressBar) {
      if (progressBar.style) progressBar.style.width = progress + '%';
      if (progressBar.setAttribute) {
        progressBar.setAttribute('aria-valuenow', String(progress));
        progressBar.setAttribute('aria-valuetext', progressLabelText);
      }
    }
  }

  var stateObj = {
    visited: (typeof visitedPages !== 'undefined') ? visitedPages : (typeof visited !== 'undefined' ? visited : []),
    currentPage: pageId,
    progress: progress
  };
  var serialized = JSON.stringify(stateObj);

  initializeLmsContext();
  if (LMS_CONTEXT.available) {
    if (typeof SCORM !== 'undefined' && SCORM.set) {
      SCORM.set('cmi.suspend_data', serialized);
      SCORM.set('cmi.core.lesson_location', typeof pageId === 'number' ? ('page_' + pageId) : String(pageId));
      /* SCORM remediation: progress updates location and suspend_data only, does not force completed */
      if (typeof SCORM.commit === 'function') SCORM.commit();
    }
  } else {
    writeBrowserStorage('sessionStorage', serialized);
    writeBrowserStorage('localStorage', serialized);
  }
`;
    code = code.slice(0, updateProgressBlock.block.contentStart) + safeUpdateBody + code.slice(updateProgressBlock.block.contentEnd);
    modified = true;
    changes.push('Replaced updateProgress with validated page ID filtering, deduplication, 0-100% clamping, and authoritative LMS state writing without browser leakage');
    audits.push({
      patternExpected: 'updateProgress function block',
      matchFound: true,
      replacementApplied: true,
    });
  } else {
    const progressCalcRegex = /(?:const|var|let)\s+progress(?:Percent)?\s*=\s*(?:Math\.round\s*\(\s*)?\(?\s*(?:(?:visitedPages|visited)\.(?:size|length))\s*\/\s*(?:PAGES\.length|PAGES|TOTAL_PAGES)\s*\)?(?:\s*\*\s*100\s*\)?)?;?/gi;
    if (progressCalcRegex.test(code)) {
      const clampedProgressSnippet = `var validPageIds = new Set((typeof PAGES !== 'undefined' ? PAGES : []).map(function(p) { return typeof p === 'string' ? p : p.id; }));
    var rawVisitedList = Array.isArray(visited) ? visited : (visited instanceof Set ? Array.from(visited) : (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages) ? visitedPages : []));
    var cleanVisited = rawVisitedList.filter(function(id) { return validPageIds.size === 0 || validPageIds.has(id); });
    var calculatedPercent = Math.round((cleanVisited.length / ((typeof PAGES !== 'undefined' && PAGES.length) || (typeof TOTAL_PAGES !== 'undefined' && TOTAL_PAGES) || 1)) * 100);
    var progressPercent = Math.min(100, Math.max(0, calculatedPercent));
    var progress = progressPercent;`;
      code = code.replace(progressCalcRegex, clampedProgressSnippet);
      modified = true;
      changes.push('Replaced progress calculation with validated page ID filter and Math.min(100, Math.max(0, ...)) clamp');
      audits.push({
        patternExpected: 'progress calculation formula',
        matchFound: true,
        replacementApplied: true,
      });
    } else if (!code.includes('Math.min(100')) {
      code += `\n\nfunction updateProgress(pageId) {
  var validList = (typeof validPageIds !== 'undefined' && Array.isArray(validPageIds))
    ? validPageIds
    : (typeof PAGES !== 'undefined' ? PAGES.map(function(p) { return typeof p === 'string' ? p : p.id; }) : []);
  if (validList.length > 0 && validList.indexOf(pageId) === -1) return;
  var rawCount = (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages)) ? visitedPages.length : 1;
  var totalCount = (typeof TOTAL_PAGES !== 'undefined' && Number(TOTAL_PAGES)) ? TOTAL_PAGES : ((typeof PAGES !== 'undefined' && PAGES.length) || 1);
  var calculated = Math.round((rawCount / totalCount) * 100);
  var progress = Math.min(100, Math.max(0, calculated));

  // Workday Learner-UX: Disambiguate "% viewed" vs "% complete"
  var currentLmsStatus = ((typeof SCORM !== 'undefined' && SCORM.get) ? SCORM.get('cmi.core.lesson_status') : '').toLowerCase();
  var isCoursePassed = currentLmsStatus === 'passed';
  var progressLabelText = (progress >= 100 && !isCoursePassed)
    ? '100% viewed'
    : (progress + (isCoursePassed ? '% complete' : '% viewed'));

  if (typeof document !== 'undefined') {
    var progressLabel = document.getElementById('progress-text') ||
      document.getElementById('progress-label') ||
      document.getElementById('progress-status') ||
      (document.querySelector ? document.querySelector('.progress-text') : null) ||
      (document.querySelector ? document.querySelector('.progress-label') : null);
    if (progressLabel) {
      progressLabel.textContent = progressLabelText;
      if (progressLabel.setAttribute) {
        progressLabel.setAttribute('data-progress-type', isCoursePassed ? 'complete' : 'viewed');
      }
    }
    var progressBar = document.getElementById('progress-bar') ||
      document.getElementById('progress-fill') ||
      (document.querySelector ? document.querySelector('.progress-bar') : null);
    if (progressBar) {
      if (progressBar.style) progressBar.style.width = progress + '%';
      if (progressBar.setAttribute) {
        progressBar.setAttribute('aria-valuenow', String(progress));
        progressBar.setAttribute('aria-valuetext', progressLabelText);
      }
    }
  }

  if (typeof SCORM !== 'undefined' && SCORM.set) {
    SCORM.set('cmi.core.lesson_location', pageId);
    /* SCORM remediation: progress updates location only, does not force completed */
    SCORM.commit();
  }
}\n`;
      modified = true;
      changes.push('Injected updateProgress with Math.min(100, Math.max(0, ...)) clamp and % viewed vs % complete disambiguation');
    }
  }

  // 4. QUIZ SUBMISSION & PASS/BEST-SCORE PRESERVATION
  const submitQuizPattern = /(?:(?:var|let|const)\s+submitQuiz\s*=\s*function|function\s+submitQuiz|submitQuiz\s*\([^)]*\))\s*\{/i;
  const quizBlock = findFunctionBlock(code, submitQuizPattern);

  const bestScoreSubmitBody = `
  var numericScore = Math.round(Number(score) || 0);
  var priorScoreRaw = (typeof SCORM !== 'undefined' && SCORM.get) ? SCORM.get('cmi.core.score.raw') : '';
  var priorScore = parseFloat(priorScoreRaw);
  if (isNaN(priorScore)) priorScore = 0;
  var bestScore = Math.max(priorScore, numericScore);

  if (typeof SCORM !== 'undefined' && SCORM.set) {
    SCORM.set('cmi.core.score.raw', bestScore);
    SCORM.set('cmi.core.score.min', 0);
    SCORM.set('cmi.core.score.max', 100);
  }

  var priorStatus = ((typeof SCORM !== 'undefined' && SCORM.get) ? SCORM.get('cmi.core.lesson_status') : '').toLowerCase();
  // Preserve prior pass! If prior was passed or bestScore >= 80, status is passed; otherwise failed
  var finalStatus = (priorStatus === 'passed' || bestScore >= 80) ? 'passed' : 'failed';

  if (typeof SCORM !== 'undefined' && SCORM.set) {
    SCORM.set('cmi.core.lesson_status', finalStatus);
    SCORM.commit();
  }

  // Display accessible modal (handles TRY AGAIN, SAVE & EXIT, EXIT COURSE)
  showAssessmentModal(numericScore, bestScore, finalStatus);
`;

  if (quizBlock) {
    code = code.slice(0, quizBlock.block.contentStart) + bestScoreSubmitBody + code.slice(quizBlock.block.contentEnd);
    modified = true;
    changes.push('Updated submitQuiz to preserve prior pass and bestScore, and launch accessible failure/pass modal');
    audits.push({
      patternExpected: 'submitQuiz function block',
      matchFound: true,
      replacementApplied: true,
    });
  }

  // 5. WORKDAY INLINE PAGE COMPATIBILITY IN loadPage
  const loadPagePattern = /(?:async\s+function\s+loadPage|(?:var|let|const)\s+loadPage\s*=\s*(?:async\s+)?function|loadPage\s*:\s*(?:async\s+)?function|function\s+loadPage|loadPage\s*\([^)]*\)\s*\{)/i;
  const loadPageBlock = findFunctionBlock(code, loadPagePattern);

  const inlineLoadPageBody = `
  var targetId = typeof page !== 'undefined' ? page : (typeof pageUrl !== 'undefined' ? pageUrl : (typeof pageId !== 'undefined' ? pageId : ''));
  var cleanKey = typeof targetId === 'string' ? targetId : (targetId && targetId.id ? targetId.id : '');
  var pageHtml = '';
  if (typeof window !== 'undefined' && window.SCORM_PAGE_CONTENT) {
    if (window.SCORM_PAGE_CONTENT[cleanKey]) {
      pageHtml = window.SCORM_PAGE_CONTENT[cleanKey];
    } else {
      var altKey = cleanKey.replace(/^pages\\//, '').replace(/\\.html$/, '');
      for (var k in window.SCORM_PAGE_CONTENT) {
        if (k === cleanKey || k === altKey || k.replace(/^pages\\//, '').replace(/\\.html$/, '') === altKey) {
          pageHtml = window.SCORM_PAGE_CONTENT[k];
          break;
        }
      }
    }
  }
  if (!pageHtml && typeof XMLHttpRequest !== 'undefined') {
    try {
      var xhr = new XMLHttpRequest();
      var reqUrl = (cleanKey.indexOf('.html') === -1 && cleanKey.indexOf('/') === -1) ? ('pages/' + cleanKey + '.html') : cleanKey;
      xhr.open('GET', reqUrl, false);
      xhr.send(null);
      if (xhr.status === 200 || xhr.status === 0) {
        pageHtml = xhr.responseText;
      }
    } catch (e) {
      console.warn('Inline page load fallback notice:', e);
    }
  }
  var targetContainer = (typeof document !== 'undefined') ? (document.getElementById('content-area') || document.getElementById('content-container') || document.getElementById('page-content') || document.querySelector('.page-content') || document.querySelector('main')) : null;
  if (targetContainer) {
    targetContainer.innerHTML = pageHtml;
  }
`;

  if (loadPageBlock) {
    code = code.slice(0, loadPageBlock.block.contentStart) + inlineLoadPageBody + code.slice(loadPageBlock.block.contentEnd);
    modified = true;
    changes.push('Updated loadPage to retrieve HTML from window.SCORM_PAGE_CONTENT without runtime fetch');
    audits.push({
      patternExpected: 'loadPage function block',
      matchFound: true,
      replacementApplied: true,
    });
  }

  // Re-run Finish remediation as safeguard to ensure nothing re-introduced status write
  const finSafeguard = repairCompactFinishCompletion(code);
  if (finSafeguard.modified) {
    code = finSafeguard.code;
    modified = true;
    changes.push(...finSafeguard.changes);
  }

  // 6. INJECT ACCESSIBLE ASSESSMENT MODAL & SAVE AND EXIT FUNCTIONS
  if (!code.includes('function showAssessmentModal')) {
    code += `\n\n/**
 * ACCESSIBLE ASSESSMENT MODAL (Workday Remediation)
 * Provides Try Again and Save & Exit controls for failed assessments,
 * and Exit Course for passed assessments.
 */
function showAssessmentModal(currentScore, bestScore, finalStatus) {
  if (typeof document === 'undefined') return;
  var existing = document.getElementById('scorm-assessment-modal');
  if (existing) existing.remove();

  var isPassed = finalStatus === 'passed';
  var modal = document.createElement('div');
  modal.id = 'scorm-assessment-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'scorm-modal-title');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.75);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:system-ui,-apple-system,sans-serif;padding:16px;';

  var content = document.createElement('div');
  content.style.cssText = 'background:#ffffff;border-radius:12px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.2);max-width:440px;width:100%;padding:24px;border:1px solid #e2e8f0;text-align:center;';

  if (!isPassed) {
    content.innerHTML = '<div role="dialog" aria-modal="true" style="width:48px;height:48px;border-radius:50%;background:#fee2e2;color:#dc2626;display:flex;align-items:center;justify-content:center;margin:0 auto 16px auto;font-size:24px;font-weight:bold;">!</div>' +
      '<h2 id="scorm-modal-title" style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Assessment Not Passed</h2>' +
      '<p style="margin:0 0 4px 0;font-size:16px;font-weight:600;color:#dc2626;">Score: ' + currentScore + '%</p>' +
      '<p style="margin:0 0 20px 0;font-size:13px;color:#64748b;line-height:1.5;">A score of 80% or higher is required to complete this course.</p>' +
      '<div style="display:flex;gap:12px;justify-content:center;">' +
        '<button id="btn-quiz-retry" type="button" aria-label="TRY AGAIN" data-action="TRY AGAIN" style="padding:10px 20px;border-radius:8px;background:#2563eb;color:#ffffff;font-size:13px;font-weight:600;border:none;cursor:pointer;">Retake Assessment</button>' +
        '<button id="btn-quiz-exit" type="button" aria-label="SAVE & EXIT" data-action="SAVE & EXIT" style="padding:10px 20px;border-radius:8px;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;font-size:13px;font-weight:600;cursor:pointer;">Save &amp; Exit</button>' +
      '</div>';
  } else {
    content.innerHTML = '<div role="dialog" aria-modal="true" style="width:48px;height:48px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;margin:0 auto 16px auto;font-size:24px;font-weight:bold;">\\u2713</div>' +
      '<h2 id="scorm-modal-title" style="margin:0 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Assessment Passed</h2>' +
      '<p style="margin:0 0 4px 0;font-size:16px;font-weight:600;color:#16a34a;">Score: ' + bestScore + '%</p>' +
      '<p style="margin:0 0 20px 0;font-size:13px;color:#64748b;line-height:1.5;">Congratulations! You have satisfied the 80% passing threshold.</p>' +
      '<div style="display:flex;gap:12px;justify-content:center;">' +
        '<button id="btn-quiz-exit-pass" type="button" style="padding:10px 24px;border-radius:8px;background:#16a34a;color:#ffffff;font-size:13px;font-weight:600;border:none;cursor:pointer;">EXIT COURSE</button>' +
      '</div>';
  }

  modal.appendChild(content);
  if (document.body) {
    document.body.appendChild(modal);
  }

  var btnRetry = document.getElementById('btn-quiz-retry');
  if (btnRetry) {
    btnRetry.addEventListener('click', function() {
      modal.remove();
      if (typeof resetAssessmentUI === 'function') {
        resetAssessmentUI();
      } else {
        var inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
        for (var i = 0; i < inputs.length; i++) {
          inputs[i].checked = false;
        }
      }
    });
  }

  var btnExit = document.getElementById('btn-quiz-exit') || document.getElementById('btn-quiz-exit-pass');
  if (btnExit) {
    btnExit.addEventListener('click', function() {
      saveAndExitCourse();
    });
  }
}
`;
    changes.push('Injected showAssessmentModal function with Try Again and Save & Exit');
    modified = true;
  }

  if (!code.includes('function saveAndExitCourse')) {
    code += `\n\n/**
 * SAVE & EXIT CONTROL (Workday Remediation)
 * Commits progress with suspend exit and closes course window without manufacturing completed status.
 */
function saveAndExitCourse() {
  if (typeof window !== 'undefined' && window._isExiting) return;
  if (typeof window !== 'undefined') window._isExiting = true;

  if (typeof SCORM !== 'undefined') {
    if (SCORM.set) SCORM.set('cmi.core.exit', 'suspend');
    if (SCORM.commit) SCORM.commit();
    if (SCORM.finish) SCORM.finish();
  }

  try {
    if (typeof window !== 'undefined' && window.close) window.close();
  } catch (e) {}

  if (typeof document !== 'undefined' && document.body) {
    var exitMsgEl = document.getElementById('exit-notification') || document.createElement('div');
    exitMsgEl.id = 'exit-notification';
    exitMsgEl.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.85);color:#fff;display:flex;align-items:center;justify-content:center;z-index:999999;font-family:system-ui,-apple-system,sans-serif;padding:24px;text-align:center;';
    exitMsgEl.innerHTML = '<div style="background:#1e293b;padding:24px 32px;border-radius:12px;border:1px solid #334155;max-width:440px;"><h3 style="margin:0 0 8px 0;font-size:18px;font-weight:600;">Course Progress Saved</h3><p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.5;">Your progress has been saved. You may close this course window.</p></div>';
    document.body.appendChild(exitMsgEl);
  }
}
`;
    changes.push('Injected saveAndExitCourse function with cmi.core.exit = suspend and non-destructive close');
    modified = true;
  }

  // 7. MANDATORY FINAL COMPLETION NORMALIZATION PASS
  // Ensures the final generated scripts/navigation.js never retains unconditional completed writes
  const finalNorm = normalizeFinalNextPageCompletion(code);
  if (finalNorm.modified) {
    code = finalNorm.code;
    modified = true;
    changes.push(...finalNorm.changes);
    audits.push(...finalNorm.audits);
  }
  const finFinalSafeguard = repairCompactFinishCompletion(code);
  if (finFinalSafeguard.modified) {
    code = finFinalSafeguard.code;
    modified = true;
    changes.push(...finFinalSafeguard.changes);
  }

  // ISSUE #1 FINAL RUNTIME HARDENING
  // Run after every legacy/stateful transformation so all callers — including tests,
  // patcher, and real package generation — receive the same effective runtime code.
  const issue1Runtime = hardenStatefulRuntimeCode(code, courseId);
  code = issue1Runtime.code;
  if (issue1Runtime.modified) {
    modified = true;
    changes.push(...issue1Runtime.changes);
    audits.push(...issue1Runtime.audits);
  }

  // Final sanity check: verify JavaScript syntax
  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after Stateful Workday navigation transformation: ${err.message}`);
  }

  return { code, modified, changes, audits };
}

