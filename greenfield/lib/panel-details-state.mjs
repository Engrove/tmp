export function fleetWorkerDetailsKey(row = {}) {
  const process = row?.process || {};
  return String(
    process.processId ||
    process.workerId ||
    row?.workerId ||
    ""
  ).trim();
}

export function reconcileOpenFleetWorkerKeys(openKeys, workers = []) {
  const requested = new Set(
    [...(openKeys || [])].map((value) => String(value || "").trim()).filter(Boolean)
  );
  const visible = new Set(
    (Array.isArray(workers) ? workers : [])
      .map((row) => fleetWorkerDetailsKey(row))
      .filter(Boolean)
  );
  return new Set([...requested].filter((key) => visible.has(key)));
}
