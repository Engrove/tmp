import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {scheduleBlockReason,queueItemNextRunnableAtMs} from '../lib/queue-schedule.mjs';
const f=JSON.parse(await readFile(new URL('fixtures/overnight-schedules-2026-10-20.json',import.meta.url)));
const before=process.env.TZ;process.env.TZ='Europe/Helsinki';
process.on('exit',()=>{if(before!==undefined)process.env.TZ=before;else delete process.env.TZ;});
const at=Date.parse(f.exportAt),find=prefix=>f.items.filter(i=>i.workerId.startsWith(prefix));
test('logged daytime worker is correctly closed at 07:26 and opens exactly at 07:30 Helsinki',()=>{
 for(const i of find('worker-632')){assert.equal(scheduleBlockReason(i.schedule,at),'OUTSIDE_RUN_WINDOW');
 const open=Date.parse('2026-10-20T04:30:00Z');assert.equal(queueItemNextRunnableAtMs(i,at),open);
 assert.ok(scheduleBlockReason(i.schedule,open-1));assert.equal(scheduleBlockReason(i.schedule,open),'');assert.equal(scheduleBlockReason(i.schedule,open+1),'');}
});
test('logged 180 minute interval is based on the completed quantum, independent of priority',()=>{
 const i=find('worker-be653')[0], wake=i.lastQuantumCompletedAtMs+180*60000;
 assert.equal(wake,Date.parse('2026-10-20T05:31:35.237Z'));
 assert.equal(queueItemNextRunnableAtMs(i,at),wake);
 assert.equal(queueItemNextRunnableAtMs({...i,priority:'URGENT'},wake-1),wake);
 assert.equal(queueItemNextRunnableAtMs(i,wake),wake);
});
test('five worker queues retain independent schedules; a free slot does not reopen closed windows',()=>{
 assert.equal(new Set(f.items.map(i=>i.workerId)).size,5);
 const always=[...find('worker-2fcd'),...find('worker-7b618')];
 assert.equal(always.length,9);for(const i of always)assert.equal(scheduleBlockReason(i.schedule,at),'');
 const night=find('worker-349');assert.equal(night.length,4);
 for(const i of night.slice(0,3))assert.equal(scheduleBlockReason(i.schedule,at),'');
 assert.ok(scheduleBlockReason(night[3].schedule,at));
 for(const i of find('worker-632'))assert.ok(scheduleBlockReason(i.schedule,at));
});
