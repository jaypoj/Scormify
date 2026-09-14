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
