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

function findFunctionBlocksByName(code: string, name: string): Array<{ start: number; end: number; contentStart: number; contentEnd: number; signature: string; body: string }> {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)\\s*\\{|(?:var|let|const)\\s+${escaped}\\s*=\\s*(?:async\\s+)?function\\s*\\([^)]*\\)\\s*\\{)`,
    'gi'
  );
  const blocks: Array<{ start: number; end: number; contentStart: number; contentEnd: number; signature: string; body: string }> = [];
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

function canonicalGetProgressBody(): string {
  return `
  /* ISSUE1_PROGRESS_CLAMP */
  var pageList = (typeof PAGES !== 'undefined' && Array.isArray(PAGES)) ? PAGES : [];
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
  var pageId = (typeof currentPageId === 'function') ? currentPageId() : '';
  var stateObj = (stateArg && typeof stateArg === 'object') ? stateArg : {
    version: 1,
    visited: (typeof visited !== 'undefined' && visited instanceof Set) ? Array.from(visited) : ((typeof visitedPages !== 'undefined' && Array.isArray(visitedPages)) ? visitedPages.slice() : []),
    knowledgeChecks: (typeof completedKnowledgeChecks !== 'undefined' && completedKnowledgeChecks instanceof Set) ? Array.from(completedKnowledgeChecks) : [],
    audioPages: (typeof completedAudioPages !== 'undefined' && completedAudioPages instanceof Set) ? Array.from(completedAudioPages) : [],
    currentPageId: pageId
  };
  if (!stateObj.currentPageId && pageId) stateObj.currentPageId = pageId;
  var serialized = (typeof stateArg === 'string') ? stateArg : JSON.stringify(stateObj || {});
  var progress = (typeof getProgress === 'function') ? getProgress() : 0;
  progress = Math.min(100, Math.max(0, Number(progress) || 0));

  var scormObj = (typeof SCORM !== 'undefined' && SCORM) ? SCORM : ((typeof window !== 'undefined' && window.SCORM) ? window.SCORM : null);
  var ctx = (typeof initializeLmsContext === 'function') ? initializeLmsContext() : null;
  var lmsAvailable = ctx ? Boolean(ctx.available) : Boolean(scormObj && scormObj.api);
  var status = '';
  if (lmsAvailable && scormObj && typeof scormObj.get === 'function') {
    status = String(scormObj.get('cmi.core.lesson_status') || '').toLowerCase();
  }
  var progressLabelText = status === 'passed' ? (progress + '% complete') : (progress + '% viewed');

  if (typeof document !== 'undefined') {
    var progressFill = document.getElementById ? document.getElementById('progress-fill') : null;
    var progressText = document.getElementById ? document.getElementById('progress-text') : null;
    if (progressFill && progressFill.style) progressFill.style.width = progress + '%';
    if (progressText) progressText.textContent = progressLabelText;
  }

  if (lmsAvailable && scormObj && typeof scormObj.set === 'function') {
    scormObj.set('cmi.suspend_data', serialized);
    if (stateObj.currentPageId) scormObj.set('cmi.core.lesson_location', stateObj.currentPageId);
    if (typeof scormObj.commit === 'function') scormObj.commit();
  } else {
    if (typeof writeBrowserStorage === 'function') {
      writeBrowserStorage('sessionStorage', serialized);
      writeBrowserStorage('localStorage', serialized);
    }
  }
  return stateObj;
`;
}

function canonicalUpdateProgressBody(signature: string): string {
  const param = getFirstParameter(signature, 'pageId');
  return `
  /* ISSUE1_ACTIVE_PROGRESS_PATH */
  var pageIdValue = typeof ${param} !== 'undefined' ? ${param} : '';
  var pageList = (typeof PAGES !== 'undefined' && Array.isArray(PAGES)) ? PAGES : [];
  var validIds = pageList.map(function(p) { return typeof p === 'string' ? p : (p && p.id ? p.id : ''); }).filter(Boolean);
  if (pageIdValue && validIds.indexOf(String(pageIdValue)) !== -1) {
    if (typeof visited !== 'undefined' && visited instanceof Set) visited.add(String(pageIdValue));
    if (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages) && visitedPages.indexOf(String(pageIdValue)) === -1) visitedPages.push(String(pageIdValue));
  }
  if (typeof save === 'function') save();
  return (typeof getProgress === 'function') ? getProgress() : 0;
`;
}

function canonicalLoadPageBody(signature: string): string {
  const param = getFirstParameter(signature, 'index');
  return `
  /* ISSUE1_PARAMETER_DRIVEN_LOAD_PAGE */
  var requestedIndex = Number(${param});
  if (!Number.isFinite(requestedIndex)) requestedIndex = 0;
  var pageList = (typeof PAGES !== 'undefined' && Array.isArray(PAGES)) ? PAGES : [];
  if (pageList.length === 0) return '';
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
  if (!pageHtml) {
    throw new Error('Workday inline page content missing for page: ' + pageIdValue);
  }

  var targetContainer = (typeof document !== 'undefined') ? (
    (document.getElementById && (document.getElementById('content-container') || document.getElementById('content-area') || document.getElementById('page-content'))) ||
    (document.querySelector && (document.querySelector('.page-content') || document.querySelector('main')))
  ) : null;
  if (!targetContainer) throw new Error('Course content container not found');
  targetContainer.innerHTML = pageHtml;

  if (pageIdValue) {
    if (typeof visited !== 'undefined' && visited instanceof Set) visited.add(String(pageIdValue));
    if (typeof visitedPages !== 'undefined' && Array.isArray(visitedPages) && visitedPages.indexOf(String(pageIdValue)) === -1) visitedPages.push(String(pageIdValue));
  }
  if (typeof setNav === 'function') setNav();
  if (typeof initializeCaptions === 'function') initializeCaptions();
  if (typeof initializeCompletionGate === 'function') initializeCompletionGate();
  if (typeof save === 'function') save();
  return pageHtml;
`;
}

function hardenAssessmentFunction(code: string, functionName: string): { code: string; count: number } {
  return replaceFunctionBodies(code, functionName, (signature, oldBody) => {
    const scoreDefined = /(?:const|let|var)\s+score\b/.test(oldBody);
    const scoreExpr = scoreDefined ? 'score' : getFirstParameter(signature, 'score');
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
      if (block) {
        return oldBody.slice(0, scormIf.index) + hardenedBlock + oldBody.slice(block.end);
      }
    }

    let cleaned = oldBody
      .replace(/(?:SCORM|window\.SCORM)\.set\s*\(\s*['"]cmi\.core\.score\.(?:raw|min|max)['"][\s\S]*?\);?/gi, '')
      .replace(/(?:SCORM|window\.SCORM)\.set\s*\(\s*['"]cmi\.core\.lesson_status['"][\s\S]*?\);?/gi, '');
    cleaned += hardenedBlock;
    return cleaned;
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
  if (loadResult.count > 0) changes.push(`Hardened ${loadResult.count} loadPage function(s) to render PAGES[index] from SCORM_PAGE_CONTENT and preserve navigation side effects`);

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
    patternExpected: 'effective save path is LMS-authoritative',
    matchFound: saveResult.count > 0,
    replacementApplied: saveResult.count > 0,
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

  return {
    code,
    modified: code !== originalCode,
    changes,
    audits,
  };
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
  const loadPassed = loadBody.includes('ISSUE1_PARAMETER_DRIVEN_LOAD_PAGE') && loadBody.includes('SCORM_PAGE_CONTENT') && loadBody.includes('targetContainer.innerHTML') && loadBody.includes('setNav') && loadBody.includes('save()');
  checks.push({ id: 39, title: 'Effective loadPage(index) renders bundled page content', ruleName: 'Issue #1 Runtime loadPage', file: 'scripts/navigation.js', passed: loadPassed, details: loadPassed ? 'PASS — effective loadPage is parameter-driven and preserves render/navigation/save side effects' : 'FAIL — effective loadPage is not the hardened parameter-driven implementation' });

  const submitBodies = ['submitAssessment', 'submitQuiz'].map((name) => effectiveBody(nav, name)).filter(Boolean);
  const assessmentPassed = submitBodies.length > 0 && submitBodies.every((body) => body.includes('ISSUE1_ASSESSMENT_PRESERVATION') && body.includes('Math.max') && body.includes('__bestScore >= 80') && body.includes("__priorStatus === 'passed'") && body.includes('showAssessmentModal'));
  checks.push({ id: 40, title: 'Effective assessment path preserves pass/best score and invokes modal', ruleName: 'Issue #1 Assessment Runtime', file: 'scripts/navigation.js', passed: assessmentPassed, details: assessmentPassed ? 'PASS — active assessment function(s) preserve prior pass/best score at 80% threshold and invoke modal' : 'FAIL — active assessment submission path is not fully hardened' });

  const saveBodies = findFunctionBlocksByName(nav, 'save').map((b) => b.body.replace(/\s+/g, ' ').trim());
  const savePassed = saveBodies.length > 0 && saveBodies.every((body) => body.includes('ISSUE1_AUTHORITATIVE_SAVE')) && new Set(saveBodies).size === 1;
  checks.push({ id: 41, title: 'All effective save declarations are identical LMS-authoritative implementations', ruleName: 'Issue #1 Save Runtime', file: 'scripts/navigation.js', passed: savePassed, details: savePassed ? 'PASS — duplicate save declarations, if present, are behaviorally identical and isolate browser storage to standalone mode' : 'FAIL — conflicting or non-authoritative save implementation remains' });

  const progressBody = effectiveBody(nav, 'getProgress');
  const progressPassed = progressBody.includes('ISSUE1_PROGRESS_CLAMP') && progressBody.includes('Math.min(100') && progressBody.includes('validIds') && progressBody.includes('seen');
  checks.push({ id: 42, title: 'Active progress calculation filters/deduplicates valid pages and clamps to 100%', ruleName: 'Issue #1 Progress Runtime', file: 'scripts/navigation.js', passed: progressPassed, details: progressPassed ? 'PASS — effective getProgress filters invalid/duplicate IDs and clamps 0-100%' : 'FAIL — active progress path can exceed 100%' });

  const effectiveSave = effectiveBody(nav, 'save');
  const labelPassed = effectiveSave.includes("status === 'passed'") && effectiveSave.includes("'% complete'") && effectiveSave.includes("'% viewed'");
  checks.push({ id: 43, title: 'Active progress label distinguishes viewed from complete', ruleName: 'Issue #1 Progress Label Runtime', file: 'scripts/navigation.js', passed: labelPassed, details: labelPassed ? 'PASS — non-passed learners see % viewed; passed learners see % complete' : 'FAIL — active save path does not enforce viewed vs complete semantics' });

  const manifestPassed = zipFileList.some((f) => f.toLowerCase() === 'scripts/page-content.js') && /<file\b[^>]*href=['"]scripts\/page-content\.js['"]/i.test(manifest);
  checks.push({ id: 44, title: 'Generated page-content.js is present and manifest-referenced', ruleName: 'Issue #1 Manifest Dependency', file: 'imsmanifest.xml', passed: manifestPassed, details: manifestPassed ? 'PASS — scripts/page-content.js is present in ZIP and declared in the SCORM resource' : 'FAIL — generated page-content.js is missing from ZIP or manifest resource list' });

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
    if (missing.length) return { passed: false, details: `FAIL — final ZIP is missing original files: ${missing.slice(0, 5).join(', ')}` };
    const manifestEntry = finalZip.file('imsmanifest.xml');
    if (!manifestEntry) return { passed: false, details: 'FAIL — final ZIP cannot be reopened with imsmanifest.xml at root' };
    const manifest = await manifestEntry.async('string');
    if (requirePageContent) {
      if (!finalZip.file('scripts/page-content.js')) return { passed: false, details: 'FAIL — final ZIP missing scripts/page-content.js' };
      if (!/<file\b[^>]*href=['"]scripts\/page-content\.js['"]/i.test(manifest)) return { passed: false, details: 'FAIL — final manifest does not reference scripts/page-content.js' };
    }
    const binaryName = originalFiles.find((name) => /\.(?:png|jpe?g|gif|webp|mp3|wav|ogg|mp4|webm|pdf)$/i.test(name));
    if (binaryName) {
      const before = await originalZip.file(binaryName)!.async('uint8array');
      const after = await finalZip.file(binaryName)!.async('uint8array');
      if (before.length !== after.length) return { passed: false, details: `FAIL — binary asset size changed for ${binaryName}` };
      for (let i = 0; i < before.length; i++) {
        if (before[i] !== after[i]) return { passed: false, details: `FAIL — binary asset bytes changed for ${binaryName}` };
      }
    }
    return { passed: true, details: `PASS — final ZIP reopened successfully; ${finalFiles.length} files present; original files preserved${binaryName ? `; binary asset ${binaryName} byte-identical` : ''}` };
  } catch (err: any) {
    return { passed: false, details: `FAIL — final ZIP integrity verification error: ${err.message}` };
  }
}
