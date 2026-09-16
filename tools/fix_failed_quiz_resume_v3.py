from pathlib import Path

p = Path('src/utils/crossProfileWorkdayHardening.ts')
text = p.read_text()
old = "        get: function(k) { return typeof window.SCORM.get === 'function' ? window.SCORM.get(k) : ''; },"
new = "        get: function(k) { return typeof window.SCORM['get'] === 'function' ? window.SCORM['get'](k) : ''; },"
if old not in text:
    raise SystemExit('Expected optional window.SCORM.get adapter line not found')
text = text.replace(old, new, 1)
p.write_text(text)
print('Isolated optional compact SCORM getter from package-wide API getter detection.')
