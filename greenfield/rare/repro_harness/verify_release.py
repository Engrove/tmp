import json, re, subprocess, hashlib
from pathlib import Path

root=Path(__file__).resolve().parents[2]
read=lambda name:(root/name).read_text()
manifest=json.loads(read('manifest.json'))
lock=json.loads(read('package-lock.json'))
versions={
    'manifest':manifest['version'], 'package':json.loads(read('package.json'))['version'],
    'lock':lock['version'], 'lockRoot':lock['packages']['']['version'],
    'VERSION':read('VERSION').strip(),
    'worker':re.search(r'APP_VERSION = "([^"]+)"',read('lib/contracts.mjs'))[1],
    'bridge':re.search(r'CONTENT_VERSION = "([^"]+)"',read('content.js'))[1],
    'panel':re.search(r'name="greenfield-version" content="([^"]+)"',read('sidepanel.html'))[1],
    'panelHeading':re.search(r'Greenfield <span>v([^<]+)',read('sidepanel.html'))[1]}
assert set(versions.values())=={'1.9.12'},versions
refs=[manifest['background']['service_worker'],manifest['side_panel']['default_path'],*manifest['icons'].values()]
for content in manifest['content_scripts']:refs+=content['js']
for name in refs:assert (root/name).is_file(),name
files=[p for p in root.rglob('*') if p.is_file() and not {'node_modules','rare'}.intersection(p.relative_to(root).parts)]
scripts=[p for p in files if p.suffix in {'.js','.mjs'}]
for path in scripts:
    subprocess.run(['node','--check',str(path)],check=True,capture_output=True)
    for name in re.findall(r'(?:from\s*|import\s*)[\'"](\.[^\'"]+)[\'"]',path.read_text()):
        assert (path.parent/name).resolve().is_file(),(path,name)
panel=read('sidepanel.html');panel_js=read('sidepanel.js')
ids=set(re.findall(r'\bid="([^"]+)"',panel))
missing=set(re.findall(r'\$\("([^"]+)"\)',panel_js))-ids
assert not missing,missing
report={'result':'PASS','versions':versions,'syntaxChecked':len(scripts),'manifestReferences':len(refs),
        'relativeImports':'PASS','panelIds':'PASS','permissions':manifest['permissions'],
        'node':subprocess.check_output(['node','--version'],text=True).strip(),
        'runtimeChecks':'Node/JSDOM and simulated Chrome APIs; no live signed-in browser execution'}
(root/'rare/package_verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
