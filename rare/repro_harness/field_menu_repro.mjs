// Field-derived reproduction of THINKING_CONTROL_AMBIGUOUS (Greenfield 1.9.12).
// Run from the repository root after `npm ci` in greenfield/:
//   node rare/repro_harness/field_menu_repro.mjs [--adapter=path] [--n=10] [--variants=a,b] [--initial=4] [--out=file]
// Baseline: --adapter=rare/repro_harness/thinking-control-1.9.12.js
// DOM model and its evidence: greenfield/tests/fixtures/field-model-menu-2026-10-13.mjs, rare/evidence_log.md.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const repo=new URL('../../',import.meta.url);
const gf=new URL('greenfield/',repo);
const {JSDOM}=createRequire(new URL('package.json',gf))('jsdom');
const {fieldModelMenu}=await import(new URL('tests/fixtures/field-model-menu-2026-10-13.mjs',gf));
const arg=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const read=url=>readFile(url,'utf8');
const [policy,observation,captured]=await Promise.all([
  read(new URL('lib/safety-policy.js',gf)),read(new URL('lib/model-observation.js',gf)),
  read(new URL('tests/fixtures/reasoning-trigger-2026-10-13.html',gf))
]);
const adapterPath=arg('adapter','greenfield/lib/thinking-control.js');
const adapter=await read(new URL(adapterPath,repo));
const N=Number(arg('n','10'));
const start=Number(arg('initial','4'));
const variants=arg('variants','describedby,arialabel,plain').split(',');

const pick=c=>c&&{role:c.role,ariaLabel:c.ariaLabel,label:c.label,tabIndex:c.tabIndex};
const rows=[];
for(const variant of variants)for(let seed=1;seed<=N;seed++){
  const f=fieldModelMenu({JSDOM,policy,observation,adapter,captured,variant,seed,start});
  try{
    const result=await f.ensure();const diag=f.diagnostics()||{};
    rows.push({variant,seed,ok:result.ok,code:result.code||'VERIFIED',detail:result.detail||'',
      sendAllowed:f.proof().allowed,finalPosition:f.position(),inputs:f.counts.input,navigationClicks:f.counts.navigation,
      menuLeftOpen:Boolean(f.d.getElementById('radix-_r_29_')),openingMethod:diag.openingMethod||'',
      stages:(diag.observedSurfaces||[]).map(s=>`${s.stage}:${s.popups.map(p=>p.role||'-').join('+')}`).join(' '),
      controls:(diag.controls||[]).map(pick),strategy:diag.strategy||'',ordinalCandidates:diag.ordinalCandidates?.length??null});
  }finally{f.close();}
}
const summary={};
for(const r of rows){const k=`${r.variant}:${r.code}`;summary[k]=(summary[k]||0)+1;}
const output={scope:'FIELD_DERIVED_DOM_JSDOM_NOT_LIVE_CHROME',node:process.version,adapter:adapterPath,initialPosition:start,n:N,summary,rows};
const out=arg('out','');
if(out)await writeFile(new URL(out,repo),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({adapter:adapterPath,initialPosition:start,n:N,summary}));
