#!/usr/bin/env python3
"""
check_admx.py
=============
Static consistency check of the Group Policy template against the code that reads it:
  * ADMX and every ADML are well-formed XML
  * every $(string.X) / $(presentation.X) used in the ADMX exists in EVERY ADML
  * every presentation refId points at an element id defined in the ADMX
  * every registry valueName in the ADMX is read by PolicyReader.cs, and vice versa
  * the ModePolicy enum values match the C# ModePolicy enum order
Run:  python3 verify/check_admx.py
"""
import os
import re
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NS = {"p": "http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions"}
ok = True


def check(name, cond, detail=""):
    global ok
    ok &= bool(cond)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))


admx_path = os.path.join(ROOT, "deploy", "PresenceLock.admx")
admx_text = open(admx_path, encoding="utf-8").read()
admx = ET.parse(admx_path).getroot()
check("ADMX is well-formed XML", admx is not None)

string_refs = set(re.findall(r"\$\(string\.([A-Za-z0-9_]+)\)", admx_text))
pres_refs = set(re.findall(r"\$\(presentation\.([A-Za-z0-9_]+)\)", admx_text))
element_ids = {e.get("id") for e in admx.iter() if e.get("id") and e.tag.split("}")[1] in
               ("enum", "decimal", "text", "boolean", "list")}
value_names = {e.get("valueName") for e in admx.iter() if e.get("valueName")}

for lang in ("en-US", "sv-SE"):
    path = os.path.join(ROOT, "deploy", lang, "PresenceLock.adml")
    adml = ET.parse(path).getroot()
    strings = {s.get("id") for s in adml.iterfind(".//p:stringTable/p:string", NS)}
    presentations = {p.get("id"): p for p in adml.iterfind(".//p:presentationTable/p:presentation", NS)}
    missing_s = string_refs - strings
    missing_p = pres_refs - set(presentations)
    check(f"{lang}: all {len(string_refs)} string ids resolve", not missing_s, ", ".join(sorted(missing_s)))
    check(f"{lang}: all {len(pres_refs)} presentations resolve", not missing_p, ", ".join(sorted(missing_p)))
    bad_ref = [c.get("refId") for p in presentations.values() for c in p
               if c.get("refId") and c.get("refId") not in element_ids]
    check(f"{lang}: every presentation refId exists in ADMX", not bad_ref, ", ".join(bad_ref))

reader = open(os.path.join(ROOT, "src", "PresenceLock.App", "Settings", "PolicyReader.cs"), encoding="utf-8").read()
read_names = set(re.findall(r'(?:Dword|Str)\(k,\s*"([A-Za-z]+)"\)', reader))
check("every ADMX valueName is read by PolicyReader.cs", not (value_names - read_names),
      ", ".join(sorted(value_names - read_names)))
check("every value PolicyReader.cs reads is defined in the ADMX", not (read_names - value_names),
      ", ".join(sorted(read_names - value_names)))

mc = open(os.path.join(ROOT, "src", "PresenceLock.Core", "ModeController.cs"), encoding="utf-8").read()
enum_order = re.search(r"enum ModePolicy\s*\{([^}]*)\}", mc).group(1).replace(" ", "").split(",")
enum_vals = [int(v.get("value")) for v in admx.iterfind(".//p:enum[@valueName='ModePolicy']/p:item/p:value/p:decimal", NS)]
check("ModePolicy ADMX values 0/1/2 match C# enum Auto/ForceLearning/ForceEnforcing",
      enum_vals == [0, 1, 2] and enum_order == ["Auto", "ForceLearning", "ForceEnforcing"],
      f"{enum_vals} vs {enum_order}")

print("\n  " + ("ADMX/ADML CONSISTENT WITH CODE" if ok else "INCONSISTENCIES FOUND"))
sys.exit(0 if ok else 1)
