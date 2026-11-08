// HTML carries its own build version so a cached imported module cannot make
// a new panel silently agree with an old service worker.
export function runtimeVersionStatus({panelVersion="",workerVersion="",manifestVersion=""}={}) {
  const versions=[panelVersion,workerVersion,manifestVersion].filter(Boolean).map(String);
  const mismatch=new Set(versions).size>1;
  return {mismatch,ready:Boolean(workerVersion)&&!mismatch,
    message:mismatch
      ? `Olika versioner är inlästa: panel ${panelVersion || "okänd"}, körande motor ${workerVersion || "okänd"}, tillägg ${manifestVersion || "okänd"}. Öppna chrome://extensions, välj Läs in igen för Greenfield och öppna panelen på nytt.`
      : workerVersion ? `Körande motor v${workerVersion}` : "Kontrollerar körande version…"};
}
