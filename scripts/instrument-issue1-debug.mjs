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

const loadAnchor = `  code = loadResult.code;`;
if (!text.includes(loadAnchor)) throw new Error('Debug anchor not found: after loadPage');
text = text.replace(loadAnchor, `${loadAnchor}
  try { new Function(code); } catch (err) {
    var markerIndex = code.indexOf('ISSUE1_PARAMETER_DRIVEN_LOAD_PAGE');
    console.error('----- ISSUE1 MALFORMED LOADPAGE CONTEXT START -----');
    console.error(code.slice(Math.max(0, markerIndex - 500), markerIndex + 4500));
    console.error('----- ISSUE1 MALFORMED LOADPAGE CONTEXT END -----');
    throw new Error('ISSUE1 DEBUG after loadPage: ' + err.message);
  }`);

addAfter(`  code = quizResult.code;`, 'after submitQuiz');
addAfter(`  code = assessmentResult.code;`, 'after submitAssessment');

fs.writeFileSync(path, text);
console.log('Issue #1 syntax-stage diagnostics instrumented.');
