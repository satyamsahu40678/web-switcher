import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createInternetController} from '../extension/internet-worker.js';
import {buildInternetResult} from '../extension/internet-contract.js';

// These tests cover orchestration/storage fencing. Native provider transport and
// permission behavior are checked separately in internet-browser.mjs.
const A = 'https://old.example.com', B = 'https://candidate.example.net', C = 'https://current.example.org';
const SERVICE = 'https://lookup.example.net', SERVICE_TWO = 'https://lookup.example.org';
const TOKEN = 'A_real_user_invite_token_with_32_characters';
const clone = value => structuredClone(value);
function area(initial = {}) {
  return {values: clone(initial), async get(keys) {
    const names = keys == null ? Object.keys(this.values) : typeof keys === 'string' ? [keys] : keys;
    return clone(Object.fromEntries(names.filter(name => Object.hasOwn(this.values, name)).map(name => [name, this.values[name]])));
  }, async set(values) {Object.assign(this.values, clone(values));}, async remove(keys) {for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];}};
}
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
const lead = (origin = B) => ({origin, kind: 'archive_redirect', sourceUrl: 'https://web.archive.org/web/20260101000000id_/https://old.example.com/', capturedAt: '2026-01-01T00:00:00Z'});
const found = (leads = [lead()]) => ({leads, reasonCodes: ['ARCHIVE_CANDIDATES_FOUND'], completeness: 'complete'});

function fixture({archive, request, discover, reserved, sharedChrome} = {}) {
  const grants = new Set([A, B, C, SERVICE, SERVICE_TWO, 'https://archive.org', 'https://web.archive.org']);
  const opened = [], saved = [], archiveInputs = [], checks = [], requests = [], reservedOrigins = new Set();
  const config = {generation: 'generation-one', paused: false, mappings: []};
  const chromeApi = sharedChrome || {storage: {local: area(), session: area()}, permissions: {async contains({origins}) {return origins.every(origin => grants.has(origin.slice(0, -2)));}}, tabs: {async create(value) {opened.push(clone(value));}}};
  const dependencies = {
    chromeApi,
    readConfig: async () => clone(config),
    isReserved: async origin => reserved ? reserved(origin) : reservedOrigins.has(origin),
    saveChoice: async input => {saved.push(clone(input));},
    requestOverride: async (url, options) => {requests.push({url, options}); if (!request) throw new Error('Unexpected provider transport'); return request(url, options);},
    archiveOverride: async (source, options) => {archiveInputs.push(source); return archive ? archive(source, options) : found();},
    continuity: {async discover(origin) {
      checks.push(origin);
      if (!grants.has(origin)) return {status: 'permission_required', sourceOrigin: origin, requiredOrigins: [origin], chain: []};
      return discover ? discover(origin) : {status: 'unknown', sourceOrigin: origin, reason: 'NO_MIGRATION_EVIDENCE', originalReachable: true, chain: []};
    }}
  };
  const controller = createInternetController(dependencies);
  return {controller, dependencies, chromeApi, config, grants, opened, saved, archiveInputs, checks, requests, reservedOrigins};
}
async function terminal(f, jobId) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await f.controller.status({jobId});
    if (!['queued', 'running'].includes(result.status)) return result;
    await delay(1);
  }
  assert.fail('Lookup did not reach a terminal state');
}
async function complete(f, sourceOrigin = A) {
  const {jobId} = await f.controller.start({sourceOrigin, mode: 'archives'});
  const result = await terminal(f, jobId); assert.equal(result.status, 'completed');
  return {jobId, candidateId: result.candidates[0]?.id, result};
}

test('first-use source-only archive investigation has no local history, destination input or candidate request', async () => {
  const f = fixture(), {result} = await complete(f, A + '/account?token=private-input#fragment');
  assert.equal(result.sourceOrigin, A); assert.equal(result.candidates[0].origin, B);
  assert.equal(result.candidates[0].navigation, 'confirm_only'); assert.deepEqual(f.archiveInputs, [A]);
  assert.deepEqual(f.checks, []); assert.deepEqual(f.opened, []); assert.deepEqual(f.saved, []);
  assert.equal(JSON.stringify(f.chromeApi.storage.local.values).includes('private-input'), false);
  assert.equal(f.chromeApi.storage.local.values.continuityState, undefined);
});

test('archive permission and signed-source barriers stop work before provider dispatch', async () => {
  const f = fixture(); f.grants.delete('https://archive.org');
  await assert.rejects(f.controller.start({sourceOrigin: A}), /archive access/); assert.deepEqual(f.archiveInputs, []);
  f.grants.add('https://archive.org'); f.reservedOrigins.add(A);
  await assert.rejects(f.controller.start({sourceOrigin: A}), /signed registry/); assert.deepEqual(f.archiveInputs, []);
});

test('signed candidate reservations are filtered and can never be opened from cached suggestions', async () => {
  const f = fixture(), choice = await complete(f);
  f.reservedOrigins.add(B);
  const result = await f.controller.status(choice);
  assert.equal(result.outcome, 'blocked'); assert.deepEqual(result.candidates, []);
  await assert.rejects(f.controller.open({...choice, expectedOrigin: B}), /signed registry/);
  assert.deepEqual(f.checks, []); assert.deepEqual(f.opened, []);
});

test('candidate identifiers cannot be borrowed from another lookup or forged', async () => {
  const f = fixture(), first = await complete(f), second = await complete(f, 'https://older.example.org');
  await assert.rejects(f.controller.check({jobId: second.jobId, candidateId: first.candidateId}), /Select a current candidate/);
  await assert.rejects(f.controller.check({jobId: '../other', candidateId: first.candidateId}), /Invalid discovery/);
  assert.deepEqual(f.checks, []);
});

test('candidate checks request missing permission without opening or saving', async () => {
  const f = fixture(), choice = await complete(f); f.grants.delete(B);
  const result = await f.controller.check(choice);
  assert.equal(result.status, 'permission_required'); assert.deepEqual(result.requiredOrigins, [B]); assert.equal(result.sourceOrigin, A);
  assert.deepEqual(f.opened, []); assert.deepEqual(f.saved, []);
});

test('Open rechecks current reachability and compares the exact displayed terminal', async () => {
  const f = fixture({discover: async () => ({status: 'found', terminalOrigin: C, chain: [{fromOrigin: B, toOrigin: C}]})}), choice = await complete(f);
  await assert.rejects(f.controller.open({...choice, expectedOrigin: B}), /changed or could not be rechecked/);
  assert.deepEqual(f.opened, []);
  await f.controller.open({...choice, expectedOrigin: C});
  assert.deepEqual(f.opened, [{url: C + '/'}]); assert.deepEqual(f.checks, [B, B]);
  assert.equal(JSON.stringify(f.opened).includes('old.example'), false);
});

test('a terminal permission revoked during the live check cannot be used by Open', async () => {
  let f;
  f = fixture({discover: async () => {
    f.grants.delete(C);
    return {status: 'found', terminalOrigin: C, chain: [{fromOrigin: B, toOrigin: C}]};
  }});
  const choice = await complete(f);
  await assert.rejects(f.controller.open({...choice, expectedOrigin: C}), /Permission|permission/);
  assert.deepEqual(f.opened, []);
});

test('policy changes while a candidate is being checked prevent navigation', async t => {
  for (const mutation of ['generation', 'pause', 'candidate reservation', 'terminal reservation']) await t.test(mutation, async () => {
    let f;
    f = fixture({discover: async () => {
      if (mutation === 'generation') f.config.generation = 'generation-two';
      else if (mutation === 'pause') f.config.paused = true;
      else f.reservedOrigins.add(mutation === 'candidate reservation' ? B : C);
      return {status: 'found', terminalOrigin: C, chain: [{fromOrigin: B, toOrigin: C}]};
    }});
    const choice = await complete(f);
    await assert.rejects(f.controller.open({...choice, expectedOrigin: C}), /changed|paused|signed registry/);
    assert.deepEqual(f.opened, []);
  });
});

test('late archive completion cannot resurrect cancelled or cleared jobs', async t => {
  for (const action of ['cancel', 'clear']) await t.test(action, async () => {
    const started = deferred(), response = deferred();
    const f = fixture({archive: async () => {started.resolve(); return response.promise;}});
    const {jobId} = await f.controller.start({sourceOrigin: A}); await started.promise;
    if (action === 'cancel') await f.controller.cancel({jobId}); else await f.controller.clear();
    response.resolve(found()); await delay(5);
    if (action === 'cancel') {
      const result = await f.controller.status({jobId}); assert.equal(result.status, 'cancelled'); assert.deepEqual(result.candidates, []);
    } else {
      await assert.rejects(f.controller.status({jobId}), /expired or was deleted/);
      assert.equal(f.chromeApi.storage.local.values.internetJobs?.jobs.length || 0, 0);
    }
    assert.deepEqual(f.opened, []);
  });
});

test('cancelling a completed suggestion while its live check runs prevents a stale Open', async () => {
  const started = deferred(), response = deferred();
  const f = fixture({discover: async () => {started.resolve(); return response.promise;}}), choice = await complete(f);
  const opening = f.controller.open({...choice, expectedOrigin: B}); await started.promise;
  await f.controller.cancel(choice);
  response.resolve({status: 'unknown', originalReachable: true, chain: []});
  await assert.rejects(opening, /changed/); assert.deepEqual(f.opened, []);
});

test('restarting the browser marks an orphan archive job interrupted without silently querying again', async () => {
  const started = deferred(), response = deferred();
  const f = fixture({archive: async () => {started.resolve(); return response.promise;}});
  const {jobId} = await f.controller.start({sourceOrigin: A}); await started.promise;
  const restarted = createInternetController(f.dependencies);
  const result = await restarted.status({jobId});
  assert.equal(result.status, 'failed'); assert.deepEqual(result.candidates, []); assert.deepEqual(result.reasonCodes, ['BROWSER_RESTART_INTERRUPTED']);
  assert.deepEqual(f.archiveInputs, [A]); response.resolve(found()); await delay(5);
  assert.equal((await restarted.status({jobId})).status, 'failed');
});

test('remembering a suggestion requires explicit 24-hour confirmation and old-source permission', async () => {
  const f = fixture(), choice = await complete(f);
  await assert.rejects(f.controller.save({...choice, expectedOrigin: B, confirmed: false, durationHours: 24}), /Explicitly confirm/);
  await assert.rejects(f.controller.save({...choice, expectedOrigin: B, confirmed: true, durationHours: 168}), /24-hour/);
  f.grants.delete(A);
  await assert.rejects(f.controller.save({...choice, expectedOrigin: B, confirmed: true, durationHours: 24}), /old source/);
  f.grants.add(A);
  const saved = await f.controller.save({...choice, expectedOrigin: B, confirmed: true, durationHours: 24});
  assert.equal(saved.trustClass, 'user_configured');
  assert.deepEqual(f.saved, [{sourceOrigin: A, destinationOrigin: B, durationHours: 24, pathPolicy: 'homepage'}]);
});

test('service credentials stay session-only and are not returned or reused across service origins', async () => {
  const f = fixture();
  const result = await f.controller.configSet({serviceOrigin: SERVICE, accessToken: TOKEN});
  assert.deepEqual(result, {serviceOrigin: SERVICE, hasAccessToken: true});
  assert.equal(JSON.stringify(f.chromeApi.storage.local.values).includes(TOKEN), false);
  assert.equal(JSON.stringify(await f.controller.configGet()).includes(TOKEN), false);
  assert.equal(f.chromeApi.storage.session.values.internetAccess.accessToken, TOKEN);
  await f.controller.configSet({serviceOrigin: SERVICE_TWO});
  assert.deepEqual(await f.controller.configGet(), {serviceOrigin: SERVICE_TWO, hasAccessToken: false});
  assert.equal(f.chromeApi.storage.session.values.internetAccess, undefined);
  await f.controller.clear(); assert.equal(f.chromeApi.storage.local.values.internetConfig, undefined);
});

test('service configuration rejects malformed origins, missing grants and unsafe invite values', async () => {
  const f = fixture();
  for (const serviceOrigin of [SERVICE + '/path', SERVICE + '?query=private', 'http://lookup.example.net', 'https://127.0.0.1', 'https://user:pass@lookup.example.net']) await assert.rejects(f.controller.configSet({serviceOrigin, accessToken: TOKEN}));
  await assert.rejects(f.controller.configSet({serviceOrigin: SERVICE, accessToken: 'short'}), /invite token/);
  f.grants.delete(SERVICE);
  await assert.rejects(f.controller.configSet({serviceOrigin: SERVICE, accessToken: TOKEN}), /Grant access/);
});

test('service jobs send hostname only and resumed polling does not repeat a paid submission', async () => {
  let submitted = 0;
  const f = fixture({request: async (_url, options) => {
    if (options.method === 'POST') {
      submitted++; assert.deepEqual(options.json, {hostname: new URL(A).hostname, clientVersion: '0.2.0'});
      assert.equal(options.accessToken, TOKEN);
      return {status: 202, body: JSON.stringify(buildInternetResult(A, [], {jobId: 'remote-one', status: 'running'}))};
    }
    assert.equal(options.method, 'GET');
    return {status: 200, body: JSON.stringify(buildInternetResult(A, [lead()], {jobId: 'remote-one'}))};
  }});
  await f.controller.configSet({serviceOrigin: SERVICE, accessToken: TOKEN});
  const {jobId} = await f.controller.start({sourceOrigin: A + '/private?token=not-for-provider', mode: 'service'});
  for (let at = 0; at < 50 && !f.chromeApi.storage.local.values.internetJobs.jobs[0].serviceJobId; at++) await delay(1);
  const restarted = createInternetController(f.dependencies), result = await restarted.status({jobId});
  assert.equal(result.status, 'completed'); assert.equal(result.jobId, jobId); assert.equal(result.candidates[0].origin, B);
  assert.equal(submitted, 1); assert.equal(f.requests.filter(call => call.options.method === 'GET').length, 1);
  assert.equal(JSON.stringify(f.requests.map(call => call.options.json)).includes('not-for-provider'), false);
});

test('a late service poll cannot restore suggestions after cancellation or clearing', async t => {
  for (const action of ['cancel', 'clear']) await t.test(action, async () => {
    const getStarted = deferred(), getResponse = deferred();
    const f = fixture({request: async (_url, options) => {
      if (options.method === 'GET') {getStarted.resolve(); return getResponse.promise;}
      return {status: 202, body: JSON.stringify(buildInternetResult(A, [], {jobId: 'remote-one', status: options.method === 'DELETE' ? 'cancelled' : 'running'}))};
    }});
    await f.controller.configSet({serviceOrigin: SERVICE, accessToken: TOKEN});
    const {jobId} = await f.controller.start({sourceOrigin: A, mode: 'service'});
    for (let at = 0; at < 50 && !f.chromeApi.storage.local.values.internetJobs.jobs[0].serviceJobId; at++) await delay(1);
    const polling = f.controller.status({jobId}); await getStarted.promise;
    if (action === 'cancel') await f.controller.cancel({jobId}); else await f.controller.clear();
    getResponse.resolve({status: 200, body: JSON.stringify(buildInternetResult(A, [lead()], {jobId: 'remote-one'}))});
    if (action === 'cancel') {
      const result = await polling; assert.equal(result.status, 'cancelled'); assert.deepEqual(result.candidates, []);
    } else {
      await assert.rejects(polling, /expired or was deleted/);
      assert.equal(f.chromeApi.storage.local.values.internetJobs?.jobs.length || 0, 0);
    }
    assert.deepEqual(f.opened, []);
  });
});

test('wrong-source and falsely trusted service replies fail closed', async t => {
  for (const attack of ['source', 'trust', 'duplicate JSON']) await t.test(attack, async () => {
    const f = fixture({request: async () => {
      const result = buildInternetResult(attack === 'source' ? 'https://another.example.com' : A, [lead()]);
      if (attack === 'trust') result.candidates[0].identityClass = 'owner_verified';
      let body = JSON.stringify(result);
      if (attack === 'duplicate JSON') body = body.replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2');
      return {status: 200, body};
    }});
    await f.controller.configSet({serviceOrigin: SERVICE, accessToken: TOKEN});
    const {jobId} = await f.controller.start({sourceOrigin: A, mode: 'service'}), result = await terminal(f, jobId);
    assert.equal(result.status, 'failed'); assert.deepEqual(result.candidates, []); assert.deepEqual(f.opened, []);
  });
});

test('expired and corrupt stored lookups are physically pruned and cannot be opened', async () => {
  const f = fixture(), choice = await complete(f);
  const stored = f.chromeApi.storage.local.values.internetJobs.jobs[0];
  stored.result.createdAt = Date.now() - 7200000; stored.result.expiresAt = Date.now() - 3600000;
  await f.controller.maintenance(); assert.equal(f.chromeApi.storage.local.values.internetJobs.jobs.length, 0);
  await assert.rejects(f.controller.open({...choice, expectedOrigin: B}), /expired or was deleted/);
  f.chromeApi.storage.local.values.internetJobs.jobs.push({...stored, result: {...stored.result, candidates: [{identityClass: 'owner_verified'}]}});
  await f.controller.maintenance(); assert.deepEqual(f.chromeApi.storage.local.values.internetJobs.jobs, []);
});

test('provider failure produces an unavailable result and never an invented successor', async () => {
  const f = fixture({archive: async () => {throw new Error('ARCHIVE_UNAVAILABLE');}});
  const {jobId} = await f.controller.start({sourceOrigin: A}); const result = await terminal(f, jobId);
  assert.equal(result.status, 'failed'); assert.equal(result.outcome, 'unavailable'); assert.deepEqual(result.candidates, []);
  assert.deepEqual(f.opened, []); assert.deepEqual(f.saved, []);
});
