// Real packaged options code in Chromium; worker/permissions are controlled mocks.
// Native MV3 networking and authority checks belong to internet-browser.mjs.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile, rm} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const report = 'test-results/internet-ui-results.json';
await mkdir('test-results', {recursive: true}); await rm(report, {force: true});
const checks = []; let active = 'UI00_launch', browser;
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = path.resolve('extension', '.' + pathname);
    assert(file.startsWith(path.resolve('extension') + path.sep));
    response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'text/html');
    response.end(await readFile(file));
  } catch {response.statusCode = 404; response.end('Not found');}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function check(id, work) {active = id; await work(); checks.push({id, passed: true}); console.log('PASS ' + id);}
try {
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {})});
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  await context.addInitScript(() => {
    const source = 'https://old.example.org', candidate = 'https://candidate.example.net', current = 'https://current.example.com';
    const grants = new Set(), jobs = new Map(), mappings = [];
    let sequence = 0, serviceOrigin = '', hasAccessToken = false;
    const state = {messages: [], permissions: [], opened: [], saved: [], denyNext: false, changedOpen: false, holdJobs: false, multiple: false};
    globalThis.internetUiEvidence = state;
    const snapshot = () => ({config: {schemaVersion: 1, generation: 'internet-ui', paused: false, mappings: structuredClone(mappings)}, grantedOrigins: [...grants].map(value => value.replace(/\/\*$/, '')), receipts: [], registryConfigured: false, registryRefreshConfigured: false, registry: {}, continuity: {sites: [], edges: []}});
    const result = job => ({schemaVersion: 2, jobId: job.id, sourceOrigin: job.sourceOrigin, status: job.cancelled ? 'cancelled' : state.holdJobs ? 'running' : 'completed', outcome: 'candidates', completeness: 'partial', reasonCodes: ['ARCHIVE_PROVIDER_PARTIAL'], createdAt: job.createdAt, expiresAt: job.createdAt + 3600000,
      candidates: [{id: 'candidate-one', origin: candidate, title: '<img id="injected-internet" src=x onerror=alert(1)>', identityClass: 'unverified_candidate', navigation: 'confirm_only', availability: {state: 'not_checked'}, reasonCodes: ['IDENTITY_UNESTABLISHED'], evidence: [{kind: 'archive_metadata', sourceUrl: 'https://web.archive.org/web/20260101000000id_/https://old.example.org/', capturedAt: Date.parse('2026-01-01T00:00:00Z'), observedAt: job.createdAt, summary: 'An archived move claim <script id="injected-script">alert(1)</script>', provenanceGroup: 'archive:old.example.org'}]}, ...(state.multiple ? [{id: 'candidate-two', origin: 'https://other.example.net', title: 'Another public claim', identityClass: 'unverified_candidate', navigation: 'confirm_only', availability: {state: 'not_checked'}, reasonCodes: [], evidence: [{kind: 'search_result', sourceUrl: 'javascript:alert(1)', observedAt: job.createdAt, summary: 'Potential alternative', provenanceGroup: 'public'}]}] : [])]});
    globalThis.chrome = {
      runtime: {id: 'internet-ui-fixture', getURL: value => 'chrome-extension://internet-ui-fixture/' + value,
        sendMessage: async message => {
          state.messages.push(structuredClone(message));
          if (message.type === 'read') return {ok: true, data: snapshot()};
          if (message.type === 'INTERNET_CONFIG_GET') return {ok: true, data: {serviceOrigin, hasAccessToken}};
          if (message.type === 'INTERNET_CONFIG_SET') {serviceOrigin = message.serviceOrigin; hasAccessToken = Boolean(serviceOrigin && (message.accessToken || hasAccessToken)); return {ok: true, data: {}};}
          if (message.type === 'INTERNET_START') {const id = 'ui-job-' + ++sequence; jobs.set(id, {id, sourceOrigin: message.sourceOrigin, createdAt: Date.now()}); return {ok: true, data: {jobId: id}};}
          if (message.type === 'INTERNET_STATUS') {const job = jobs.get(message.jobId); return job ? {ok: true, data: result(job)} : {ok: false, error: 'Unknown investigation'};}
          if (message.type === 'INTERNET_CANCEL') {const job = jobs.get(message.jobId); if (job) job.cancelled = true; return {ok: true, data: {}};}
          if (message.type === 'INTERNET_CHECK') return {ok: true, data: grants.has(current + '/*') ? {status: 'ready', sourceOrigin: source, candidateOrigin: candidate, terminalOrigin: current} : {status: 'permission_required', sourceOrigin: source, candidateOrigin: candidate, requiredOrigins: [current]}};
          if (message.type === 'INTERNET_OPEN') {if (state.changedOpen) return {ok: false, error: 'The checked endpoint changed.'}; state.opened.push(message.expectedOrigin + '/'); return {ok: true, data: {}};}
          if (message.type === 'INTERNET_SAVE') {state.saved.push(structuredClone(message)); mappings.push({id: 'chosen-result', sourceOrigin: source, destinationOrigin: message.expectedOrigin, enabled: true, pathPolicy: 'homepage', createdAt: Date.now(), expiresAt: Date.now() + 86400000}); return {ok: true, data: {}};}
          if (message.type === 'CLEAR_LOCAL_DATA') {jobs.clear(); mappings.length = 0; serviceOrigin = ''; hasAccessToken = false; return {ok: true, data: {}};}
          return {ok: true, data: {}};
        }},
      permissions: {contains: async ({origins}) => origins.every(origin => grants.has(origin)), request: async ({origins}) => {state.permissions.push([...origins]); if (state.denyNext) {state.denyNext = false; return false;} for (const origin of origins) grants.add(origin); return true;}},
      storage: {local: {get: async () => ({}), set: async () => {}}},
      tabs: {query: async () => [{id: 7, url: source + '/account?token=private'}], create: async ({url}) => state.opened.push(url)}
    };
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.goto(base + '/options.html'); await page.locator('#global-status').filter({hasText: 'enabled'}).waitFor();
  const card = () => page.locator('#internet-results article[data-candidate-id="candidate-one"]');
  const startSearch = async source => {
    await page.locator('#continuity-source').fill(source);
    await page.locator('#internet-consent').check(); await page.locator('#internet-start').click();
    await card().waitFor();
  };
  await check('IU01_old_address_only_explicit_archive_consent', async () => {
    assert.equal(await page.locator('#internet-consent').isChecked(), false);
    assert.equal(await page.locator('#internet-start').isDisabled(), true);
    await startSearch('old.example.org/account?token=private-input#fragment');
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.messages.find(message => message.type === 'INTERNET_START')), {type: 'INTERNET_START', sourceOrigin: 'https://old.example.org', mode: 'archives'});
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.permissions[0]), ['https://archive.org/*', 'https://web.archive.org/*']);
    assert.equal(await page.locator('#destination').inputValue(), '');
    assert.equal(await page.locator('#internet-results').getAttribute('data-job-id'), 'ui-job-1');
    assert.match(await card().textContent(), /Unverified suggestion/);
    assert.match(await card().textContent(), /Historical capture/);
    assert.equal(await card().locator('[data-action="open"]').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.opened), []);
    assert.equal(await page.evaluate(() => JSON.stringify(internetUiEvidence.messages).includes('private-input')), false);
  });
  await check('IU02_provider_evidence_is_inert_and_multiple_results_do_not_auto_open', async () => {
    assert.equal(await page.locator('#injected-internet').count(), 0);
    assert.equal(await page.locator('#injected-script').count(), 0);
    assert.match(await card().textContent(), /<img id="injected-internet"/);
    await page.evaluate(() => {internetUiEvidence.multiple = true;});
    await startSearch('https://old.example.org');
    assert.equal(await page.locator('#internet-results article').count(), 2);
    assert.ok(await page.evaluate(() => internetUiEvidence.messages.some(message => message.type === 'INTERNET_CANCEL' && message.jobId === 'ui-job-1')), 'Changing the source must invalidate even a completed suggestion reference.');
    assert.equal(await page.locator('#internet-results a[href^="javascript:"]').count(), 0);
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.opened), []);
  });
  await check('IU03_candidate_and_next_origin_permissions_precede_check', async () => {
    await card().locator('[data-action="check"]').click();
    await card().locator('[data-action="continue"]').waitFor();
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.permissions.at(-1)), ['https://old.example.org/*', 'https://candidate.example.net/*']);
    await card().locator('[data-action="continue"]').click();
    await card().locator('[data-action="open"]').waitFor();
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.permissions.at(-1)), ['https://current.example.com/*']);
    assert.match(await card().textContent(), /Checked endpoint: https:\/\/current.example.com/);
    assert.equal(await card().locator('[data-action="save"]').isDisabled(), true);
  });
  await check('IU04_open_rechecks_and_changed_destination_requires_new_check', async () => {
    await page.evaluate(() => {internetUiEvidence.changedOpen = true;});
    await card().locator('[data-action="open"]').click();
    await card().locator('.internet-candidate-status').filter({hasText: 'changed'}).waitFor();
    assert.equal(await card().locator('[data-action="open"]').isVisible(), false);
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.opened), []);
    await page.evaluate(() => {internetUiEvidence.changedOpen = false;});
    await card().locator('[data-action="check"]').click(); await card().locator('[data-action="open"]').waitFor();
    await card().locator('[data-action="open"]').click();
    await card().locator('.internet-candidate-status').filter({hasText: 'checked again'}).waitFor();
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.opened), ['https://current.example.com/']);
    const message = await page.evaluate(() => internetUiEvidence.messages.filter(value => value.type === 'INTERNET_OPEN').at(-1));
    assert.equal(message.expectedOrigin, 'https://current.example.com'); assert.equal('sourceUrl' in message, false);
  });
  await check('IU05_remember_requires_explicit_unverified_choice', async () => {
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.saved), []);
    await card().locator('[data-action="remember"]').check();
    await card().locator('[data-action="save"]').click();
    await card().locator('.internet-candidate-status').filter({hasText: 'Choice remembered'}).waitFor();
    const saved = await page.evaluate(() => internetUiEvidence.saved.at(-1));
    assert.equal(saved.confirmed, true); assert.equal(saved.durationHours, 24); assert.equal(saved.expectedOrigin, 'https://current.example.com');
    await page.locator('#mapping-list article').filter({hasText: 'User configured'}).waitFor();
    assert.equal(await card().locator('[data-action="remember"]').isChecked(), false);
  });
  await check('IU06_permission_denial_cancel_and_source_changes_stop_results', async () => {
    const before = await page.evaluate(() => internetUiEvidence.messages.filter(message => message.type === 'INTERNET_START').length);
    await page.locator('#continuity-source').fill('https://denied.example.org');
    await page.locator('#internet-consent').check();
    await page.evaluate(() => {internetUiEvidence.denyNext = true;});
    await page.locator('#internet-start').click();
    await page.locator('#internet-status').filter({hasText: 'not granted'}).waitFor();
    assert.equal(await page.evaluate(() => internetUiEvidence.messages.filter(message => message.type === 'INTERNET_START').length), before);
    await page.evaluate(() => {internetUiEvidence.holdJobs = true;});
    await page.locator('#continuity-source').fill('https://old.example.org');
    await page.locator('#internet-consent').check(); await page.locator('#internet-start').click();
    await page.locator('#internet-status[data-status="running"]').waitFor();
    await page.locator('#internet-cancel').click();
    await page.locator('#internet-status').filter({hasText: 'cancelled'}).waitFor();
    assert.equal(await page.locator('#internet-results article').count(), 0);
    assert.equal(await page.locator('#internet-results').getAttribute('data-job-id'), null);
    assert.ok(await page.evaluate(() => internetUiEvidence.messages.some(message => message.type === 'INTERNET_CANCEL')));
    await page.locator('#internet-consent').check(); await page.locator('#internet-start').click();
    await page.locator('#internet-status[data-status="running"]').waitFor();
    await page.locator('#continuity-source').fill('https://different.example.org');
    assert.equal(await page.locator('#internet-consent').isChecked(), false);
    assert.equal(await page.locator('#internet-results article').count(), 0);
    await page.evaluate(() => {internetUiEvidence.holdJobs = false;});
    await startSearch('https://old.example.org');
    const completedJob = await page.locator('#internet-results').getAttribute('data-job-id');
    await page.locator('#internet-consent').uncheck();
    assert.equal(await page.locator('#internet-results article').count(), 0);
    assert.ok(await page.evaluate(id => internetUiEvidence.messages.some(message => message.type === 'INTERNET_CANCEL' && message.jobId === id), completedJob));
  });
  await check('IU07_service_configuration_is_explicit_and_token_is_not_read_back', async () => {
    await page.locator('.internet-service-settings summary').click();
    await page.locator('#internet-service-origin').fill('https://discovery.example.org');
    await page.locator('#internet-service-token').fill('synthetic-per-user-invite-000000');
    await page.locator('#internet-config-save').click();
    await page.locator('#internet-service-state').filter({hasText: 'saved for this browser session'}).waitFor();
    assert.equal(await page.locator('#internet-service-token').inputValue(), '');
    assert.deepEqual(await page.evaluate(() => internetUiEvidence.permissions.at(-1)), ['https://discovery.example.org/*']);
    await page.locator('#internet-mode').selectOption('service');
    assert.match(await page.locator('#internet-disclosure').textContent(), /https:\/\/discovery.example.org/);
    await startSearch('https://old.example.org');
    const message = await page.evaluate(() => internetUiEvidence.messages.filter(value => value.type === 'INTERNET_START').at(-1));
    assert.deepEqual(message, {type: 'INTERNET_START', sourceOrigin: 'https://old.example.org', mode: 'service'});
    assert.equal('accessToken' in message, false);
    await page.reload(); await page.locator('#global-status').filter({hasText: 'enabled'}).waitFor();
    assert.match(await page.locator('#internet-service-state').textContent(), /No service configured/);
    assert.equal(await page.locator('#internet-service-token').inputValue(), '');
  });
  await check('IU08_mobile_layout_and_clear_data_reset_online_ui', async () => {
    await startSearch('https://old.example.org');
    await page.screenshot({path: 'test-results/internet-ui-desktop.png', fullPage: true});
    await page.setViewportSize({width: 375, height: 812});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clear-local').click();
    await page.locator('#notice').filter({hasText: 'deleted'}).waitFor();
    assert.equal(await page.locator('#internet-results article').count(), 0);
    assert.equal(await page.locator('#internet-consent').isChecked(), false);
    assert.equal(await page.locator('#internet-mode').inputValue(), 'archives');
    assert.equal(await page.locator('#internet-service-token').inputValue(), '');
  });
  assert.equal(checks.length, 8);
  await writeFile(report, JSON.stringify({executedAt: new Date().toISOString(), passedChecks: checks.length, checks, scope: 'Actual packaged options UI in Chromium with mocked worker and permission replies; not native MV3 networking or provider availability.'}, null, 2) + '\n');
} catch (error) {
  const detail = active + ': ' + error.message;
  if (process.env.GITHUB_ACTIONS === 'true') console.error('::error title=Internet discovery UI::' + detail.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  await writeFile(report, JSON.stringify({executedAt: new Date().toISOString(), passedChecks: checks.length, checks, error: detail}, null, 2) + '\n');
  throw error;
} finally {
  if (browser) await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
