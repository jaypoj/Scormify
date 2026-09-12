/**
 * Deterministic brace-aware and token-aware JavaScript code scanner and transformer.
 * Bypasses fragile multi-brace regex replacements by parsing balanced block delimiters
 * while respecting strings, comments, and nested structures.
 */

export interface BlockRange {
  start: number;       // Index of openChar '{'
  end: number;         // Index immediately after matching closeChar '}'
  contentStart: number;// Index of first char inside '{'
  contentEnd: number;  // Index of matching '}'
  body: string;        // Code inside the braces
  full: string;        // Code including '{' and '}'
}

/**
 * Finds the first balanced block bounded by openChar and closeChar at or after startPos.
 * Ignores characters inside single-quote, double-quote, and template strings,
 * as well as single-line and multi-line comments.
 */
export function findBalancedBlock(
  code: string,
  startPos: number,
  openChar: string = '{',
  closeChar: string = '}'
): BlockRange | null {
  const firstOpen = code.indexOf(openChar, startPos);
  if (firstOpen === -1) return null;

  let depth = 0;
  let inString: string | null = null;
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = firstOpen; i < code.length; i++) {
    const ch = code[i];
    const prev = i > 0 ? code[i - 1] : '';

    if (inLineComment) {
      if (ch === '\n' || ch === '\r') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (prev === '*' && ch === '/') {
        inBlockComment = false;
      }
      continue;
    }

    if (inString !== null) {
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === '\\') {
        isEscaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }

    // Check for comment starts
    if (ch === '/' && i + 1 < code.length) {
      const next = code[i + 1];
      if (next === '/') {
        inLineComment = true;
        i++;
        continue;
      } else if (next === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    // Check for string starts
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }

    // Count balance
    if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return {
          start: firstOpen,
          end: i + 1,
          contentStart: firstOpen + 1,
          contentEnd: i,
          body: code.slice(firstOpen + 1, i),
          full: code.slice(firstOpen, i + 1),
        };
      }
    }
  }

  return null;
}

/**
 * Finds all event listeners for a given event name (e.g., 'beforeunload', 'unload', 'load')
 * and returns their full range and balanced function body range.
 */
export function findEventListeners(
  code: string,
  eventNames: string[]
): Array<{
  matchIndex: number;
  matchLength: number;
  eventName: string;
  functionBlock: BlockRange;
}> {
  const results: Array<{
    matchIndex: number;
    matchLength: number;
    eventName: string;
    functionBlock: BlockRange;
  }> = [];

  for (const name of eventNames) {
    const regex = new RegExp(`(?:addEventListener\\s*\\(\\s*['"]${name}['"]|window\\.on${name}\\s*=|on${name}\\s*=)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(code)) !== null) {
      const block = findBalancedBlock(code, m.index, '{', '}');
      if (block) {
        results.push({
          matchIndex: m.index,
          matchLength: m[0].length,
          eventName: name,
          functionBlock: block,
        });
      }
    }
  }

  return results;
}

/**
 * Finds a method or function declaration by name/pattern and returns its balanced body.
 */
export function findFunctionBlock(
  code: string,
  pattern: RegExp
): { patternIndex: number; patternMatch: string; block: BlockRange } | null {
  const match = pattern.exec(code);
  if (!match) return null;

  const block = findBalancedBlock(code, match.index, '{', '}');
  if (!block) return null;

  return {
    patternIndex: match.index,
    patternMatch: match[0],
    block,
  };
}
