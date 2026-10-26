// Research-only unpacked extension. Uses loopback HTTP and disposable browser state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-switcher-lab-'));
  const extension = path.join(temp, 'extension');
  fs.mkdirSync(extension);
  const hits = [];
  const checks = [];
  const server = http.createServer((req, res) => {
    hits.push({host: req.headers.host, method:req.method, path:req.url});
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/form') {
      res.end(`<form method="post" action="http://old.test:${server.address().port}/submit"><input name="x" value="fixture"><button>Send</button></form>`);
    } else res.end('<html><body>Controlled origin</body></html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const manifest = {
    manifest_version:3, name:'Web Switcher research gate', version:'0.0.1',
    permissions:['storage','declarativeNetRequestWithHostAccess'],
    host_permissions:['http://*.test/*'],
    background:{service_worker:'background.js'},
    web_accessible_resources:[{resources:['route.html'], matches:['<all_urls>']}]
  };
  fs.writeFileSync(path.join(extension,'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(extension,'background.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  fs.writeFileSync(path.join(extension,'route.html'), '<!doctype html><meta name="referrer" content="no-referrer"><body><p id="state">checking</p><script src="route.js"></script>');
  fs.writeFileSync(path.join(extension,'route.js'), `
    (async () => {
      const state = document.querySelector('#state');
      try {
        const prefix = '#alias=old&source=';
        if (!location.hash.startsWith(prefix)) throw new Error('bad envelope');
        const raw = location.hash.slice(prefix.length);
        const input = new URL(raw);
        await chrome.storage.local.set({lastSeen: {path: input.pathname, query: input.search, hash: input.hash}});
        if (input.hostname !== 'old.test' || input.port !== '${port}' || input.username || input.password) {
          state.textContent='rejected'; return;
        }
        const {catalog} = await chrome.storage.local.get('catalog');
        if (!catalog?.enabled) { state.textContent='paused'; return; }
        if (catalog.expiresAt <= Date.now()) { state.textContent='expired'; return; }
        const dest = new URL('http://new.test:${port}');
        dest.pathname = input.pathname;
        dest.search = ''; dest.hash = '';
        location.replace(dest.href);
      } catch (error) { state.textContent='rejected'; }
    })();
  `);
  let context;
  const note = (id, detail) => checks.push({id, passed:true, detail});
  try {
    context = await chromium.launchPersistentContext(path.join(temp,'profile'), {
      channel:'chromium', headless:true,
      args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP *.test 127.0.0.1']
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2];
    const gate = `chrome-extension://${id}/route.html`;
    await worker.evaluate(async ({port, gate}) => {
      await chrome.storage.local.set({catalog:{enabled:true, expiresAt:Date.now()+600000}});
      await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:[1], addRules:[{
        id:1, priority:1,
        action:{type:'redirect', redirect:{regexSubstitution:gate+'#alias=old&source=\\0'}},
        condition:{regexFilter:'^http://old\\.test:'+port+'/.*$', requestMethods:['get'],resourceTypes:['main_frame']}
      }]});
    }, {port,gate});
    const page = await context.newPage();
    const source = `http://old.test:${port}/docs/a%20b?token=synthetic#section`;
    await page.goto(source);
    await page.waitForURL(`http://new.test:${port}/docs/a%20b`);
    note('B01_gate_redirect', 'DNR redirected through packaged gate to the expected path.');
    assert.equal(hits.filter(x=>x.host.startsWith('old.test:')).length,0);
    note('B02_no_old_origin_request', 'Known alias was intercepted before this local old HTTP origin received a request.');
    const observedSource = await worker.evaluate(async()=> (await chrome.storage.local.get('lastSeen')).lastSeen);
    assert.equal(new URL(page.url()).search,''); assert.equal(new URL(page.url()).hash,'');
    note('B03_sensitive_url_drop','Synthetic query token and fragment were absent from destination URL.');
    for (const fixture of ['/x/%2Fencoded','/docs/a%26b','/docs/%E2%9C%93']) {
      await page.goto(`http://old.test:${port}${fixture}`);
      await page.waitForURL(`http://new.test:${port}${fixture}`);
    }
    note('B04_encoded_paths','Three encoded-path fixtures round-tripped without query/fragment forwarding.');
    await page.goto(`http://old.test.evil.test:${port}/page`);
    assert.equal(new URL(page.url()).hostname,'old.test.evil.test');
    note('B05_exact_host','Suffix-lookalike hostname did not match the source rule.');
    await worker.evaluate(()=>chrome.storage.local.set({catalog:{enabled:true,expiresAt:0}}));
    await page.goto(`http://old.test:${port}/expired`);
    await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='expired');
    assert.ok(page.url().startsWith(gate));
    note('B06_expired_mapping','Persisted DNR rule reached the gate, which stopped an expired mapping.');
    await worker.evaluate(()=>chrome.storage.local.set({catalog:{enabled:false,expiresAt:Date.now()+600000}}));
    await page.goto(`http://old.test:${port}/paused`);
    await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='paused');
    note('B07_paused_mapping','Gate stopped routing when the family was locally paused.');
    await page.goto(gate+`#alias=old&source=http://evil.test:${port}/page`);
    await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='rejected');
    note('B08_untrusted_gate_input','Directly supplied unrelated source host was rejected.');
    await page.goto(`http://launcher.test:${port}/form`);
    await Promise.all([page.waitForURL(`http://old.test:${port}/submit`),page.getByRole('button',{name:'Send'}).click()]);
    assert.ok(hits.some(x=>x.host.startsWith('old.test:')&&x.method==='POST'));
    note('B09_post_exclusion','POST form navigation was not rewritten by the GET-only rule.');
    const version = context.browser()?.version() || 'unknown';
    const result = {executedAt:new Date().toISOString(), browserVersion:version, scope:'Disposable unpacked Chromium extension; controlled loopback HTTP',
      passedChecks:checks.length, checks, sourceSeenByGate:observedSource,
      limitations:['Not Chrome/Edge store builds','No real TLS or DNS ownership proof','No signed-catalog browser verification in this minimal gate',
        'No permissions UX, browser restart, service worker suspension, BFCache, site service worker, loop, or arbitrary URL fuzzing test',
        'This is a feasibility experiment, not a production extension or accuracy benchmark']};
    fs.writeFileSync(path.join(__dirname,'browser_gate_results.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  } catch (error) {
    fs.writeFileSync(path.join(__dirname,'browser_gate_results.json'),JSON.stringify({executedAt:new Date().toISOString(),passedChecks:checks.length,checks,error:String(error)},null,2)+'\n');
    throw error;
  } finally {
    if(context) await context.close();
    await new Promise(r=>server.close(r));
    fs.rmSync(temp,{recursive:true,force:true});
  }
})();
