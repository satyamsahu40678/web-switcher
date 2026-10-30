import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSource, emptyContinuityState, validateContinuityState, discoverContinuity,
  CONTINUITY_TTL_MS, MAX_CONTINUITY_EDGES, MAX_CONTINUITY_SITES
} from '../extension/continuity.js';

const now = 1700000000000;
const A = 'https://old.example.com', B = 'https://middle.example.net';
const C = 'https://current.example.org', D = 'https://next.example.net';
const edge = (fromOrigin, toOrigin, extras = {}) => ({fromOrigin, toOrigin, evidence: 'http_redirect', firstSeen: now - 1000, lastSeen: now - 1000, expiresAt: now - 1000 + CONTINUITY_TTL_MS, ...extras});
const history = (...edges) => ({...emptyContinuityState(), edges});
const redirect = (url, successorUrl, evidence = 'http_redirect') => ({url, origin: new URL(url).origin, status: 'redirect', httpStatus: evidence === 'http_redirect' ? 301 : 200, successorUrl, evidence});
const reachable = url => ({url, origin: new URL(url).origin, status: 'reachable', httpStatus: 200});
const unavailable = (url, reason = 'NETWORK_DNS_FAILURE', httpStatus = 0) => ({url, origin: new URL(url).origin, status: 'unavailable', reason, httpStatus});
async function run(routes, options = {}) {
  const calls = [];
  const response = await discoverContinuity(options.source || A, {
    now, hasPermission: async () => true, ...options,
    probe: options.probe || (async url => {calls.push(url); assert(routes[url], 'Unexpected probe ' + url); return typeof routes[url] === 'function' ? routes[url](url) : routes[url];})
  });
  return {...response, calls};
}

test('source-only input normalizes the old address without forwarding its private URL parts', () => {
  assert.equal(normalizeSource('Old.Example.com'), A);
  assert.equal(normalizeSource(A + '/account/reset?token=private#secret'), A);
  assert.equal(normalizeSource('  ' + A + '/docs  '), A);
  assert.equal(normalizeSource('http://old.test:8080/path', {allowTestOrigins: true}), 'http://old.test:8080');
  for (const input of ['https://user:password@old.example.com/', 'https://127.0.0.1/', 'https://localhost/', 'https://thing.internal/', 'https://old.test/', 'javascript:alert(1)', 'http://old.example.com/', A + ':444/', A + '\\bad', 'x'.repeat(8193)]) {
    assert.throws(() => normalizeSource(input), input);
  }
});

test('graph storage is closed, bounded and cannot import registry/owner trust', () => {
  const state = history(edge(A, B));
  assert.deepEqual(validateContinuityState(state), state);
  const bad = [
    {...state, trustClass: 'registry_reviewed'},
    history({...edge(A, B), trustClass: 'owner_verified'}),
    history(edge(A, A)), history(edge(A, B), edge(A, B)),
    history(edge(A, B, {evidence: 'search_similarity'})),
    history(edge(A, B, {expiresAt: now + CONTINUITY_TTL_MS + 1})),
    history(edge(A, B, {firstSeen: now, lastSeen: now - 1})),
    {...state, sites: [{id: 'site', sourceOrigin: A, enabled: true, createdAt: now}, {id: 'site', sourceOrigin: B, enabled: true, createdAt: now}]},
    {...state, sites: Array.from({length: MAX_CONTINUITY_SITES + 1}, (_, i) => ({id: 's' + i, sourceOrigin: `https://site${i}.example.com`, enabled: true, createdAt: now}))}
  ];
  for (const input of bad) assert.throws(() => validateContinuityState(input));
});

test('finds A → B → C from live headers and metadata without a destination supplied by the user', async () => {
  const state = emptyContinuityState(), before = structuredClone(state);
  const checked = await run({
    [A + '/']: redirect(A + '/', B + '/announcement'),
    [B + '/announcement']: redirect(B + '/announcement', C + '/', 'meta_refresh'),
    [C + '/']: reachable(C + '/')
  }, {state, source: A + '/old-private-path?token=private'});
  assert.equal(checked.result.status, 'found');
  assert.equal(checked.result.terminalOrigin, C);
  assert.equal(checked.result.trustClass, 'source_declared');
  assert.deepEqual(checked.result.chain.map(item => [item.fromOrigin, item.toOrigin, item.evidence]), [[A, B, 'http_redirect'], [B, C, 'meta_refresh']]);
  assert.deepEqual(checked.calls, [A + '/', B + '/announcement', C + '/']);
  assert.equal(JSON.stringify(checked.state).includes('announcement'), false);
  assert.equal(JSON.stringify(checked.state).includes('private'), false);
  assert.deepEqual(state, before, 'Caller storage is cloned before updates.');
});

test('remembered successors skip dead A and dead B, but C must respond before it is offered', async () => {
  const checked = await run({
    [A + '/']: unavailable(A + '/'),
    [B + '/']: unavailable(B + '/', 'NETWORK_CONNECTION_FAILURE'),
    [C + '/']: reachable(C + '/')
  }, {state: history(edge(A, B), edge(B, C))});
  assert.equal(checked.result.status, 'found');
  assert.equal(checked.result.terminalOrigin, C);
  assert.deepEqual(checked.result.chain.map(item => item.remembered), [true, true]);
  assert.equal(checked.result.attempts[0].reason, 'NETWORK_DNS_FAILURE');
  assert.deepEqual(checked.calls, [A + '/', B + '/', C + '/']);
});

test('a later C → D move extends remembered history after retired A and B disappear', async () => {
  const checked = await run({
    [A + '/']: unavailable(A + '/'), [B + '/']: unavailable(B + '/'),
    [C + '/']: redirect(C + '/', D + '/', 'successor_link'), [D + '/']: reachable(D + '/')
  }, {state: history(edge(A, B), edge(B, C))});
  assert.equal(checked.result.terminalOrigin, D);
  assert.equal(checked.state.edges.length, 3);
  assert.deepEqual(checked.result.chain.map(item => item.toOrigin), [B, C, D]);
  assert.equal(checked.state.edges[0].firstSeen, now - 1000, 'Full origin provenance is retained, not replaced by a blind shortcut.');
});

test('newly discovered origin permissions stop the chain before any ungranted network request', async () => {
  const first = await run({[A + '/']: redirect(A + '/', B + '/')}, {hasPermission: async origin => origin === A});
  assert.equal(first.result.status, 'permission_required');
  assert.deepEqual(first.result.requiredOrigins, [B]);
  assert.deepEqual(first.calls, [A + '/']);
  assert.equal(first.state.edges.length, 1, 'The observed successor is retained for a permission continuation.');
  const second = await run({[A + '/']: redirect(A + '/', B + '/'), [B + '/']: reachable(B + '/')}, {state: first.state});
  assert.equal(second.result.terminalOrigin, B);
  assert.equal(second.state.edges.length, 1);
});

test('no source permission causes no probe at all', async () => {
  const checked = await run({}, {hasPermission: async () => false});
  assert.equal(checked.result.status, 'permission_required');
  assert.deepEqual(checked.calls, []);
});

test('a reachable old source, canonical or ordinary-link hints do not invent a migration', async () => {
  const checked = await run({[A + '/']: {...reachable(A + '/'), hints: [{origin: B, evidence: 'canonical'}]}});
  assert.equal(checked.result.status, 'unknown');
  assert.equal(checked.result.reason, 'NO_MIGRATION_EVIDENCE');
  assert.equal(checked.result.originalReachable, true);
  assert.equal(checked.result.terminalOrigin, undefined);
  assert.deepEqual(checked.state.edges, []);
});

test('a live source that stops announcing a remembered move does not silently reuse history or regress to an old endpoint', async () => {
  const checked = await run({[A + '/']: reachable(A + '/')}, {state: history(edge(A, B))});
  assert.equal(checked.result.status, 'unknown');
  assert.equal(checked.result.reason, 'MIGRATION_EVIDENCE_CHANGED');
  assert.equal(checked.result.originalReachable, undefined);
  assert.deepEqual(checked.calls, [A + '/']);
});

test('history never turns TLS, CORS/blocked fetches, forbidden, throttled or server-error responses into routing permission', async () => {
  for (const [reason, httpStatus] of [['TLS_ERROR', 0], ['FETCH_BLOCKED', 0], ['FETCH_ERROR', 0], ['NETWORK_DNS_FAILURE', 403], ['HTTP_401', 401], ['HTTP_403', 403], ['HTTP_429', 429], ['HTTP_500', 500], ['TLS_ERROR', 404]]) {
    const checked = await run({[A + '/']: unavailable(A + '/', reason, httpStatus)}, {state: history(edge(A, B))});
    assert.equal(checked.result.status, 'unavailable', reason);
    assert.equal(checked.result.terminalOrigin, undefined);
    assert.deepEqual(checked.calls, [A + '/']);
  }
});

test('404 and 410 skip only a fresh known successor, which must itself be checked live', async () => {
  for (const httpStatus of [404, 410]) {
    const reason = 'HTTP_' + httpStatus;
    const routes = {[A + '/']: unavailable(A + '/', reason, httpStatus), [B + '/']: reachable(B + '/')};
    const checked = await run(routes, {state: history(edge(A, B))});
    assert.equal(checked.result.status, 'found', reason);
    assert.equal(checked.result.terminalOrigin, B);
    assert.equal(checked.result.chain[0].remembered, true);
    assert.equal(checked.result.attempts[0].reason, reason);
    assert.deepEqual(checked.calls, [A + '/', B + '/']);

    const unknown = await run(routes);
    assert.equal(unknown.result.status, 'unavailable');
    assert.equal(unknown.result.reason, reason);
    assert.equal(unknown.result.terminalOrigin, undefined);
    assert.deepEqual(unknown.calls, [A + '/'], 'HTTP Gone alone supplies no successor.');

    const stale = await run(routes, {state: history(edge(A, B, {firstSeen: now - CONTINUITY_TTL_MS - 1, lastSeen: now - CONTINUITY_TTL_MS - 1, expiresAt: now - 1}))});
    assert.equal(stale.result.reason, 'HISTORY_EXPIRED');
    assert.deepEqual(stale.calls, [A + '/']);
    assert.deepEqual(stale.state.edges, []);

    const goneEndpoint = await run({...routes, [B + '/']: unavailable(B + '/', reason, httpStatus)}, {state: history(edge(A, B))});
    assert.equal(goneEndpoint.result.status, 'unavailable');
    assert.equal(goneEndpoint.result.terminalOrigin, undefined, 'A remembered endpoint is not offered when it is also gone.');
  }
});

test('expired history cannot rescue a dead source and is physically pruned', async () => {
  const checked = await run({[A + '/']: unavailable(A + '/')}, {state: history(edge(A, B, {firstSeen: now - CONTINUITY_TTL_MS - 1, lastSeen: now - CONTINUITY_TTL_MS - 1, expiresAt: now - 1}))});
  assert.equal(checked.result.reason, 'HISTORY_EXPIRED');
  assert.deepEqual(checked.calls, [A + '/']);
  assert.deepEqual(checked.state.edges, []);
});

test('history that expires during a probe cannot conflict with newly observed live evidence', async () => {
  let clock = now;
  const checked = await run({}, {
    now: () => clock,
    state: history(edge(A, B, {expiresAt: now + 1})),
    probe: async url => {
      if (url === A + '/') {clock += 2; return redirect(url, C + '/');}
      assert.equal(url, C + '/'); return reachable(url);
    }
  });
  assert.equal(checked.result.status, 'found');
  assert.equal(checked.result.terminalOrigin, C);
  assert.equal(checked.state.edges.length, 1);
  assert.equal(checked.state.edges[0].toOrigin, C);
});

test('cycles stop without offering a destination', async () => {
  const checked = await run({[A + '/']: redirect(A + '/', B + '/'), [B + '/']: redirect(B + '/', A + '/')});
  assert.equal(checked.result.status, 'loop');
  assert.equal(checked.result.terminalOrigin, undefined);
  assert.deepEqual(checked.calls, [A + '/', B + '/']);
});

test('a contradictory successor is retained as a conflict, never silently overwritten', async () => {
  const first = await run({[A + '/']: redirect(A + '/', C + '/')}, {state: history(edge(A, B))});
  assert.equal(first.result.status, 'conflict');
  assert.deepEqual(first.result.conflictingOrigins, [B, C]);
  assert.equal(first.state.edges.length, 2);
  const second = await run({}, {state: first.state});
  assert.equal(second.result.status, 'conflict');
  assert.deepEqual(second.calls, []);
});

test('ambiguous declarations and unsafe successor URLs never trigger a follow-up request', async () => {
  const ambiguous = await run({[A + '/']: {url: A + '/', origin: A, status: 'ambiguous', httpStatus: 200}});
  assert.equal(ambiguous.result.status, 'conflict');
  for (const target of ['https://127.0.0.1/', 'https://service.local/', 'https://user:pass@middle.example.net/', B + '/?token=secret', B + '/#secret', B + '/account/reset', B + '/public/%2fprivate', B + '/file.exe', 'http://middle.example.net/']) {
    const checked = await run({[A + '/']: redirect(A + '/', target)});
    assert.equal(checked.result.reason, 'UNSAFE_SUCCESSOR', target);
    assert.deepEqual(checked.calls, [A + '/']);
    assert.deepEqual(checked.state.edges, []);
  }
});

test('same-origin migration paths remain transient and path cycles are bounded', async () => {
  const checked = await run({[A + '/']: redirect(A + '/', A + '/moved'), [A + '/moved']: redirect(A + '/moved', B + '/'), [B + '/']: reachable(B + '/')});
  assert.equal(checked.result.terminalOrigin, B);
  assert.equal(checked.state.edges.length, 1);
  assert.equal(checked.state.edges[0].fromOrigin, A);
  const loop = await run({[A + '/']: redirect(A + '/', A + '/moved'), [A + '/moved']: redirect(A + '/moved', A + '/')});
  assert.equal(loop.result.status, 'loop');
});

test('separate domain-hop and request limits bound long and same-origin chains', async () => {
  let calls = 0;
  const manyOrigins = await run({}, {probe: async url => {calls++; const n = url.startsWith(A) ? 0 : Number(new URL(url).hostname.match(/site(\d+)/)[1]); return redirect(url, `https://site${n + 1}.example.com/`);}});
  assert.equal(manyOrigins.result.reason, 'HOP_LIMIT');
  assert.equal(calls, 9);
  calls = 0;
  const paths = await run({}, {probe: async url => {calls++; return redirect(url, A + '/step' + calls);}});
  assert.equal(paths.result.reason, 'PROBE_LIMIT');
  assert.equal(calls, 12);
});

test('clock reversal cannot renew or route a remembered edge', async () => {
  const checked = await run({}, {state: history(edge(A, B, {firstSeen: now, lastSeen: now + 1, expiresAt: now + CONTINUITY_TTL_MS}))});
  assert.equal(checked.result.reason, 'CLOCK_ANOMALY');
  assert.deepEqual(checked.calls, []);
  let clock = now;
  const changedDuringProbe = await run({}, {now: () => clock, probe: async url => {clock--; return reachable(url);}});
  assert.equal(changedDuringProbe.result.reason, 'CLOCK_ANOMALY');
  const originalNow = Date.now;
  try {
    clock = now; Date.now = () => clock;
    const defaultClock = await discoverContinuity(A, {
      hasPermission: async () => true,
      probe: async url => {clock--; return reachable(url);}
    });
    assert.equal(defaultClock.result.reason, 'CLOCK_ANOMALY', 'The default runtime clock must be reread after network work.');
  } finally { Date.now = originalNow; }
});

test('the total deadline aborts a stalled probe instead of offering an untested historical destination', async () => {
  let signal;
  const before = performance.now();
  const checked = await run({}, {budgetMs: 20, state: history(edge(A, B)), probe: (_url, options) => {
    signal = options.signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('ABORTED')), {once: true}));
  }});
  assert.equal(checked.result.reason, 'TIME_BUDGET');
  assert.equal(signal.aborted, true);
  assert.equal(checked.result.terminalOrigin, undefined);
  assert(performance.now() - before < 1000);
});

test('history capacity stops new edge recording and forged probe results fail closed', async () => {
  const full = history(...Array.from({length: MAX_CONTINUITY_EDGES}, (_, i) => edge(`https://old${i}.example.com`, `https://next${i}.example.com`)));
  const checked = await run({[A + '/']: redirect(A + '/', B + '/')}, {state: full});
  assert.equal(checked.result.reason, 'HISTORY_LIMIT');
  assert.equal(checked.state.edges.length, MAX_CONTINUITY_EDGES);
  assert.deepEqual(checked.calls, [A + '/']);
  const forged = await run({[A + '/']: {...reachable(A + '/'), origin: B}});
  assert.equal(forged.result.reason, 'INVALID_PROBE_RESULT');
  const status = await run({[A + '/']: {...redirect(A + '/', B + '/'), httpStatus: 500}});
  assert.equal(status.result.reason, 'INVALID_PROBE_RESULT');
});
