"""Offline Chromium DOM smoke for the shipped content.js; no authenticated site or network.

Usage: /opt/pyvenv/bin/python tests/chromium-dom-smoke.py
Requires installed Playwright Python and local Chromium. Isolated about:blank
uses a deterministic UUID/crypto mock because that origin is not secure.
This complements, but does not replace, the jsdom and live-extension suites.
"""
from pathlib import Path
import json
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / 'content.js').read_text(encoding='utf-8')
FIXTURE = json.loads((ROOT / 'tests/fixtures/ready-hash-2026-10-23.json').read_text())
COUNT = 0

def check(condition, message):
    global COUNT
    if not condition:
        raise AssertionError(message)
    COUNT += 1


def initialize(page):
    page.set_content('<main><article id="reply"></article></main>')
    page.evaluate("""() => {
      // about:blank is insecure; this deterministic mock is only for startup.
      Object.defineProperty(window, 'crypto', {configurable:true, value:{
        randomUUID:()=> 'offline-chromium-uuid',
        subtle:{digest:async()=>new ArrayBuffer(32)}
      }});
      window.__gfEvents=[];window.__gfListeners=[];
      window.__gfDisposed=0;
      window.chrome={runtime:{id:'offline-test',
        onMessage:{addListener(f){window.__gfListeners.push(f)},
                   removeListener(f){window.__gfListeners=window.__gfListeners.filter(x=>x!==f)}},
        sendMessage:async(message)=>{window.__gfEvents.push(message.type);return {ok:true}}
      }};
      window.GreenfieldThinkingControl={dispose:()=>window.__gfDisposed++};
    }""")
    # Expose only the actual private DOM extraction function for assertions.
    page.add_script_tag(content=SOURCE.replace('})();\n','window.__gfReadMessage = messageText; })();\n'))
    page.wait_for_function('window.__EIC_GF_CONTENT_V2__ && window.__gfListeners.length === 1')


def read(page, html, role='assistant'):
    return page.evaluate("""({html,role})=>{
      const owner=document.querySelector('#reply');owner.innerHTML=html;
      const before=owner.innerHTML;
      const output=window.__gfReadMessage({owner,role});
      return {output,unchanged:before===owner.innerHTML};
    }""", {'html':html,'role':role})

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    try:
        page = browser.new_page()
        exceptions = []
        page.on('pageerror', lambda err: exceptions.append(str(err)))
        initialize(page)
        check(page.evaluate('window.__EIC_GF_CONTENT_V2__.version') == (ROOT / 'VERSION').read_text().strip(), 'Content bridge version mismatch')
        check(page.evaluate('window.__gfEvents.includes("EIC_GF_CONTENT_READY")'), 'Bridge did not announce READY')

        emitted = []
        for key in ['initial','repair']:
            sample = FIXTURE[key]
            row = read(page, sample['html'])
            check(row['unchanged'],f'{key}: DOM extraction mutated live message')
            check(sample['expectedHash'] in row['output'],f'{key}: expected hash lost')
            check(sample['expectedHash'] + 'Awaiting' not in row['output'],f'{key}: block joining not fixed')
            emitted.append(row['output'])
        # Inline extra hexadecimal characters must remain connected; they may
        # not be separated into a syntactically valid 64-character ACK.
        first_hash=FIXTURE['initial']['expectedHash']
        row=read(page,f'<p><code>{first_hash}<span>a</span></code></p>')
        check(first_hash+'a' in row['output'], 'Inline hexadecimal suffix was split')
        check(row['unchanged'], 'Inline DOM changed unexpectedly')

        # Every hexadecimal neighbor after a block boundary remains separate.
        for ch in '0123456789abcdefABCDEF':
            row=read(page,f'<p><code>{first_hash}</code></p><p>{ch}fter</p>')
            check(first_hash+'\n' in row['output'] or first_hash+' ' in row['output'],f'Hex neighbor {ch} joined')
            check(row['unchanged'],f'Hex neighbor {ch} damaged original DOM')

        # Use the shipped ACK parser (Node module) on Chromium's extracted text.
        script="""import {initializationAcknowledged} from './lib/response-stability.mjs';
          const data=JSON.parse(process.argv[1]);
          console.log(JSON.stringify(data.map(x=>initializationAcknowledged(x.text,x.hash))));"""
        cases=[{'text':emitted[i], 'hash': FIXTURE[k]['expectedHash']} for i,k in enumerate(['initial','repair'])]
        cases += [{'text':first_hash+'a','hash':first_hash}]
        run=subprocess.run(['node','--input-type=module','-e',script,json.dumps(cases)],cwd=ROOT,check=True,capture_output=True,text=True)
        check(json.loads(run.stdout) == [True,True,False],'ACK parser mismatch for real Chromium extracted text')

        # Reinjection creates one active bridge, keeps the dispatch map and
        # disposes the prior thinking adapter exactly once.
        before=page.evaluate('''() => {
          const old=window.__EIC_GF_CONTENT_V2__;
          old.dispatchRecords.set('previous-effect',{effectIssued:true});
          return {id:old.documentId,seq:old.observationSequence};
        }''')
        page.add_script_tag(content=SOURCE.replace('})();\n','window.__gfReadMessage = messageText; })();\n'))
        after=page.evaluate('''() => ({
          id:window.__EIC_GF_CONTENT_V2__.documentId,
          effect:window.__EIC_GF_CONTENT_V2__.dispatchRecords.get('previous-effect')?.effectIssued,
          listeners:window.__gfListeners.length, disposed:window.__gfDisposed
        })''')
        check(before['id']==after['id'], 'Document identity changed on reinjection')
        check(after['effect'] is True, 'Dispatch idempotency ledger was lost')
        check(after['listeners']==1, 'Content listeners leaked across reinjection')
        check(after['disposed']==1, 'Previous adapter was not disposed exactly once')

        # Runtime invalidation must be terminal for the old bridge.
        page.evaluate('''() => {
          window.chrome.runtime.sendMessage=()=>{throw Error('Extension context invalidated.')};
          document.querySelector('main').append(document.createElement('section'));
        }''')
        page.wait_for_function('window.__gfListeners.length === 0',timeout=5000)
        check(page.evaluate('window.__gfDisposed===2'), 'Invalidation did not dispose current adapter')
        check(page.evaluate('window.__gfListeners.length===0'), 'Invalidated runtime still has active listener')
        check(not exceptions, f'Uncaught browser exceptions: {exceptions}')
    finally:
        browser.close()

print(f'CHROMIUM_DOM_SMOKE: PASS {COUNT}/{COUNT}; no live extension or EIC owner access')
