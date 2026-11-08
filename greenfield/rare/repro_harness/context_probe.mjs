import {readFile} from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';

const report=[];
for(const path of process.argv.slice(2)) {
  const source=await readFile(path,'utf8'),runs=[];
  for(let run=1;run<=6;run++) {
    const dom=new JSDOM('<main></main>',{url:'https://chatgpt.com/g/g-test',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
    const w=dom.window,timers=new Map(),listeners=new Set();let id=0,invalid=false,error='';
    w.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{fn,ms});return key;};w.clearTimeout=key=>timers.delete(key);
    w.setInterval=()=>++id;w.clearInterval=()=>{};
    w.chrome={runtime:{id:'test',onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},
      sendMessage:()=>{if(invalid)throw new Error('Extension context invalidated.');return Promise.resolve({ok:true});}}};
    w.eval(source);await new Promise(resolve=>setImmediate(resolve));invalid=true;
    for(const [key,timer] of [...timers])if(timer.ms===350){timers.delete(key);try{timer.fn();}catch(e){error=e.message;}}
    await new Promise(resolve=>setImmediate(resolve));
    runs.push({run,uncaught:error,remainingListeners:listeners.size});
    w.__EIC_GF_CONTENT_V2__?.dispose();dom.window.close();
  }
  report.push({path,runs,failures:runs.filter(r=>r.uncaught).length,total:runs.length});
}
console.log(JSON.stringify(report,null,2));
