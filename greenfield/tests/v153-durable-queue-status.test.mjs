import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMissionWorkQueue } from "../lib/mission-work-queue.mjs";
import { loadMissionQueueSets, saveMissionQueueSet } from "../lib/mission-queue-sets.mjs";
import { QUEUE_SET_VAULT_FOLDER } from "../lib/mission-queue-set-vault.mjs";

function storageMock() {
  const state = {};
  return { state, async get(key) { return key == null ? structuredClone(state) : { [key]: structuredClone(state[key]) }; },
    async set(values) { Object.assign(state, structuredClone(values)); } };
}
function bookmarksMock() {
  let nextId=10; const nodes=new Map();
  const root={id:"0",title:"",children:[]}, bar={id:"1",parentId:"0",title:"Bookmarks bar",children:[]}, other={id:"2",parentId:"0",title:"Other bookmarks",children:[]};
  root.children.push(bar,other); [root,bar,other].forEach(n=>nodes.set(n.id,n));
  const copy=(v)=>structuredClone(v);
  const strip=(n)=>{const x={...n}; delete x.children; return copy(x);};
  const remove=(id)=>{const n=nodes.get(String(id)); if(!n)return; for(const c of n.children||[])remove(c.id); const p=nodes.get(String(n.parentId)); if(p?.children)p.children=p.children.filter(c=>c.id!==n.id); nodes.delete(n.id);};
  return {
    async getTree(){return [copy(root)];},
    async getChildren(id){return (nodes.get(String(id))?.children||[]).map(strip);},
    async create({parentId,title="",url}){const p=nodes.get(String(parentId)); if(!p)throw new Error("PARENT"); const n={id:String(nextId++),parentId:String(parentId),title:String(title),...(url?{url:String(url)}:{children:[]})}; nodes.set(n.id,n); p.children.push(n); return strip(n);},
    async update(id,c){const n=nodes.get(String(id)); if(!n)throw new Error("MISSING"); if(Object.hasOwn(c,"title"))n.title=String(c.title); return strip(n);},
    async removeTree(id){remove(id);},
    debug(){return copy(root);}
  };
}
test("v1.5.3 queue sets survive extension-local reset through Chrome-profile bookmark vault", async () => {
  const bookmarks=bookmarksMock(), a=storageMock();
  const queue=normalizeMissionWorkQueue({workerId:"w-a",windowId:1,items:[{goal:"GF-045 supervisor",label:"GF-045",priority:"URGENT",status:"READY"},{goal:"GF-008 AUM",label:"GF-008",priority:"HIGH",status:"READY"}]}, {workerId:"w-a",windowId:1});
  await saveMissionQueueSet({name:"Arbetsdag",queue},a,{now:1000,bookmarks});
  const b=storageMock();
  const restored=await loadMissionQueueSets(b,{bookmarks});
  assert.equal(restored.sets.length,1);
  assert.equal(restored.sets[0].name,"Arbetsdag");
  assert.deepEqual(restored.sets[0].items.map(x=>x.label),["GF-045","GF-008"]);
  assert.match(JSON.stringify(bookmarks.debug()),new RegExp(QUEUE_SET_VAULT_FOLDER.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});
test("v1.5.3 first read migrates legacy local queue sets into durable vault", async () => {
  const bookmarks=bookmarksMock(), a=storageMock();
  const queue=normalizeMissionWorkQueue({workerId:"w",windowId:2,items:[{goal:"Legacy",status:"READY"}]}, {workerId:"w",windowId:2});
  await saveMissionQueueSet({name:"Legacy set",queue},a,{now:2000,bookmarks:null});
  const migrated=await loadMissionQueueSets(a,{bookmarks});
  assert.equal(migrated.sets[0].name,"Legacy set");
  const fresh=await loadMissionQueueSets(storageMock(),{bookmarks});
  assert.equal(fresh.sets[0].name,"Legacy set");
});

import fs from "node:fs";
test("v1.5.3 fleet status tab is wired to global snapshot", () => {
  const html=fs.readFileSync(new URL("../sidepanel.html",import.meta.url),"utf8");
  const panel=fs.readFileSync(new URL("../sidepanel.js",import.meta.url),"utf8");
  const background=fs.readFileSync(new URL("../background.js",import.meta.url),"utf8");
  assert.match(html,/id="overviewTabButton"/);
  assert.match(html,/data-ui-tab="overview"/);
  assert.match(panel,/renderFleetStatus/);
  assert.match(background,/fleetStatusSnapshot/);
  assert.match(background,/fleetStatus: await fleetStatusSnapshot\(\)/);
});
