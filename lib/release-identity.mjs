/**
 * v0.10.12: one owner for release identity.
 *
 * v0.10.11 shipped with `CONTENT_SCRIPT_VERSION = "0.10.11"` in
 * `lib/contracts.mjs` and `const VERSION = "0.10.10";` in `content.js`. The
 * content script is a classic script and cannot import the contract, so the
 * literal has to be duplicated — and nothing compared the two. `ensureContentScript`
 * verifies the injected bridge against `CONTENT_SCRIPT_VERSION`, so every tab
 * link and every Autostart failed with
 * "Content bridge kunde inte verifieras (förväntad 0.10.11, observerad 0.10.10)"
 * before a run could even be created.
 *
 * The per-file SHA-256 manifest was cryptographically correct and semantically
 * useless here: it proved the wrong file had been packaged unchanged.
 *
 * These helpers are pure so the validator, the package script and the test suite
 * can all apply the identical rule to the same five values.
 */

export const RELEASE_IDENTITY_SCHEMA = "eic.autonom.release-identity.v1";

export const RELEASE_IDENTITY_SURFACES = Object.freeze([
  "packageVersion",
  "manifestVersion",
  "appVersion",
  "contentScriptVersion",
  "contentSourceVersion"
]);

const CONTENT_VERSION_PATTERN = /^\s*const\s+VERSION\s*=\s*"([^"]+)"\s*;\s*$/m;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Read the runtime version literal out of `content.js` source text. This is the
 * value the injected bridge reports from `EIC_PING`, which is the only value
 * `ensureContentScript` actually compares against.
 */
export function parseContentScriptVersion(source = "") {
  const match = CONTENT_VERSION_PATTERN.exec(String(source));
  return match ? match[1] : "";
}

/**
 * @returns {{ok: boolean, version: string, surfaces: object, mismatches: string[], errors: string[]}}
 */
export function evaluateReleaseIdentity({
  packageVersion = "",
  manifestVersion = "",
  appVersion = "",
  contentScriptVersion = "",
  contentSourceVersion = ""
} = {}) {
  const surfaces = {
    packageVersion: String(packageVersion || ""),
    manifestVersion: String(manifestVersion || ""),
    appVersion: String(appVersion || ""),
    contentScriptVersion: String(contentScriptVersion || ""),
    contentSourceVersion: String(contentSourceVersion || "")
  };

  const errors = [];
  for (const surface of RELEASE_IDENTITY_SURFACES) {
    const value = surfaces[surface];
    if (!value) {
      errors.push(`${surface} saknas`);
      continue;
    }
    if (!SEMVER_PATTERN.test(value)) errors.push(`${surface} är inte en giltig version: ${value}`);
  }

  const reference = surfaces.packageVersion;
  const mismatches = RELEASE_IDENTITY_SURFACES
    .filter((surface) => surfaces[surface] !== reference)
    .map((surface) => `${surface}=${surfaces[surface] || "(saknas)"} ≠ packageVersion=${reference || "(saknas)"}`);

  return {
    schema: RELEASE_IDENTITY_SCHEMA,
    ok: errors.length === 0 && mismatches.length === 0,
    version: reference,
    surfaces,
    mismatches,
    errors
  };
}

export function releaseIdentityFailureDetail(verdict) {
  const parts = [...(verdict?.errors || []), ...(verdict?.mismatches || [])];
  if (!parts.length) return "";
  return `RELEASE_IDENTITY_MISMATCH: ${parts.join("; ")}`;
}
