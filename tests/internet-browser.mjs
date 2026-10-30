// Native MV3 first-use Internet discovery. All remote-looking hosts are owned
// loopback fixtures; only the disposable copy receives fixture/provider grants.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {buildInternetResult} from '../extension/internet-contract.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'web-switcher-internet-'));
const extension = path.join(directory, 'extension'), profile = path.join(directory, 'profile');
const reportPath = 'test-results/internet-browser.json';
await mkdir('test-results', {recursive: true});
await rm(reportPath, {force: true});
const hits = [], checks = [], pendingResponses = new Set();
const serviceRequests = [], serviceJobs = new Map();
const serviceInvite = 'native_fixture_invite_token_0123456789ABCDEF';
const captureTimestamp = '20260101000000', secondTimestamp = '20260102000000';
const modes = new Map([['candidate.test', 'redirect'], ['mutable.test', 'page']]);
let context, worker, settings, extensionId, browserVersion, latestJob, mainJob, mainCandidate;
let activeCheck = 'I00_launch';
const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, 'http://' + req.headers.host), hostname = requestUrl.hostname;
  const destination = req.headers['sec-fetch-dest'] || '', accept = req.headers.accept || '';
  const requestKind = destination
    ? destination === 'empty' ? 'probe' : destination === 'document' ? 'document' : 'subresource'
    : accept === '*/*' ? 'probe' : accept.startsWith('text/html') ? 'document' : 'subresource';
  const hit = {hostname, method: req.method, path: req.url, accept, destination, requestKind,
    cookie: req.headers.cookie || null, referrer: req.headers.referer || null,
    authorizationPresent: Boolean(req.headers.authorization)};
  hits.push(hit);
  res.setHeader('Cache-Control', 'no-store');
  const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
  // This fixture tests the real extension service wire. Actual SQLite service
  // behavior has separate HTTP acceptance rather than being simulated here.
  if (hostname === 'service.test') {
    if (req.headers.authorization !== 'Bearer ' + serviceInvite) { res.statusCode = 401; return json({error: 'fixture-access-denied'}); }
    if (requestUrl.pathname === '/v2/discoveries' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => {body += chunk; if (body.length > 4096) req.destroy();});
      req.on('end', () => {
        let input;
        try {input = JSON.parse(body);} catch {res.statusCode = 400; return json({error: 'fixture-invalid-json'});}
        serviceRequests.push({method: req.method, input, cookie: req.headers.cookie || null, referrer: req.headers.referer || null});
        if (Object.keys(input).some(key => !['hostname', 'clientVersion'].includes(key)) || input.hostname !== 'service-old.test') {
          res.statusCode = 400; return json({error: 'fixture-expected-hostname-only'});
        }
        const source = 'https://' + input.hostname, createdAt = Date.now(), expiresAt = createdAt + 3600000, jobId = 'native-service-job';
        serviceJobs.set(jobId, buildInternetResult(source, [{origin: origin('candidate.test'), kind: 'search_result', sourceUrl: 'https://reference.test/domain-move', title: 'A public search lead', summary: 'A controlled public search provider suggested this domain; identity remains unverified.'}], {allowTestOrigins: true, jobId, createdAt, expiresAt}));
        res.statusCode = 202;
        return json(buildInternetResult(source, [], {allowTestOrigins: true, jobId, createdAt, expiresAt, status: 'queued', phase: 'Queued search fixture'}));
      });
      return;
    }
    const job = serviceJobs.get(requestUrl.pathname.split('/').at(-1));
    if (requestUrl.pathname.startsWith('/v2/discoveries/') && req.method === 'GET' && job) {
      serviceRequests.push({method: req.method, cookie: req.headers.cookie || null, referrer: req.headers.referer || null}); return json(job);
    }
    res.statusCode = 404; return json({error: 'fixture-not-found'});
  }
  if (hostname === 'archive.test' && requestUrl.pathname === '/wayback/available') {
    const source = new URL(requestUrl.searchParams.get('url'));
    const capturedSource = source.hostname === 'forged-old.test' ? origin('different-old.test') : source.origin;
    return json({archived_snapshots: {closest: {available: true, status: '200', timestamp: captureTimestamp,
      url: origin('replay.test') + '/web/' + captureTimestamp + 'id_/' + capturedSource + '/'}}});
  }
  if (hostname === 'replay.test' && requestUrl.pathname === '/cdx/search/cdx') {
    const source = requestUrl.searchParams.get('url') || '';
    return json([['timestamp', 'original', 'statuscode'],
      ...(source.includes('multi-old.test') ? [[secondTimestamp, origin('multi-old.test') + '/', '301']] : [])]);
  }
  if (hostname === 'replay.test' && requestUrl.pathname.startsWith('/web/')) {
    const capture = /^\/web\/(\d{14})(?:id_)?\/(https?:\/\/.*)$/.exec(requestUrl.pathname);
    if (!capture) { res.statusCode = 400; return res.end('Invalid fixture capture'); }
    const capturedSource = new URL(capture[2]);
    const finish = () => {
      if (res.destroyed) return;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      let target = origin('candidate.test');
      if (capturedSource.hostname === 'mutable-old.test') target = origin('mutable.test');
      if (capturedSource.hostname === 'ungranted-old.test') target = 'https://ungranted.test';
      if (capturedSource.hostname === 'private-old.test') target = 'https://127.0.0.1';
      if (capturedSource.hostname === 'multi-old.test' && capture[1] === secondTimestamp) {
        res.statusCode = 302;
        res.setHeader('x-archive-orig-location', origin('alternate.test') + '/');
        res.setHeader('Location', origin('replay.test') + '/web/' + secondTimestamp + 'id_/' + origin('alternate.test') + '/');
        return res.end();
      }
      if (capturedSource.hostname === 'canonical-old.test') {
        return res.end(`<title>Ordinary archived page</title><link rel="canonical" href="${origin('alternate.test')}/"><a href="${origin('alternate.test')}/">Other page</a>`);
      }
      res.end(`<title>Dated source fixture</title><script>fetch('/script-executed')</script><meta http-equiv="refresh" content="0;url=${target}/">`);
    };
    if (['slow-old.test', 'restart-old.test'].includes(capturedSource.hostname)) {
      const timer = setTimeout(() => { pendingResponses.delete(timer); finish(); }, 2000);
      pendingResponses.add(timer); res.on('close', () => { clearTimeout(timer); pendingResponses.delete(timer); });
    } else finish();
    return;
  }
  if (hostname.endsWith('-old.test') || hostname === 'old.test') { req.socket.destroy(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (modes.get(hostname) === 'redirect') {
    res.statusCode = 302; res.setHeader('Location', origin('current.test') + '/'); return res.end();
  }
  res.end(`<!doctype html><title>${hostname}</title><h1>Live Internet fixture: ${hostname}</h1>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = hostname => `http://${hostname}:${port}`;
const sourceOrigin = origin('old.test'), candidateOrigin = origin('candidate.test'), currentOrigin = origin('current.test');
const providerUrls = {availability: origin('archive.test') + '/wayback/available', cdx: origin('replay.test') + '/cdx/search/cdx', replay: origin('replay.test')};

async function launch(profileDirectory = profile) {
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'chromium', headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    viewport: {width: 1280, height: 1000},
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1']
  });
  context.setDefaultTimeout(15000);
  [worker] = context.serviceWorkers(); if (!worker) worker = await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2];
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  settings = await context.newPage(); await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByText('Local switching enabled', {exact: true}).waitFor();
}
async function raw(type, extra = {}) { return settings.evaluate(data => chrome.runtime.sendMessage(data), {type, ...extra}); }
async function message(type, extra = {}) {
  const reply = await raw(type, extra); assert.equal(reply?.ok, true, reply?.error || `${type} failed`); return reply.data;
}
async function storage(key) { return worker.evaluate(async key => (await chrome.storage.local.get(key))[key], key); }
async function terminal(jobId, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await message('INTERNET_STATUS', {jobId}); latestJob = result;
    if (!['queued', 'running'].includes(result.status)) return result;
    await delay(100);
  }
  throw new Error('Internet discovery job did not finish within fixture deadline: ' + JSON.stringify(latestJob));
}
async function discover(source = sourceOrigin) {
  const {jobId} = await message('INTERNET_START', {sourceOrigin: source, mode: 'archives'});
  assert.equal(typeof jobId, 'string'); return terminal(jobId);
}
async function check(id, run) { activeCheck = id; await run(); checks.push({id, passed: true}); console.log(`PASS ${id}`); }
function count(hostname, requestKind) { return hits.filter(hit => hit.hostname === hostname && (!requestKind || hit.requestKind === requestKind)).length; }
function assertUnverified(candidate) {
  assert.equal(candidate.identityClass, 'unverified_candidate'); assert.equal(candidate.navigation, 'confirm_only');
  assert.ok(candidate.evidence.length > 0);
}
async function navigate(page, url) {
  try { await page.goto(url, {waitUntil: 'domcontentloaded'}); }
  catch (error) { if (!error.message.includes('ERR_ABORTED')) throw error; }
}
async function waitForSnapshot(hostname, after = 0) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (hits.slice(after).some(hit => hit.hostname === 'replay.test' && hit.path.startsWith('/web/') && hit.path.includes(hostname))) return;
    await delay(25);
  }
  throw new Error('Expected slow fixture snapshot request was not observed');
}

try {
  await cp('extension', extension, {recursive: true});
  const buildPath = path.join(extension, 'build-config.js'), build = await readFile(buildPath, 'utf8');
  assert.match(build, /export const ALLOW_TEST_ORIGINS = false;/);
  assert.match(build, /export const INTERNET_PROVIDER_FIXTURES = null;/);
  await writeFile(buildPath, build.replace('export const ALLOW_TEST_ORIGINS = false;', 'export const ALLOW_TEST_ORIGINS = true;')
    .replace('export const INTERNET_PROVIDER_FIXTURES = null;', `export const INTERNET_PROVIDER_FIXTURES = ${JSON.stringify(providerUrls)};`));
  const manifestPath = path.join(extension, 'manifest.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Fixed production archive grants avoid optional-dialog automation. Networking
  // still uses only the configured HTTP fixture providers in this test copy.
  manifest.host_permissions = ['http://*.test/*', 'https://archive.org/*', 'https://web.archive.org/*'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await launch();
  await context.addCookies(['archive.test', 'replay.test', 'candidate.test', 'current.test'].map(hostname => ({url: origin(hostname), name: 'private_fixture_session', value: 'never-send-in-a-probe'})));

  await check('I01_fresh_install_needs_no_history_or_configured_service', async () => {
    const state = await message('read');
    assert.equal(state.config.mappings.length, 0); assert.equal(state.continuity?.edges.length || 0, 0);
    const config = await message('INTERNET_CONFIG_GET'); assert.equal(config.serviceOrigin, ''); assert.equal(config.hasAccessToken, false);
    assert.equal(await settings.locator('#internet-consent').isChecked(), false);
    assert.equal(await settings.locator('#destination').inputValue(), '');
  });
  await check('I02_old_address_only_UI_finds_public_archive_candidate', async () => {
    await settings.getByLabel('Old website address', {exact: true}).fill(sourceOrigin + '/account?token=private-internet-input#fragment');
    await settings.locator('#internet-consent').check();
    await settings.locator('#internet-start').click();
    const card = settings.locator('#internet-results article[data-candidate-id]').filter({hasText: candidateOrigin});
    await card.waitFor(); mainCandidate = await card.getAttribute('data-candidate-id');
    // The native journey must create a real job, not inject UI replies.
    const jobs = await settings.evaluate(() => document.querySelector('#internet-results')?.dataset.jobId || null);
    if (jobs) mainJob = await message('INTERNET_STATUS', {jobId: jobs});
    else {
      // Querying again still uses the empty local graph and real public-source
      // transport; the UI card above proves the initial user-facing journey.
      mainJob = await discover(sourceOrigin);
      mainCandidate = mainJob.candidates.find(candidate => candidate.origin === candidateOrigin)?.id;
    }
    assert.equal(mainJob.status, 'completed'); assert.equal(mainJob.outcome, 'candidates');
    assertUnverified(mainJob.candidates.find(candidate => candidate.id === mainCandidate));
    assert.equal((await storage('config')).mappings.length, 0);
    assert.equal((await storage('continuityState'))?.edges.length || 0, 0, 'Public archive evidence must not forge locally observed successor history.');
    assert.equal(count('old.test'), 0, 'Archive investigation must work without contacting the dead source.');
    assert.equal(count('candidate.test'), 0); assert.equal(count('current.test'), 0);
    await settings.screenshot({path: 'test-results/internet-source-only.png', fullPage: true});
  });
  await check('I03_archive_requests_omit_private_URL_parts_credentials_and_scripts', async () => {
    const providerRequests = hits.filter(hit => ['archive.test', 'replay.test'].includes(hit.hostname));
    assert.ok(providerRequests.length >= 3);
    for (const hit of providerRequests) { assert.equal(hit.cookie, null); assert.equal(hit.referrer, null); assert.equal(hit.authorizationPresent, false); }
    assert.ok(!JSON.stringify(hits).includes('private-internet-input'));
    assert.ok(!JSON.stringify(await storage('internetJobs')).includes('private-internet-input'));
    assert.equal(hits.filter(hit => hit.path.includes('/script-executed')).length, 0);
  });
  await check('I04_explicit_check_follows_live_candidate_chain_without_identity_upgrade', async () => {
    const result = await message('INTERNET_CHECK', {jobId: mainJob.jobId, candidateId: mainCandidate});
    assert.equal(result.status, 'ready'); assert.equal(result.terminalOrigin, currentOrigin);
    assert.equal(count('candidate.test', 'document'), 0); assert.equal(count('current.test', 'document'), 0);
    assertUnverified((await message('INTERNET_STATUS', {jobId: mainJob.jobId})).candidates.find(candidate => candidate.id === mainCandidate));
    for (const hit of hits.filter(hit => ['candidate.test', 'current.test'].includes(hit.hostname) && hit.requestKind === 'probe')) {
      assert.equal(hit.cookie, null); assert.equal(hit.referrer, null); assert.equal(hit.path, '/');
    }
  });
  await check('I05_open_is_an_explicit_revalidated_homepage_choice', async () => {
    const opening = context.waitForEvent('page');
    await message('INTERNET_OPEN', {jobId: mainJob.jobId, candidateId: mainCandidate, expectedOrigin: currentOrigin});
    const page = await opening; await page.waitForURL(currentOrigin + '/');
    assert.equal(new URL(page.url()).search, ''); assert.equal(new URL(page.url()).hash, '');
    assert.equal((await storage('config')).mappings.length, 0, 'Opening does not silently enable following.'); await page.close();
  });
  await check('I06_changed_checked_destination_cannot_open_a_stale_choice', async () => {
    const job = await discover(origin('mutable-old.test')), candidate = job.candidates.find(candidate => candidate.origin === origin('mutable.test'));
    assert.ok(candidate);
    const beforeForged = hits.length;
    const forged = await raw('INTERNET_CHECK', {jobId: mainJob.jobId, candidateId: candidate.id});
    assert.ok(forged.ok === false || forged.data?.status !== 'ready', 'A candidate identifier from a different job cannot authorize a check.');
    assert.equal(hits.length, beforeForged, 'An invalid job/candidate binding must fail before network use.');
    assert.equal((await message('INTERNET_CHECK', {jobId: job.jobId, candidateId: candidate.id})).terminalOrigin, origin('mutable.test'));
    modes.set('mutable.test', 'redirect'); const before = count('current.test', 'document');
    const result = await raw('INTERNET_OPEN', {jobId: job.jobId, candidateId: candidate.id, expectedOrigin: origin('mutable.test')});
    assert.ok(result.ok === false || result.data?.status !== 'ready'); assert.equal(count('current.test', 'document'), before);
    modes.set('mutable.test', 'page');
  });
  await check('I07_multiple_historical_candidates_do_not_auto_open_a_winner', async () => {
    const before = context.pages().length, job = await discover(origin('multi-old.test'));
    assert.ok(job.candidates.length >= 2, JSON.stringify(job)); for (const candidate of job.candidates) assertUnverified(candidate);
    assert.equal(context.pages().length, before); assert.equal(count('alternate.test'), 0);
    assert.equal((await storage('config')).mappings.length, 0);
  });
  await check('I08_private_and_forged_archive_targets_are_rejected_before_contact', async () => {
    const before = hits.length;
    for (const hostname of ['private-old.test', 'forged-old.test']) {
      const job = await discover(origin(hostname)); assert.equal(job.candidates.length, 0, JSON.stringify(job));
    }
    assert.ok(!hits.slice(before).some(hit => hit.hostname === '127.0.0.1' || hit.hostname === 'different-old.test'));
  });
  await check('I09_generic_canonical_content_cannot_supply_identity_or_a_rule', async () => {
    const before = context.pages().length, job = await discover(origin('canonical-old.test'));
    assert.equal(job.candidates.length, 0, 'Generic canonical and ordinary links are not archived move declarations.');
    assert.equal(context.pages().length, before); assert.equal(count('alternate.test'), 0);
    assert.equal((await storage('config')).mappings.length, 0);
  });
  await check('I10_ungranted_candidate_requires_access_before_its_network_request', async () => {
    const job = await discover(origin('ungranted-old.test')), candidate = job.candidates.find(candidate => candidate.origin === 'https://ungranted.test');
    assert.ok(candidate, JSON.stringify(job));
    await worker.evaluate(() => {
      globalThis.internetNativeRequests = [];
      chrome.webRequest.onBeforeRequest.addListener(details => globalThis.internetNativeRequests.push({url: details.url, type: details.type}), {urls: ['https://*.test/*']});
    });
    const result = await message('INTERNET_CHECK', {jobId: job.jobId, candidateId: candidate.id});
    assert.equal(result.status, 'permission_required'); assert.ok(result.requiredOrigins.includes('https://ungranted.test'));
    assert.equal((await worker.evaluate(() => globalThis.internetNativeRequests)).length, 0);
  });
  await check('I11_signed_candidate_and_terminal_reservations_block_weaker_choices', async () => {
    const beforeCandidate = count('candidate.test'), beforeCurrent = count('current.test', 'document');
    await worker.evaluate(origin => chrome.storage.local.set({catalogContinuityOrigins: [origin], catalogContinuityBlocked: false}), candidateOrigin);
    const reservedCandidate = await raw('INTERNET_CHECK', {jobId: mainJob.jobId, candidateId: mainCandidate});
    assert.ok(reservedCandidate.ok === false || reservedCandidate.data?.status !== 'ready'); assert.equal(count('candidate.test'), beforeCandidate);
    await worker.evaluate(origin => chrome.storage.local.set({catalogContinuityOrigins: [origin], catalogContinuityBlocked: false}), currentOrigin);
    const reservedTerminal = await raw('INTERNET_OPEN', {jobId: mainJob.jobId, candidateId: mainCandidate, expectedOrigin: currentOrigin});
    assert.ok(reservedTerminal.ok === false || reservedTerminal.data?.status !== 'ready'); assert.equal(count('current.test', 'document'), beforeCurrent);
    await worker.evaluate(() => chrome.storage.local.set({catalogContinuityOrigins: [], catalogContinuityBlocked: false}));
  });
  await check('I12_remembering_choice_is_explicit_user_configuration_with_real_DNR', async () => {
    const noConsent = await raw('INTERNET_SAVE', {jobId: mainJob.jobId, candidateId: mainCandidate, expectedOrigin: currentOrigin, durationHours: 24, confirmed: false});
    assert.equal(noConsent.ok, false); assert.equal((await storage('config')).mappings.length, 0);
    await message('INTERNET_SAVE', {jobId: mainJob.jobId, candidateId: mainCandidate, expectedOrigin: currentOrigin, durationHours: 24, confirmed: true});
    const mapping = (await storage('config')).mappings.find(mapping => mapping.sourceOrigin === sourceOrigin);
    assert.equal(mapping.destinationOrigin, currentOrigin); assert.equal(mapping.pathPolicy, 'homepage'); assert.equal(mapping.expiresAt - mapping.createdAt, 24 * 3600000);
    assert.ok(!['owner_verified', 'registry_reviewed'].includes(mapping.trustClass));
    const before = count('old.test', 'document'), page = await context.newPage();
    await navigate(page, sourceOrigin + '/public-page?demo=1#local'); await page.waitForURL(currentOrigin + '/');
    assert.equal(count('old.test', 'document'), before); await page.close();
    assert.equal((await storage('continuityState'))?.sites.length || 0, 0, 'Remembering a user choice must not masquerade as observed source-only following.');
  });
  await check('I13_native_service_connector_uses_hostname_only_and_session_credentials', async () => {
    await context.addCookies([{url: origin('service.test'), name: 'private_fixture_service', value: 'never-send-to-service'}]);
    await message('INTERNET_CONFIG_SET', {serviceOrigin: origin('service.test'), accessToken: serviceInvite});
    const config = await message('INTERNET_CONFIG_GET');
    assert.equal(config.serviceOrigin, origin('service.test')); assert.equal(config.hasAccessToken, true);
    assert.ok(!JSON.stringify(config).includes(serviceInvite));
    assert.ok(!JSON.stringify(await worker.evaluate(() => chrome.storage.local.get(null))).includes(serviceInvite), 'Service invite must not enter persistent local storage.');
    const before = context.pages().length;
    const started = await message('INTERNET_START', {sourceOrigin: 'https://service-old.test/account?token=private-service-input#fragment', mode: 'service'});
    const job = await terminal(started.jobId);
    assert.equal(job.sourceOrigin, 'https://service-old.test'); assert.equal(job.status, 'completed'); assert.equal(job.outcome, 'candidates');
    const candidate = job.candidates.find(item => item.origin === candidateOrigin); assert.ok(candidate); assertUnverified(candidate);
    assert.equal(candidate.evidence[0].kind, 'search_result'); assert.equal(context.pages().length, before, 'Service suggestions must not open themselves.');
    assert.ok(serviceRequests.some(item => item.method === 'POST')); assert.ok(serviceRequests.some(item => item.method === 'GET'));
    assert.deepEqual(serviceRequests.find(item => item.method === 'POST').input, {hostname: 'service-old.test', clientVersion: '0.2.0'});
    for (const request of serviceRequests) {assert.equal(request.cookie, null); assert.equal(request.referrer, null);}
    assert.ok(!JSON.stringify(hits).includes('private-service-input')); assert.equal(count('service-old.test'), 0);
    const checked = await message('INTERNET_CHECK', {jobId: job.jobId, candidateId: candidate.id});
    assert.equal(checked.status, 'ready'); assert.equal(checked.terminalOrigin, currentOrigin);
    assertUnverified((await message('INTERNET_STATUS', {jobId: job.jobId})).candidates.find(item => item.id === candidate.id));
  });
  await check('I14_cancelled_background_lookup_cannot_complete_with_candidates', async () => {
    const before = hits.length;
    const started = await message('INTERNET_START', {sourceOrigin: origin('slow-old.test'), mode: 'archives'});
    await waitForSnapshot('slow-old.test', before); await message('INTERNET_CANCEL', {jobId: started.jobId}); await delay(2200);
    const result = await message('INTERNET_STATUS', {jobId: started.jobId});
    assert.equal(result.status, 'cancelled'); assert.equal(result.candidates.length, 0);
  });
  await check('I15_clear_during_external_work_cannot_restore_local_jobs_or_mappings', async () => {
    const before = hits.length;
    const started = await message('INTERNET_START', {sourceOrigin: origin('slow-old.test'), mode: 'archives'});
    await waitForSnapshot('slow-old.test', before); await message('CLEAR_LOCAL_DATA'); await delay(2200);
    const stale = await raw('INTERNET_STATUS', {jobId: started.jobId});
    assert.ok(stale.ok === false || !stale.data?.candidates?.length);
    assert.equal((await storage('config')).mappings.length, 0);
    assert.ok(!JSON.stringify(await storage('internetJobs') || []).includes('slow-old.test'));
  });
  await check('I16_restart_during_archive_lookup_fails_closed_without_silent_retry', async () => {
    const snapshotBefore = hits.length;
    const started = await message('INTERNET_START', {sourceOrigin: origin('restart-old.test'), mode: 'archives'});
    await waitForSnapshot('restart-old.test', snapshotBefore); await context.close(); context = undefined;
    const before = hits.length; await launch();
    const result = await message('INTERNET_STATUS', {jobId: started.jobId});
    assert.ok(['failed', 'cancelled', 'expired'].includes(result.status), JSON.stringify(result)); assert.equal(result.candidates.length, 0);
    assert.equal(hits.slice(before).filter(hit => ['archive.test', 'replay.test'].includes(hit.hostname)).length, 0);
  });
  await check('I17_missing_provider_permission_stops_before_the_first_request', async () => {
    await context.close(); context = undefined;
    manifest.host_permissions = ['http://old.test/*', 'http://replay.test/*'];
    await writeFile(manifestPath, JSON.stringify(manifest)); await launch(path.join(directory, 'ungranted-profile'));
    const before = count('archive.test');
    const started = await raw('INTERNET_START', {sourceOrigin, mode: 'archives'});
    if (started.ok) {
      const result = await terminal(started.data.jobId);
      assert.notEqual(result.outcome, 'candidates'); assert.equal(result.candidates.length, 0);
    }
    await delay(100); assert.equal(count('archive.test'), before);
  });
  assert.equal(checks.length, 17, 'Every native Internet discovery check must execute.');
} catch (error) {
  const notices = [];
  for (const page of context?.pages() || []) {
    for (const selector of ['#notice', '#internet-status']) {
      try { if (await page.locator(selector).count()) notices.push((await page.locator(selector).textContent({timeout: 1000}))?.slice(0, 600)); } catch { /* Preserve failure. */ }
    }
  }
  error.message += `; latest job: ${JSON.stringify(latestJob)}; fixture hits: ${JSON.stringify(hits.slice(-12))}; notices: ${notices.filter(Boolean).join(' | ')}`;
  const detail = `${activeCheck}: ${error.message}`;
  console.error('FAIL ' + detail);
  if (process.env.GITHUB_ACTIONS === 'true') console.error('::error title=Native Internet discovery::' + detail.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
  checks.push({id: activeCheck, passed: false, error: error.message}); process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify({executedAt: new Date().toISOString(), browserVersion, passedChecks: checks.filter(check => check.passed).length, checks,
    limitations: ['Controlled loopback HTTP archive/candidate/service-wire fixtures, pregranted test origins and fixed provider grants; not live provider coverage or optional-permission dialogs.', 'The service-wire fixture validates extension HTTP/auth/privacy/result handling; actual SQLite queue/provider behavior is verified separately by service tests.', 'No public example ownership, Internet-wide accuracy, TLS/DNS pinning or Store approval claim.', 'Internet candidates remain unverified; explicit retained choice has only user-configured authority.']}, null, 2) + '\n');
  if (context) await context.close();
  for (const timer of pendingResponses) clearTimeout(timer);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(directory, {recursive: true, force: true});
}
