import fs from 'node:fs';

const path = 'src/utils/issue1StatefulRuntime.ts';
let text = fs.readFileSync(path, 'utf8');

function addAfter(anchor, label) {
  if (!text.includes(anchor)) throw new Error(`Debug anchor not found: ${label}`);
  text = text.replace(anchor, `${anchor}\n  try { new Function(code); } catch (err) { throw new Error('ISSUE1 DEBUG ${label}: ' + err.message); }`);
}

addAfter(`  let code = originalCode;`, 'initial');
addAfter(`  code = progressResult.code;`, 'after getProgress');
addAfter(`  code = saveResult.code;`, 'after save');
addAfter(`  code = updateResult.code;`, 'after updateProgress');
addAfter(`  code = loadResult.code;`, 'after loadPage');
addAfter(`  code = quizResult.code;`, 'after submitQuiz');
addAfter(`  code = assessmentResult.code;`, 'after submitAssessment');

fs.writeFileSync(path, text);
console.log('Issue #1 syntax-stage diagnostics instrumented.');
