// Native MV3 acceptance for many old aliases sharing a checked current address.
// These are owned loopback fixtures, not claims about public website identity.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const temp = await mkdtemp(path.join(os.tmpdir(), 'web-switcher-shared-follow-'));
const extension = path.join(temp, 'extension'), profile = path.join(temp, 'profile');
await cp('extension', extension, {recursive: true});
const build = await readFile(path.join(extension, 'build-config.js'), 'utf8');
assert.match(build, /export const ALLOW_TEST_ORIGINS = false;/);
await writeFile(path.join(extension, 'build-config.js'), build.replace('export const ALLOW_TEST_ORIGINS = false;', 'export const ALLOW_TEST_ORIGINS = true;'));
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://*.test/*'];
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
await mkdir('test-results', {recursive: true});

const modes = new Map(), hits = [], checks = [], held = new Map();
let context, worker, settings, extensionId, browserVersion, activeCheck = 'G00_launch';
const origin = hostname => `http://${hostname}:${port}`;
function resetModes() {
  modes.clear();
  modes.set('alias-a.test', {kind: 'gone'}); modes.set('alias-b.test', {kind: 'gone'});
  modes.set('current.test', {kind: 'page'}); modes.set('later.test', {kind: 'page'}); modes.set('latest.test', {kind: 'page'});
}
const server = http.createServer((req, res) => {
  const hostname = new URL('http://' + req.headers.host).hostname;
  const destination = req.headers['sec-fetch-dest'] || '', accept = req.headers.accept || '';
  const requestKind = destination ? destination === 'empty' ? 'probe' : destination === 'document' ? 'document' : 'subresource'
    : accept === '*/*' ? 'probe' : accept.startsWith('text/html') ? 'document' : 'subresource';
  hits.push({hostname, path: req.url, method: req.method, requestKind, cookie: req.headers.cookie || null, referrer: req.headers.referer || null});
  const mode = modes.get(hostname) || {kind: 'page'};
  function respond(current) {
    if (res.destroyed) return;
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    if (current.kind === 'http' && req.url === '/') {
      res.statusCode = 302; res.setHeader('Location', origin(current.target) + '/'); res.end();
    } else if (current.kind === 'gone') {
      res.statusCode = 410; res.end('<!doctype html><h1>Retired fixture</h1>');
    } else {
      res.end(`<!doctype html><title>${hostname} fixture</title><h1>Live fixture: ${hostname}</h1>`);
    }
  }
  if (mode.kind === 'hold' && requestKind === 'probe' && req.url === '/') {
    held.set(hostname, () => {held.delete(hostname); const after = mode.target ? {kind: 'http', target: mode.target} : {kind: 'page'}; modes.set(hostname, after); respond(after);});
  } else respond(mode);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const oldA = origin('alias-a.test'), oldB = origin('alias-b.test'), current = origin('current.test'), later = origin('later.test'), latest = origin('latest.test');
const slug = '/download-invincible-hindi-dubbed-series/';
resetModes();

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    viewport: {width: 1280, height: 1000},
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1'],
  });
  context.setDefaultTimeout(15000);
  [worker] = context.serviceWorkers(); if (!worker) worker = await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2]; browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  settings = await context.newPage(); await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByText('Local switching enabled', {exact: true}).waitFor();
}
async function message(type, extra = {}) {
  const response = await settings.evaluate(value => chrome.runtime.sendMessage(value), {type, ...extra});
  assert.equal(response?.ok, true, response?.error || 'Extension message failed.'); return response.data;
}
async function stored(key = 'config') { return worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key); }
async function setConfig(config) { await worker.evaluate(config => chrome.storage.local.set({config}), config); }
async function navigate(page, url) {
  try { await page.goto(url, {waitUntil: 'domcontentloaded'}); }
  catch (error) { if (!error.message.includes('ERR_ABORTED')) throw error; }
}
async function check(id, run) { activeCheck = id; await run(); checks.push({id, passed: true}); console.log(`PASS ${id}`); }
function card(source) { return settings.locator('#mapping-list article.mapping').filter({has: settings.getByRole('heading', {name: source, exact: true})}); }
async function createMapping(source, target, pathPolicy = 'preserve', follow = false) {
  await settings.locator('#source').fill(source); await settings.locator('#destination').fill(target);
  await settings.locator('#path-policy').selectOption(pathPolicy);
  await settings.locator('#follow-destination').setChecked(follow);
  await settings.locator('#verified').check();
  await settings.getByRole('button', {name: 'Connect these addresses'}).click();
  await card(source).waitFor();
}
async function enableGroup(source = oldA) {
  await card(source).getByRole('button', {name: 'Follow destination moves', exact: true}).click();
  await card(source).getByText('Shared destination · follows declared moves', {exact: true}).waitFor();
}
async function setupPair() {
  await createMapping(oldA, current); await createMapping(oldB, current); await enableGroup();
  return stored();
}
async function reset() {
  for (const release of held.values()) release(); held.clear(); resetModes();
  await message('CLEAR_LOCAL_DATA'); await settings.reload(); await settings.getByText('Local switching enabled', {exact: true}).waitFor();
}
async function route(source, target, suffix = slug) {
  const page = await context.newPage(); await navigate(page, source + suffix + '?public=fixture#private-fragment');
  await page.waitForURL(target + suffix); await page.getByRole('heading', {name: `Live fixture: ${new URL(target).hostname}`, exact: true}).waitFor(); return page;
}
async function blocked(page, reason) {
  await page.waitForFunction(reason => document.body.dataset.reason === reason, reason);
  assert.equal(page.url(), `chrome-extension://${extensionId}/route.html`);
}
async function waitHeld(hostname) {
  const end = Date.now() + 10000;
  while (!held.has(hostname)) { if (Date.now() > end) throw new Error(`No held probe for ${hostname}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function probesSince(index) { return hits.slice(index).filter(hit => hit.requestKind === 'probe'); }
function assertLinked(config, target, sources) {
  for (const source of sources) {
    const mapping = config.mappings.find(item => item.sourceOrigin === source);
    assert.ok(mapping, `Missing old alias ${source}`); assert.equal(mapping.destinationOrigin, target); assert.equal(mapping.followOrigin, current);
  }
}

try {
  await launch();
  await check('G01_multiple_old_origins_join_one_opted_in_destination', async () => {
    const config = await setupPair(); assertLinked(config, current, [oldA, oldB]);
    assert.equal(config.mappings.length, 2);
    await settings.screenshot({path: 'test-results/shared-follow-settings.png', fullPage: true});
  });
  await check('G02_healthy_shared_current_keeps_paths_for_both_aliases', async () => {
    const before = hits.length;
    for (const old of [oldA, oldB]) { const page = await route(old, current); await page.close(); }
    const relevant = hits.slice(before);
    assert.ok(probesSince(before).filter(hit => hit.hostname === 'current.test').length >= 2);
    assert.ok(relevant.every(hit => !['alias-a.test', 'alias-b.test'].includes(hit.hostname)), 'Only the known current address is probed; old aliases are intercepted before contact.');
    for (const hit of probesSince(before)) { assert.equal(hit.path, '/'); assert.equal(hit.cookie, null); assert.equal(hit.referrer, null); }
    assert.ok(relevant.filter(hit => hit.requestKind === 'document').every(hit => hit.path === slug && hit.referrer === null));
  });
  let originalMembers;
  await check('G03_first_declared_move_updates_every_alias_and_enrolls_former_current', async () => {
    originalMembers = (await stored()).mappings.map(item => ({id: item.id, createdAt: item.createdAt, expiresAt: item.expiresAt, pathPolicy: item.pathPolicy}));
    modes.set('current.test', {kind: 'http', target: 'later.test'});
    const page = await route(oldA, later); await page.close();
    const config = await stored(); assertLinked(config, later, [oldA, oldB, current]);
    await settings.waitForFunction(target => {
      const rows = [...document.querySelectorAll('#mapping-list .destination')];
      return rows.length === 3 && rows.every(row => row.textContent === `→ ${target}`);
    }, later);
    for (const original of originalMembers) {
      const updated = config.mappings.find(item => item.id === original.id);
      assert.deepEqual({id: updated.id, createdAt: updated.createdAt, expiresAt: updated.expiresAt, pathPolicy: updated.pathPolicy}, original, 'Automatic moves must not renew local consent or alter path choice.');
    }
  });
  await check('G04_later_move_uses_latest_pointer_when_earlier_domains_are_gone', async () => {
    modes.set('current.test', {kind: 'gone'}); modes.set('later.test', {kind: 'http', target: 'latest.test'});
    const before = hits.length; const page = await route(oldB, latest); await page.close();
    assertLinked(await stored(), latest, [oldA, oldB, current, later]);
    assert.ok(!hits.slice(before).some(hit => ['alias-a.test', 'alias-b.test', 'current.test'].includes(hit.hostname)), 'The shared current pointer avoids retired earlier origins entirely.');
    assert.ok(probesSince(before).some(hit => hit.hostname === 'later.test'));
    assert.ok(probesSince(before).some(hit => hit.hostname === 'latest.test'));
  });
  await check('G05_former_current_domains_route_to_latest_and_group_exports_round_trip_decisions', async () => {
    for (const old of [current, later]) { const page = await route(old, latest); await page.close(); }
    const backup = await message('EXPORT_SETTINGS');
    assert.equal(backup.mappings.filter(item => item.followOrigin === current).length, 4);
    assert.ok(!JSON.stringify(backup).includes('private-fragment'));
    assert.ok(!Object.hasOwn(backup, 'continuityState'), 'A manual backup must not claim to export signed authority or discovered history.');
  });
  await check('G06_shared_pointer_and_derived_aliases_survive_browser_restart', async () => {
    await context.close(); context = undefined; await launch();
    assertLinked(await stored(), latest, [oldA, oldB, current, later]);
    const page = await route(oldA, latest); await page.close();
  });
  await check('G07_path_choices_remain_individual_and_sensitive_links_require_homepage_confirmation', async () => {
    const config = await stored(), b = config.mappings.find(item => item.sourceOrigin === oldB);
    await message('setPathPolicy', {id: b.id, pathPolicy: 'homepage', generation: config.generation});
    const home = await context.newPage(); await navigate(home, oldB + slug); await home.waitForURL(latest + '/'); await home.close();
    const sensitive = await context.newPage(); const before = hits.length;
    await navigate(sensitive, oldA + '/account/login?token=do-not-copy#private'); await blocked(sensitive, 'manual');
    assert.ok(!hits.slice(before).some(hit => hit.requestKind === 'document'));
    await Promise.all([sensitive.waitForURL(latest + '/'), sensitive.getByRole('button', {name: 'Open destination homepage', exact: true}).click()]);
    assert.ok(!JSON.stringify(hits).includes('do-not-copy')); await sensitive.close();
  });
  await check('G08_stopping_following_freezes_all_linked_aliases_without_background_checks', async () => {
    await settings.reload(); await card(oldA).getByRole('button', {name: 'Stop following destination moves', exact: true}).click();
    await card(oldA).getByRole('button', {name: 'Follow destination moves', exact: true}).waitFor();
    const config = await stored(); assert.ok(config.mappings.every(item => !item.followOrigin));
    modes.set('latest.test', {kind: 'http', target: 'unselected.test'});
    const before = hits.length; const page = await route(oldA, latest); await page.close();
    assert.equal(probesSince(before).length, 0, 'A static mapping must not silently keep probing after the group is disabled.');
  });
  await check('G09_global_pause_removes_interception_and_group_expiry_does_not_renew_itself', async () => {
    await reset(); const config = await setupPair();
    await message('pauseAll', {paused: true});
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 0);
    const before = hits.length, page = await context.newPage(); await page.goto(oldA + '/paused'); assert.equal(page.url(), oldA + '/paused'); await page.close();
    assert.equal(probesSince(before).length, 0);
    await message('pauseAll', {paused: false});
    const expired = await stored(), at = Date.now();
    for (const mapping of expired.mappings) {mapping.createdAt = at - 7200000; mapping.expiresAt = at - 3600000;}
    await setConfig(expired);
    const beforeExpired = hits.length, stale = await context.newPage(); await navigate(stale, oldA + slug); await blocked(stale, 'expired'); await stale.close();
    assert.equal(probesSince(beforeExpired).length, 0); assert.equal((await stored()).mappings[0].destinationOrigin, current);
    assert.equal(config.mappings[0].followOrigin, current);
  });
  await check('G10_ungranted_current_requires_permission_before_any_probe', async () => {
    await reset(); await createMapping(oldA, current);
    const config = await stored(); const mapping = config.mappings[0];
    mapping.destinationOrigin = 'https://ungranted-shared-destination.com'; mapping.followOrigin = mapping.destinationOrigin;
    await setConfig(config);
    const before = hits.length, page = await context.newPage(); await navigate(page, oldA + slug);
    await blocked(page, 'destination_permission');
    await page.getByRole('button', {name: 'Allow next destination check', exact: true}).waitFor();
    assert.equal(probesSince(before).length, 0); assert.equal((await stored()).mappings[0].destinationOrigin, mapping.destinationOrigin); await page.close();
  });
  await check('G11_return_to_a_group_old_origin_is_a_conflict_not_a_new_current', async () => {
    await reset(); const config = await setupPair(); modes.set('current.test', {kind: 'http', target: 'alias-a.test'}); modes.set('alias-a.test', {kind: 'page'});
    const page = await context.newPage(); await navigate(page, oldB + slug);
    await page.waitForFunction(() => ['conflict', 'loop', 'override'].includes(document.body.dataset.reason));
    const after = await stored(); assert.equal(after.generation, config.generation); assertLinked(after, current, [oldA, oldB]);
    assert.equal(after.mappings.length, 2); await page.close();
  });
  await check('G12_external_policy_change_during_probe_cannot_advance_any_alias', async () => {
    await reset(); const before = await setupPair(); modes.set('current.test', {kind: 'hold', target: 'later.test'});
    const page = await context.newPage(); const start = hits.length; const navigation = navigate(page, oldA + slug);
    try {
      await waitHeld('current.test');
      const changed = structuredClone(before); changed.generation = 'external-shared-group-change'; await setConfig(changed);
      held.get('current.test')(); await navigation; await blocked(page, 'changed');
      const after = await stored(); assert.equal(after.generation, changed.generation); assertLinked(after, current, [oldA, oldB]);
      assert.ok(!hits.slice(start).some(hit => hit.hostname === 'later.test' && hit.requestKind === 'document'));
    } finally { if (held.has('current.test')) held.get('current.test')(); await page.close(); }
  });
  await check('G13_external_pause_during_probe_stops_routing_without_reactivating_group', async () => {
    await reset(); const before = await setupPair(); modes.set('current.test', {kind: 'hold', target: 'later.test'});
    const page = await context.newPage(); const start = hits.length; const navigation = navigate(page, oldA + slug);
    try {
      await waitHeld('current.test'); const paused = structuredClone(before); paused.paused = true; await setConfig(paused);
      held.get('current.test')(); await navigation;
      await page.waitForFunction(() => ['paused', 'changed'].includes(document.body.dataset.reason));
      const after = await stored(); assert.equal(after.paused, true); assertLinked(after, current, [oldA, oldB]);
      assert.ok(!hits.slice(start).some(hit => hit.hostname === 'later.test' && hit.requestKind === 'document'));
    } finally { if (held.has('current.test')) held.get('current.test')(); await page.close(); }
  });
  await check('G14_sensitive_confirmation_uses_the_generation_committed_by_its_own_move', async () => {
    await reset(); const before = await setupPair(); modes.set('current.test', {kind: 'http', target: 'later.test'});
    const page = await context.newPage(); const start = hits.length;
    try {
      await navigate(page, oldA + '/account/login?token=confirm-private#section'); await blocked(page, 'manual');
      const advanced = await stored(); assert.notEqual(advanced.generation, before.generation);
      assertLinked(advanced, later, [oldA, oldB, current]);
      await page.getByText(later + '/', {exact: true}).waitFor();
      assert.ok(!hits.slice(start).some(hit => hit.requestKind === 'document'), 'A move may update shared policy, but the sensitive URL still needs its separate confirmation.');
      await Promise.all([page.waitForURL(later + '/'), page.getByRole('button', {name: 'Open destination homepage', exact: true}).click()]);
      await page.getByRole('heading', {name: 'Live fixture: later.test', exact: true}).waitFor();
      assert.ok(!JSON.stringify(hits).includes('confirm-private'));
    } finally { await page.close(); }
  });
  await check('G15_a_second_move_before_confirmation_cannot_open_the_stale_preview', async () => {
    await reset(); await setupPair(); modes.set('current.test', {kind: 'http', target: 'later.test'});
    const page = await context.newPage();
    try {
      await navigate(page, oldA + '/account/login?token=second-move-private'); await blocked(page, 'manual');
      assertLinked(await stored(), later, [oldA, oldB, current]);
      await page.getByText(later + '/', {exact: true}).waitFor();
      modes.set('later.test', {kind: 'http', target: 'latest.test'});
      const start = hits.length;
      await page.getByRole('button', {name: 'Open destination homepage', exact: true}).click();
      await blocked(page, 'changed');
      assertLinked(await stored(), latest, [oldA, oldB, current, later]);
      assert.ok(!hits.slice(start).some(hit => hit.requestKind === 'document'), 'Neither the stale homepage nor a newly discovered homepage may open under the old confirmation.');
      assert.ok(!JSON.stringify(hits).includes('second-move-private'));
    } finally { await page.close(); }
  });
  assert.equal(checks.length, 15);
} catch (error) {
  const notices = [];
  for (const page of context?.pages() || []) {
    try { for (const selector of ['#notice', '#message']) { const node = page.locator(selector); if (await node.count()) notices.push((await node.textContent({timeout: 1000}))?.slice(0, 600)); } }
    catch { /* Preserve the first acceptance failure. */ }
  }
  error.message += `; fixture hits: ${JSON.stringify(hits.slice(-12))}; notices: ${notices.filter(Boolean).join(' | ')}`;
  console.error(`FAIL ${activeCheck}: ${error.message}`);
  if (process.env.GITHUB_ACTIONS === 'true') console.error('::error title=Shared destination browser acceptance::' + `${activeCheck}: ${error.message}`.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
  checks.push({id: activeCheck, passed: false, error: error.message}); process.exitCode = 1;
} finally {
  for (const release of held.values()) release(); held.clear();
  await writeFile('test-results/shared-follow-browser.json', JSON.stringify({executedAt: new Date().toISOString(), browserVersion, passedChecks: checks.filter(check => check.passed).length, checks,
    limitations: ['Owned loopback HTTP fixtures and pregranted test-origin access; native optional permission dialogs and actual permission revocation are not accepted here.', 'Source-declared shared moves do not establish public-domain ownership or article compatibility.', 'Signed reservation and permission-revocation races require the separate worker tests; no public-site recovery accuracy or Store approval claim.']}, null, 2) + '\n');
  if (context) await context.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(temp, {recursive: true, force: true});
}
