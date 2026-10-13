"""Release consistency check for the Greenfield package next to this rare/ directory.
Usage (repository root): python3 -I rare/repro_harness/verify_release.py 1.9.13"""
import json, re, subprocess, sys
from pathlib import Path

expected=sys.argv[1]
root=Path(__file__).resolve().parents[2]/'greenfield'
read=lambda name:(root/name).read_text()
manifest=json.loads(read('manifest.json'))
lock=json.loads(read('package-lock.json'))
versions={
    'manifest':manifest['version'],'package':json.loads(read('package.json'))['version'],
    'lock':lock['version'],'lockRoot':lock['packages']['']['version'],'VERSION':read('VERSION').strip(),
    'worker':re.search(r'APP_VERSION = "([^"]+)"',read('lib/contracts.mjs'))[1],
    'bridge':re.search(r'CONTENT_VERSION = "([^"]+)"',read('content.js'))[1],
    'panel':re.search(r'name="greenfield-version" content="([^"]+)"',read('sidepanel.html'))[1],
    'panelHeading':re.search(r'Greenfield <span>v([^<]+)',read('sidepanel.html'))[1]}
assert set(versions.values())=={expected},versions
adapter=int(re.search(r'adapterVersion:(\d+)',read('lib/model-observation.js'))[1])
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
missing=set(re.findall(r'\$\("([^"]+)"\)',panel_js))-set(re.findall(r'\bid="([^"]+)"',panel))
assert not missing,missing
print(json.dumps({'result':'PASS','versions':versions,'adapterVersion':adapter,'syntaxChecked':len(scripts),
    'manifestReferences':len(refs),'relativeImports':'PASS','panelIds':'PASS',
    'node':subprocess.check_output(['node','--version'],text=True).strip()},ensure_ascii=False))
