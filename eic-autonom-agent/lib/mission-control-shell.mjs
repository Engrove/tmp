export const MISSION_CONTROL_SHELL_SCHEMA = "eic.autonom.mission-control-shell.v1";

export const MISSION_CONTROL_VIEW_IDS = Object.freeze({
  RUN: "RUN",
  SURFACES: "SURFACES",
  EVIDENCE: "EVIDENCE",
  MISSIONS: "MISSIONS",
  SETTINGS: "SETTINGS"
});

export const MISSION_CONTROL_VIEW_REGISTRY = Object.freeze({
  [MISSION_CONTROL_VIEW_IDS.RUN]: Object.freeze({
    id: MISSION_CONTROL_VIEW_IDS.RUN,
    label: "Körning",
    panelId: "missionViewRun"
  }),
  [MISSION_CONTROL_VIEW_IDS.SURFACES]: Object.freeze({
    id: MISSION_CONTROL_VIEW_IDS.SURFACES,
    label: "Webbytor",
    panelId: "missionViewSurfaces"
  }),
  [MISSION_CONTROL_VIEW_IDS.EVIDENCE]: Object.freeze({
    id: MISSION_CONTROL_VIEW_IDS.EVIDENCE,
    label: "Evidens",
    panelId: "missionViewEvidence"
  }),
  [MISSION_CONTROL_VIEW_IDS.MISSIONS]: Object.freeze({
    id: MISSION_CONTROL_VIEW_IDS.MISSIONS,
    label: "Uppdrag",
    panelId: "missionViewMissions"
  }),
  [MISSION_CONTROL_VIEW_IDS.SETTINGS]: Object.freeze({
    id: MISSION_CONTROL_VIEW_IDS.SETTINGS,
    label: "Inställningar",
    panelId: "missionViewSettings"
  })
});

export const DEFAULT_MISSION_CONTROL_VIEW = MISSION_CONTROL_VIEW_IDS.RUN;

const VIEW_ORDER = Object.freeze(Object.keys(MISSION_CONTROL_VIEW_REGISTRY));

function text(value, fallback, max = 180) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, max);
}

export function resolveMissionControlView(viewId) {
  const view = MISSION_CONTROL_VIEW_REGISTRY[String(viewId || "")];
  if (!view) throw new Error(`MISSION_CONTROL_VIEW_UNKNOWN:${viewId}`);
  return view;
}

export function missionShellSummary(missionView, run = null) {
  const view = missionView && typeof missionView === "object" ? missionView : {};
  const activeMissionId = String(view.activeMissionId || "");
  const activeMission = activeMissionId && view.missions?.[activeMissionId]
    ? view.missions[activeMissionId]
    : null;
  return Object.freeze({
    schema: MISSION_CONTROL_SHELL_SCHEMA,
    version: 1,
    activeMissionId: activeMission?.missionId || null,
    modeLabel: text(activeMission?.modeId || run?.mode, "INGET UPPDRAG"),
    stateLabel: text(activeMission?.state || run?.state, "IDLE"),
    stepLabel: text(activeMission?.currentStep || run?.activeWorkUnit, "Ingen aktiv arbetsenhet", 260),
    controllerSurfaceLabel: text(
      activeMission?.surfaceRoles?.CHATGPT_CONTROLLER || activeMission?.controllerSurfaceId,
      "Ej bunden"
    ),
    webTargetSurfaceLabel: text(
      activeMission?.surfaceRoles?.WEB_TARGET || activeMission?.targetSurfaceId,
      "Ej bunden"
    )
  });
}

function requireNode(map, viewId, kind) {
  const node = map?.[viewId];
  if (!node) throw new Error(`MISSION_CONTROL_${kind}_MISSING:${viewId}`);
  return node;
}

export function createMissionControlShell({
  buttons,
  panels,
  initialView = DEFAULT_MISSION_CONTROL_VIEW,
  onViewChanged = null
} = {}) {
  const listeners = [];
  let activeView = resolveMissionControlView(initialView).id;

  for (const viewId of VIEW_ORDER) {
    requireNode(buttons, viewId, "BUTTON");
    requireNode(panels, viewId, "PANEL");
  }

  function activate(viewId, { focus = false } = {}) {
    const next = resolveMissionControlView(viewId).id;
    for (const id of VIEW_ORDER) {
      const selected = id === next;
      const button = buttons[id];
      const panel = panels[id];
      button.setAttribute?.("aria-selected", selected ? "true" : "false");
      button.setAttribute?.("tabindex", selected ? "0" : "-1");
      panel.toggleAttribute?.("hidden", !selected);
      panel.classList?.toggle("is-active", selected);
    }
    activeView = next;
    if (focus) buttons[next].focus?.();
    if (typeof onViewChanged === "function") onViewChanged(next);
    return next;
  }

  function move(from, delta) {
    const index = VIEW_ORDER.indexOf(from);
    const next = VIEW_ORDER[(index + delta + VIEW_ORDER.length) % VIEW_ORDER.length];
    activate(next, { focus: true });
  }

  for (const viewId of VIEW_ORDER) {
    const button = buttons[viewId];
    const click = () => activate(viewId);
    const keydown = (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault?.();
        move(viewId, 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault?.();
        move(viewId, -1);
      } else if (event.key === "Home") {
        event.preventDefault?.();
        activate(VIEW_ORDER[0], { focus: true });
      } else if (event.key === "End") {
        event.preventDefault?.();
        activate(VIEW_ORDER.at(-1), { focus: true });
      }
    };
    button.addEventListener?.("click", click);
    button.addEventListener?.("keydown", keydown);
    listeners.push([button, "click", click], [button, "keydown", keydown]);
  }

  activate(activeView);

  return Object.freeze({
    schema: MISSION_CONTROL_SHELL_SCHEMA,
    version: 1,
    activate,
    getActiveView: () => activeView,
    destroy() {
      for (const [node, type, listener] of listeners) {
        node.removeEventListener?.(type, listener);
      }
    }
  });
}
