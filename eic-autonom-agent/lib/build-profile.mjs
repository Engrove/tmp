const CHATGPT_HOSTS = Object.freeze([
  "https://chatgpt.com/*",
  "https://chat.openai.com/*"
]);

export const BUILD_PROFILE_SCHEMA = "eic.autonom.build-profile.v1";

export const BUILD_PROFILES = Object.freeze({
  STANDARD: "STANDARD",
  BROWSER: "BROWSER"
});

export const BROWSER_OPTIONAL_HOSTS = Object.freeze([
  "http://*/*",
  "https://*/*"
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set((values || []).map(String))];
}

function containsAll(values, required) {
  const set = new Set(values || []);
  return required.every((item) => set.has(item));
}

export function exactOriginPattern(urlValue) {
  let url;
  try {
    url = new URL(String(urlValue || ""));
  } catch {
    throw new Error("WEB_ORIGIN_URL_INVALID");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("WEB_ORIGIN_PROTOCOL_UNSUPPORTED");
  }
  if (["chatgpt.com", "chat.openai.com"].includes(url.hostname.toLowerCase())) {
    throw new Error("WEB_ORIGIN_CHATGPT_FORBIDDEN");
  }
  return `${url.origin}/*`;
}

export function createManifestForProfile(baseManifest, profile) {
  if (!Object.values(BUILD_PROFILES).includes(profile)) {
    throw new Error(`BUILD_PROFILE_UNKNOWN:${profile}`);
  }
  const manifest = clone(baseManifest || {});
  manifest.permissions = unique(manifest.permissions);
  manifest.host_permissions = unique(manifest.host_permissions);
  delete manifest.optional_permissions;
  delete manifest.optional_host_permissions;
  delete manifest.eic_build_profile;

  if (profile === BUILD_PROFILES.STANDARD) {
    manifest.permissions = manifest.permissions.filter((item) => item !== "debugger");
    manifest.host_permissions = manifest.host_permissions.filter(
      (item) => !BROWSER_OPTIONAL_HOSTS.includes(item)
    );
    return manifest;
  }

  manifest.name = `${String(manifest.name || "EIC Autonom Agent")} Browser`;
  manifest.description = `${String(manifest.description || "")} Browserprofilen kräver explicit originbehörighet och använder en bounded CDP-session.`;
  manifest.permissions = unique([...manifest.permissions, "debugger"]);
  manifest.optional_host_permissions = [...BROWSER_OPTIONAL_HOSTS];
  return manifest;
}

export function detectBuildProfile(manifestValue) {
  const manifest = manifestValue || {};
  const permissions = unique(manifest.permissions);
  const hosts = unique(manifest.host_permissions);
  const optionalHosts = unique(manifest.optional_host_permissions);
  const hasDebugger = permissions.includes("debugger");
  const hasGeneralRequiredHost = BROWSER_OPTIONAL_HOSTS.some((host) => hosts.includes(host));
  const hasBrowserOptionalHosts = containsAll(optionalHosts, BROWSER_OPTIONAL_HOSTS);

  if (!hasDebugger && !hasGeneralRequiredHost && optionalHosts.length === 0) {
    if (!containsAll(hosts, CHATGPT_HOSTS)) throw new Error("STANDARD_PROFILE_CHATGPT_HOSTS_MISSING");
    return BUILD_PROFILES.STANDARD;
  }

  if (hasDebugger && !hasGeneralRequiredHost && hasBrowserOptionalHosts) {
    return BUILD_PROFILES.BROWSER;
  }

  throw new Error("BUILD_PROFILE_PERMISSION_MIX_INVALID");
}

export function buildProfileSummary(manifestValue) {
  const profile = detectBuildProfile(manifestValue);
  return {
    schema: BUILD_PROFILE_SCHEMA,
    version: 1,
    profile,
    debuggerAvailable: profile === BUILD_PROFILES.BROWSER,
    optionalWebOrigins: profile === BUILD_PROFILES.BROWSER
      ? [...BROWSER_OPTIONAL_HOSTS]
      : [],
    requiredHosts: unique(manifestValue?.host_permissions)
  };
}
