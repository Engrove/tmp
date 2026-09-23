# Greenfield control and persistence contract — v1.2.2

## 1. Browser-loop action

The extension owns one explicit browser-loop projection:

- `GREENFIELD_STATE=ACTIVE` with `GREENFIELD_ACTION=NEXT` when an executable autonomous next
  step exists.
- `GREENFIELD_STATE=ACTIVE` with `GREENFIELD_ACTION=OPERATOR` only when actual human authority
  or interaction is required.
- `GREENFIELD_STATE=ACTIVE` with `GREENFIELD_ACTION=BLOCK` only when a genuine hard stop remains
  and no safe executable autonomous next step exists.
- `GREENFIELD_STATE=DONE` with `GREENFIELD_ACTION=NONE` when the current mission objective is
  actually satisfied.

`eic.a2a.response.v1.blockers[]` is evidence/claim scope. It is never a direct browser-loop
control input. `status=CONTINUE` with non-empty `nextSuggestedAction` is executable continuation
evidence unless a separate hard runtime/owner/human/safety condition prevents it.

## 2. Alignment with Greenfield Works

Greenfield Works owns:
- canonical five-sentence mission-definition chronology (`MISSION_SET`);
- Greenfield session receipts (`START`, `HEARTBEAT`, `CONTINUE`, state boundaries);
- derived Greenfield execution/index state.

It does not own browser DOM/runtime truth, source/repo truth, or domain truth. The extension
therefore consumes Greenfield response semantics without promoting free-text domain blockers
into terminal browser state.

## 3. Saved mission persistence

Saved mission presets have a separate browser persistence owner:
`CHROME_PROFILE_BOOKMARK_STORE`.

The versioned vault is extension-install and extension-ID independent within the same Chrome
profile. `chrome.storage.local` is a cache. Writes are staged and read back before commit;
deletes require durable readback; legacy local-only v1.2.1 missions migrate on first v1.2.2
load. The vault is bounded to 24 missions.

Deleting the Chrome profile or its bookmark data removes this persistence. The bookmark vault
does not replace Greenfield Works mission chronology.
