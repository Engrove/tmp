// Read-only verification inside an extension page's DevTools context.
// Does not start, pause, update, navigate or send a mission. No private text is returned.
export async function verifyInstalledBuild(expectedBuildSHA256, {chromeApi=chrome,fetchImpl=fetch}={}) {
  let timer;
  const job=(async()=>{
    const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const descriptor=await (await fetchImpl(chromeApi.runtime.getURL('installed-integrity.json'))).json();
    if(!expectedBuildSHA256 || descriptor.runtimeBuildSHA256!==expectedBuildSHA256)throw Error('UNEXPECTED_BUILD_DESCRIPTOR');
    const basis=Object.fromEntries(Object.entries(descriptor.files).filter(([name])=>name!=='lib/build-identity.mjs').sort(([a],[b])=>a.localeCompare(b,'en')));
    // Deterministic ASCII file names: use code-unit order, as in the packager.
    const canonical=JSON.stringify(Object.fromEntries(Object.keys(basis).sort().map(k=>[k,basis[k]])));
    if(await sha(new TextEncoder().encode(canonical))!==expectedBuildSHA256)throw Error('BUILD_MAP_HASH_MISMATCH');
    const mismatches=[];
    for(const [name,expected] of Object.entries(descriptor.files)) {
      const r=await fetchImpl(chromeApi.runtime.getURL(name));
      if(!r.ok || await sha(await r.arrayBuffer())!==expected)mismatches.push(name);
    }
    // Content.js may be byte-correct for the wrong release. Verify the
    // advertised bridge identity independently from descriptor file hashes.
    const contentBody = await (await fetchImpl(chromeApi.runtime.getURL('content.js'))).text();
    const bridgeVersion = /const CONTENT_VERSION = ["']([^"']+)["']/.exec(contentBody)?.[1] || '';
    const semanticVersionMismatches = bridgeVersion === descriptor.version ? [] :
      [`content.js:${bridgeVersion || 'MISSING'}!=${descriptor.version}`];
    const running=await chromeApi.runtime.sendMessage({type:'EIC_GF_RUNTIME_IDENTITY'});
    const tabs=await chromeApi.tabs.query({url:['https://chatgpt.com/*','https://chat.openai.com/*']});
    const bridges=await Promise.all(tabs.map(async tab=>{
      try {const ping=await chromeApi.tabs.sendMessage(tab.id,{type:'EIC_GF_PING'});
        return {tabId:tab.id,windowId:tab.windowId,version:ping?.version || '',responded:ping?.ok===true};
      }catch{return {tabId:tab.id,windowId:tab.windowId,version:'',responded:false};}
    }));
    const alarms=await chromeApi.alarms.getAll();
    return {schema:'eic.greenfield.installed-verification.v1',at:new Date().toISOString(),expectedBuildSHA256,
      filesChecked:Object.keys(descriptor.files).length,fileMismatches:mismatches,
      installedVersion:chromeApi.runtime.getManifest().version,runningVersion:running?.appVersion || '',
      runningBuildSHA256:running?.runtimeBuildSHA256 || '',runtimeFault:running?.runtimeFault || '',
      byteIdentityVerified:mismatches.length===0 && running?.runtimeBuildSHA256===expectedBuildSHA256 && running?.appVersion===descriptor.version,
      semanticVersionMismatches,semanticVersionVerified:semanticVersionMismatches.length===0,
      bridgeObservations:bridges,alarmCount:alarms.length,liveMissionBehavior:'NOT_VERIFIED',terminalAcceptance:'OPEN'};
  })();
  try{return await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('INSTALLATION_CHECK_TIMEOUT')),15000);})]);}
  finally{clearTimeout(timer);}
}
