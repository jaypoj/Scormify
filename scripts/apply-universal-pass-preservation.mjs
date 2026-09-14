import fs from 'node:fs';

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error(`Missing anchor: ${label}`);
  return text.replace(before, after);
}

// Patch patcher.ts integration.
{
  const path = 'src/utils/patcher.ts';
  let text = fs.readFileSync(path, 'utf8');

  const importAnchor = `import { ensurePageContentManifestEntry } from './issue1StatefulRuntime';`;
  if (!text.includes("from './universalPassPreservation'")) {
    text = replaceRequired(
      text,
      importAnchor,
      `${importAnchor}\nimport { hardenUniversalAssessmentRuntime } from './universalPassPreservation';`,
      'patcher import'
    );
  }

  const fallbackAnchor = `  // Inventory-guided fallback for remaining defects\n`;
  if (!text.includes('Universal assessment runtime hardening')) {
    const integration = `  // Universal assessment runtime hardening: preserve prior passed state and best LMS score across retakes.\n  const assessmentFilesToScan = openedFiles.filter((f) => {\n    const content = updatedContents[f];\n    return Boolean(content && (content.includes('submitAssessment') || (content.includes('assessmentData') && content.includes('SafeSCORM'))));\n  });\n\n  for (const filePath of assessmentFilesToScan) {\n    const original = updatedContents[filePath];\n    if (!original) continue;\n\n    patternsSearched += 1;\n    const result = hardenUniversalAssessmentRuntime(original);\n    for (const a of result.audits) {\n      audits.push({\n        filePath,\n        patternExpected: a.patternExpected,\n        matchFound: a.matchFound,\n        replacementApplied: a.replacementApplied,\n        contentChanged: a.replacementApplied,\n        reason: a.reason,\n      });\n      if (a.matchFound) patternsMatched++;\n      if (a.replacementApplied) {\n        replacementsAttempted++;\n        replacementsApplied++;\n      }\n    }\n\n    if (result.modified && result.code !== original) {\n      updatedContents[filePath] = result.code;\n      if (!filesModified.includes(filePath)) filesModified.push(filePath);\n      for (const desc of result.changes) {\n        codeChanges.push({\n          filePath,\n          description: desc,\n          beforeSnippet: original.slice(0, 300),\n          afterSnippet: result.code.slice(0, 300),\n        });\n      }\n      logs.push(\`Applied Universal assessment pass-preservation remediation to \${filePath}: \${result.changes.join('; ')}\`);\n    }\n  }\n\n`;
    const universalStart = text.indexOf(`export function patchUniversalScorm12Package(`);
    const fallbackPos = text.indexOf(fallbackAnchor, universalStart);
    if (universalStart < 0 || fallbackPos < 0) throw new Error('Universal patch integration anchor missing');
    text = text.slice(0, fallbackPos) + integration + text.slice(fallbackPos);
  }

  fs.writeFileSync(path, text);
  console.log('Integrated Universal assessment hardening into patcher.ts');
}

// Patch validator.ts with an explicit Universal-only acceptance gate.
{
  const path = 'src/utils/validator.ts';
  let text = fs.readFileSync(path, 'utf8');

  const importAnchor = `import { findThreshold80Evidence } from './legacyUniversalWorkday';`;
  if (!text.includes("validateUniversalPassPreservation")) {
    text = replaceRequired(
      text,
      importAnchor,
      `${importAnchor}\nimport { validateUniversalPassPreservation } from './universalPassPreservation';`,
      'validator import'
    );
  }

  const statefulAnchor = `  // =========================================================================\n  // RULES 21 - 30: DETERMINISTIC VALIDATION FOR STATEFUL COMPACT WORKDAY PROFILE`;
  if (!text.includes('Universal prior pass / best-score preservation')) {
    const universalCheck = `  // Universal-only runtime invariant: a later lower retake may not downgrade a prior pass or best score.\n  if (originalPackage.repairProfile === 'KNOWN_SCORM12_UNIVERSAL_QUIZ_80_V1') {\n    const universalPassCheck = validateUniversalPassPreservation(updatedFilesMap);\n    checks.push({\n      id: 40,\n      title: 'Universal prior pass / best-score preservation',\n      ruleName: 'Universal retake pass preservation',\n      file: universalPassCheck.file,\n      passed: universalPassCheck.passed,\n      details: universalPassCheck.details,\n    });\n  }\n\n`;
    text = replaceRequired(text, statefulAnchor, universalCheck + statefulAnchor, 'validator Stateful rules anchor');
  }

  fs.writeFileSync(path, text);
  console.log('Added Universal pass-preservation validation gate.');
}
