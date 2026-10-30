// Actual packaged options/popup code with a controlled browser-API contract.
// This verifies UI consent/messages, not native grants or network discovery.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile, rm} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

await mkdir('test-results', {recursive: true});
await rm('test-results/continuity-ui-results.json', {force: true});
const checks = [];
let activeCheck = 'launch';
const server = http.createServer(async (req, res) => {
  const name = new URL(req.url, 'http://127.0.0.1').pathname;
  try {
    const file = path.resolve('extension', '.' + name);
    assert(file.startsWith(path.resolve('extension') + path.sep));
    const data = await readFile(file);
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    res.end(data);
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
async function check(id, work) { activeCheck = id; await work(); checks.push({id, passed: true}); console.log('PASS ' + id); }
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => {
    const grants = new Set();
    const sites = [];
    const source = 'https://old.example.org', middle = 'https://middle.example.org', latest = 'https://latest.example.org';
    const state = {messages: [], permissions: [], tabs: [], denyNext: false, rejectOpen: false};
    globalThis.continuityUiEvidence = state;
    const snapshot = () => ({config: {schemaVersion: 1, generation: 'ui-fixture', paused: false, mappings: []}, grantedOrigins: [], receipts: [], registryConfigured: false, registryRefreshConfigured: false, registry: {}, continuity: {sites: structuredClone(sites), edges: []}});
    globalThis.chrome = {
      runtime: {
        id: 'continuity-ui-fixture', getURL: name => 'chrome-extension://continuity-ui-fixture/' + name,
        openOptionsPage: async () => { state.tabs.push('options'); },
        sendMessage: async message => {
          state.messages.push(structuredClone(message));
          if (message.type === 'read') return {ok: true, data: snapshot()};
          if (message.type === 'CONTINUITY_DISCOVER') {
            const input = message.sourceOrigin;
            if (input.includes('unknown.')) return {ok: true, data: {status: 'unknown', sourceOrigin: input, chain: [], reason: 'NO_MOVE_SIGNAL'}};
            if (input.includes('conflict.')) return {ok: true, data: {status: 'conflict', sourceOrigin: input, chain: [], reason: 'CONFLICTING_SUCCESSORS'}};
            const first = {fromOrigin: source, toOrigin: middle, evidence: 'meta_refresh', checkedAt: Date.now(), remembered: true};
            if (!grants.has(middle + '/*') && !grants.has('https://*/*')) return {ok: true, data: {status: 'permission_required', sourceOrigin: input, chain: [first], requiredOrigins: [middle]}};
            const second = {fromOrigin: middle, toOrigin: latest, evidence: 'website_metadata <img id="injected">', checkedAt: Date.now()};
            if (!grants.has(latest + '/*') && !grants.has('https://*/*')) return {ok: true, data: {status: 'permission_required', sourceOrigin: input, chain: [first, second], requiredOrigins: [latest]}};
            return {ok: true, data: {status: 'found', sourceOrigin: input, terminalOrigin: latest, chain: [first, second]}};
          }
          if (message.type === 'CONTINUITY_OPEN') {
            if (state.rejectOpen) return {ok: false, error: 'The observed successor changed.'};
            state.tabs.push(message.expectedOrigin); return {ok: true, data: {opened: true}};
          }
          if (message.type === 'CONTINUITY_FOLLOW') {
            const previous = sites.find(site => site.sourceOrigin === message.sourceOrigin);
            if (previous) previous.enabled = message.enabled;
            else sites.push({id: 'followed-fixture', sourceOrigin: message.sourceOrigin, enabled: message.enabled, createdAt: Date.now()});
            return {ok: true, data: {}};
          }
          if (message.type === 'CONTINUITY_FORGET') { sites.splice(sites.findIndex(site => site.sourceOrigin === message.sourceOrigin), 1); return {ok: true, data: {}}; }
          return {ok: true, data: {}};
        }
      },
      storage: {local: {get: async () => ({}), set: async () => {}}},
      permissions: {contains: async ({origins}) => origins.every(origin => grants.has(origin) || (origin.startsWith('https://') && grants.has('https://*/*'))), request: async ({origins}) => {
        state.permissions.push([...origins]);
        if (state.denyNext) { state.denyNext = false; return false; }
        origins.forEach(origin => grants.add(origin)); return true;
      }},
      tabs: {query: async () => [{id: 7, url: source + '/private?synthetic=1'}], create: async ({url}) => { state.tabs.push(url); }}
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(base + '/options.html');
  await page.locator('#global-status').filter({hasText: 'enabled'}).waitFor();
  await check('UI01_source_only_start_and_incremental_consent', async () => {
    assert.equal(await page.locator('#continuity-wide-access').isChecked(), false);
    await page.locator('#continuity-source').fill('old.example.org/private?synthetic=1#section');
    await page.locator('#continuity-find').click();
    await page.locator('#continuity-result-title').filter({hasText: 'permission'}).waitFor();
    const evidence = await page.evaluate(() => continuityUiEvidence);
    assert.deepEqual(evidence.permissions[0], ['https://old.example.org/*']);
    assert.deepEqual(evidence.messages.find(message => message.type === 'CONTINUITY_DISCOVER'), {type: 'CONTINUITY_DISCOVER', sourceOrigin: 'https://old.example.org'});
    assert.equal(await page.locator('#continuity-open').isVisible(), false);
    assert.match(await page.locator('#continuity-continue').textContent(), /middle\.example\.org/);
    await page.locator('#continuity-continue').click();
    await page.locator('#continuity-continue').filter({hasText: 'latest.example.org'}).waitFor();
    await page.locator('#continuity-continue').click();
    await page.locator('#continuity-result-title').filter({hasText: 'reachable address'}).waitFor();
    assert.match(await page.locator('#continuity-chain').textContent(), /old\.example\.org.*middle\.example\.org/s);
    assert.match(await page.locator('#continuity-chain').textContent(), /middle\.example\.org.*latest\.example\.org/s);
    assert.match(await page.locator('#continuity-chain').textContent(), /Remembered successor/);
    assert.equal(await page.locator('#injected').count(), 0, 'Evidence must render as text, not HTML.');
  });
  await check('UI02_revalidate_before_open_and_hide_changed_result', async () => {
    await page.evaluate(() => { continuityUiEvidence.rejectOpen = true; });
    await page.locator('#continuity-open').click();
    await page.locator('#continuity-status').filter({hasText: 'changed'}).waitFor();
    assert.equal(await page.locator('#continuity-open').isVisible(), false);
    assert.equal(await page.locator('#continuity-follow').isVisible(), false);
    const message = await page.evaluate(() => continuityUiEvidence.messages.find(message => message.type === 'CONTINUITY_OPEN'));
    assert.deepEqual(message, {type: 'CONTINUITY_OPEN', sourceOrigin: 'https://old.example.org', expectedOrigin: 'https://latest.example.org'});
    await page.evaluate(() => { continuityUiEvidence.rejectOpen = false; });
    await page.locator('#continuity-find').click();
    await page.locator('#continuity-open').waitFor();
    await page.locator('#continuity-open').click();
    await page.locator('#continuity-status').filter({hasText: 'checked again'}).waitFor();
    assert.equal(await page.evaluate(() => continuityUiEvidence.tabs.at(-1)), 'https://latest.example.org');
  });
  await check('UI03_explicit_follow_consent_source_only_pause_resume_and_forget', async () => {
    assert.equal(await page.locator('#continuity-follow').isDisabled(), true);
    await page.locator('#continuity-follow-consent').check();
    await page.locator('#continuity-follow').click();
    const followed = page.locator('#continuity-followed article');
    await followed.filter({hasText: 'Following future moves'}).waitFor();
    const followMessage = await page.evaluate(() => continuityUiEvidence.messages.find(message => message.type === 'CONTINUITY_FOLLOW'));
    assert.deepEqual(followMessage, {type: 'CONTINUITY_FOLLOW', sourceOrigin: 'https://old.example.org', enabled: true});
    await followed.getByRole('button', {name: 'Pause following', exact: true}).click();
    await followed.filter({hasText: 'Following paused'}).waitFor();
    await followed.getByRole('button', {name: 'Resume following', exact: true}).click();
    await followed.filter({hasText: 'Following future moves'}).waitFor();
    await followed.getByRole('button', {name: 'Forget this website', exact: true}).click();
    await page.locator('#continuity-followed').filter({hasText: 'No followed websites yet'}).waitFor();
  });
  await check('UI04_permission_denial_and_conflict_never_open', async () => {
    const before = await page.evaluate(() => continuityUiEvidence.messages.filter(message => message.type === 'CONTINUITY_DISCOVER').length);
    await page.locator('#continuity-source').fill('https://unknown.example.org');
    await page.evaluate(() => { continuityUiEvidence.denyNext = true; });
    await page.locator('#continuity-find').click();
    await page.locator('#continuity-status').filter({hasText: 'not granted'}).waitFor();
    assert.equal(await page.evaluate(() => continuityUiEvidence.messages.filter(message => message.type === 'CONTINUITY_DISCOVER').length), before);
    await page.locator('#continuity-source').fill('https://conflict.example.org');
    await page.locator('#continuity-find').click();
    await page.locator('#continuity-result-title').filter({hasText: 'disagree'}).waitFor();
    assert.equal(await page.locator('#continuity-open').isVisible(), false);
    assert.equal(await page.locator('#continuity-follow').isVisible(), false);
  });
  await check('UI05_broad_access_is_opt_in_and_mobile_has_no_overflow', async () => {
    await page.locator('#continuity-source').fill('https://old.example.org');
    await page.locator('#continuity-wide-access').check();
    await page.locator('#continuity-find').click();
    await page.locator('#continuity-open').waitFor();
    assert.deepEqual(await page.evaluate(() => continuityUiEvidence.permissions.at(-1)), ['https://old.example.org/*', 'https://*/*']);
    await page.locator('#continuity-access-status').filter({hasText: 'currently granted'}).waitFor();
    await page.locator('#continuity-wide-access').uncheck();
    assert.match(await page.locator('#continuity-access-status').textContent(), /does not revoke/);
    assert.equal(await page.evaluate(() => chrome.permissions.contains({origins: ['https://*/*']})), true);
    await page.screenshot({path: 'test-results/continuity-settings-desktop.png', fullPage: true});
    await page.setViewportSize({width: 375, height: 812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  });
  await check('UI06_popup_primary_action_prefills_old_origin', async () => {
    await page.goto(base + '/popup.html');
    await page.locator('#current-origin').filter({hasText: 'https://old.example.org'}).waitFor();
    await page.locator('#find-current').click();
    const opened = await page.evaluate(() => continuityUiEvidence.tabs.at(-1));
    assert.equal(opened, 'chrome-extension://continuity-ui-fixture/options.html?source=https%3A%2F%2Fold.example.org#continuity');
    assert.match(await page.locator('#add-mapping').textContent(), /manual/i);
  });
  const evidence = {executedAt: new Date().toISOString(), passedChecks: checks.length, checks, scope: 'Packaged options/popup in actual Chromium with mocked browser API and discovery replies; not native extension permissions or resolver validation.'};
  await writeFile('test-results/continuity-ui-results.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log('Continuity UI contract passed: old address only, incremental permissions, explicit follow consent, chain rendering, changed-result refusal and popup entry.');
} catch (error) {
  const detail = `${activeCheck}: ${error.message}`;
  if (process.env.GITHUB_ACTIONS === 'true') console.error(`::error title=Continuity UI contract::${detail.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  await writeFile('test-results/continuity-ui-results.json', JSON.stringify({executedAt: new Date().toISOString(), passedChecks: checks.length, checks, error: detail}, null, 2) + '\n');
  throw error;
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
