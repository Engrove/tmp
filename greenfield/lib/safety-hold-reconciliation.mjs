export function reconcileSafetyHoldWithFreshProof(priorSafety = {}, proof = {}, qualityIncident = null) {
  const hold = priorSafety?.hold || null;
  const priorProof = priorSafety?.proof || null;
  const holdCode = String(hold?.code || "");
  const priorProofCode = String(priorProof?.code || "");

  const clear = Boolean(
    hold &&
    proof?.allowed === true &&
    !qualityIncident &&
    holdCode &&
    priorProofCode &&
    holdCode === priorProofCode
  );

  return {
    hold: clear ? null : hold,
    cleared: clear,
    clearedCode: clear ? holdCode : ""
  };
}
