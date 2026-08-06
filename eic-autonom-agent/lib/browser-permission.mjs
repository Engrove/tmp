import {
  BUILD_PROFILES,
  exactOriginPattern
} from "./build-profile.mjs";

export const WEB_PERMISSION_STATES = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  UNAVAILABLE_STANDARD_PROFILE: "UNAVAILABLE_STANDARD_PROFILE",
  NOT_REQUESTED: "NOT_REQUESTED",
  REQUESTING: "REQUESTING",
  GRANTED: "GRANTED",
  DENIED: "DENIED",
  REVOKED: "REVOKED",
  ERROR: "ERROR"
});

function assertBrowserProfile(profile) {
  if (profile !== BUILD_PROFILES.BROWSER) {
    throw new Error("WEB_PERMISSION_BROWSER_PROFILE_REQUIRED");
  }
}

function assertChromePermissions(chromeApi) {
  if (!chromeApi?.permissions?.contains || !chromeApi?.permissions?.request || !chromeApi?.permissions?.remove) {
    throw new Error("WEB_PERMISSION_API_UNAVAILABLE");
  }
}

export async function containsExactOriginPermission(chromeApi, urlValue) {
  assertChromePermissions(chromeApi);
  const pattern = exactOriginPattern(urlValue);
  const granted = await chromeApi.permissions.contains({ origins: [pattern] });
  return { pattern, granted: Boolean(granted) };
}

export async function requestExactOriginPermission(chromeApi, profile, urlValue) {
  assertBrowserProfile(profile);
  assertChromePermissions(chromeApi);
  const pattern = exactOriginPattern(urlValue);
  const requested = await chromeApi.permissions.request({ origins: [pattern] });
  const readback = await chromeApi.permissions.contains({ origins: [pattern] });
  return {
    pattern,
    requested: Boolean(requested),
    granted: Boolean(readback)
  };
}

export async function revokeExactOriginPermission(chromeApi, profile, urlValue) {
  assertBrowserProfile(profile);
  assertChromePermissions(chromeApi);
  const pattern = exactOriginPattern(urlValue);
  const removed = await chromeApi.permissions.remove({ origins: [pattern] });
  const readback = await chromeApi.permissions.contains({ origins: [pattern] });
  return {
    pattern,
    removed: Boolean(removed),
    granted: Boolean(readback)
  };
}
