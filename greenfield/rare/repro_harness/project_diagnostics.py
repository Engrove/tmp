import sys, json, hashlib
from pathlib import Path

source = Path(sys.argv[1])
data = json.loads(source.read_text())
projection = {"sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
              "appVersion": data["appVersion"], "createdAt": data["createdAt"],
              "runtimeFault": data["runtimeFault"], "modelEvidence": data["modelInspection"]["evidence"],
              "processes": [], "incidents": []}
for key, value in data["storage"].items():
    if key.startswith("eic.gf.process.worker."):
        pending = value.get("pendingPrompt") or {}
        safety = value.get("safety") or {}
        projection["processes"].append({
            "phase": value["phase"], "version": value["version"],
            "hold": safety.get("hold"), "proof": safety.get("proof"),
            "dispatch": pending.get("dispatch"),
            "initializationStatus": (value.get("sessionInitialization") or {}).get("status"),
            "missionPause": value.get("missionPause")})
    elif key == "eic.gf.safety.v1":
        projection["globalSafety"] = {k: value.get(k) for k in ["providerHold", "admissionPaused"]}
    elif key == "eic.gf.global-capacity-scheduler.v1":
        projection["capacity"] = {"activeTurns": len(value["activeTurns"]), "waiters": len(value["waiters"])}
    elif key == "eic.gf.incident-log.v1":
        projection["incidents"] = [{k:r.get(k) for k in ["atMs", "kind", "code", "detail"]}
                                   for r in value["rows"] if r["kind"] == "SAFETY_HOLD_STARTED"]
print(json.dumps(projection, ensure_ascii=False, indent=2))
