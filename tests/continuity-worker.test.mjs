import test from 'node:test';
import assert from 'node:assert/strict';
import {createContinuityController, compileContinuityRules} from '../extension/continuity-worker.js';
import {emptyContinuityState, CONTINUITY_TTL_MS} from '../extension/continuity.js';

// Controller orchestration only. Actual MV3 permission/navigation behavior has
// separate native Chromium coverage in continuity-browser.mjs.
const A = 'https://old.example.com', B = 'https://middle.example.net', C = 'https://current.example.org';
const clone = value => structuredClone(value);
const site = (sourceOrigin = A, id = 'followed-old') => ({id, sourceOrigin, enabled: true, createdAt: Date.now() - 1000});
const edge = (fromOrigin = A, toOrigin = B, expiresAt = Date.now() + 3600000) => ({fromOrigin, toOrigin, evidence: 'http_redirect', firstSeen: Date.now() - 2000, lastSeen: Date.now() - 1000, expiresAt});
const redirect = (url, target = B) => ({url, origin: new URL(url).origin, status: 'redirect', httpStatus: 301, successorUrl: target + '/', evidence: 'http_redirect'});
const reachable = url => ({url, origin: new URL(url).origin, status: 'reachable', httpStatus: 200});
function area(initial = {}) {
  return {values: clone(initial), async get(key) { return clone(key ? {[key]: this.values[key]} : this.values); }, async set(value) {Object.assign(this.values, clone(value));}};
}
function fixture({state = {...emptyContinuityState(), sites: [site()]}, probe, reserved = () => false} = {}) {
  const grants = new Set([A, B, C]), opened = [], updates = [], sessions = [], alarms = [], observations = [], records = [];
  const config = {schemaVersion: 1, generation: 'generation-one', paused: false, mappings: []};
  const chromeApi = {
    storage: {local: area({continuityState: state}), session: area()},
    runtime: {getURL: path => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' + path},
    permissions: {async contains({origins}) {return origins.every(value => grants.has(value.slice(0, -2)));}},
    tabs: {async create(value) {opened.push(clone(value));}, async update(id, value) {updates.push({id, ...clone(value)});}},
    declarativeNetRequest: {async updateSessionRules(value) {sessions.push(clone(value));}},
    alarms: {async create(name, options) {alarms.push({name, ...clone(options)});}}
  };
  const controller = createContinuityController({chromeApi, isReserved: reserved, probeOverride: async (url, options) => {
    observations.push(url);
    return probe ? probe(url, options) : new URL(url).origin === A ? redirect(url) : reachable(url);
  }});
  const sender = {tab: {id: 7}, frameId: 0};
  const envelope = (source = A + '/docs?public=value#local') => ({generation: config.generation, mappingId: 'followed-old', source});
  const context = {readConfig: async () => clone(config), recordSwitch: async result => {records.push(clone(result)); return result;}};
  return {controller, chromeApi, grants, config, opened, updates, sessions, alarms, observations, records, sender, envelope, context};
}

test('source-only enrollment creates an exact-origin GET gate without a manual destination', async () => {
  const f = fixture({state: emptyContinuityState()}); let installs = 0;
  await f.controller.follow({sourceOrigin: A + '/private?token=secret', enabled: true}, async () => installs++);
  const state = await f.controller.read();
  assert.equal(installs, 1); assert.equal(state.sites.length, 1); assert.equal(state.sites[0].sourceOrigin, A);
  assert.equal(JSON.stringify(state).includes('secret'), false); assert.equal('destinationOrigin' in state.sites[0], false);
  const [rule] = await f.controller.rules(f.config);
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']); assert.deepEqual(rule.condition.requestMethods, ['get']);
  assert.equal(new RegExp(rule.condition.regexFilter).test(A + '/docs'), true);
  assert.equal(new RegExp(rule.condition.regexFilter).test(A + '.attacker.org/docs'), false);
  assert.match(rule.action.redirect.regexSubstitution, /continuity-gate\.html#g=generation-one/);
});

test('continuity rules yield to manual mappings, signed reservations, global pause and missing grants', () => {
  const state = {...emptyContinuityState(), sites: [site()]}, config = {paused: false, generation: 'g', mappings: []};
  const rules = (cfg = config, grants = new Set([A]), reservations = {}) => compileContinuityRules(cfg, state, grants, 'chrome-extension://id/continuity-gate.html', reservations);
  assert.equal(rules().length, 1);
  assert.deepEqual(rules({...config, mappings: [{sourceOrigin: A}]}), []);
  assert.deepEqual(rules(config, new Set([A]), {origins: [A]}), []);
  assert.deepEqual(rules(config, new Set([A]), {blockedAll: true}), []);
  assert.deepEqual(rules({...config, paused: true}), []);
  assert.deepEqual(rules(config, new Set()), []);
});

test('enrollment requires source consent and rolls storage back when DNR activation fails', async () => {
  const f = fixture({state: emptyContinuityState()}); f.grants.delete(A);
  await assert.rejects(f.controller.follow({sourceOrigin: A, enabled: true}, async () => {}), /Allow checks/);
  assert.deepEqual(await f.controller.read(), emptyContinuityState()); f.grants.add(A);
  let installs = 0;
  await assert.rejects(f.controller.follow({sourceOrigin: A, enabled: true}, async () => {if (++installs === 1) throw new Error('DNR transaction failed');}), /DNR/);
  assert.equal(installs, 2); assert.deepEqual(await f.controller.read(), emptyContinuityState());
});

test('opening freshly rechecks the displayed successor and sends only its homepage', async () => {
  const f = fixture();
  await assert.rejects(f.controller.open({sourceOrigin: A, expectedOrigin: C}), /changed or could not be rechecked/);
  assert.deepEqual(f.opened, []);
  const result = await f.controller.open({sourceOrigin: A + '/account?token=secret', expectedOrigin: B});
  assert.equal(result.terminalOrigin, B); assert.deepEqual(f.opened, [{url: B + '/'}]);
  assert.equal(JSON.stringify(await f.controller.read()).includes('secret'), false);
  assert.deepEqual(f.observations, [A + '/', B + '/', A + '/', B + '/']);
});

test('reserved signed sources are never probed or opened through weaker continuity', async () => {
  const f = fixture({reserved: () => true});
  const result = await f.controller.discover(A);
  assert.equal(result.reason, 'SIGNED_REGISTRY_PRECEDENCE'); assert.deepEqual(f.observations, []);
  assert.equal((await f.controller.resolveGate({envelope: f.envelope()}, f.sender, f.context)).reason, 'override');
  await assert.rejects(f.controller.open({sourceOrigin: A, expectedOrigin: B}), /changed/);
  assert.deepEqual(f.opened, []); assert.deepEqual(f.records, []);
});

test('signed reservations stop live and remembered intermediate successors before their network request', async t => {
  for (const remembered of [false, true]) await t.test(remembered ? 'remembered dead predecessor' : 'live predecessor', async () => {
    const state = {...emptyContinuityState(), sites: [site()], edges: remembered ? [edge(A, B), edge(B, C)] : []};
    const f = fixture({state, reserved: origin => origin === B, probe: async url => {
      if (new URL(url).origin === A) return remembered
        ? {url, origin: A, status: 'unavailable', httpStatus: 0, reason: 'NETWORK_DNS_FAILURE'}
        : redirect(url);
      assert.fail('A signed intermediate origin must not be probed through continuity.');
    }});
    const result = await f.controller.discover(A);
    assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'SIGNED_REGISTRY_PRECEDENCE');
    assert.deepEqual(f.observations, [A + '/']);
    assert.deepEqual(await f.controller.read(), state, 'No partial evidence is learned across the signed barrier.');
  });
});

test('an intermediate successor reserved while being probed cannot contribute another hop', async () => {
  let reserved = false;
  const f = fixture({reserved: origin => origin === B && reserved, probe: async url => {
    if (new URL(url).origin === A) return redirect(url);
    assert.equal(new URL(url).origin, B); reserved = true; return redirect(url, C);
  }});
  const result = await f.controller.discover(A);
  assert.equal(result.status, 'unknown'); assert.equal(result.reason, 'SIGNED_REGISTRY_PRECEDENCE');
  assert.deepEqual(f.observations, [A + '/', B + '/']);
  assert.deepEqual((await f.controller.read()).edges, []);
});

test('late reservation of an earlier hop blocks discovery, explicit open and the navigation gate', async t => {
  for (const action of ['discover', 'open', 'gate']) await t.test(action, async () => {
    let reserved = false;
    const f = fixture({reserved: origin => origin === B && reserved, probe: async url => {
      const origin = new URL(url).origin;
      if (origin === A) return redirect(url);
      if (origin === B) return redirect(url, C);
      assert.equal(origin, C); reserved = true; return reachable(url);
    }});
    if (action === 'open') await assert.rejects(f.controller.open({sourceOrigin: A, expectedOrigin: C}), /changed|authority/);
    else {
      const result = action === 'discover' ? await f.controller.discover(A)
        : await f.controller.resolveGate({envelope: f.envelope()}, f.sender, f.context);
      assert.notEqual(result.status, 'found'); assert.notEqual(result.status, 'ready');
      assert.equal(result.reason, 'SIGNED_REGISTRY_PRECEDENCE');
    }
    assert.deepEqual(f.observations, [A + '/', B + '/', C + '/']);
    assert.deepEqual(f.opened, []); assert.deepEqual(f.updates, []); assert.deepEqual(f.records, []);
    assert.deepEqual((await f.controller.read()).edges, []);
  });
});

test('a signed reservation on an earlier hop after switch recording still withholds the navigation target', async () => {
  let reserved = false;
  const f = fixture({reserved: origin => origin === B && reserved, probe: async url => {
    const origin = new URL(url).origin;
    return origin === A ? redirect(url) : origin === B ? redirect(url, C) : reachable(url);
  }});
  f.context.recordSwitch = async result => {reserved = true; return result;};
  const result = await f.controller.resolveGate({envelope: f.envelope()}, f.sender, f.context);
  assert.deepEqual(result, {status: 'blocked', reason: 'override'});
  assert.deepEqual(f.opened, []); assert.deepEqual(f.updates, []);
});

test('gate rechecks grants, pause, generation and registry changes after the network returns', async t => {
  for (const [name, mutate, reason] of [
    ['permission', f => f.grants.delete(A), 'permission'],
    ['pause', f => {f.config.paused = true;}, 'paused'],
    ['generation', f => {f.config.generation = 'generation-two';}, 'changed'],
    ['manual authority', f => {f.config.mappings.push({sourceOrigin: A});}, 'override'],
    ['signed authority', f => {f.reserved = true;}, 'override']
  ]) await t.test(name, async () => {
    let f;
    f = fixture({reserved: () => f.reserved, probe: async url => {
      if (new URL(url).origin === A) return redirect(url);
      mutate(f); return reachable(url);
    }});
    const result = await f.controller.resolveGate({envelope: f.envelope()}, f.sender, f.context);
    assert.equal(result.status, 'blocked'); assert.equal(result.reason, reason); assert.deepEqual(f.records, []);
  });
});

test('gate cannot resurrect a site paused or forgotten during a network check', async t => {
  for (const action of ['pause', 'forget']) await t.test(action, async () => {
    let f;
    f = fixture({probe: async url => {
      if (new URL(url).origin === A) return redirect(url);
      const state = await f.controller.read();
      if (action === 'pause') state.sites[0].enabled = false;
      else state.sites = [];
      await f.chromeApi.storage.local.set({continuityState: state});
      return reachable(url);
    }});
    const result = await f.controller.resolveGate({envelope: f.envelope()}, f.sender, f.context);
    assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'paused');
    assert.deepEqual(f.records, []);
    const state = await f.controller.read();
    if (action === 'pause') assert.equal(state.sites[0].enabled, false);
    else assert.deepEqual(state.sites, []);
  });
});

test('gate rechecks authority after recording a switch before releasing its destination', async () => {
  const f = fixture();
  f.context.recordSwitch = async result => {f.config.paused = true; return result;};
  const result = await f.controller.resolveGate({envelope: f.envelope()}, f.sender, f.context);
  assert.deepEqual(result, {status: 'blocked', reason: 'paused'});
});

test('opening fails closed when the source grant disappears while checking the successor', async () => {
  let f;
  f = fixture({probe: async url => {
    if (new URL(url).origin === A) return redirect(url);
    f.grants.delete(A); return reachable(url);
  }});
  await assert.rejects(f.controller.open({sourceOrigin: A, expectedOrigin: B}), /permission or registry authority changed/);
  assert.deepEqual(f.opened, []);
});

test('sensitive URLs require fresh homepage confirmation bound to the current successor', async () => {
  const f = fixture(), envelope = f.envelope(A + '/account/reset?token=private#secret');
  const preview = await f.controller.resolveGate({type: 'CONTINUITY_RESOLVE', envelope}, f.sender, f.context);
  assert.equal(preview.status, 'confirmation'); assert.equal(preview.homepage, B + '/'); assert.deepEqual(f.records, []);
  const changed = await f.controller.resolveGate({type: 'CONTINUITY_CONFIRM', envelope, expectedOrigin: C}, f.sender, f.context);
  assert.equal(changed.reason, 'changed'); assert.deepEqual(f.records, []);
  const ready = await f.controller.resolveGate({type: 'CONTINUITY_CONFIRM', envelope, expectedOrigin: B}, f.sender, f.context);
  assert.equal(ready.status, 'ready'); assert.equal(ready.url, B + '/');
  assert.equal(JSON.stringify(f.records).includes('private'), false);
  assert.equal(JSON.stringify(f.chromeApi.storage.local.values).includes('private'), false);
});

test('healthy unchanged source resumes its private URL only on that same origin with a tab-scoped bypass', async () => {
  const f = fixture({probe: async url => reachable(url)}), source = A + '/account?token=private#local';
  const result = await f.controller.resolveGate({envelope: f.envelope(source)}, f.sender, f.context);
  assert.equal(result.status, 'original'); assert.deepEqual(f.updates, [{id: 7, url: source}]); assert.deepEqual(f.records, []);
  const [rule] = f.sessions[0].addRules;
  assert.deepEqual(rule.condition.tabIds, [7]); assert.equal(rule.action.type, 'allow'); assert.deepEqual(rule.condition.requestMethods, ['get']);
  assert.equal(new RegExp(rule.condition.regexFilter).test(B + '/'), false);
  assert.equal(f.chromeApi.storage.session.values.bypasses[7].sourceOrigin, A);
  assert.equal(JSON.stringify(f.chromeApi.storage.session.values).includes('private'), false);
  assert.equal(f.alarms[0].name, 'cleanup');
});

test('gate rejects stale generations, forged origins, subframes and unenrolled sources before networking', async () => {
  const f = fixture();
  const cases = [
    [{envelope: {...f.envelope(), generation: 'old'}}, f.sender, 'changed'],
    [{envelope: f.envelope(B + '/')}, f.sender, 'invalid'],
    [{envelope: f.envelope()}, {...f.sender, frameId: 1}, 'invalid'],
    [{envelope: {...f.envelope(), mappingId: 'unknown'}}, f.sender, 'paused'],
    [{envelope: f.envelope(A + '/\\evil')}, f.sender, 'invalid']
  ];
  for (const [message, sender, reason] of cases) assert.equal((await f.controller.resolveGate(message, sender, f.context)).reason, reason);
  assert.deepEqual(f.observations, []); assert.deepEqual(f.records, []);
});

test('corrupt history is quarantined and expired observations are physically pruned', async () => {
  const bad = {schemaVersion: 1, sites: [], edges: [{trustClass: 'owner_verified'}]};
  const f = fixture({state: bad});
  assert.deepEqual(await f.controller.read(), emptyContinuityState());
  assert.deepEqual(f.chromeApi.storage.local.values.corruptContinuity, bad);
  const expired = edge(A, B, Date.now() - 1); expired.firstSeen = Date.now() - CONTINUITY_TTL_MS; expired.lastSeen = expired.expiresAt - 1;
  await f.chromeApi.storage.local.set({continuityState: {...emptyContinuityState(), sites: [site()], edges: [expired, edge(B, C)]}});
  const state = await f.controller.read(); assert.equal(state.edges.length, 1); assert.equal(state.edges[0].fromOrigin, B);
  assert.equal(f.chromeApi.storage.local.values.continuityState.edges.length, 1);
});

test('forget clears the connected chain but preserves unrelated history and other enrollments', async () => {
  const X = 'https://unrelated.example.com', Y = 'https://another.example.net';
  const f = fixture({state: {...emptyContinuityState(), sites: [site(), site(B, 'middle')], edges: [edge(A, B), edge(B, C), edge(X, Y)]}});
  let installs = 0; await f.controller.forget({sourceOrigin: A}, async () => installs++);
  const state = await f.controller.read(); assert.equal(installs, 1);
  assert.deepEqual(state.sites.map(item => item.sourceOrigin), [B]);
  assert.deepEqual(state.edges.map(item => [item.fromOrigin, item.toOrigin]), [[X, Y]]);
});
