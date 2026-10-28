// Native MV3 acceptance for source-only discovery and remembered successors.
// Every remote-looking hostname below is an owned loopback fixture. Permissions
// are pregranted only in the disposable copy, never in the shipped extension.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const temp = await mkdtemp(path.join(os.tmpdir(), 'web-switcher-continuity-'));
const extension = path.join(temp, 'extension');
const profile = path.join(temp, 'profile');
await cp('extension', extension, {recursive: true});
const buildConfig = await readFile(path.join(extension, 'build-config.js'), 'utf8');
assert.match(buildConfig, /export const ALLOW_TEST_ORIGINS = false;/);
await writeFile(path.join(extension, 'build-config.js'), buildConfig.replace('export const ALLOW_TEST_ORIGINS = false;', 'export const ALLOW_TEST_ORIGINS = true;'));
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
assert.ok(manifest.permissions.includes('webRequest'), 'The real probe must observe its own response headers.');
manifest.host_permissions = ['http://*.test/*'];
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
await mkdir('test-results', {recursive: true});

const hits = [], checks = [], modes = new Map([
  ['old.test', {kind: 'http', target: 'bridge.test'}],
  ['bridge.test', {kind: 'meta', target: 'current.test'}],
  ['current.test', {kind: 'page'}],
  ['next.test', {kind: 'page'}],
  ['unmoved.test', {kind: 'page'}],
  ['canonical.test', {kind: 'canonical', target: 'decoy.test'}],
  ['decoy.test', {kind: 'page'}],
  ['conflict.test', {kind: 'http', target: 'left.test'}],
  ['left.test', {kind: 'page'}],
  ['right.test', {kind: 'page'}],
  ['cycle-a.test', {kind: 'http', target: 'cycle-b.test'}],
  ['cycle-b.test', {kind: 'http', target: 'cycle-a.test'}],
  ['deny.test', {kind: 'http', target: 'deny-target.test'}],
  ['deny-target.test', {kind: 'page'}],
]);
const server = http.createServer((req, res) => {
  const hostname = new URL('http://' + req.headers.host).hostname;
  hits.push({hostname, method: req.method, path: req.url, destination: req.headers['sec-fetch-dest'] || '', cookie: req.headers.cookie || null, referrer: req.headers.referer || null});
  const mode = modes.get(hostname) || {kind: 'page'};
  if (mode.kind === 'dead') { req.socket.destroy(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (mode.kind === 'http') {
    res.statusCode = 302; res.setHeader('Location', origin(mode.target) + '/'); res.end();
  } else if (mode.kind === 'meta') {
    res.end(`<!doctype html><meta http-equiv="refresh" content="0; url=${origin(mode.target)}/"><title>Declared move</title>`);
  } else if (mode.kind === 'canonical') {
    res.end(`<!doctype html><title>Ordinary page</title><link rel="canonical" href="${origin(mode.target)}/"><a href="${origin(mode.target)}/">A different website</a><h1>Canonical is not a migration</h1>`);
  } else if (mode.kind === 'deny') {
    res.statusCode = 403; res.end('<!doctype html><h1>Access refused</h1>');
  } else {
    res.end(`<!doctype html><title>${hostname} fixture</title><h1>Live fixture: ${hostname}</h1>`);
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = hostname => `http://${hostname}:${port}`;
const sourceOrigin = origin('old.test');
const currentOrigin = origin('current.test');
const latestOrigin = origin('next.test');
let context, worker, settings, extensionId, browserVersion;
let activeCheck = 'C00_launch';

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    viewport: {width: 1280, height: 1000},
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1'],
  });
  context.setDefaultTimeout(15000);
  [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2];
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByText('Local switching enabled', {exact: true}).waitFor();
}
async function message(type, extra = {}) {
  const response = await settings.evaluate(data => chrome.runtime.sendMessage(data), {type, ...extra});
  assert.equal(response?.ok, true, response?.error || 'Extension message did not succeed.');
  return response.data;
}
async function storage(key) { return worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key); }
async function navigate(page, url) {
  try { await page.goto(url, {waitUntil: 'domcontentloaded'}); }
  catch (error) { if (!error.message.includes('ERR_ABORTED')) throw error; }
}
async function check(id, run) { activeCheck = id; await run(); checks.push({id, passed: true}); console.log(`PASS ${id}`); }
function count(hostname, destination) { return hits.filter(hit => hit.hostname === hostname && (destination === undefined || hit.destination === destination)).length; }
async function discovery(source = sourceOrigin) { return message('CONTINUITY_DISCOVER', {sourceOrigin: source}); }
async function follow(source, enabled = true) { return message('CONTINUITY_FOLLOW', {sourceOrigin: source, enabled}); }
const gateUrl = () => `chrome-extension://${extensionId}/continuity-gate.html`;

try {
  await launch();
  await context.addCookies(['old.test', 'bridge.test', 'current.test'].map(hostname => ({url: origin(hostname), name: 'private_fixture_session', value: 'do-not-send-during-probes'})));
  await check('C01_source_only_UI_discovers_HTTP_and_meta_chain', async () => {
    assert.equal(await settings.locator('#continuity-wide-access').isChecked(), false);
    await settings.getByLabel('Old website address', {exact: true}).fill(sourceOrigin + '/private-input?token=private-url-secret#fragment');
    await settings.getByRole('button', {name: 'Find current address', exact: false}).click();
    await settings.getByText(`Reachable now: ${currentOrigin}`, {exact: true}).waitFor();
    const chain = await settings.locator('#continuity-chain').textContent();
    for (const member of [sourceOrigin, origin('bridge.test'), currentOrigin]) assert.ok(chain.includes(member));
    assert.match(chain, /http redirect/i); assert.match(chain, /meta refresh/i); assert.match(chain, /Unverified/);
    assert.equal((await storage('config')).mappings.length, 0, 'No destination is entered as a manual mapping.');
    assert.equal(await settings.locator('#destination').inputValue(), '');
    await settings.screenshot({path: 'test-results/continuity-source-only.png', fullPage: true});
  });
  await check('C02_open_latest_from_discovered_result_without_manual_mapping', async () => {
    const opening = context.waitForEvent('page');
    await settings.getByRole('button', {name: 'Open latest address', exact: true}).click();
    const opened = await opening; await opened.waitForURL(currentOrigin + '/');
    assert.equal((await storage('config')).mappings.length, 0);
    await opened.close();
  });
  await check('C03_follow_source_only_then_navigation_reaches_discovered_current', async () => {
    await settings.locator('#continuity-follow-consent').check();
    await settings.getByRole('button', {name: 'Follow this website', exact: true}).click();
    await settings.getByText('Following this source. Future visits can check and follow its observed successor chain.', {exact: true}).waitFor();
    const state = await storage('continuityState');
    assert.equal(state.sites.length, 1); assert.equal(state.sites[0].sourceOrigin, sourceOrigin); assert.equal(state.sites[0].enabled, true);
    assert.equal((await storage('config')).mappings.length, 0);
    const oldDocumentRequests = count('old.test', 'document');
    const page = await context.newPage();
    await navigate(page, sourceOrigin + '/public-docs?demo=1#section');
    await page.waitForURL(currentOrigin + '/');
    assert.equal(count('old.test', 'document'), oldDocumentRequests, 'The extension gate, rather than a normal old-site page load, must handle this navigation.');
    assert.equal(new URL(page.url()).search, ''); assert.equal(new URL(page.url()).hash, '');
    await page.close();
  });
  await check('C04_probe_requests_omit_credentials_referrer_and_private_URL_parts', async () => {
    const probes = hits.filter(hit => hit.destination === 'empty');
    assert.ok(probes.length >= 3, 'The real extension must issue fixture probes.');
    for (const hit of probes) { assert.equal(hit.method, 'GET'); assert.equal(hit.cookie, null); assert.equal(hit.referrer, null); assert.equal(hit.path, '/'); }
    assert.ok(!JSON.stringify(hits).includes('private-url-secret'));
    const state = await storage('continuityState');
    for (const edge of state.edges) assert.deepEqual(Object.keys(edge).sort(), ['evidence', 'expiresAt', 'firstSeen', 'fromOrigin', 'lastSeen', 'toOrigin']);
    assert.ok(!JSON.stringify(state).includes('private-input'));
  });
  await check('C05_dead_old_origin_uses_remembered_successor_and_checks_terminal', async () => {
    modes.set('old.test', {kind: 'dead'});
    const result = await discovery();
    assert.equal(result.status, 'found'); assert.equal(result.terminalOrigin, currentOrigin);
    assert.ok(result.chain.some(edge => edge.fromOrigin === sourceOrigin && edge.remembered));
    assert.ok(result.attempts.some(attempt => attempt.origin === sourceOrigin && attempt.status === 'unavailable'));
    assert.ok(result.attempts.some(attempt => attempt.origin === currentOrigin && attempt.status === 'reachable'));
    const page = await context.newPage(); await navigate(page, sourceOrigin + '/retired'); await page.waitForURL(currentOrigin + '/'); await page.close();
  });
  await check('C06_multiple_dead_origins_and_future_move_find_new_terminal', async () => {
    modes.set('bridge.test', {kind: 'dead'}); modes.set('current.test', {kind: 'meta', target: 'next.test'});
    const result = await discovery();
    assert.equal(result.status, 'found'); assert.equal(result.terminalOrigin, latestOrigin);
    assert.deepEqual(result.chain.map(edge => [edge.fromOrigin, edge.toOrigin]), [[sourceOrigin, origin('bridge.test')], [origin('bridge.test'), currentOrigin], [currentOrigin, latestOrigin]]);
    assert.equal(result.chain.filter(edge => edge.remembered).length, 2);
    assert.equal(result.chain.at(-1).evidence, 'meta_refresh');
    // Retire the former terminal as well. A fixed A→C mapping or ordinary live
    // redirect traversal cannot recover now; the learned C→D edge is required.
    modes.set('current.test', {kind: 'dead'});
    const page = await context.newPage(); await navigate(page, sourceOrigin + '/moved-again'); await page.waitForURL(latestOrigin + '/'); await page.close();
  });
  await check('C07_discovered_history_and_following_survive_browser_restart', async () => {
    await context.close(); context = undefined; await launch();
    const state = await storage('continuityState'); assert.ok(state.sites.some(site => site.sourceOrigin === sourceOrigin && site.enabled));
    assert.ok(state.edges.some(edge => edge.fromOrigin === currentOrigin && edge.toOrigin === latestOrigin));
    const page = await context.newPage(); await navigate(page, sourceOrigin + '/after-restart'); await page.waitForURL(latestOrigin + '/'); await page.close();
  });
  await check('C08_reachable_source_and_generic_canonical_links_are_not_migrations', async () => {
    const original = await discovery(origin('unmoved.test'));
    assert.equal(original.status, 'unknown'); assert.equal(original.originalReachable, true); assert.equal(original.terminalOrigin, undefined);
    const before = count('decoy.test'); const canonical = await discovery(origin('canonical.test'));
    assert.equal(canonical.status, 'unknown'); assert.equal(canonical.terminalOrigin, undefined); assert.equal(count('decoy.test'), before);
  });
  await check('C09_followed_healthy_unmoved_site_resumes_its_original_URL', async () => {
    await follow(origin('unmoved.test'));
    const page = await context.newPage(); const original = origin('unmoved.test') + '/docs/retained?keep=1#section';
    await navigate(page, original); await page.waitForURL(original);
    await page.getByRole('heading', {name: 'Live fixture: unmoved.test'}).waitFor();
    assert.ok(!page.url().startsWith('chrome-extension:')); await page.close();
  });
  await check('C10_conflicting_successor_stops_before_contacting_new_destination', async () => {
    assert.equal((await discovery(origin('conflict.test'))).terminalOrigin, origin('left.test'));
    modes.set('conflict.test', {kind: 'http', target: 'right.test'});
    const before = count('right.test'); const result = await discovery(origin('conflict.test'));
    assert.equal(result.status, 'conflict'); assert.equal(result.terminalOrigin, undefined); assert.equal(count('right.test'), before);
  });
  await check('C11_redirect_cycles_stop_with_bounded_requests', async () => {
    const before = count('cycle-a.test') + count('cycle-b.test');
    const result = await discovery(origin('cycle-a.test'));
    assert.equal(result.status, 'loop'); assert.equal(result.terminalOrigin, undefined);
    assert.ok(count('cycle-a.test') + count('cycle-b.test') - before <= 3);
  });
  await check('C12_HTTP_refusal_does_not_skip_to_remembered_target', async () => {
    assert.equal((await discovery(origin('deny.test'))).terminalOrigin, origin('deny-target.test'));
    modes.set('deny.test', {kind: 'deny'}); const before = count('deny-target.test');
    const result = await discovery(origin('deny.test'));
    assert.equal(result.status, 'unavailable'); assert.equal(result.reason, 'HTTP_403'); assert.equal(result.terminalOrigin, undefined); assert.equal(count('deny-target.test'), before);
  });
  await check('C13_ungranted_origin_requires_permission_before_network', async () => {
    const before = hits.filter(hit => hit.destination === 'empty').length;
    const result = await discovery('https://ungranted-continuity-site.com/private?token=local-only');
    assert.equal(result.status, 'permission_required'); assert.deepEqual(result.requiredOrigins, ['https://ungranted-continuity-site.com']); assert.equal(result.terminalOrigin, undefined);
    assert.equal(hits.filter(hit => hit.destination === 'empty').length, before);
  });
  await check('C14_sensitive_original_link_needs_a_fresh_confirmation', async () => {
    const before = count('next.test', 'document'); const page = await context.newPage();
    await navigate(page, sourceOrigin + '/account/login?token=private-url-secret#section');
    await page.waitForFunction(() => document.body.dataset.reason === 'manual');
    assert.equal(page.url(), gateUrl()); assert.equal(count('next.test', 'document'), before);
    const confirm = page.locator('#continuity-confirm'); await confirm.waitFor({state: 'visible'});
    await Promise.all([page.waitForURL(latestOrigin + '/'), confirm.click()]);
    assert.ok(!JSON.stringify(hits).includes('private-url-secret'));
    await page.close();
  });
  await check('C15_global_pause_removes_automatic_continuity_interception', async () => {
    await message('pauseAll', {paused: true});
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 0);
    const page = await context.newPage(); const original = origin('unmoved.test') + '/paused?keep=1';
    await page.goto(original); assert.equal(page.url(), original); await page.close();
    await message('pauseAll', {paused: false});
  });
  await check('C16_stale_and_forged_gate_envelopes_do_not_trigger_discovery', async () => {
    const state = await storage('continuityState'), config = await storage('config');
    const relevantHits = () => hits.filter(hit => ['old.test', 'bridge.test', 'current.test', 'next.test', 'evil.test'].includes(hit.hostname) && (hit.destination === 'empty' || hit.hostname === 'evil.test')).length;
    const site = state.sites.find(site => site.sourceOrigin === sourceOrigin); const before = relevantHits();
    const stale = await context.newPage(); await stale.goto(`${gateUrl()}#g=stale&m=${site.id}&source=${sourceOrigin}/`);
    await stale.waitForFunction(() => document.body.dataset.reason === 'changed'); assert.equal(stale.url(), gateUrl()); await stale.close();
    const forged = await context.newPage(); await forged.goto(`${gateUrl()}#g=${config.generation}&m=${site.id}&source=${origin('evil.test')}/`);
    await forged.waitForFunction(() => document.body.dataset.reason === 'invalid'); assert.equal(forged.url(), gateUrl()); await forged.close();
    assert.equal(relevantHits(), before);
  });
  await check('C17_expired_successor_history_cannot_recover_a_dead_origin', async () => {
    const state = await storage('continuityState'), old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    for (const edge of state.edges) Object.assign(edge, {firstSeen: old, lastSeen: old, expiresAt: old + 7 * 24 * 60 * 60 * 1000});
    await worker.evaluate(state => chrome.storage.local.set({continuityState: state}), state);
    const before = count('next.test', 'empty'); const result = await discovery();
    assert.equal(result.status, 'unavailable'); assert.equal(result.terminalOrigin, undefined); assert.equal(count('next.test', 'empty'), before);
  });
  await check('C18_forget_and_clear_remove_following_and_local_history', async () => {
    await message('CONTINUITY_FORGET', {sourceOrigin});
    assert.ok(!(await storage('continuityState')).sites.some(site => site.sourceOrigin === sourceOrigin));
    await message('CLEAR_LOCAL_DATA');
    assert.equal((await storage('continuityState'))?.sites.length || 0, 0);
    assert.equal((await storage('continuityState'))?.edges.length || 0, 0);
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 0);
  });
  assert.equal(checks.length, 18, 'Every current continuity acceptance check must execute.');
} catch (error) {
  try {
    if (settings && !settings.isClosed()) {
      const result = await discovery();
      error.message += `; source discovery: ${JSON.stringify(result)}; fixture hits: ${JSON.stringify(hits.slice(-10))}`;
    }
  } catch { /* Diagnostic probing must not hide the first acceptance failure. */ }
  const notices = [];
  for (const page of context?.pages() || []) {
    try {
      for (const selector of ['#notice', '#message', '#continuity-status', '#continuity-message']) {
        const node = page.locator(selector);
        if (await node.count()) notices.push((await node.textContent({timeout: 1000}))?.slice(0, 500));
      }
    } catch { /* Keep the original failure. */ }
  }
  if (notices.some(Boolean)) error.message += `; notices: ${notices.filter(Boolean).join(' | ')}`;
  console.error(`FAIL ${activeCheck}: ${error.message}`);
  if (process.env.GITHUB_ACTIONS === 'true') console.error('::error title=Automatic continuity browser acceptance::' + `${activeCheck}: ${error.message}`.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
  checks.push({id: activeCheck, passed: false, error: error.message}); process.exitCode = 1;
} finally {
  await writeFile('test-results/continuity-browser.json', JSON.stringify({executedAt: new Date().toISOString(), browserVersion, passedChecks: checks.filter(check => check.passed).length, checks,
    limitations: ['Loopback HTTP fixtures and pregranted test-origin permissions; not native permission-dialog acceptance.', 'Source-declared observations are unverified and do not prove operator identity or content safety.', 'No public DNS/connect-IP pinning, public-site discovery accuracy or Chrome/Edge Store approval claim.']}, null, 2) + '\n');
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, {recursive: true, force: true});
}
