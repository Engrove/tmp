
const listeners = () => ({ addListener(){} });
const store = {};
globalThis.chrome = {
  sidePanel: { setPanelBehavior: async()=>{} },
  alarms: { get: async()=>null, create(){}, onAlarm: listeners() },
  storage: { local: {
    async get(keys) {
      if (typeof keys === "string") return { [keys]: store[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter(k=>k in store).map(k=>[k,store[k]]));
      return {...store};
    },
    async set(value){ Object.assign(store,value); },
    async remove(keys){ for (const k of [].concat(keys)) delete store[k]; },
    async setAccessLevel(){}
  }},
  runtime: {
    sendMessage: async()=>({}),
    onMessage: listeners(),
    onInstalled: listeners(),
    onStartup: listeners()
  },
  tabs: {
    sendMessage: async()=>({ok:true,version:"0.6.3"}),
    query: async()=>[],
    get: async()=>{ throw new Error("no tabs"); },
    update: async()=>({}),
    reload: async()=>{},
    create: async()=>({id:1}),
    connect: ()=>({}),
    onActivated: listeners(), onUpdated: listeners(), onReplaced: listeners(),
    onRemoved: listeners(), onDetached: listeners(), onAttached: listeners()
  },
  scripting: { executeScript: async()=>{} },
  windows: { onRemoved: listeners() }
};
await import("../background.js");
await new Promise(r=>setTimeout(r,20));
console.log("BACKGROUND BOOT SMOKE PASS");
