import fs from 'node:fs';

function replaceOnce(text, before, after, label) {
  if (!text.includes(before)) {
    if (text.includes(after.trim().slice(0, Math.min(80, after.trim().length)))) {
      console.log(`[skip] ${label} already applied`);
      return text;
    }
    throw new Error(`Patch anchor not found: ${label}`);
  }
  const first = text.indexOf(before);
  const second = text.indexOf(before, first + before.length);
  if (second !== -1) throw new Error(`Patch anchor is not unique: ${label}`);
  console.log(`[patch] ${label}`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function patchCodeTransformer() {
  const path = 'src/utils/codeTransformer.ts';
  let text = fs.readFileSync(path, 'utf8');

  text = replaceOnce(
    text,
    `import { findBalancedBlock, findEventListeners, findFunctionBlock } from './braceScanner';\n`,
    `import { findBalancedBlock, findEventListeners, findFunctionBlock } from './braceScanner';\nimport { hardenStatefulRuntimeCode } from './issue1StatefulRuntime';\n`,
    'codeTransformer import Issue #1 hardener'
  );

  const oldTail = `  // Final sanity check: verify JavaScript syntax\n  try {\n    new Function(code);\n  } catch (err: any) {\n    throw new Error(\`Syntax error after Stateful Workday navigation transformation: \${err.message}\`);\n  }\n\n  return { code, modified, changes, audits };\n}\n`;
  const newTail = `  // ISSUE #1 FINAL RUNTIME HARDENING\n  // Run after every legacy/stateful transformation so all callers — including tests,\n  // patcher, and real package generation — receive the same effective runtime code.\n  const issue1Runtime = hardenStatefulRuntimeCode(code, courseId);\n  code = issue1Runtime.code;\n  if (issue1Runtime.modified) {\n    modified = true;\n    changes.push(...issue1Runtime.changes);\n    audits.push(...issue1Runtime.audits);\n  }\n\n  // Final sanity check: verify JavaScript syntax\n  try {\n    new Function(code);\n  } catch (err: any) {\n    throw new Error(\`Syntax error after Stateful Workday navigation transformation: \${err.message}\`);\n  }\n\n  return { code, modified, changes, audits };\n}\n`;
  text = replaceOnce(text, oldTail, newTail, 'integrate Issue #1 hardener into Stateful transformer');
  fs.writeFileSync(path, text);
}

function patchPatcher() {
  const path = 'src/utils/patcher.ts';
  let text = fs.readFileSync(path, 'utf8');
  text = replaceOnce(
    text,
    `} from './codeTransformer';\n`,
    `} from './codeTransformer';\nimport { ensurePageContentManifestEntry } from './issue1StatefulRuntime';\n`,
    'patcher import manifest helper'
  );

  const manifestAnchor = `  // 4. Update index.html for script include and Save & Exit control\n`;
  const manifestInsert = `  // 3b. Ensure generated page-content.js is declared in the active SCORM resource.\n  if (pageMapResult.pageCount > 0 && updatedContents['imsmanifest.xml']) {\n    const originalManifest = updatedContents['imsmanifest.xml'];\n    const manifestResult = ensurePageContentManifestEntry(originalManifest);\n    if (manifestResult.modified) {\n      updatedContents['imsmanifest.xml'] = manifestResult.xml;\n      if (!filesModified.includes('imsmanifest.xml')) filesModified.push('imsmanifest.xml');\n      replacementsAttempted++;\n      replacementsApplied++;\n      codeChanges.push({\n        filePath: 'imsmanifest.xml',\n        description: 'Added scripts/page-content.js to the SCORM resource file list',\n        beforeSnippet: originalManifest.slice(0, 300),\n        afterSnippet: manifestResult.xml.slice(0, 300),\n      });\n      logs.push('Added scripts/page-content.js to imsmanifest.xml resource dependencies');\n    }\n  }\n\n  // 4. Update index.html for script include and Save & Exit control\n`;
  text = replaceOnce(text, manifestAnchor, manifestInsert, 'manifest page-content dependency');
  fs.writeFileSync(path, text);
}

function patchValidator() {
  const path = 'src/utils/validator.ts';
  let text = fs.readFileSync(path, 'utf8');
  text = replaceOnce(
    text,
    `import { findFunctionBlock } from './braceScanner';\n`,
    `import { findFunctionBlock } from './braceScanner';\nimport { validateIssue1StatefulRuntime } from './issue1StatefulRuntime';\n`,
    'validator import Issue #1 runtime checks'
  );

  text = replaceOnce(
    text,
    `  const unapprovedModifications = filesModified.filter(\n    (f) => !f.endsWith('.js') && !f.endsWith('.html') && !f.endsWith('.htm')\n  );\n`,
    `  const unapprovedModifications = filesModified.filter((f) => {\n    const lower = f.toLowerCase();\n    const approvedRuntime = lower.endsWith('.js') || lower.endsWith('.html') || lower.endsWith('.htm');\n    const approvedStatefulManifest =\n      originalPackage.repairProfile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1' &&\n      lower === 'imsmanifest.xml';\n    return !approvedRuntime && !approvedStatefulManifest;\n  });\n`,
    'allow controlled stateful manifest modification'
  );

  const oldRule9 = `  // 9. Pass threshold 80 preserved\n  let quizThreshold80 = true;\n  const assessmentFile = originalPackage.assessmentFiles?.[0]?.replace(/^\\[[^\\]]+\\]\\s*/, '') || 'scripts/navigation.js';\n  checks.push({\n    id: 9,\n    title: 'Quiz passing threshold remains 80%',\n    ruleName: 'Pass threshold 80 preserved',\n    file: assessmentFile,\n    passed: quizThreshold80,\n    details: 'PASS — quiz threshold remains 80%',\n  });\n`;
  const newRule9 = `  // 9. Pass threshold 80 preserved — inspect actual effective assessment source.\n  const assessmentFile = originalPackage.assessmentFiles?.[0]?.replace(/^\\[[^\\]]+\\]\\s*/, '') || 'scripts/navigation.js';\n  const thresholdSources = Object.entries(updatedFilesMap)\n    .filter(([f]) => f.endsWith('.js') || f.endsWith('.html') || f.endsWith('.htm'))\n    .map(([f, content]) => ({ f, content }));\n  let quizThreshold80 = false;\n  let thresholdEvidenceFile = assessmentFile;\n  for (const source of thresholdSources) {\n    if (/(?:__bestScore|bestScore|score|numericScore)\\s*>=\\s*80\\b/i.test(source.content) && /passed|failed/i.test(source.content)) {\n      quizThreshold80 = true;\n      thresholdEvidenceFile = source.f;\n      break;\n    }\n  }\n  checks.push({\n    id: 9,\n    title: 'Quiz passing threshold remains 80%',\n    ruleName: 'Pass threshold 80 preserved',\n    file: thresholdEvidenceFile,\n    passed: quizThreshold80,\n    details: quizThreshold80\n      ? 'PASS — effective assessment source explicitly applies an 80% passing threshold'\n      : 'FAIL — effective assessment source does not prove an 80% passing threshold',\n  });\n`;
  text = replaceOnce(text, oldRule9, newRule9, 'replace hardcoded Rule 9');

  const endAnchor = `  for (const c of checks) {\n`;
  const endInsert = `  if (originalPackage.repairProfile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {\n    checks.push(...validateIssue1StatefulRuntime(updatedFilesMap, zipFileList));\n  }\n\n  for (const c of checks) {\n`;
  text = replaceOnce(text, endAnchor, endInsert, 'append Issue #1 structural runtime validation');
  fs.writeFileSync(path, text);
}

function patchPackageProcessor() {
  const path = 'src/utils/packageProcessor.ts';
  let text = fs.readFileSync(path, 'utf8');
  text = replaceOnce(
    text,
    `import { findFunctionBlock } from './braceScanner';\n`,
    `import { findFunctionBlock } from './braceScanner';\nimport { verifyFinalZipIntegrity, FinalZipIntegrityResult } from './issue1StatefulRuntime';\n`,
    'packageProcessor import final ZIP verifier'
  );

  const blobAnchor = `  onStatusUpdate?.('Calculating repaired package SHA-256...');\n  const patchedSha256 = await calculateSha256(patchedBlob);\n`;
  const blobInsert = `  let issue1ZipIntegrity: FinalZipIntegrityResult | null = null;\n  if (pkg.repairProfile === 'KNOWN_SCORM12_STATEFUL_COMPACT_WORKDAY_V1') {\n    onStatusUpdate?.('Reopening final ZIP for integrity verification...');\n    issue1ZipIntegrity = await verifyFinalZipIntegrity(zip, patchedBlob, true);\n  }\n\n  onStatusUpdate?.('Calculating repaired package SHA-256...');\n  const patchedSha256 = await calculateSha256(patchedBlob);\n`;
  text = replaceOnce(text, blobAnchor, blobInsert, 'reopen final generated ZIP before signoff');

  const validationAnchor = `  // Add the passing invariant check\n  validation.checks.push({\n`;
  const validationInsert = `  if (issue1ZipIntegrity) {\n    validation.checks.push({\n      id: 98,\n      title: 'FINAL ZIP REOPEN / BINARY INTEGRITY',\n      ruleName: 'Final ZIP Integrity',\n      file: 'Recreated ZIP',\n      passed: issue1ZipIntegrity.passed,\n      details: issue1ZipIntegrity.details,\n    });\n  }\n\n  // Add the passing invariant check\n  validation.checks.push({\n`;
  text = replaceOnce(text, validationAnchor, validationInsert, 'add final ZIP integrity validation result');

  const passedAnchor = `  const validationPassed =\n    validation.allPassed &&\n    !targetDefectsRemaining &&\n    !statefulDefectsRemaining &&\n    !postScan.finishDefect.detected;\n`;
  const passedInsert = `  const validationPassed =\n    validation.allPassed &&\n    (!issue1ZipIntegrity || issue1ZipIntegrity.passed) &&\n    !targetDefectsRemaining &&\n    !statefulDefectsRemaining &&\n    !postScan.finishDefect.detected;\n`;
  text = replaceOnce(text, passedAnchor, passedInsert, 'make final ZIP integrity build-blocking');
  fs.writeFileSync(path, text);
}

patchCodeTransformer();
patchPatcher();
patchValidator();
patchPackageProcessor();
console.log('Issue #1 source patch applied.');
