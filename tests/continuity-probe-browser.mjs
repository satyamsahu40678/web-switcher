// Native MV3 proof: fetch(manual) is opaque; webRequest supplies the next hop.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {mkdtemp, mkdir, cp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';

const reportPath = 'test-results/continuity-probe-browser.json';
await mkdir('test-results', {recursive: true}); await rm(reportPath, {force: true});
const directory = await mkdtemp(path.join(tmpdir(), 'web-switcher-native-probe-'));
const hits = [], checks = []; let context, active = 'P00_worker';
const names = ['old.continuity.test', 'next.continuity.test', 'current.continuity.test', 'unsafe.continuity.test'];
const server = createServer((request, response) => {
  const host = request.headers.host.split(':')[0]; hits.push({host, path: request.url, method: request.method});
  const next = name => `http://${name}:${server.address().port}/`;
  if (host === names[0] && request.url === '/') { response.writeHead(302, {Location: next(names[1])}); response.end(); }
  else if (host === names[1]) { response.writeHead(307, {Location: next(names[2])}); response.end(); }
  else if (request.url === '/unsafe') { response.writeHead(302, {Location: `http://127.0.0.1:${server.address().port}/private-probe`}); response.end(); }
  else if (request.url === '/empty') request.socket.destroy();
  else if (request.url === '/meta') { response.writeHead(200, {'Content-Type': 'text/html'}); response.end(`<script>fetch('/script-executed')</script><meta http-equiv="refresh" content="0;url=${next(names[2])}">`); }
  else if (request.url === '/header-refresh') { response.writeHead(200, {'Content-Type': 'text/html', Refresh: `0; url=${next(names[2])}`}); response.end('Explicit redirect observation'); }
  else if (request.url === '/advertised') { response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<link rel="web-switcher-successor" href="/.well-known/web-switcher.json">'); }
  else if (request.url === '/.well-known/web-switcher.json') { response.writeHead(200, {'Content-Type': 'application/json'}); response.end(JSON.stringify({schemaVersion: 1, successorOrigin: next(names[2])})); }
  else { response.writeHead(200, {'Content-Type': 'text/html'}); response.end('Controlled public site fixture'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port, origin = host => `http://${host}:${port}`;
const unused = createTcpServer(); await new Promise(resolve => unused.listen(0, '127.0.0.1', resolve)); const closedPort = unused.address().port; await new Promise(resolve => unused.close(resolve));
const note = (id, detail) => checks.push({id, passed: true, detail});
try {
  for (const file of ['continuity-probe.js', 'core.js']) await cp(path.join('extension', file), path.join(directory, file));
  await cp('extension/security', path.join(directory, 'security'), {recursive: true});
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'Continuity transport fixture', version: '0.0.1', permissions: ['webRequest'], host_permissions: names.map(name => `http://${name}/*`), background: {service_worker: 'background.js', type: 'module'}}));
  await writeFile(path.join(directory, 'background.js'), `import {createContinuityProbe} from './continuity-probe.js'; globalThis.runProbe=createContinuityProbe(chrome,{allowTestOrigins:true}); chrome.runtime.onInstalled.addListener(()=>{});`);
  context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {headless: true, executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`, '--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1']});
  context.setDefaultTimeout(10000);
  let [worker] = context.serviceWorkers(); if (!worker) worker = await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => { for (let i = 0; i < 50 && !globalThis.runProbe; i++) await new Promise(resolve => setTimeout(resolve, 20)); if (!globalThis.runProbe) throw new Error('Native probe worker did not initialize'); });
  const probe = url => worker.evaluate(url => globalThis.runProbe(url), url);
  active = 'P01_manual_location';
  const first = await probe(origin(names[0]) + '/');
  assert.equal(first.status, 'redirect'); assert.equal(first.httpStatus, 302); assert.equal(first.evidence, 'http_redirect'); assert.equal(first.successorUrl, origin(names[1]) + '/');
  assert.equal(hits.filter(hit => hit.host === names[1] || hit.host === names[2]).length, 0);
  note(active, 'Native opaque manual fetch observed Location through scoped webRequest and did not contact the successor.');
  active = 'P02_explicit_chain_steps';
  const second = await probe(first.successorUrl); assert.equal(second.status, 'redirect'); assert.equal(second.httpStatus, 307); assert.equal(second.successorUrl, origin(names[2]) + '/');
  assert.equal((await probe(second.successorUrl)).status, 'reachable');
  note(active, 'Two explicit native hops discover A→B→C and validate the final endpoint.');
  active = 'P03_unsafe_redirect';
  const unsafe = await probe(origin(names[3]) + '/unsafe'); assert.equal(unsafe.status, 'blocked'); assert.equal(unsafe.reason, 'UNSAFE_SUCCESSOR');
  assert.equal(hits.filter(hit => hit.path === '/private-probe').length, 0);
  note(active, 'Unsafe literal-address successor was rejected before any request to that address.');
  active = 'P04_nonexecuting_metadata';
  const meta = await probe(origin(names[0]) + '/meta'); assert.equal(meta.status, 'redirect'); assert.equal(meta.evidence, 'meta_refresh');
  assert.equal(hits.filter(hit => hit.path === '/script-executed').length, 0);
  const refreshed = await probe(origin(names[0]) + '/header-refresh'); assert.equal(refreshed.evidence, 'http_refresh');
  const advertised = await probe(origin(names[0]) + '/advertised'); assert.equal(advertised.evidence, 'successor_link'); assert.equal(advertised.successorUrl, origin(names[0]) + '/.well-known/web-switcher.json');
  assert.equal(hits.filter(hit => hit.path === '/.well-known/web-switcher.json').length, 0);
  const manifest = await probe(advertised.successorUrl); assert.equal(manifest.evidence, 'well_known'); assert.equal(manifest.successorUrl, origin(names[2]) + '/');
  note(active, 'Refresh header, inert meta and explicitly advertised JSON work without executing site JavaScript.');
  active = 'P05_permission_boundary';
  const ungranted = await probe(origin('ungranted.continuity.test') + '/'); assert.equal(ungranted.reason, 'PERMISSION_REQUIRED');
  assert.equal(hits.filter(hit => hit.host === 'ungranted.continuity.test').length, 0);
  note(active, 'An origin without Chrome host access is not probed.');
  active = 'P06_network_error_classification';
  const empty = await probe(origin(names[0]) + '/empty'); assert.equal(empty.reason, 'NETWORK_CONNECTION_FAILURE');
  const closed = await probe(`http://${names[0]}:${closedPort}/`); assert.equal(closed.reason, 'NETWORK_CONNECTION_FAILURE');
  note(active, 'Native empty-response and refused-connection errors are distinguished from generic fetch/TLS failures.');
  assert.equal(checks.length, 6);
  const result = {executedAt: new Date().toISOString(), browser: context.browser()?.version(), passedChecks: checks.length, checks, limitations: ['Generated internal loopback HTTP fixtures only; no deployed public egress or ownership claim.', 'Required fixture host grants do not test native optional-permission dialogs.']};
  await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const detail = `${active}: ${error.message}`;
  await writeFile(reportPath, JSON.stringify({executedAt: new Date().toISOString(), passedChecks: checks.length, checks, error: detail}, null, 2) + '\n');
  if (process.env.GITHUB_ACTIONS === 'true') console.error('::error title=Native continuity transport::' + detail.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
  throw error;
} finally {
  if (context) await context.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(directory, {recursive: true, force: true});
}
