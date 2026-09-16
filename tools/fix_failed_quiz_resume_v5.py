from pathlib import Path

p = Path('test-cross-profile-integrity.ts')
text = p.read_text()
old = "assert(!/scormifyExitCourse[\\s\\S]*?cmi\\.core\\.lesson_status[\\s\\S]*?(?:passed|failed|completed)/i.test(compactHtml), 'C1: exit handler mutates lesson_status');"
new = "assert(!/scormifyExitCourse[\\s\\S]*?(?:set|setValue|LMSSetValue)\\s*\\(\\s*['\"]cmi\\.core\\.lesson_status['\"]/i.test(compactHtml), 'C1: exit handler mutates lesson_status');"
if old not in text:
    raise SystemExit('C1 lesson_status mutation assertion anchor not found')
text = text.replace(old, new, 1)
p.write_text(text)
print('Updated C1 regression to distinguish a lesson_status read from an actual status write.')
