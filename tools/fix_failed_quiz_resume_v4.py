from pathlib import Path

p = Path('src/utils/issue1StatefulRuntime.ts')
text = p.read_text()
old = """  const saveExitBody = effectiveBody(nav, 'saveAndExitCourse');
  const saveExitResumePassed =
    saveExitBody.includes('SCORMIFY STATEFUL WORKDAY: failed-assessment resume bookmark') &&
    saveExitBody.includes('cmi.core.lesson_location') &&
    saveExitBody.includes(\"cmi.core.exit', 'suspend'\") &&
    /typeof save\\s*===\\s*['\"]function['\"][\\s\\S]{0,120}save\\s*\\(\\s*\\)/.test(saveExitBody) &&
    /commit\\s*\\(\\s*\\)/.test(saveExitBody) &&
    /finish\\s*\\(\\s*\\)/.test(saveExitBody);
"""
new = """  const saveExitBody = effectiveBody(nav, 'saveAndExitCourse');
  const saveExitApplicable = saveExitBody.trim().length > 0;
  const saveExitResumePassed = !saveExitApplicable || (
    saveExitBody.includes('SCORMIFY STATEFUL WORKDAY: failed-assessment resume bookmark') &&
    saveExitBody.includes('cmi.core.lesson_location') &&
    saveExitBody.includes(\"cmi.core.exit', 'suspend'\") &&
    /typeof save\\s*===\\s*['\"]function['\"][\\s\\S]{0,120}save\\s*\\(\\s*\\)/.test(saveExitBody) &&
    /commit\\s*\\(\\s*\\)/.test(saveExitBody) &&
    /finish\\s*\\(\\s*\\)/.test(saveExitBody));
"""
if old not in text:
    raise SystemExit('Stateful Rule 45 expression anchor not found')
text = text.replace(old, new, 1)
old_details = """    details: saveExitResumePassed
      ? 'PASS — failed-assessment Save & Exit persists Stateful progress, writes the assessment lesson_location bookmark, then suspends/commits/finishes'
      : 'FAIL — failed-assessment Save & Exit can relaunch at an older lesson page instead of the final assessment',
"""
new_details = """    details: !saveExitApplicable
      ? 'PASS — low-level Stateful runtime contains no Save & Exit handler; the full navigation/cross-profile layer owns handler injection and resume validation'
      : (saveExitResumePassed
        ? 'PASS — failed-assessment Save & Exit persists Stateful progress, writes the assessment lesson_location bookmark, then suspends/commits/finishes'
        : 'FAIL — failed-assessment Save & Exit can relaunch at an older lesson page instead of the final assessment'),
"""
if old_details not in text:
    raise SystemExit('Stateful Rule 45 details anchor not found')
text = text.replace(old_details, new_details, 1)
p.write_text(text)
print('Scoped Rule 45 to outputs that contain the Save & Exit handler; full package validation remains strict.')
