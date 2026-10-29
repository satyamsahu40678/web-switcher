import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {DiscoveryStore} from './store.mjs';
import {createDiscoveryApplication, configFromEnvironment} from './server.mjs';
import {validateInternetResult} from '../extension/internet-contract.js';

const TOKEN = 'test_invitation_owner_one_1234567890', OTHER = 'test_invitation_owner_two_1234567890';
const SOURCE = 'https://retired.journey.org', TARGET = 'https://current.journey.net';
const owner = value => createHash('sha256').update(value).digest('hex');
const response = (url, data, status = 200, headers = {'content-type': 'application/json'}) => ({url, status, headers, body: typeof data === 'string' ? data : JSON.stringify(data)});
const searchPayload = (url = TARGET + '/public?ref=drop#part') => ({type: 'search', web: {results: [{url, title: 'Current public site', description: 'A public result mentioning the retired address.'}]}});

async function fixture(t, {provider, options = {}, storeOptions = {}} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ws-online-http-'));
  const database = join(directory, 'state.sqlite');
  let store = new DiscoveryStore({path: database, ...storeOptions}), app, base;
  const calls = [];
  const request = async (url, config) => {
    calls.push({url, headers: config?.headers, method: config?.method});
    return provider ? provider(url, config) : response(url, searchPayload());
  };
  async function launch() {
    app = createDiscoveryApplication({store, request, tokens: [TOKEN, OTHER], braveKey: 'fixture-provider-key', archiveEnabled: false, runnerOptions: {pollMs: 10}, ...options});
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + app.server.address().port;
  }
  await launch();
  t.after(async () => {try {await app.close();} finally {store.close(); rmSync(directory, {recursive: true, force: true});}});
  const api = async (path, {token = TOKEN, method = 'GET', body, headers = {}} = {}) => {
    const result = await fetch(base + path, {method, headers: {...(token ? {Authorization: 'Bearer ' + token} : {}), ...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers}, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)});
    const text = await result.text(); return {status: result.status, headers: result.headers, data: text ? JSON.parse(text) : undefined};
  };
  const terminal = async id => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const result = await api('/v2/discoveries/' + id);
      assert.equal(result.status, 200);
      if (!['queued', 'running'].includes(result.data.status)) return result.data;
      await delay(10);
    }
    throw new Error('The bounded fixture job did not complete.');
  };
  return {directory, calls, api, terminal, get store() {return store;}, get app() {return app;}, async restart() {await app.close(); store.close(); store = new DiscoveryStore({path: database, ...storeOptions}); await launch();}};
}

test('real HTTP, SQLite and runner find a previously unseen candidate from only an old hostname', async t => {
  const f = await fixture(t);
  const start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org', clientVersion: '0.2.0'}});
  assert.equal(start.status, 202); assert.equal(start.data.sourceOrigin, SOURCE);
  const result = await f.terminal(start.data.jobId); validateInternetResult(result);
  assert.equal(result.status, 'completed'); assert.equal(result.outcome, 'candidates');
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].origin, TARGET);
  assert.equal(result.candidates[0].identityClass, 'unverified_candidate'); assert.equal(result.candidates[0].navigation, 'confirm_only');
  assert.deepEqual(result.candidates[0].availability, {state: 'not_checked'});
  assert.equal(f.calls.length, 1);
  const query = new URL(f.calls[0].url);
  assert.equal(query.origin, 'https://api.search.brave.com'); assert.equal(query.searchParams.get('q'), '"retired.journey.org"');
  assert.equal(JSON.stringify(result).includes('fixture-provider-key'), false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(JSON.stringify(result).includes('?ref='), false);
  assert.equal(f.store.get(owner(TOKEN), result.jobId).searchCalls, 1);
});

test('invitation authentication and owner-scoped references prevent cross-user polling or cancellation', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/v2/discoveries', {method: 'POST', token: null, body: {hostname: 'retired.journey.org'}})).status, 401);
  assert.equal((await f.api('/v2/discoveries', {method: 'POST', token: 'invalid_invitation_token_1234567890', body: {hostname: 'retired.journey.org'}})).status, 401);
  const start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}});
  const path = '/v2/discoveries/' + start.data.jobId;
  assert.equal((await f.api(path, {token: OTHER})).status, 404);
  assert.equal((await f.api(path, {token: OTHER, method: 'DELETE'})).status, 404);
  assert.equal((await f.terminal(start.data.jobId)).outcome, 'candidates');
  const other = await f.api('/v2/discoveries', {method: 'POST', token: OTHER, body: {hostname: 'retired.journey.org'}});
  assert.notEqual(other.data.jobId, start.data.jobId);
});

test('closed hostname-only JSON refuses URL data, duplicate keys, excessive bodies and unknown fields before spending', async t => {
  const f = await fixture(t);
  for (const hostname of ['https://retired.journey.org', 'retired.journey.org/private', 'retired.journey.org?token=private', 'retired.journey.org#fragment', 'user@retired.journey.org', '127.0.0.1', 'router.local', 'retired.journey.org:8443', 'RETIRED.journey.org']) {
    assert.equal((await f.api('/v2/discoveries', {method: 'POST', body: {hostname}})).status, 400, hostname);
  }
  for (const body of ['{"hostname":"retired.journey.org","hostname":"other.journey.org"}', '{"hostname":"retired.journey.org"} trailing', {hostname: 'retired.journey.org', fetchUrl: 'http://127.0.0.1'}, {hostname: 'retired.journey.org', clientVersion: {x: 1}}]) {
    assert.equal((await f.api('/v2/discoveries', {method: 'POST', body})).status, 400);
  }
  assert.equal((await f.api('/v2/discoveries', {method: 'POST', body: 'x'.repeat(4097)})).status, 413);
  assert.equal((await f.api('/v2/discoveries', {method: 'POST', body: '{}', headers: {'Content-Type': 'text/plain'}})).status, 415);
  assert.equal(f.calls.length, 0);
});

test('archive investigation works with no paid search key, no local graph and no live old-source contact', async t => {
  const stamp = '20260101000000';
  const f = await fixture(t, {options: {braveKey: '', archiveEnabled: true}, provider: url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/wayback/available') return response(url, {archived_snapshots: {closest: {available: true, status: '200', timestamp: stamp, url: `https://web.archive.org/web/${stamp}id_/${SOURCE}/`}}});
    if (parsed.pathname === '/cdx/search/cdx') return response(url, [['timestamp', 'original', 'statuscode']]);
    return response(url, '', 302, {'x-archive-orig-location': TARGET + '/'});
  }});
  const start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}}), result = await f.terminal(start.data.jobId);
  assert.equal(result.outcome, 'candidates'); assert.equal(result.candidates[0].origin, TARGET);
  assert.equal(result.candidates[0].evidence[0].kind, 'archive_redirect');
  assert.ok(result.reasonCodes.includes('SEARCH_NOT_CONFIGURED'));
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => ['archive.org', 'web.archive.org'].includes(new URL(call.url).hostname)));
  const job = f.store.get(owner(TOKEN), start.data.jobId); assert.equal(job.searchCalls, 0); assert.equal(job.archiveIndexCalls, 2); assert.equal(job.archiveSnapshotCalls, 1);
});

test('historical pointer candidates are not crowded out by ten search placements', async t => {
  const f = await fixture(t, {options: {archiveEnabled: true, runnerOptions: {pollMs: 10, archiveFactory: () => async () => ({leads: [{origin: TARGET, kind: 'archive_redirect', sourceUrl: 'https://web.archive.org/web/20260101000000id_/' + SOURCE + '/'}], reasonCodes: [], completeness: 'complete'})}}, provider: url => response(url, {type: 'search', web: {results: Array.from({length: 10}, (_, index) => ({url: `https://result-${index}.other.org/`, title: 'A search placement'}))}})});
  const start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}}), result = await f.terminal(start.data.jobId);
  assert.equal(result.candidates.length, 10); assert.equal(result.candidates[0].origin, TARGET);
  assert.ok(result.candidates.every(candidate => candidate.navigation === 'confirm_only'));
});

test('provider refusals yield explicit unavailable results without inventing replacement addresses', async t => {
  for (const [status, expected] of [[401, 'SEARCH_CREDENTIAL_REJECTED'], [429, 'SEARCH_QUOTA_REACHED'], [503, 'SEARCH_UNAVAILABLE']]) {
    const f = await fixture(t, {provider: url => response(url, {}, status)});
    const start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}}), result = await f.terminal(start.data.jobId);
    assert.equal(result.outcome, 'unavailable'); assert.deepEqual(result.candidates, []); assert.ok(result.reasonCodes.includes(expected));
    assert.equal(f.calls.length, 1);
  }
});

test('completed caches and request reservations survive an actual service/database restart', async t => {
  const f = await fixture(t), start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}});
  const first = await f.terminal(start.data.jobId); assert.equal(f.calls.length, 1);
  await f.restart();
  const repeated = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}});
  assert.equal(repeated.status, 200); assert.deepEqual(repeated.data, first); assert.equal(f.calls.length, 1);
  assert.equal(f.store.get(owner(TOKEN), first.jobId).searchCalls, 1);
});

test('cancelled work cannot publish a late provider result, and uncertain paid calls stay charged', async t => {
  let release, entered;
  const pending = new Promise(resolve => {entered = resolve;});
  const f = await fixture(t, {provider: url => {entered(); return new Promise(resolve => {release = () => resolve(response(url, searchPayload()));});}});
  const start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}}); await pending;
  const cancelled = await f.api('/v2/discoveries/' + start.data.jobId, {method: 'DELETE'}); assert.equal(cancelled.data.status, 'cancelled');
  release(); await delay(20);
  const result = await f.api('/v2/discoveries/' + start.data.jobId); assert.equal(result.data.status, 'cancelled'); assert.deepEqual(result.data.candidates, []);
  assert.equal(f.store.get(owner(TOKEN), start.data.jobId).searchCalls, 1);
});

test('an absolute deadline fences a late result rather than extending queued or running work', async t => {
  let current = Date.now(), release, entered;
  const pending = new Promise(resolve => {entered = resolve;});
  const f = await fixture(t, {storeOptions: {now: () => current}, options: {runnerOptions: {now: () => current, pollMs: 10}}, provider: url => {entered(); return new Promise(resolve => {release = () => resolve(response(url, searchPayload()));});}});
  const start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}}); await pending; current += 120001;
  const expired = await f.api('/v2/discoveries/' + start.data.jobId); assert.equal(expired.data.status, 'expired');
  release(); await delay(20);
  assert.deepEqual((await f.api('/v2/discoveries/' + start.data.jobId)).data.candidates, []);
});

test('disabled admission does not run queued work or spend provider calls', async t => {
  const f = await fixture(t, {options: {enabled: false}});
  f.store.enqueue(owner(TOKEN), SOURCE); await delay(30);
  assert.equal(f.calls.length, 0); assert.equal((await f.api('/health/live', {token: null})).status, 200);
  assert.equal((await f.api('/health/ready', {token: null})).status, 503);
  assert.equal((await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}})).status, 503);
});

test('explicit browser origins receive bounded CORS headers; arbitrary web pages are refused', async t => {
  const allowed = 'chrome-extension://' + 'a'.repeat(32);
  const f = await fixture(t, {options: {allowedOrigins: [allowed]}});
  const preflight = await f.api('/v2/discoveries', {method: 'OPTIONS', token: null, headers: {Origin: allowed}});
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), allowed);
  assert.equal((await f.api('/v2/discoveries', {method: 'OPTIONS', token: null, headers: {Origin: 'https://hostile.journey.org'}})).status, 403);
  assert.equal((await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}, headers: {Origin: 'https://hostile.journey.org'}})).status, 403);
});

test('durable poll limits apply to authenticated reads without preventing cancellation', async t => {
  const f = await fixture(t, {storeOptions: {limits: {pollsPerOwnerHour: 1, pollsPerHour: 10}}});
  const start = await f.api('/v2/discoveries', {method: 'POST', body: {hostname: 'retired.journey.org'}}), path = '/v2/discoveries/' + start.data.jobId;
  assert.equal((await f.api(path)).status, 200); assert.equal((await f.api(path)).status, 429);
  assert.equal((await f.api(path, {method: 'DELETE'})).status, 200);
});

test('configuration validates invitation, origin and concurrency boundaries', () => {
  assert.equal(configFromEnvironment({}).enabled, false);
  assert.throws(() => configFromEnvironment({ONLINE_DISCOVERY_ENABLED: 'true'}), /invitation/);
  assert.throws(() => configFromEnvironment({ONLINE_ACCESS_TOKENS: TOKEN + ',' + TOKEN}), /distinct/);
  assert.throws(() => configFromEnvironment({ONLINE_CONCURRENCY: '5'}), /ONLINE_CONCURRENCY/);
  assert.throws(() => configFromEnvironment({ONLINE_ALLOWED_ORIGINS: 'http://untrusted.journey.org'}), /origin/);
  assert.equal(configFromEnvironment({ONLINE_DISCOVERY_ENABLED: 'true', ONLINE_ACCESS_TOKENS: TOKEN, ONLINE_ALLOWED_ORIGINS: 'chrome-extension://' + 'a'.repeat(32)}).tokens.length, 1);
});
