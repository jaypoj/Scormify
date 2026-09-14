export interface ThresholdEvidence {
  passed: boolean;
  file: string;
  details: string;
}

/**
 * Resolve the deterministic 80% threshold forms used by the custom SCORM families:
 * - score >= 80
 * - const passingScore = 80; percentage >= passingScore
 * - passMark: 80; score >= COURSE_SETTINGS.passMark
 */
export function findThreshold80Evidence(
  updatedFilesMap: Record<string, string>,
  preferredFile = 'scripts/navigation.js'
): ThresholdEvidence {
  const sources = Object.entries(updatedFilesMap).filter(([file]) => /\.(?:js|html?|xml)$/i.test(file));

  for (const [file, content] of sources) {
    if (/(?:score|percentage|numericScore|bestScore|__bestScore)\s*>=\s*80\b/i.test(content) && /passed|failed/i.test(content)) {
      return {
        passed: true,
        file,
        details: 'PASS — effective assessment source directly applies an 80% passing threshold',
      };
    }
  }

  for (const [file, content] of sources) {
    const declarations = Array.from(content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*80\b/g));
    for (const declaration of declarations) {
      const name = declaration[1];
      const comparison = new RegExp(
        `(?:score|percentage|numericScore|bestScore|__bestScore)\\s*>=\\s*${name}\\b`,
        'i'
      );
      if (comparison.test(content) && /passed|failed/i.test(content)) {
        return {
          passed: true,
          file,
          details: `PASS — resolved ${name}=80 and found the assessment comparison using that value`,
        };
      }
    }
  }

  for (const [file, content] of sources) {
    const properties = Array.from(content.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*80\b/g));
    for (const propertyMatch of properties) {
      const property = propertyMatch[1];
      const comparison = new RegExp(
        `(?:score|percentage|numericScore|bestScore|__bestScore)\\s*>=\\s*[A-Za-z_$][\\w$]*\\.${property}\\b`,
        'i'
      );
      if (comparison.test(content) && /passed|failed/i.test(content)) {
        return {
          passed: true,
          file,
          details: `PASS — resolved configuration property ${property}=80 and found the assessment comparison using that value`,
        };
      }
    }
  }

  return {
    passed: false,
    file: preferredFile,
    details: 'FAIL — effective assessment source does not prove an 80% passing threshold',
  };
}
