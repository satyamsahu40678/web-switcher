import test from 'node:test';
import assert from 'node:assert/strict';
import {createMappingFollower} from '../extension/mapping-follow.js';
import {createMapping, validateConfig} from '../extension/core.js';
import {createContinuityController} from '../extension/continuity-worker.js';

const A = 'https://old-one.com', B = 'https://old-two.com', C = 'https://current-site.com', D = 'https://next-site.net', E = 'https://latest-site.org';
const clone = value => structuredClone(value);
const START = Date.parse('2026-10-31T12:00:00Z');
function fixture() {
  let currentTime = START, sequence = 0, discover, beforeCommit, persist = clone;
  const mapping = (source, id) => ({...createMapping({sourceOrigin: source, destinationOrigin: C, pathPolicy: 'preserve', durationHours: 24}, START - 1000, id), followOrigin: C});
  let config = {schemaVersion: 1, generation: 'generation-one', paused: false, mappings: [mapping(A, 'alias-one'), mapping(B, 'alias-two')]};
  const grants = new Set([A, B, C, D, E]), reservations = new Set(), calls = [], commits = [];
  const moved = (from = C, to = D) => ({status: 'found', sourceOrigin: from, terminalOrigin: to, chain: [{fromOrigin: from, toOrigin: to, evidence: 'http_redirect', checkedAt: currentTime}], attempts: [{origin: from, status: 'redirect'}, {origin: to, status: 'reachable'}], trustClass: 'source_declared', checkedAt: currentTime});
  const unchanged = from => ({status: 'unknown', reason: 'NO_MIGRATION_EVIDENCE', sourceOrigin: from, originalReachable: true, chain: [], attempts: [{origin: from, status: 'reachable'}], checkedAt: currentTime});
  const controller = createMappingFollower({
    continuity: {async discover(origin, options) {calls.push({origin, options: clone(options)}); return discover ? discover(origin, options) : moved(origin, origin === C ? D : E);}},
    readConfig: async () => clone(config),
    commitConfig: async (next, guard) => {if (beforeCommit) await beforeCommit(next); await guard(); validateConfig(next); config = persist(next); commits.push(clone(next));},
    isReserved: async origin => reservations.has(origin),
    hasPermission: async origin => grants.has(origin),
    now: () => currentTime, makeId: () => 'generated-' + ++sequence,
  });
  return {controller, grants, reservations, calls, commits, moved, unchanged,
    get config() {return config;}, set config(value) {config = value;},
    setDiscover(value) {discover = value;}, setCommitHook(value) {beforeCommit = value;}, setPersist(value) {persist = value;}, setTime(value) {currentTime = value;},
    envelope(id = 'alias-one', source = A + '/download-invincible-hindi-dubbed-series/?public=yes#local') {return {generation: config.generation, mappingId: id, source};},
  };
}

test('all selected aliases share each freshly observed current destination and former current aliases', async () => {
  const f = fixture(), original = clone(f.config), firstEnvelope = f.envelope();
  const first = await f.controller.resolve(clone(f.config), firstEnvelope);
  assert.equal(first.currentOrigin, D); assert.equal(first.localGroupId, C); assert.equal(first.updated, true);
  assert.equal(first.config.mappings.length, 3);
  assert.ok(first.config.mappings.every(mapping => mapping.destinationOrigin === D && mapping.followOrigin === C));
  assert.deepEqual(first.config.mappings.slice(0, 2).map(mapping => ({...mapping, destinationOrigin: C})), original.mappings);
  assert.equal(first.config.mappings[2].sourceOrigin, C);
  assert.equal(first.envelope.source, firstEnvelope.source, 'The entered URL stays local and retains its exact envelope until core policy sanitizes navigation.');
  assert.equal(first.envelope.generation, f.config.generation);
  assert.notEqual(first.envelope.generation, original.generation);
  assert.deepEqual(f.calls.map(call => call.origin), [C], 'Retired aliases must not be the starting network request.');
  assert.deepEqual(f.calls[0].options.blockedOrigins, [A, B], 'The discovery controller must fence selected old aliases before dispatch.');
  assert.equal(await first.validate(), null);
  const second = await f.controller.resolve(clone(f.config), f.envelope('alias-two', B + '/articles/42'));
  assert.equal(second.currentOrigin, E); assert.equal(second.localGroupId, C);
  assert.deepEqual(f.calls.map(call => call.origin), [C, D]);
  assert.deepEqual(new Set(f.config.mappings.map(mapping => mapping.sourceOrigin)), new Set([A, B, C, D]));
  assert.ok(f.config.mappings.every(mapping => mapping.destinationOrigin === E));
  assert.equal(f.commits.length, 2);
});

test('a freshly reachable unchanged current domain does not rewrite policy or invent a move', async () => {
  const f = fixture(), initial = clone(f.config);
  f.setDiscover(origin => f.unchanged(origin));
  const result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(result.currentOrigin, C); assert.equal(result.updated, false); assert.equal(result.localGroupId, C);
  assert.deepEqual(f.config, initial); assert.deepEqual(f.commits, []);
});
test('browser storage object-key reordering preserves own commits while array edits remain changes', async () => {
  const f = fixture();
  const storageOrder = value => Array.isArray(value) ? value.map(storageOrder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, storageOrder(value[key])])) : value;
  f.setPersist(storageOrder);
  const first = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(first.currentOrigin, D); assert.equal(await first.validate(), null);
  assert.deepEqual(Object.keys(f.config), [...Object.keys(f.config)].sort(), 'The fixture models Chrome storage serialization rather than keeping insertion order.');
  const second = await f.controller.resolve(clone(f.config), f.envelope('alias-two', B + '/articles/42'));
  assert.equal(second.currentOrigin, E); assert.equal(await second.validate(), null);
  f.config.mappings.reverse();
  assert.equal((await second.validate()).reason, 'changed', 'An actual mapping-array change still invalidates a routing snapshot.');
});

test('static manual choices never acquire automatic follow behavior implicitly', async () => {
  const f = fixture(); for (const mapping of f.config.mappings) delete mapping.followOrigin;
  const envelope = f.envelope(); const result = await f.controller.resolve(clone(f.config), envelope);
  assert.deepEqual(result, {config: f.config, envelope}); assert.deepEqual(f.calls, []); assert.deepEqual(f.commits, []);
});

test('disabled or expired sibling mappings retain their local decision and original expiry', async () => {
  const f = fixture();
  f.config.mappings[1].enabled = false;
  f.config.mappings[1].createdAt = START - 7200000; f.config.mappings[1].expiresAt = START - 3600000;
  const sibling = clone(f.config.mappings[1]);
  const result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(result.currentOrigin, D);
  assert.deepEqual(f.config.mappings[1], {...sibling, destinationOrigin: D});
});

test('missing source or current-origin permission stops before a network request', async t => {
  for (const origin of [A, C]) await t.test(origin, async () => {
    const f = fixture(); f.grants.delete(origin);
    const result = await f.controller.resolve(clone(f.config), f.envelope());
    assert.equal(result.blocked.status, 'permission_required'); assert.deepEqual(result.blocked.requiredOrigins, [origin]);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.commits, []);
  });
});

test('new successor permission and revoked intermediate grants cannot commit an unchecked destination', async () => {
  const f = fixture(); f.grants.delete(D);
  const first = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(first.blocked.status, 'permission_required'); assert.deepEqual(first.blocked.requiredOrigins, [D]);
  assert.equal(f.config.mappings[0].destinationOrigin, C); assert.deepEqual(f.commits, []);
  f.grants.add(D);
  f.setDiscover(origin => {f.grants.delete(C); return f.moved(origin, D);});
  const revoked = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(revoked.blocked.status, 'permission_required'); assert.ok(revoked.blocked.requiredOrigins.includes(C));
  assert.deepEqual(f.commits, []);
});

test('every group alias and the shared seed/current retain the signed-history barrier', async t => {
  for (const origin of [A, B, C]) await t.test(origin, async () => {
    const f = fixture(); f.reservations.add(origin);
    const result = await f.controller.resolve(clone(f.config), f.envelope());
    assert.equal(result.blocked.reason, 'override'); assert.deepEqual(f.calls, []); assert.deepEqual(f.commits, []);
  });
});

test('an intermediate or terminal reservation appearing during discovery blocks every group update', async () => {
  const f = fixture();
  f.setDiscover(origin => {f.reservations.add(D); return f.moved(origin, D);});
  const result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(result.blocked.reason, 'override'); assert.deepEqual(f.commits, []);
  assert.ok(f.config.mappings.every(mapping => mapping.destinationOrigin === C));
});

test('discovery failures are not converted into a static fallback or a working-current claim', async t => {
  for (const status of ['unknown', 'unavailable', 'conflict', 'loop']) await t.test(status, async () => {
    const f = fixture(); f.setDiscover(origin => ({status, sourceOrigin: origin, chain: [], attempts: [{origin, status: 'unavailable'}], checkedAt: START}));
    const result = await f.controller.resolve(clone(f.config), f.envelope());
    assert.ok(result.blocked); assert.deepEqual(f.commits, []);
    assert.ok(f.config.mappings.every(mapping => mapping.destinationOrigin === C));
  });
});

test('malformed or source-unbound discovery results cannot select a shared destination', async t => {
  for (const [name, mutate] of Object.entries({
    'wrong source': result => {result.sourceOrigin = E;},
    'unbound terminal': result => {result.terminalOrigin = E;},
    'private terminal': result => {result.terminalOrigin = 'http://127.0.0.1';},
    'disconnected chain': result => {result.chain[0].fromOrigin = E;},
    'unsupported evidence': result => {result.chain[0].evidence = 'search_rank';},
    'no chain': result => {result.chain = [];},
  })) await t.test(name, async () => {
    const f = fixture(); f.setDiscover(origin => {const result = f.moved(origin, D); mutate(result); return result;});
    const result = await f.controller.resolve(clone(f.config), f.envelope());
    assert.equal(result.blocked.reason, 'unavailable'); assert.deepEqual(f.commits, []);
  });
});

test('a move into an old selected alias is a loop rather than a reversed group pointer', async () => {
  const f = fixture(); f.setDiscover(origin => f.moved(origin, A));
  const result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(result.blocked.reason, 'loop'); assert.deepEqual(f.commits, []);
});
test('real continuity discovery blocks a return into a selected old alias before contacting it', async () => {
  const f = fixture(), requests = [];
  let state;
  const continuity = createContinuityController({
    chromeApi: {storage: {local: {async get(key) {return {[key]: clone(state)};}, async set(value) {state = clone(value.continuityState);}}}, permissions: {async contains({origins}) {return origins.every(origin => f.grants.has(origin.slice(0, -2)));}}},
    probeOverride: async url => {requests.push(url); assert.equal(new URL(url).origin, C); return {url, origin: C, status: 'redirect', httpStatus: 301, successorUrl: A + '/', evidence: 'http_redirect'};},
  });
  f.setDiscover((origin, options) => continuity.discover(origin, options));
  const result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(result.blocked.reason, 'loop');
  assert.deepEqual(requests, [C + '/']); assert.deepEqual(f.commits, []);
  assert.ok(f.config.mappings.every(mapping => mapping.destinationOrigin === C));
});
test('a return into an ungranted old sibling is a loop, not a request to grant that sibling', async () => {
  const f = fixture(), requests = [];
  f.grants.delete(B);
  let state;
  const continuity = createContinuityController({
    chromeApi: {storage: {local: {async get(key) {return {[key]: clone(state)};}, async set(value) {state = clone(value.continuityState);}}}, permissions: {async contains({origins}) {return origins.every(origin => f.grants.has(origin.slice(0, -2)));}}},
    probeOverride: async url => {requests.push(url); assert.equal(new URL(url).origin, C); return {url, origin: C, status: 'redirect', httpStatus: 301, successorUrl: B + '/', evidence: 'http_redirect'};},
  });
  f.setDiscover((origin, options) => continuity.discover(origin, options));
  const result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(result.blocked.status, 'blocked'); assert.equal(result.blocked.reason, 'loop');
  assert.equal(result.blocked.requiredOrigins, undefined);
  assert.deepEqual(requests, [C + '/']); assert.deepEqual(f.commits, []);
});
test('signed-continuity inhibition remains explicit even when protected discovery omits attempts', async () => {
  const f = fixture(); f.setDiscover(origin => ({status: 'unknown', sourceOrigin: origin, chain: [], reason: 'SIGNED_REGISTRY_PRECEDENCE'}));
  assert.equal((await f.controller.resolve(clone(f.config), f.envelope())).blocked.reason, 'override');
  assert.deepEqual(f.commits, []);
});

test('a successor colliding with another static source cannot create a chained mapping', async () => {
  const f = fixture();
  f.config.mappings.push(createMapping({sourceOrigin: D, destinationOrigin: E, pathPolicy: 'homepage', durationHours: 24}, START - 1000, 'unrelated-static'));
  const initial = clone(f.config);
  const result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(result.blocked.reason, 'conflict'); assert.deepEqual(f.config, initial); assert.deepEqual(f.commits, []);
});

test('a concurrent user edit, including an edit without rotating generation, cannot be overwritten', async t => {
  for (const [name, mutate] of Object.entries({
    'new generation': config => {config.generation = 'new-user-generation';},
    'pause': config => {config.paused = true;},
    'same-generation path choice': config => {config.mappings[1].pathPolicy = 'homepage';},
    'member removed': config => {config.mappings.splice(1, 1);},
  })) await t.test(name, async () => {
    const f = fixture(); f.setDiscover(origin => {mutate(f.config); return f.moved(origin, D);});
    const result = await f.controller.resolve(clone(f.config), f.envelope());
    assert.equal(result.blocked.reason, 'changed'); assert.deepEqual(f.commits, []);
  });
});

test('expiry during a destination request blocks the result without renewing consent', async () => {
  const f = fixture();
  f.setDiscover(origin => {f.setTime(START + 86400000); return f.moved(origin, D);});
  const result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(result.blocked.reason, 'expired'); assert.deepEqual(f.commits, []);
});

test('commit-time policy invalidation and failed rule installation cannot return a successful move', async t => {
  await t.test('settings change before commit guard', async () => {
    const f = fixture(); f.setCommitHook(() => {f.config.generation = 'edited-before-commit';});
    const result = await f.controller.resolve(clone(f.config), f.envelope());
    assert.equal(result.blocked.reason, 'changed'); assert.deepEqual(f.commits, []);
  });
  await t.test('rule installation fails', async () => {
    const f = fixture(); f.setCommitHook(() => {throw new Error('Synthetic DNR failure');});
    const result = await f.controller.resolve(clone(f.config), f.envelope());
    assert.equal(result.blocked.reason, 'unavailable'); assert.deepEqual(f.commits, []);
    assert.ok(f.config.mappings.every(mapping => mapping.destinationOrigin === C));
  });
});

test('final-use callback rechecks permissions, reservations and current policy after an own commit', async () => {
  const f = fixture(), result = await f.controller.resolve(clone(f.config), f.envelope());
  assert.equal(await result.validate(), null);
  f.grants.delete(D); assert.equal((await result.validate()).status, 'permission_required'); f.grants.add(D);
  f.reservations.add(C); assert.equal((await result.validate()).reason, 'override'); f.reservations.clear();
  f.config.generation = 'edited-after-update'; assert.equal((await result.validate()).reason, 'changed');
});

test('explicit group checks return minimized JSON data and use the same current endpoint', async () => {
  const f = fixture(), result = await f.controller.check(C, f.config.generation);
  assert.equal(result.status, 'checked'); assert.equal(result.currentOrigin, D); assert.equal(result.previousOrigin, C); assert.equal(result.mappingCount, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(Object.values(result).some(value => typeof value === 'function'), false);
  assert.deepEqual(f.calls.map(call => call.origin), [C]);
});

test('stale settings and groups with no active member do not start external work', async () => {
  const f = fixture();
  assert.equal((await f.controller.check(C, 'stale-generation')).blocked.reason, 'changed');
  for (const mapping of f.config.mappings) mapping.enabled = false;
  assert.equal((await f.controller.check(C, f.config.generation)).blocked.reason, 'expired');
  assert.deepEqual(f.calls, []);
});
