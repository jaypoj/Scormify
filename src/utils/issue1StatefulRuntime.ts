import JSZip from 'jszip';
import { ValidationItem } from '../types';
import { findBalancedBlock } from './braceScanner';

export interface RuntimeHardeningResult {
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

type NamedFunctionBlock = {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  signature: string;
  body: string;
};

function findFunctionBlocksByName(code: string, name: string): NamedFunctionBlock[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{|(?:var|let|const)\\s+${escaped}\\s*=\\s*(?:async\\s+)?function\\s*\\([^)]*\\)\\s*\\{)`,
    'gi'
  );
  const blocks: NamedFunctionBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const block = findBalancedBlock(code, match.index, '{', '}');
    if (!block) break;
    blocks.push({
      start: match.index,
      end: block.end,
      contentStart: block.contentStart,
      contentEnd: block.contentEnd,
      signature: code.slice(match.index, block.contentStart),
      body: block.body,
    });
    pattern.lastIndex = block.end;
  }
  return blocks;
}

function replaceFunctionBodies(
  code: string,
  name: string,
  bodyFactory: (signature: string, oldBody: string) => string
): { code: string; count: number } {
  const blocks = findFunctionBlocksByName(code, name);
  if (blocks.length === 0) return { code, count: 0 };
  let updated = code;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const nextBody = bodyFactory(block.signature, block.body);
    updated = updated.slice(0, block.contentStart) + nextBody + updated.slice(block.contentEnd);
  }
  return { code: updated, count: blocks.length };
}

function getFirstParameter(signature: string, fallback: string): string {
  const match = signature.match(/\(([^)]*)\)/);
  if (!match) return fallback;
  const first = match[1].split(',')[0]?.trim();
  return first && /^[A-Za-z_$][\w$]*$/.test(first) ? first : fallback;
}

function canonicalPageListExpression(): string {
  return `(typeof PAGES !== 'undefined' && Array.isArray(PAGES))
    ? PAGES
    : ((typeof validPageIds !== 'undefined' && Array.isArray(validPageIds)) ? validPageIds : [])`;
}

function canonicalGetProgressBody(): string {
  return `
  /* ISSUE1_PROGRESS_CLAMP */
  var pageList = ${canonicalPageListExpression()};
  var validIds = pageList.map(function(p) { return typeof p === 'string' ? p : (p && p.id ? p.id : ''); }).filter(Boolean);
  var rawVisited = [];
  if (typeof visited !== 'undefined') {
    rawVisited = visited instanceof Set ? Array.from(visited) : (Array.isArray(visited) ? visited.slice() : []);
  } else if (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages)) {
    rawVisited = visitedPages.slice();
  }
  var seen = Object.create(null);
  var validCount = 0;
  for (var i = 0; i < rawVisited.length; i++) {
    var id = String(rawVisited[i] || '');
    if (validIds.indexOf(id) !== -1 && !seen[id]) {
      seen[id] = true;
      validCount++;
    }
  }
  var total = validIds.length || 1;
  return Math.min(100, Math.max(0, Math.round((validCount / total) * 100)));
`;
}

function canonicalSaveBody(): string {
  return `
  /* ISSUE1_AUTHORITATIVE_SAVE */
  var stateArg = arguments.length > 0 ? arguments[0] : null;
  var pageId = (typeof currentPageId === 'function')
    ? currentPageId()
    : ((typeof currentPage !== 'undefined' && typeof currentPage === 'string') ? currentPage : '');
  var stateObj = (stateArg && typeof stateArg === 'object') ? stateArg : {
    version: 1,
    visited: (typeof visited !== 'undefined' && visited instanceof Set)
      ? Array.from(visited)
      : ((typeof visitedPages !== 'undefined' && Array.isArray(visitedPages)) ? visitedPages.slice() : []),
    knowledgeChecks: (typeof completedKnowledgeChecks !== 'undefined' && completedKnowledgeChecks instanceof Set)
      ? Array.from(completedKnowledgeChecks)
      : [],
    audioPages: (typeof completedAudioPages !== 'undefined' && completedAudioPages instanceof Set)
      ? Array.from(completedAudioPages)
      : [],
    currentPageId: pageId
  };
  if (!stateObj.currentPageId && pageId) stateObj.currentPageId = pageId;
  var serialized = (typeof stateArg === 'string') ? stateArg : JSON.stringify(stateObj || {});

  var progress = 0;
  if (typeof getProgress === 'function') {
    progress = getProgress();
  } else {
    var pageList = ${canonicalPageListExpression()};
    var validIds = pageList.map(function(p) { return typeof p === 'string' ? p : (p && p.id ? p.id : ''); }).filter(Boolean);
    var rawVisited = (typeof visited !== 'undefined' && visited instanceof Set)
      ? Array.from(visited)
      : ((typeof visitedPages !== 'undefined' && Array.isArray(visitedPages)) ? visitedPages.slice() : []);
    var seen = Object.create(null);
    var validCount = 0;
    for (var i = 0; i < rawVisited.length; i++) {
      var id = String(rawVisited[i] || '');
      if (validIds.indexOf(id) !== -1 && !seen[id]) {
        seen[id] = true;
        validCount++;
      }
    }
    progress = Math.round((validCount / (validIds.length || 1)) * 100);
  }
  progress = Math.min(100, Math.max(0, Number(progress) || 0));

  var scormObj = (typeof SCORM !== 'undefined' && SCORM)
    ? SCORM
    : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
  var ctx = (typeof initializeLmsContext === 'function') ? initializeLmsContext() : null;
  var lmsAvailable = ctx ? Boolean(ctx.available) : Boolean(scormObj && (scormObj.api || typeof scormObj.get === 'function'));
  var status = '';
  if (lmsAvailable && scormObj && typeof scormObj.get === 'function') {
    status = String(scormObj.get('cmi.core.lesson_status') || '').toLowerCase();
  }
  var progressLabelText = status === 'passed' ? (progress + '% complete') : (progress + '% viewed');

  if (typeof document !== 'undefined') {
    var progressFill = document.getElementById ? (document.getElementById('progress-fill') || document.getElementById('progress-bar')) : null;
    var progressText = document.getElementById ? (document.getElementById('progress-text') || document.getElementById('progress-label') || document.getElementById('progress-status')) : null;
    if (progressFill && progressFill.style) progressFill.style.width = progress + '%';
    if (progressText) progressText.textContent = progressLabelText;
  }

  if (lmsAvailable && scormObj && typeof scormObj.set === 'function') {
    scormObj.set('cmi.suspend_data', serialized);
    if (stateObj.currentPageId) scormObj.set('cmi.core.lesson_location', stateObj.currentPageId);
    if (typeof scormObj.commit === 'function') scormObj.commit();
  } else if (typeof writeBrowserStorage === 'function') {
    writeBrowserStorage('sessionStorage', serialized);
    writeBrowserStorage('localStorage', serialized);
  } else {
    if (typeof sessionStorage !== 'undefined' && typeof STORAGE_KEY !== 'undefined') sessionStorage.setItem(STORAGE_KEY, serialized);
    if (typeof localStorage !== 'undefined' && typeof STORAGE_KEY !== 'undefined') localStorage.setItem(STORAGE_KEY, serialized);
  }
  return stateObj;
`;
}

function canonicalUpdateProgressBody(signature: string): string {
  const param = getFirstParameter(signature, 'pageId');
  return `
  /* ISSUE1_ACTIVE_PROGRESS_PATH */
  var pageIdValue = typeof ${param} !== 'undefined' ? ${param} : '';
  var pageList = ${canonicalPageListExpression()};
  var validIds = pageList.map(function(p) { return typeof p === 'string' ? p : (p && p.id ? p.id : ''); }).filter(Boolean);
  if (pageIdValue && validIds.indexOf(String(pageIdValue)) !== -1) {
    if (typeof visited !== 'undefined' && visited instanceof Set) visited.add(String(pageIdValue));
    if (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages) && visitedPages.indexOf(String(pageIdValue)) === -1) visitedPages.push(String(pageIdValue));
  }

  var progress = 0;
  if (typeof getProgress === 'function') {
    progress = getProgress();
  } else {
    var rawVisited = (typeof visited !== 'undefined' && visited instanceof Set)
      ? Array.from(visited)
      : ((typeof visitedPages !== 'undefined' && Array.isArray(visitedPages)) ? visitedPages.slice() : []);
    var seen = Object.create(null);
    var validCount = 0;
    for (var i = 0; i < rawVisited.length; i++) {
      var id = String(rawVisited[i] || '');
      if (validIds.indexOf(id) !== -1 && !seen[id]) {
        seen[id] = true;
        validCount++;
      }
    }
    progress = Math.round((validCount / (validIds.length || 1)) * 100);
  }
  progress = Math.min(100, Math.max(0, Number(progress) || 0));

  if (typeof save === 'function') {
    save();
  } else {
    var scormObj = (typeof SCORM !== 'undefined' && SCORM) ? SCORM : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
    var status = (scormObj && typeof scormObj.get === 'function') ? String(scormObj.get('cmi.core.lesson_status') || '').toLowerCase() : '';
    var progressLabelText = status === 'passed' ? (progress + '% complete') : (progress + '% viewed');
    if (typeof document !== 'undefined') {
      var progressFill = document.getElementById ? (document.getElementById('progress-fill') || document.getElementById('progress-bar')) : null;
      var progressText = document.getElementById ? (document.getElementById('progress-text') || document.getElementById('progress-label') || document.getElementById('progress-status')) : null;
      if (progressFill && progressFill.style) progressFill.style.width = progress + '%';
      if (progressText) progressText.textContent = progressLabelText;
    }
    if (scormObj && typeof scormObj.set === 'function' && pageIdValue) {
      scormObj.set('cmi.core.lesson_location', String(pageIdValue));
      if (typeof scormObj.commit === 'function') scormObj.commit();
    }
  }
  return progress;
`;
}

function canonicalLoadPageBody(signature: string): string {
  const param = getFirstParameter(signature, 'index');
  return `
  /* ISSUE1_PARAMETER_DRIVEN_LOAD_PAGE */
  var rawTarget = typeof ${param} !== 'undefined' ? ${param} : 0;
  var pageList = ${canonicalPageListExpression()};
  if (pageList.length === 0) return '';

  var requestedIndex = Number(rawTarget);
  if (!Number.isFinite(requestedIndex)) {
    var normalizedTarget = String(rawTarget || '').replace(/^pages\\//, '').replace(/\\.html?$/i, '');
    requestedIndex = 0;
    for (var i = 0; i < pageList.length; i++) {
      var candidate = pageList[i];
      var candidateId = typeof candidate === 'string' ? candidate : (candidate && candidate.id ? candidate.id : '');
      var normalizedCandidateId = String(candidateId || '').replace(/^pages\\//, '').replace(/\\.html?$/i, '');
      if (candidateId === rawTarget || normalizedCandidateId === normalizedTarget) {
        requestedIndex = i;
        break;
      }
    }
  }
  requestedIndex = Math.max(0, Math.min(pageList.length - 1, Math.floor(requestedIndex)));
  if (typeof current !== 'undefined') current = requestedIndex;

  var entry = pageList[requestedIndex];
  var pageIdValue = typeof entry === 'string' ? entry : (entry && entry.id ? entry.id : '');
  var normalizedKey = String(pageIdValue || '').replace(/^pages\\//, '').replace(/\\.html?$/i, '');
  var pageHtml = '';
  var contentMap = (typeof window !== 'undefined' && window.SCORM_PAGE_CONTENT) ? window.SCORM_PAGE_CONTENT : null;
  if (contentMap) {
    pageHtml = contentMap[normalizedKey] || contentMap[pageIdValue] || contentMap['pages/' + normalizedKey + '.html'] || '';
    if (!pageHtml) {
      for (var key in contentMap) {
        var normalizedCandidate = String(key).replace(/^pages\\//, '').replace(/\\.html?$/i, '');
        if (normalizedCandidate === normalizedKey) {
          pageHtml = contentMap[key];
          break;
        }
      }
    }
  }
  if (!pageHtml) throw new Error('Workday inline page content missing for page: ' + pageIdValue);

  var targetContainer = (typeof document !== 'undefined') ? (
    (document.getElementById && (document.getElementById('content-container') || document.getElementById('content-area') || document.getElementById('page-content'))) ||
    (document.querySelector && (document.querySelector('.page-content') || document.querySelector('main')))
  ) : null;
  if (!targetContainer) throw new Error('Course content container not found');
  targetContainer.innerHTML = pageHtml;

  if (pageIdValue) {
    if (typeof visited !== 'undefined' && visited instanceof Set) visited.add(String(pageIdValue));
    if (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages) && visitedPages.indexOf(String(pageIdValue)) === -1) visitedPages.push(String(pageIdValue));
    if (typeof currentPage !== 'undefined' && typeof currentPage !== 'function') currentPage = String(pageIdValue);
  }
  if (typeof setNav === 'function') setNav();
  if (typeof initializeCaptions === 'function') initializeCaptions();
  if (typeof initializeCompletionGate === 'function') initializeCompletionGate();
  if (typeof save === 'function') save();
  else if (typeof updateProgress === 'function') updateProgress(pageIdValue);
  return pageHtml;
`;
}

function hardenAssessmentFunction(code: string, functionName: string): { code: string; count: number } {
  return replaceFunctionBodies(code, functionName, (signature, oldBody) => {
    const scoreDefined = /(?:const|let|var)\s+score\b/.test(oldBody);
    const numericScoreDefined = /(?:const|let|var)\s+numericScore\b/.test(oldBody);
    const scoreExpr = scoreDefined ? 'score' : (numericScoreDefined ? 'numericScore' : getFirstParameter(signature, 'score'));
    const scormIf = /if\s*\(\s*(?:window\.)?SCORM\s*\)\s*\{/i.exec(oldBody);
    const hardenedBlock = `
  /* ISSUE1_ASSESSMENT_PRESERVATION */
  var __currentScore = Math.round(Number(${scoreExpr}) || 0);
  var __scorm = (typeof SCORM !== 'undefined' && SCORM) ? SCORM : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
  var __priorScoreRaw = (__scorm && typeof __scorm.get === 'function') ? __scorm.get('cmi.core.score.raw') : '';
  var __priorScore = parseFloat(__priorScoreRaw);
  if (isNaN(__priorScore)) __priorScore = 0;
  var __bestScore = Math.max(__priorScore, __currentScore);
  var __priorStatus = (__scorm && typeof __scorm.get === 'function') ? String(__scorm.get('cmi.core.lesson_status') || '').toLowerCase() : '';
  var __finalStatus = (__priorStatus === 'passed' || __bestScore >= 80) ? 'passed' : 'failed';
  if (__scorm && typeof __scorm.set === 'function') {
    if (typeof qs !== 'undefined' && qs && typeof qs.forEach === 'function' && typeof recordAssessmentInteraction === 'function') qs.forEach(recordAssessmentInteraction);
    __scorm.set('cmi.core.score.raw', __bestScore);
    __scorm.set('cmi.core.score.min', 0);
    __scorm.set('cmi.core.score.max', 100);
    __scorm.set('cmi.core.lesson_status', __finalStatus);
    if (typeof __scorm.commit === 'function') __scorm.commit();
  }
  if (typeof showAssessmentModal === 'function') showAssessmentModal(__currentScore, __bestScore, __finalStatus);
`;

    if (scormIf) {
      const block = findBalancedBlock(oldBody, scormIf.index, '{', '}');
      if (block) return oldBody.slice(0, scormIf.index) + hardenedBlock + oldBody.slice(block.end);
    }

    const cleaned = oldBody
      .replace(/(?:SCORM|window\.SCORM)\.set\s*\(\s*['"]cmi\.core\.score\.(?:raw|min|max)['"][\s\S]*?\);?/gi, '')
      .replace(/(?:SCORM|window\.SCORM)\.set\s*\(\s*['"]cmi\.core\.lesson_status['"][\s\S]*?\);?/gi, '');
    return cleaned + hardenedBlock;
  });
}

export function hardenStatefulRuntimeCode(originalCode: string, _courseId: string = 'ScormCourse'): RuntimeHardeningResult {
  let code = originalCode;
  const changes: string[] = [];
  const audits: RuntimeHardeningResult['audits'] = [];

  const progressResult = replaceFunctionBodies(code, 'getProgress', () => canonicalGetProgressBody());
  code = progressResult.code;
  if (progressResult.count > 0) changes.push(`Hardened ${progressResult.count} getProgress function(s) with valid-page filtering and 0-100% clamp`);

  const saveResult = replaceFunctionBodies(code, 'save', () => canonicalSaveBody());
  code = saveResult.code;
  if (saveResult.count > 0) changes.push(`Hardened ${saveResult.count} save function(s) so LMS mode performs zero browser-storage writes`);

  const updateResult = replaceFunctionBodies(code, 'updateProgress', (signature) => canonicalUpdateProgressBody(signature));
  code = updateResult.code;
  if (updateResult.count > 0) changes.push(`Hardened ${updateResult.count} updateProgress function(s) to use the active clamped progress/save path`);

  const loadResult = replaceFunctionBodies(code, 'loadPage', (signature) => canonicalLoadPageBody(signature));
  code = loadResult.code;
  if (loadResult.count > 0) changes.push(`Hardened ${loadResult.count} loadPage function(s) to render its parameter from SCORM_PAGE_CONTENT and preserve navigation side effects`);

  const quizResult = hardenAssessmentFunction(code, 'submitQuiz');
  code = quizResult.code;
  const assessmentResult = hardenAssessmentFunction(code, 'submitAssessment');
  code = assessmentResult.code;
  if (quizResult.count + assessmentResult.count > 0) {
    changes.push(`Hardened ${quizResult.count + assessmentResult.count} assessment submission function(s) for 80% threshold, best-score/pass preservation, and modal invocation`);
  }

  audits.push({
    patternExpected: 'effective loadPage uses its parameter and SCORM_PAGE_CONTENT',
    matchFound: loadResult.count > 0,
    replacementApplied: loadResult.count > 0,
  });
  audits.push({
    patternExpected: 'effective save path is LMS-authoritative when a save function exists',
    matchFound: saveResult.count > 0,
    replacementApplied: saveResult.count > 0,
    reason: saveResult.count === 0 ? 'No save() function present in this runtime variant' : undefined,
  });
  audits.push({
    patternExpected: 'submitQuiz or submitAssessment hardened',
    matchFound: quizResult.count + assessmentResult.count > 0,
    replacementApplied: quizResult.count + assessmentResult.count > 0,
  });

  try {
    new Function(code);
  } catch (err: any) {
    throw new Error(`Syntax error after Issue #1 runtime hardening: ${err.message}`);
  }

  return { code, modified: code !== originalCode, changes, audits };
}

export function ensurePageContentManifestEntry(manifestXml: string): { xml: string; modified: boolean } {
  if (!manifestXml || /<file\b[^>]*href=['"]scripts\/page-content\.js['"]/i.test(manifestXml)) {
    return { xml: manifestXml, modified: false };
  }

  const resourceRegex = /<resource\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  let fallbackClose = -1;
  while ((match = resourceRegex.exec(manifestXml)) !== null) {
    const close = manifestXml.indexOf('</resource>', match.index);
    if (close === -1) continue;
    if (fallbackClose === -1) fallbackClose = close;
    const block = manifestXml.slice(match.index, close);
    if (/href=['"][^'"]*index\.html['"]/i.test(match[0]) || /<file\b[^>]*href=['"][^'"]*index\.html['"]/i.test(block)) {
      const insertion = `\n      <file href="scripts/page-content.js"/>`;
      return { xml: manifestXml.slice(0, close) + insertion + manifestXml.slice(close), modified: true };
    }
  }

  if (fallbackClose !== -1) {
    const insertion = `\n      <file href="scripts/page-content.js"/>`;
    return { xml: manifestXml.slice(0, fallbackClose) + insertion + manifestXml.slice(fallbackClose), modified: true };
  }
  return { xml: manifestXml, modified: false };
}

function effectiveBody(code: string, name: string): string {
  const blocks = findFunctionBlocksByName(code, name);
  return blocks.length ? blocks[blocks.length - 1].body : '';
}

export function validateIssue1StatefulRuntime(updatedFilesMap: { [fileName: string]: string }, zipFileList: string[]): ValidationItem[] {
  const nav = updatedFilesMap['scripts/navigation.js'] || Object.entries(updatedFilesMap).find(([k]) => k.toLowerCase().includes('navigation') && k.endsWith('.js'))?.[1] || '';
  const manifest = updatedFilesMap['imsmanifest.xml'] || '';
  const checks: ValidationItem[] = [];

  const loadBody = effectiveBody(nav, 'loadPage');
  const loadPassed = loadBody.includes('ISSUE1_PARAMETER_DRIVEN_LOAD_PAGE') && loadBody.includes('SCORM_PAGE_CONTENT') && loadBody.includes('targetContainer.innerHTML');
  checks.push({ id: 39, title: 'Effective loadPage parameter renders bundled page content', ruleName: 'Issue #1 Runtime loadPage', file: 'scripts/navigation.js', passed: loadPassed, details: loadPassed ? 'PASS — effective loadPage is parameter-driven and renders bundled content while preserving supported navigation side effects' : 'FAIL — effective loadPage is not the hardened parameter-driven implementation' });

  const submitBodies = ['submitAssessment', 'submitQuiz'].map((name) => effectiveBody(nav, name)).filter(Boolean);
  const assessmentPassed = submitBodies.length > 0 && submitBodies.every((body) => body.includes('ISSUE1_ASSESSMENT_PRESERVATION') && body.includes('Math.max') && body.includes('__bestScore >= 80') && body.includes("__priorStatus === 'passed'") && body.includes('showAssessmentModal'));
  checks.push({ id: 40, title: 'Effective assessment path preserves pass/best score and invokes modal', ruleName: 'Issue #1 Assessment Runtime', file: 'scripts/navigation.js', passed: assessmentPassed, details: assessmentPassed ? 'PASS — active assessment function(s) preserve prior pass/best score at 80% threshold and invoke modal' : 'FAIL — active assessment submission path is not fully hardened' });

  const saveBodies = findFunctionBlocksByName(nav, 'save').map((b) => b.body.replace(/\s+/g, ' ').trim());
  const hasRawBrowserSave = /function\s+save\b[\s\S]{0,2500}?(?:localStorage|sessionStorage)\.setItem/i.test(nav) && !nav.includes('ISSUE1_AUTHORITATIVE_SAVE');
  const savePassed = saveBodies.length === 0 ? !hasRawBrowserSave : (saveBodies.every((body) => body.includes('ISSUE1_AUTHORITATIVE_SAVE')) && new Set(saveBodies).size === 1);
  checks.push({ id: 41, title: 'Effective save path is LMS-authoritative', ruleName: 'Issue #1 Save Runtime', file: 'scripts/navigation.js', passed: savePassed, details: savePassed ? (saveBodies.length ? 'PASS — all save declarations are identical LMS-authoritative implementations; browser storage is standalone-only' : 'PASS — this runtime variant has no conflicting save() implementation') : 'FAIL — conflicting or non-authoritative save implementation remains' });

  const progressBody = effectiveBody(nav, 'getProgress');
  const updateBody = effectiveBody(nav, 'updateProgress');
  const effectiveSave = effectiveBody(nav, 'save');
  const hardenedGetProgress = progressBody.includes('ISSUE1_PROGRESS_CLAMP') && progressBody.includes('Math.min(100') && progressBody.includes('validIds') && progressBody.includes('seen');
  const hardenedUpdateProgress = updateBody.includes('ISSUE1_ACTIVE_PROGRESS_PATH') && updateBody.includes('Math.min(100') && updateBody.includes('validIds');
  const hardenedSaveProgress = effectiveSave.includes('ISSUE1_AUTHORITATIVE_SAVE') && effectiveSave.includes('progress = Math.min(100') && effectiveSave.includes('validIds') && effectiveSave.includes('seen');
  const progressPassed = hardenedGetProgress || hardenedUpdateProgress || hardenedSaveProgress;
  checks.push({ id: 42, title: 'Active progress calculation filters/deduplicates valid pages and clamps to 100%', ruleName: 'Issue #1 Progress Runtime', file: 'scripts/navigation.js', passed: progressPassed, details: progressPassed ? 'PASS — effective progress path filters invalid/duplicate IDs and clamps 0-100%' : 'FAIL — active progress path can exceed 100%' });

  const labelSource = effectiveSave || updateBody;
  const labelPassed = labelSource.includes("status === 'passed'") && labelSource.includes("'% complete'") && labelSource.includes("'% viewed'");
  checks.push({ id: 43, title: 'Active progress label distinguishes viewed from complete', ruleName: 'Issue #1 Progress Label Runtime', file: 'scripts/navigation.js', passed: labelPassed, details: labelPassed ? 'PASS — non-passed learners see % viewed; passed learners see % complete' : 'FAIL — active progress path does not enforce viewed vs complete semantics' });

  const saveExitBody = effectiveBody(nav, 'saveAndExitCourse');
  const saveExitApplicable = saveExitBody.trim().length > 0;
  const saveExitResumePassed = !saveExitApplicable || (
    saveExitBody.includes('SCORMIFY STATEFUL WORKDAY: failed-assessment resume bookmark') &&
    saveExitBody.includes('cmi.core.lesson_location') &&
    saveExitBody.includes("cmi.core.exit', 'suspend'") &&
    /typeof save\s*===\s*['"]function['"][\s\S]{0,120}save\s*\(\s*\)/.test(saveExitBody) &&
    /commit\s*\(\s*\)/.test(saveExitBody) &&
    /finish\s*\(\s*\)/.test(saveExitBody));
  checks.push({
    id: 45,
    title: 'Failed-assessment Save & Exit preserves assessment resume bookmark',
    ruleName: 'Issue #1 Failed Assessment Resume Runtime',
    file: 'scripts/navigation.js',
    passed: saveExitResumePassed,
    details: !saveExitApplicable
      ? 'PASS — low-level Stateful runtime contains no Save & Exit handler; the full navigation/cross-profile layer owns handler injection and resume validation'
      : (saveExitResumePassed
        ? 'PASS — failed-assessment Save & Exit persists Stateful progress, writes the assessment lesson_location bookmark, then suspends/commits/finishes'
        : 'FAIL — failed-assessment Save & Exit can relaunch at an older lesson page instead of the final assessment'),
  });

  const pageContentPresent = zipFileList.some((f) => f.toLowerCase() === 'scripts/page-content.js');
  const manifestRequired = pageContentPresent;
  const manifestPassed = !manifestRequired || /<file\b[^>]*href=['"]scripts\/page-content\.js['"]/i.test(manifest);
  checks.push({ id: 44, title: 'Generated page-content.js is present and manifest-referenced', ruleName: 'Issue #1 Manifest Dependency', file: 'imsmanifest.xml', passed: manifestPassed, details: manifestPassed ? (manifestRequired ? 'PASS — scripts/page-content.js is present in ZIP and declared in the SCORM resource' : 'PASS — this package did not generate page-content.js') : 'FAIL — generated page-content.js is missing from the manifest resource list' });

  return checks;
}

export interface FinalZipIntegrityResult {
  passed: boolean;
  details: string;
}

export async function verifyFinalZipIntegrity(originalZip: JSZip, finalBlob: Blob, requirePageContent: boolean): Promise<FinalZipIntegrityResult> {
  if (!finalBlob || finalBlob.size <= 0) return { passed: false, details: 'FAIL — final ZIP Blob is empty' };
  try {
    const finalZip = await JSZip.loadAsync(await finalBlob.arrayBuffer());
    const finalFiles = Object.keys(finalZip.files).filter((name) => !finalZip.files[name].dir);
    const originalFiles = Object.keys(originalZip.files).filter((name) => !originalZip.files[name].dir);
    const missing = originalFiles.filter((name) => !finalFiles.includes(name));
    if (missing.length) return { passed: false, details: `FAIL — final ZIP is missing expected files: ${missing.slice(0, 5).join(', ')}` };

    const manifestEntry = finalZip.file('imsmanifest.xml');
    if (!manifestEntry) return { passed: false, details: 'FAIL — final ZIP cannot be reopened with imsmanifest.xml at root' };
    const manifest = await manifestEntry.async('string');
    if (requirePageContent) {
      if (!finalZip.file('scripts/page-content.js')) return { passed: false, details: 'FAIL — final ZIP missing scripts/page-content.js' };
      if (!/<file\b[^>]*href=['"]scripts\/page-content\.js['"]/i.test(manifest)) return { passed: false, details: 'FAIL — final manifest does not reference scripts/page-content.js' };
    }

    const binaryName = originalFiles.find((name) => /\.(?:png|jpe?g|gif|webp|mp3|wav|ogg|mp4|webm|pdf)$/i.test(name));
    if (binaryName) {
      const beforeEntry = originalZip.file(binaryName);
      const afterEntry = finalZip.file(binaryName);
      if (!beforeEntry || !afterEntry) return { passed: false, details: `FAIL — binary asset missing after packaging: ${binaryName}` };
      const before = await beforeEntry.async('uint8array');
      const after = await afterEntry.async('uint8array');
      if (before.length !== after.length) return { passed: false, details: `FAIL — binary asset size changed for ${binaryName}` };
      for (let i = 0; i < before.length; i++) {
        if (before[i] !== after[i]) return { passed: false, details: `FAIL — binary asset bytes changed for ${binaryName}` };
      }
    }

    return { passed: true, details: `PASS — final ZIP reopened successfully; ${finalFiles.length} files present; expected files preserved${binaryName ? `; binary asset ${binaryName} byte-identical` : ''}` };
  } catch (err: any) {
    return { passed: false, details: `FAIL — final ZIP integrity verification error: ${err.message}` };
  }
}
