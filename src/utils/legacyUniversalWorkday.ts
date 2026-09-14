import { ValidationItem } from '../types';
import { findBalancedBlock } from './braceScanner';

export interface LegacyUniversalResult {
  code: string;
  modified: boolean;
  changes: string[];
  requiresInlinePageMap: boolean;
}

type FunctionRange = {
  contentStart: number;
  contentEnd: number;
};

function findFunctionRange(code: string, pattern: RegExp): FunctionRange | null {
  const match = pattern.exec(code);
  if (!match) return null;
  const block = findBalancedBlock(code, match.index, '{', '}');
  return block ? { contentStart: block.contentStart, contentEnd: block.contentEnd } : null;
}

function replaceInsideRange(code: string, range: FunctionRange, replaceBody: (body: string) => string): { code: string; changed: boolean } {
  const body = code.slice(range.contentStart, range.contentEnd);
  const nextBody = replaceBody(body);
  return nextBody === body
    ? { code, changed: false }
    : { code: code.slice(0, range.contentStart) + nextBody + code.slice(range.contentEnd), changed: true };
}

export function isLegacyUniversalRuntime(code: string): boolean {
  return Boolean(
    code &&
    /\bSafeSCORM\b/.test(code) &&
    /\bCOURSE_SETTINGS\b/.test(code) &&
    /window\.assessmentData\s*=/.test(code) &&
    /window\.submitAssessment\s*=\s*(?:async\s+)?function/.test(code) &&
    /function\s+navigateToPage\s*\(/.test(code)
  );
}

function inlinePageHelper(): string {
  return `
function __scormifyInlinePageResponse(pageId) {
  var map = (typeof window !== 'undefined' && window.SCORM_PAGE_CONTENT) ? window.SCORM_PAGE_CONTENT : null;
  var rawId = String(pageId || '');
  var normalized = rawId.replace(/^pages\\//, '').replace(/\\.html?$/i, '');
  var html = map ? (map[rawId] || map[normalized] || map['pages/' + normalized + '.html'] || '') : '';
  if (!html && map) {
    for (var key in map) {
      var normalizedKey = String(key).replace(/^pages\\//, '').replace(/\\.html?$/i, '');
      if (normalizedKey === normalized) { html = map[key]; break; }
    }
  }
  return Promise.resolve({ ok: Boolean(html), text: function() { return Promise.resolve(html); } });
}
`;
}

export function updateLegacyUniversalRuntime(originalCode: string): LegacyUniversalResult {
  if (!isLegacyUniversalRuntime(originalCode)) {
    return { code: originalCode, modified: false, changes: [], requiresInlinePageMap: false };
  }

  let code = originalCode;
  const changes: string[] = [];
  let requiresInlinePageMap = false;

  const pageFetch = /fetch\s*\(\s*`pages\/\$\{pageId\}\.html`\s*\)/g;
  if (pageFetch.test(code)) {
    pageFetch.lastIndex = 0;
    code = code.replace(pageFetch, '__scormifyInlinePageResponse(pageId)');
    if (!code.includes('function __scormifyInlinePageResponse')) {
      const anchor = /function\s+navigateToPage\s*\(/.exec(code);
      if (anchor) code = code.slice(0, anchor.index) + inlinePageHelper() + '\n' + code.slice(anchor.index);
    }
    requiresInlinePageMap = true;
    changes.push('Replaced legacy page fetch with bundled page-content bridge');
  }

  return { code, modified: code !== originalCode, changes, requiresInlinePageMap };
}

export interface ThresholdEvidence {
  passed: boolean;
  file: string;
  details: string;
}

export function findThreshold80Evidence(updatedFilesMap: Record<string, string>, preferredFile = 'scripts/navigation.js'): ThresholdEvidence {
  const sources = Object.entries(updatedFilesMap).filter(([file]) => /\.(?:js|html?|xml)$/i.test(file));

  for (const [file, content] of sources) {
    if (/(?:score|percentage|numericScore|bestScore|__bestScore)\s*>=\s*80\b/i.test(content) && /passed|failed/i.test(content)) {
      return { passed: true, file, details: 'PASS — effective assessment source directly applies an 80% passing threshold' };
    }
  }

  for (const [file, content] of sources) {
    const declarations = Array.from(content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*80\b/g));
    for (const declaration of declarations) {
      const name = declaration[1];
      const comparison = new RegExp(`(?:score|percentage|numericScore|bestScore|__bestScore)\\s*>=\\s*${name}\\b`, 'i');
      if (comparison.test(content) && /passed|failed/i.test(content)) {
        return { passed: true, file, details: `PASS — resolved ${name}=80 and found the assessment comparison using that value` };
      }
    }
  }

  for (const [file, content] of sources) {
    const properties = Array.from(content.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*80\b/g));
    for (const propertyMatch of properties) {
      const property = propertyMatch[1];
      const comparison = new RegExp(`(?:score|percentage|numericScore|bestScore|__bestScore)\\s*>=\\s*[A-Za-z_$][\\w$]*\\.${property}\\b`, 'i');
      if (comparison.test(content) && /passed|failed/i.test(content)) {
        return { passed: true, file, details: `PASS — resolved configuration property ${property}=80 and found the assessment comparison using that value` };
      }
    }
  }

  return { passed: false, file: preferredFile, details: 'FAIL — effective assessment source does not prove an 80% passing threshold' };
}
