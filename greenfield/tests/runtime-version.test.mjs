import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runtimeVersionStatus} from '../lib/runtime-version.mjs';
import {modelRecheckMessage} from '../lib/operations-view.mjs';

test('captured old runtime is detected even when manifest and imported constants are old',async()=>{
  const html=await readFile(new URL('../sidepanel.html',import.meta.url),'utf8');
  const panelVersion=/name="greenfield-version" content="([^"]+)"/.exec(html)[1];
  const result=runtimeVersionStatus({panelVersion,workerVersion:'1.9.10',manifestVersion:'1.9.10'});
  assert.equal(result.mismatch,true);assert.equal(result.ready,false);assert.match(result.message,/körande motor 1\.9\.10/);assert.match(result.message,/Läs in igen/);
});
test('consistent builds are ready, missing runtime is not a successful version check',()=>{
  assert.equal(runtimeVersionStatus({panelVersion:'1.9.12',workerVersion:'1.9.12',manifestVersion:'1.9.12'}).ready,true);
  assert.equal(runtimeVersionStatus({panelVersion:'1.9.12',manifestVersion:'1.9.12'}).ready,false);
});
test('recheck feedback distinguishes resumed, blocked and paused workers',()=>{
  const text=modelRecheckMessage({ready:1,failed:1,skipped:1,results:[{ok:true},{ok:false,code:'THINKING_SELECTION_TIMEOUT'},{ok:false,skipped:true,code:'PROCESS_PAUSED'}]});
  assert.match(text,/Återupptagning köad/);assert.match(text,/1 kontroll blockerad/);assert.match(text,/Workern är pausad/);assert.doesNotMatch(text,/Ändringen är sparad/);
});
