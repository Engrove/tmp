# Autostart failure analysis — v0.10.3 vs v0.10.4

## Scope

This report compares the operator-supplied source packages:

- `eic-autonom-agent-v0.10.3-source.zip`
  - SHA-256: `3d5936a611b96225b565312708e424d2a5edc1f8fbb5f71ad07a3571d5fbbe7e`
- `eic-autonom-agent-v0.10.4-source.zip`
  - SHA-256: `876c0b086909cefbed322bb746329e4ea1150c8806c43110a6fb18d07ede2bb0`

Both archives passed ZIP CRC and path-safety checks in the analysis session.

The supplied Desktop Chrome evidence shows an installed UI labelled `v0.10.4`, no selected linked ChatGPT tab after the attempted flow, and these extension errors:

- `Error: Koppla och välj en ChatGPT-flik först.`
- `NanoUserActivationRequiredError: Chrome kräver ett aktivt användarklick för att starta LanguageModel.create().`

This report separates those operator-observed runtime symptoms from source-proved causes.

## Verdict

v0.10.4 contains two independent blocking Autostart defects and one error-handling defect.

1. **Config/runtime v13 is loaded with an obsolete expected version 12.**
2. **D1/D2 confirmation uses a modal `confirm()` before native model creation.**
3. **A rejected model activation promise is not handled until after later awaits.**

The first defect explains why a tab can be linked and then disappear before mission start. The second explains the observed `NanoUserActivationRequiredError`. The third explains the separate `Uncaught (in promise)` entry.

## Systematic comparison

### v0.10.3 baseline

v0.10.3 has no combined Autostart transaction. The operator invokes the established controls separately:

1. link the active ChatGPT tab;
2. activate the Chrome on-device LanguageModel;
3. start the selected mission.

Its state contract is internally consistent:

- config schema: `eic.autonom.config.v12`;
- runtime schema: `eic.autonom.runtime.v12`;
- defaults: version `12`;
- `background.js/loadCurrentState`: expected version `12`;
- `saveConfig`: writes version `12`.

A current object therefore survives `currentStateOrFresh()` without reset.

### v0.10.4 state-version regression

v0.10.4 intentionally changes the current contracts to:

- config schema: `eic.autonom.config.v13`;
- runtime schema: `eic.autonom.runtime.v13`;
- defaults: version `13`;
- `saveConfig`: writes version `13`.

However, `background.js/loadCurrentState()` still passes literal `version: 12` for both config and runtime.

`currentStateOrFresh()` accepts state only when both schema and version equal the expected values. Consequently, a valid v13 object is treated as older/unknown and replaced with a fresh object on every load.

### Deterministic Autostart failure chain

The v0.10.4 Autostart order is:

1. begin LanguageModel activation;
2. `SAVE_CONFIG`;
3. `LINK_ACTIVE_TAB`;
4. await LanguageModel activation;
5. start mission.

The stale loader makes this sequence fail deterministically:

1. `SAVE_CONFIG` persists config v13.
2. `LINK_ACTIVE_TAB` calls `loadBundle()`.
3. `loadBundle()` compares v13 state with expected version 12 and creates fresh config/runtime.
4. The link command adds the active tab to that fresh runtime and persists runtime v13.
5. Mission start calls `loadBundle()` again.
6. Runtime v13 again fails the obsolete expected version 12 check and is replaced with an empty runtime.
7. `startWaiting()` finds no selected linked tab and throws `Koppla och välj en ChatGPT-flik först.`

The defect affects more than Autostart: any current config/runtime state that passes through `loadCurrentState()` is unstable.

### v0.10.4 user-activation regression

For Mjölnar D1 and D2, v0.10.4 calls the browser modal `confirm()` before `beginNanoCreateFromGestureWithConfig()`.

The native provider guard then requires:

`navigator.userActivation.isActive === true`

The supplied Desktop Chrome run shows that the modal path did not retain the required transient activation. The result is the observed `NanoUserActivationRequiredError`.

The source test only checked that the create helper appeared before the first textual `await command`. It did not check that no modal or other gesture-breaking step preceded the create call.

### v0.10.4 unhandled rejection

v0.10.4 stores the activation promise and awaits it only after config save and tab linking.

When native activation rejects immediately, no rejection handler is attached during those intervening awaits. Chrome can therefore report a separate `Uncaught (in promise)` even though the outer Autostart click handler later catches the propagated error.

## v0.10.5 corrections

v0.10.5 applies the following bounded corrections:

1. `CONFIG_VERSION`, `RUNTIME_VERSION` and `AUDIT_VERSION` are owned by `lib/contracts.mjs`.
2. Default creation, current-state loading and config save use those constants.
3. Current config/runtime v13 round-trip without forward-only reset.
4. D1/D2 use staged in-panel confirmation:
   - first click arms the exact preset for 30 seconds;
   - second explicit click starts native `LanguageModel.create()` directly;
   - no modal `confirm()` precedes create.
5. Activation rejection is converted immediately to a handled outcome before any later await.
6. Autostart reads back:
   - selected linked tab;
   - linked-tab record;
   - matching `CHATGPT_CONTROLLER` surface.
7. Mission start is blocked if readback does not match.
8. The already-persisted Autostart config is reused; mission start does not perform a second implicit config save.
9. New discriminating tests cover both the failing v0.10.4 fixtures and the v0.10.5 emit path.

## Claim boundary

Source analysis and local tests can verify source/package behavior only. Desktop Chrome must still verify the installed v0.10.5 extension, native LanguageModel gesture, actual tab binding, sidepanel/service-worker identity and runtime export.
