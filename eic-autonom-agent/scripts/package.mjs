import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BUILD_PROFILES,
  createManifestForProfile,
  detectBuildProfile
} from "../lib/build-profile.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseManifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const packageVersion = baseManifest.version;
const dist = path.resolve(root, "..", `eic-autonom-agent-v${packageVersion}-dist`);
fs.mkdirSync(dist, { recursive: true });

const sourcePath = path.join(dist, `eic-autonom-agent-v${packageVersion}-source.zip`);
const standardPath = path.join(dist, `eic-autonom-agent-v${packageVersion}-standard.zip`);
const browserPath = path.join(dist, `eic-autonom-agent-v${packageVersion}-browser.zip`);

const runtimeRoots = [
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "README.md",
  "PRIVACY.md",
  "build-info.json",
  "icons",
  "knowledge",
  "lib",
  "docs/V0_9_3_FORWARD_ONLY_POLICY.md",
  "docs/V0_9_3_DELIVERY_CONTEXT_ARCHITECTURE.md",
  "docs/CHANGELOG_V0_9_11.md",
  "docs/VERIFICATION_V0_9_11.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_9_11.md",
  "docs/V0_9_11_LANGUAGE_ATTESTATION.md",
  "docs/V0_10_0_ARCHITECTURE.md",
  "docs/CHANGELOG_V0_10_0.md",
  "docs/VERIFICATION_V0_10_0.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_0.md",
  "docs/V0_10_1_ARCHITECTURE.md",
  "docs/CHANGELOG_V0_10_1.md",
  "docs/VERIFICATION_V0_10_1.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_1.md",
  "docs/V0_10_2_ARCHITECTURE.md",
  "docs/CHANGELOG_V0_10_2.md",
  "docs/VERIFICATION_V0_10_2.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_2.md",
  "docs/V0_10_3_ARCHITECTURE.md",
  "docs/CHANGELOG_V0_10_3.md",
  "docs/VERIFICATION_V0_10_3.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_3.md",
  "docs/V0_10_4_ARCHITECTURE.md",
  "docs/CHANGELOG_V0_10_4.md",
  "docs/VERIFICATION_V0_10_4.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_4.md",
  "docs/V0_10_5_ARCHITECTURE.md",
  "docs/AUTOSTART_FAILURE_ANALYSIS_V0_10_5.md",
  "docs/CHANGELOG_V0_10_5.md",
  "docs/VERIFICATION_V0_10_5.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_5.md",
  "docs/V0_10_6_ARCHITECTURE.md",
  "docs/V0_10_6_REMEDIATION_MATRIX.md",
  "docs/V0_10_6_CHANGE_MANIFEST.json",
  "docs/FULL_AUDIT_V0_10_6.md",
  "docs/CHANGELOG_V0_10_6.md",
  "docs/VERIFICATION_V0_10_6.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_6.md",
  "docs/V0_10_7_ARCHITECTURE.md",
  "docs/V0_10_7_CHANGE_MANIFEST.json",
  "docs/CHANGELOG_V0_10_7.md",
  "docs/VERIFICATION_V0_10_7.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_7.md",
  "docs/V0_10_8_ARCHITECTURE.md",
  "docs/V0_10_8_CHANGE_MANIFEST.json",
  "docs/CHANGELOG_V0_10_8.md",
  "docs/VERIFICATION_V0_10_8.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_8.md",
  "docs/V0_10_9_ARCHITECTURE.md",
  "docs/V0_10_9_CHANGE_MANIFEST.json",
  "docs/CHANGELOG_V0_10_9.md",
  "docs/VERIFICATION_V0_10_9.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_9.md",
  "docs/V0_10_10_ARCHITECTURE.md",
  "docs/V0_10_10_CHANGE_MANIFEST.json",
  "docs/CHANGELOG_V0_10_10.md",
  "docs/VERIFICATION_V0_10_10.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_10.md",
  "docs/V0_10_11_ARCHITECTURE.md",
  "docs/V0_10_11_CHANGE_MANIFEST.json",
  "docs/V0_10_11_INCIDENT_ANALYSIS.md",
  "docs/CHANGELOG_V0_10_11.md",
  "docs/VERIFICATION_V0_10_11.md",
  "docs/DESKTOP_CHROME_ACCEPTANCE_V0_10_11.md"
];

function walkRuntimeFiles(baseRoot) {
  const files = [];
  const walk = (relative) => {
    const absolute = path.join(baseRoot, relative);
    if (!fs.existsSync(absolute)) return;
    const stat = fs.statSync(absolute);
    if (stat.isFile()) {
      files.push(relative.split(path.sep).join("/"));
      return;
    }
    for (const child of fs.readdirSync(absolute).sort()) {
      if (child === "__pycache__" || child === "history") continue;
      walk(path.join(relative, child));
    }
  };
  for (const item of runtimeRoots) walk(item);
  return [...new Set(files)].filter((item) => item !== "build-info.json").sort();
}

function writeBuildInfo(baseRoot, profile) {
  const manifest = JSON.parse(fs.readFileSync(path.join(baseRoot, "manifest.json"), "utf8"));
  const files = {};
  const combined = crypto.createHash("sha256");
  for (const relative of walkRuntimeFiles(baseRoot)) {
    const digest = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(baseRoot, relative)))
      .digest("hex");
    files[relative] = digest;
    combined.update(`${relative}:${digest}\n`);
  }
  const info = {
    schema: "eic.autonom.build.v1",
    version: manifest.version,
    profile,
    builtAt: new Date().toISOString(),
    fileCount: Object.keys(files).length,
    packageDigest: combined.digest("hex"),
    files
  };
  fs.writeFileSync(path.join(baseRoot, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`, "utf8");
  return info;
}

function copyTree(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const child of fs.readdirSync(source)) {
      if (child === "__pycache__" || child === "history") continue;
      copyTree(path.join(source, child), path.join(destination, child));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function createStage(profile) {
  const stage = path.join(dist, `.stage-${profile.toLowerCase()}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const relative of runtimeRoots) {
    const source = path.join(root, relative);
    if (fs.existsSync(source)) copyTree(source, path.join(stage, relative));
  }
  const manifest = createManifestForProfile(baseManifest, profile);
  fs.writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (detectBuildProfile(manifest) !== profile) throw new Error(`BUILD_PROFILE_READBACK_FAILED:${profile}`);
  const info = writeBuildInfo(stage, profile);
  return { stage, info };
}

const sourceInfo = writeBuildInfo(root, "SOURCE");
const standard = createStage(BUILD_PROFILES.STANDARD);
const browser = createStage(BUILD_PROFILES.BROWSER);

console.log(`SOURCE BUILD DIGEST: ${sourceInfo.packageDigest} (${sourceInfo.fileCount} filer)`);
console.log(`STANDARD BUILD DIGEST: ${standard.info.packageDigest} (${standard.info.fileCount} filer)`);
console.log(`BROWSER BUILD DIGEST: ${browser.info.packageDigest} (${browser.info.fileCount} filer)`);

const py = String.raw`
import sys, zipfile, pathlib, shutil
root=pathlib.Path(sys.argv[1]).resolve()
standard_stage=pathlib.Path(sys.argv[2]).resolve()
browser_stage=pathlib.Path(sys.argv[3]).resolve()
standard=pathlib.Path(sys.argv[4]).resolve()
browser=pathlib.Path(sys.argv[5]).resolve()
source=pathlib.Path(sys.argv[6]).resolve()
for output in (standard,browser,source):
    if output.exists(): output.unlink()
def zip_tree(base, output):
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        for child in sorted(base.rglob('*')):
            if not child.is_file(): continue
            rel=child.relative_to(base)
            if any(part in {'node_modules','dist','__pycache__'} for part in rel.parts): continue
            z.write(child,rel.as_posix())
    with zipfile.ZipFile(output) as z:
        bad=z.testzip()
        if bad: raise SystemExit(f'CRC failure {output}: {bad}')
zip_tree(standard_stage,standard)
zip_tree(browser_stage,browser)
zip_tree(root,source)
`;

const result = spawnSync("python3", [
  "-c", py, root, standard.stage, browser.stage,
  standardPath, browserPath, sourcePath
], { encoding: "utf8" });
fs.rmSync(standard.stage, { recursive: true, force: true });
fs.rmSync(browser.stage, { recursive: true, force: true });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
console.log(`STANDARD PACKAGE PASS: ${standardPath}`);
console.log(`BROWSER PACKAGE PASS: ${browserPath}`);
console.log(`SOURCE PACKAGE PASS: ${sourcePath}`);
