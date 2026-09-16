from pathlib import Path

p = Path('src/utils/codeTransformer.ts')
text = p.read_text()
old = r"    code += '\\n\\nfunction saveAndExitCourse() {' + statefulSaveExitBody + '\\n}\\n';"
new = r"    code += '\n\nfunction saveAndExitCourse() {' + statefulSaveExitBody + '\n}\n';"
if old not in text:
    raise SystemExit('Expected over-escaped Save & Exit injection line not found')
text = text.replace(old, new, 1)
p.write_text(text)
print('Corrected generated Save & Exit newline escaping.')
