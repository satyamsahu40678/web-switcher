import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createMapping, parseEnvelope } from '../extension/core.js';
import { TRUSTED_REGISTRY_KEYS } from '../extension/build-config.js';
import { encodeBase64Url } from '../packages/security/catalog.mjs';

// This harness models asynchronous storage cloning and atomic DNR replacement.
// It exercises worker orchestration, not actual Chromium permission/navigation behavior.
const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const extensionUrl = path => `chrome-extension://${extensionId}/${path}`;
const optionsSender = { id: extensionId, url: extensionUrl('options.html') };
const popupSender = { id: extensionId, url: extensionUrl('popup.html') };
const routeSender = { id: extensionId, url: extensionUrl('route.html'), tab: { id: 7 }, frameId: 0, documentId: 'gate-document-1' };
const clone = value => structuredClone(value);
function event() {
  const listeners = [];
  return { addListener: listener => listeners.push(listener), emit: (...args) => listeners.map(listener => listener(...args)), listeners };
}
function storageArea() {
  return {
    values: {},
    async get(keys) {
      const selected = keys === null || keys === undefined ? this.values : Object.fromEntries((typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)).filter(key => Object.hasOwn(this.values, key)).map(key => [key, this.values[key]]));
      return clone(selected);
    },
    async set(value) { Object.assign(this.values, clone(value)); },
    async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key]; },
    async clear() { this.values = {}; },
  };
}
let dynamicRules = [];
let sessionRules = [];
let failNextDnr = false;
let regexSupported = true;
const grants = new Set();
const tabs = new Map();
const tabUpdates = [];
const alarms = [];
const chromeMock = {
  webNavigation: {onCommitted: event()},
  webRequest: {onHeadersReceived: event(), onErrorOccurred: event()},
  runtime: { id: extensionId, getURL: extensionUrl, onMessage: event(), onInstalled: event(), onStartup: event() },
  storage: { local: storageArea(), session: storageArea() },
  permissions: { onAdded: event(), onRemoved: event(), async contains({ origins }) { return origins.every(origin => grants.has(origin)); } },
  declarativeNetRequest: {
    async isRegexSupported() { return { isSupported: regexSupported }; },
    async getDynamicRules() { return clone(dynamicRules); },
    async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
      if (failNextDnr) { failNextDnr = false; throw new Error('Synthetic DNR transaction failure'); }
      dynamicRules = [...dynamicRules.filter(rule => !removeRuleIds.includes(rule.id)), ...clone(addRules)];
    },
    async getSessionRules() { return clone(sessionRules); },
    async updateSessionRules({ removeRuleIds = [], addRules = [] }) { sessionRules = [...sessionRules.filter(rule => !removeRuleIds.includes(rule.id)), ...clone(addRules)]; },
  },
  tabs: {
    onUpdated: event(), onRemoved: event(),
    async get(id) { if (!tabs.has(id)) throw new Error('Tab not found'); return clone(tabs.get(id)); },
    async update(id, value) { tabUpdates.push({ id, ...clone(value) }); tabs.set(id, { ...tabs.get(id), ...clone(value) }); return clone(tabs.get(id)); },
  },
  alarms: { onAlarm: event(), async create(name, value) { alarms.push({ name, ...clone(value) }); } },
};
globalThis.chrome = chromeMock;
await import('../extension/background.js');
function send(message, sender = optionsSender) {
  return new Promise(resolve => {
    const active = chromeMock.runtime.onMessage.listeners[0](clone(message), clone(sender), resolve);
    assert.equal(active, true, 'worker keeps the response channel open');
  });
}
const now = () => Date.now();
const baseMapping = () => createMapping({ sourceOrigin: 'https://old-site.com', destinationOrigin: 'https://current-site.com', pathPolicy: 'preserve', durationHours: 24 }, now() - 1000, 'local-1');
const baseConfig = () => ({ schemaVersion: 1, generation: 'generation-1', paused: false, mappings: [baseMapping()] });
const envelope = (source = 'https://old-site.com/docs/start?public=yes#local') => parseEnvelope(`#g=generation-1&m=local-1&source=${source}`);
function reset(config = baseConfig()) {
  chromeMock.storage.local.values = { config: clone(config) }; chromeMock.storage.session.values = {};
  dynamicRules = []; sessionRules = []; grants.clear(); tabs.clear(); tabUpdates.length = 0; alarms.length = 0;
  failNextDnr = false; regexSupported = true;
  for (const key of Object.keys(TRUSTED_REGISTRY_KEYS)) delete TRUSTED_REGISTRY_KEYS[key];
}
async function reconcile() { chromeMock.runtime.onStartup.emit(); const read = await send({ type: 'read' }); assert.equal(read.ok, true, read.error); return read.data; }
function grant(origin = 'https://old-site.com') { grants.add(`${origin}/*`); }
function portable(config = baseConfig()) { return { schemaVersion: 1, paused: config.paused, mappings: config.mappings }; }

test('worker accepts packaged UI only; web pages and subframe gates cannot mutate state', async () => {
  reset(); const previous = clone(chromeMock.storage.local.values.config);
  for (const sender of [{ id: extensionId, url: 'https://hostile.com/options.html' }, { id: 'different-extension', url: extensionUrl('options.html') }, { id: extensionId, url: extensionUrl('route.html') }]) {
    const result = await send({ type: 'pauseAll', paused: true }, sender); assert.equal(result.ok, false);
  }
  const subframe = await send({ type: 'resolve', envelope: envelope() }, { ...routeSender, frameId: 2 });
  assert.deepEqual(subframe.data, { status: 'blocked', reason: 'invalid' });
  assert.deepEqual(chromeMock.storage.local.values.config, previous);
});
test('save needs an existing source grant and compiles only exact-origin main-frame GET rules', async () => {
  reset({ schemaVersion: 1, generation: 'empty', paused: false, mappings: [] });
  const input = { sourceOrigin: 'https://old-site.com', destinationOrigin: 'https://current-site.com', pathPolicy: 'preserve', durationHours: 24 };
  assert.equal((await send({ type: 'save', input })).ok, false); assert.equal(chromeMock.storage.local.values.config.mappings.length, 0);
  grant(); assert.equal((await send({ type: 'save', input })).ok, true);
  assert.equal(dynamicRules.length, 1); assert.deepEqual(dynamicRules[0].condition.resourceTypes, ['main_frame']); assert.deepEqual(dynamicRules[0].condition.requestMethods, ['get']);
  assert.equal(new RegExp(dynamicRules[0].condition.regexFilter).test('https://old-site.com.evil.org/docs'), false);
});
test('strict raw import rejects duplicate JSON keys and forged trust without partial changes', async () => {
  reset(); grant(); await reconcile();
  const initial = clone(chromeMock.storage.local.values.config); const initialRules = clone(dynamicRules);
  const forged = portable(); forged.mappings[0].trustClass = 'owner_verified';
  const reservedId = portable(); reservedId.mappings[0].id = 'registry-0';
  const forgedProvenance = portable(); forgedProvenance.mappings[0].provenance = 'registry';
  const requests = [JSON.stringify(forged), JSON.stringify(reservedId), JSON.stringify(forgedProvenance), JSON.stringify({ ...portable(), catalogRecord: { jws: 'forged' } }), JSON.stringify(portable()).replace('"paused":false', '"paused":false,"paused":true'), '{"schemaVersion":1,"paused":false,"mappings":[]}garbage'];
  for (const text of requests) {
    const response = await send({ type: 'IMPORT_SETTINGS', text }); assert.equal(response.ok, false);
    assert.deepEqual(chromeMock.storage.local.values.config, initial); assert.deepEqual(dynamicRules, initialRules); assert.equal(chromeMock.storage.local.values.pendingConfig, undefined);
  }
});
test('imported local mappings never manufacture browser grants', async () => {
  reset({ schemaVersion: 1, generation: 'empty', paused: false, mappings: [] });
  const response = await send({ type: 'IMPORT_SETTINGS', text: JSON.stringify(portable()) }); assert.equal(response.ok, true, response.error);
  assert.equal(chromeMock.storage.local.values.config.mappings.length, 1); assert.equal(dynamicRules.length, 0); assert.equal(grants.size, 0);
});
test('DNR failure rolls back an imported configuration and clears its staging record', async () => {
  reset(); grant(); await reconcile();
  const previous = clone(chromeMock.storage.local.values.config); const previousRules = clone(dynamicRules);
  const replacement = portable(); replacement.mappings[0].destinationOrigin = 'https://replacement-site.com';
  failNextDnr = true; const response = await send({ type: 'IMPORT_SETTINGS', text: JSON.stringify(replacement) });
  assert.equal(response.ok, false); assert.match(response.error, /DNR/); assert.deepEqual(chromeMock.storage.local.values.config, previous); assert.deepEqual(dynamicRules, previousRules); assert.equal(chromeMock.storage.local.values.pendingConfig, undefined);
});
test('concurrent UI writes are serialized instead of losing one mapping', async () => {
  reset({ schemaVersion: 1, generation: 'empty', paused: false, mappings: [] }); grant(); grant('https://older-site.com');
  const input = sourceOrigin => ({ sourceOrigin, destinationOrigin: 'https://current-site.com', pathPolicy: 'homepage', durationHours: 24 });
  const responses = await Promise.all([send({ type: 'save', input: input('https://old-site.com') }), send({ type: 'save', input: input('https://older-site.com') })]);
  assert.equal(responses.every(result => result.ok), true); assert.equal(chromeMock.storage.local.values.config.mappings.length, 2); assert.equal(dynamicRules.length, 2);
});
test('confirmation binds the current policy generation and exact displayed destination', async () => {
  reset(); grant(); const sensitive = envelope('https://old-site.com/account/reset?token=synthetic');
  const preview = await send({ type: 'resolve', envelope: sensitive }, routeSender); assert.equal(preview.data.reason, 'manual');
  assert.equal(preview.data.homepage, 'https://current-site.com/');
  const forged = await send({ type: 'confirmRoute', envelope: sensitive, expectedUrl: 'https://attacker.com/' }, routeSender); assert.equal(forged.data.reason, 'changed');
  chromeMock.storage.local.values.config.generation = 'generation-2';
  const stale = await send({ type: 'confirmRoute', envelope: sensitive, expectedUrl: preview.data.homepage }, routeSender); assert.equal(stale.data.reason, 'changed');
  assert.equal(chromeMock.storage.local.values.receipts?.length ?? 0, 0);
});
test('confirmed sensitive route goes only to the revalidated homepage and writes origin-only receipt', async () => {
  reset(); grant();
  const response = await send({ type: 'confirmRoute', envelope: envelope('https://old-site.com/account?token=synthetic#sensitive'), expectedUrl: 'https://current-site.com/' }, routeSender);
  assert.equal(response.data.status, 'ready'); assert.equal(response.data.url, 'https://current-site.com/');
  const [receipt] = chromeMock.storage.local.values.receipts; assert.deepEqual(Object.keys(receipt).sort(), ['at', 'destinationOrigin', 'sourceOrigin']);
  assert.equal(JSON.stringify(receipt).includes('synthetic'), false);
});
test('receipt retention physically removes expired, future and malformed storage entries', async () => {
  reset(); const at = now();
  const origins = { sourceOrigin: 'https://old-site.com', destinationOrigin: 'https://current-site.com' };
  chromeMock.storage.local.values.receipts = [null, { ...origins, at: at - 2 * 86400000 }, { ...origins, at: at + 3600000 }, { ...origins, at: at - 1000 }];
  const response = await send({ type: 'read' }); assert.equal(response.ok, true, response.error);
  assert.equal(response.data.receipts.length, 1); assert.deepEqual(chromeMock.storage.local.values.receipts, [{ ...origins, at: at - 1000 }]);
});
test('repeated family switch is blocked by the tab-session loop guard', async () => {
  reset(); grant(); const first = await send({ type: 'resolve', envelope: envelope() }, routeSender); assert.equal(first.data.status, 'ready');
  const second = await send({ type: 'resolve', envelope: envelope() }, routeSender); assert.equal(second.data.reason, 'loop');
  assert.equal(chromeMock.storage.local.values.receipts.length, 1);
});
async function retryPreview() {
  assert.equal((await send({type: 'resolve', envelope: envelope()}, routeSender)).data.status, 'ready');
  const sourceEnvelope = envelope('https://old-site.com/another-old-link?public=yes#private');
  const second = await send({type: 'resolve', envelope: sourceEnvelope}, routeSender);
  assert.equal(second.data.reason, 'loop');
  assert.equal(second.data.homepage, 'https://current-site.com/');
  assert.equal(typeof second.data.retryToken, 'string');
  return {type: 'retryRoute', envelope: sourceEnvelope, expectedUrl: second.data.retryUrl, retryToken: second.data.retryToken};
}
test('deliberate loop recovery keeps the safe mapped path and renews automatic protection', async () => {
  reset(); grant(); const retry = await retryPreview();
  const result = await send(retry, routeSender);
  assert.equal(result.data.status, 'ready');
  assert.equal(result.data.url, 'https://current-site.com/another-old-link');
  assert.equal(chromeMock.storage.local.values.receipts.length, 2);
  const bounce = await send({type: 'resolve', envelope: envelope('https://old-site.com/different-return-path')}, {...routeSender, documentId: 'bounced-gate'});
  assert.equal(bounce.data.reason, 'loop');
  assert.equal(chromeMock.storage.local.values.receipts.length, 2);
  assert.equal((await send(retry, routeSender)).data.reason, 'changed');
  assert.ok(!JSON.stringify(chromeMock.storage.session.values.routeRetries).includes('private'));
});
test('loop recovery capabilities are single-use even for concurrent clicks', async () => {
  reset(); grant(); const retry = await retryPreview();
  const results = await Promise.all([send(retry, routeSender), send(retry, routeSender)]);
  assert.deepEqual(results.map(result => result.data.status), ['ready', 'blocked']);
  assert.equal(results[1].data.reason, 'changed');
  assert.equal(chromeMock.storage.local.values.receipts.length, 2);
});
test('loop recovery cannot cross documents, tabs, frames, targets or web senders', async () => {
  reset(); grant(); const retry = await retryPreview();
  for (const sender of [{...routeSender, documentId: 'other-document'}, {...routeSender, documentId: undefined}, {...routeSender, tab: {id: 8}}, {...routeSender, frameId: 1}]) {
    assert.equal((await send(retry, sender)).data.status, 'blocked');
  }
  assert.equal((await send({...retry, expectedUrl: 'https://attacker.com/'}, routeSender)).data.reason, 'changed');
  assert.equal((await send({...retry, retryToken: 'forged'}, routeSender)).data.reason, 'changed');
  assert.equal((await send(retry, {...routeSender, url: 'https://attacker.com/route.html'})).ok, false);
  assert.equal(chromeMock.storage.local.values.receipts.length, 1);
  assert.equal((await send(retry, routeSender)).data.status, 'ready', 'invalid requests must not confer routing authority');
});
test('loop recovery rechecks current policy and its bounded authorization', async t => {
  const mutations = {
    'generation changes': () => {chromeMock.storage.local.values.config.generation = 'changed-generation';},
    'destination changes': () => {chromeMock.storage.local.values.config.mappings[0].destinationOrigin = 'https://replacement-site.com';},
    'mapping removed': () => {chromeMock.storage.local.values.config.mappings = [];},
    'mapping disabled': () => {chromeMock.storage.local.values.config.mappings[0].enabled = false;},
    'global pause': () => {chromeMock.storage.local.values.config.paused = true;},
    'permission revoked': () => {grants.clear();},
    'mapping expired': () => {const m = chromeMock.storage.local.values.config.mappings[0]; m.createdAt = now() - 7200000; m.expiresAt = now() - 3600000;},
    'retry expired': () => {chromeMock.storage.session.values.routeRetries['7'].expiresAt = now() - 1;},
    'clock moved backwards': () => {chromeMock.storage.session.values.routeRetries['7'].expiresAt = now() + 180000;},
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    reset(); grant(); const retry = await retryPreview(); mutate();
    assert.equal((await send(retry, routeSender)).data.status, 'blocked');
    assert.equal(chromeMock.storage.local.values.receipts.length, 1);
  });
});
test('closing a tab removes its outstanding homepage recovery capability', async () => {
  reset(); grant(); const retry = await retryPreview();
  chromeMock.tabs.onRemoved.emit(7); await send({type: 'read'});
  assert.deepEqual(chromeMock.storage.session.values.routeRetries, {});
  assert.equal((await send(retry, routeSender)).data.reason, 'changed');
});
function observeGate(sender, transitionType = 'typed', transitionQualifiers = ['server_redirect', 'from_address_bar']) {
  chromeMock.webNavigation.onCommitted.emit({tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId, url: sender.url + '#g=generation-1&m=local-1&source=https://old-site.com/private?token=synthetic', transitionType, transitionQualifiers, documentLifecycle: 'active'});
}
test('fresh typed visits and real link transitions preserve the article without a false pause', async () => {
  reset(); grant();
  const source = envelope('https://old-site.com/download-invincible-hindi-dubbed-series/?public=yes#section');
  for (const [index, type] of ['typed', 'typed', 'link'].entries()) {
    const sender = {...routeSender, documentId: `fresh-gate-${index}`};
    observeGate(sender, type);
    const result = await send({type: 'resolve', envelope: source}, sender);
    assert.equal(result.data.status, 'ready');
    assert.equal(result.data.url, 'https://current-site.com/download-invincible-hindi-dubbed-series/');
    const used = chromeMock.storage.session.values.navigationGates['7'];
    assert.equal(used.fresh, false); assert.equal(used.consumed, true);
    assert.equal(used.documentId, sender.documentId, 'Navigation freshness is consumed once, not inherited by another message.');
  }
  const replay = await send({type: 'resolve', envelope: source}, {...routeSender, documentId: 'fresh-gate-2'});
  assert.equal(replay.data.reason, 'loop');
  assert.equal(chromeMock.storage.local.values.receipts.length, 3);
});
test('late browser commit metadata cannot recreate freshness for an already-used gate document', async () => {
  reset(); grant();
  const sender = {...routeSender, documentId: 'late-commit-document'};
  assert.equal((await send({type: 'resolve', envelope: envelope()}, sender)).data.status, 'ready');
  observeGate(sender);
  const repeated = await send({type: 'resolve', envelope: envelope()}, sender);
  assert.equal(repeated.data.reason, 'loop');
  assert.equal(chromeMock.storage.local.values.receipts.length, 1);
});
test('redirect metadata and another gate document cannot reset an active mapping guard', async () => {
  reset(); grant();
  assert.equal((await send({type: 'resolve', envelope: envelope()}, routeSender)).data.status, 'ready');
  const redirected = {...routeSender, documentId: 'client-redirected-gate'};
  observeGate(redirected, 'link', ['client_redirect', 'server_redirect']);
  assert.equal((await send({type: 'resolve', envelope: envelope()}, redirected)).data.reason, 'loop');
  const other = {...routeSender, documentId: 'different-fresh-gate'};
  observeGate(other);
  assert.equal((await send({type: 'resolve', envelope: envelope()}, redirected)).data.reason, 'loop');
  const saved = JSON.stringify(chromeMock.storage.session.values.navigationGates);
  assert.ok(!saved.includes('private') && !saved.includes('synthetic') && !saved.includes('old-site.com'));
  assert.equal(chromeMock.storage.local.values.receipts.length, 1);
});
test('fresh-looking programmatic link bursts remain bounded and other tabs stay independent', async () => {
  reset(); grant();
  for (let index = 0; index < 7; index++) {
    const sender = {...routeSender, documentId: `burst-${index}`};
    observeGate(sender, 'link', ['server_redirect']);
    const result = await send({type: 'resolve', envelope: envelope()}, sender);
    assert.equal(index < 6 ? result.data.status : result.data.reason, index < 6 ? 'ready' : 'loop');
  }
  assert.equal(chromeMock.storage.local.values.receipts.length, 6);
  assert.equal((await send({type: 'resolve', envelope: envelope()}, {...routeSender, tab: {id: 8}, documentId: 'other-tab'})).data.status, 'ready');
  chromeMock.tabs.onRemoved.emit(7); await send({type: 'read'});
  assert.ok(!Object.keys(chromeMock.storage.session.values.navigationBursts).some(key => key.startsWith('7:')));
});
test('same-millisecond ordinary switches keep unique nonfuture activity and undo references', async () => {
  reset(); grant();
  const fixed = now(); const realNow = Date.now;
  Date.now = () => fixed;
  try {
    for (let index = 0; index < 3; index++) {
      const sender = {...routeSender, documentId: `same-millisecond-${index}`};
      observeGate(sender);
      assert.equal((await send({type: 'resolve', envelope: envelope()}, sender)).data.status, 'ready');
    }
    const activity = (await send({type: 'read'})).data.receipts;
    assert.equal(activity.length, 3);
    assert.equal(new Set(activity.map(receipt => receipt.at)).size, 3);
    assert.ok(activity.every(receipt => receipt.at <= fixed));
    assert.ok(activity.every(receipt => chromeMock.storage.session.values.receiptTabs[String(receipt.at)]?.tabId === 7));
  } finally { Date.now = realNow; }
});
test('changing existing mapping link behavior preserves its identity and expiry, replaces DNR and rejects stale settings', async () => {
  const initial = baseConfig(); initial.mappings[0].pathPolicy = 'homepage';
  reset(initial); grant(); await reconcile();
  const before = clone(chromeMock.storage.local.values.config.mappings[0]);
  const message = {type: 'setPathPolicy', id: before.id, pathPolicy: 'preserve', generation: initial.generation};
  assert.equal((await send(message, popupSender)).ok, false);
  const changed = await send(message); assert.equal(changed.ok, true, changed.error);
  const config = chromeMock.storage.local.values.config;
  assert.deepEqual(config.mappings[0], {...before, pathPolicy: 'preserve'});
  assert.notEqual(config.generation, initial.generation);
  assert.ok(dynamicRules[0].action.redirect.regexSubstitution.includes(config.generation));
  assert.equal((await send({...message, pathPolicy: 'homepage'})).ok, false);
  assert.equal((await send({...message, pathPolicy: 'unsafe', generation: config.generation})).ok, false);
  assert.equal((await send({type: 'resolve', envelope: envelope()}, routeSender)).data.reason, 'changed');
  const currentEnvelope = {...envelope('https://old-site.com/download-invincible-hindi-dubbed-series/'), generation: config.generation};
  assert.equal((await send({type: 'resolve', envelope: currentEnvelope}, routeSender)).data.url, 'https://current-site.com/download-invincible-hindi-dubbed-series/');
});
test('undo rejects another tab and same-origin navigation after the recorded switch', async () => {
  reset(); grant(); const result = await send({ type: 'resolve', envelope: envelope() }, routeSender); const receiptId = String(chromeMock.storage.local.values.receipts[0].at);
  tabs.set(7, { id: 7, url: result.data.url });
  assert.equal((await send({ type: 'undo', tabId: 8, receiptId }, popupSender)).ok, false);
  tabs.set(7, { id: 7, url: 'https://current-site.com/another-page' });
  const moved = await send({ type: 'undo', tabId: 7, receiptId }, popupSender); assert.equal(moved.ok, false); assert.match(moved.error, /moved/); assert.equal(tabUpdates.length, 0); assert.equal(sessionRules.length, 0);
});
test('undo allow rule is tab-scoped and removed after its navigation completes', async () => {
  reset(); grant(); const result = await send({ type: 'resolve', envelope: envelope() }, routeSender); const receiptId = String(chromeMock.storage.local.values.receipts[0].at);
  tabs.set(7, { id: 7, url: result.data.url });
  const undone = await send({ type: 'undo', tabId: 7, receiptId }, popupSender); assert.equal(undone.ok, true, undone.error);
  assert.deepEqual(sessionRules[0].condition.tabIds, [7]); assert.equal(sessionRules[0].action.type, 'allow'); assert.equal(tabUpdates[0].url, 'https://old-site.com/');
  chromeMock.tabs.onUpdated.emit(7, { status: 'complete' }); await send({ type: 'read' });
  assert.equal(sessionRules.length, 0); assert.deepEqual(chromeMock.storage.session.values.bypasses, {});
});
test('revoking source access removes rules and makes an already-open gate fail closed', async () => {
  reset(); grant(); await reconcile(); assert.equal(dynamicRules.length, 1);
  grants.clear(); chromeMock.permissions.onRemoved.emit({ origins: ['https://old-site.com/*'] }); await send({ type: 'read' });
  assert.equal(dynamicRules.length, 0); const result = await send({ type: 'resolve', envelope: envelope() }, routeSender); assert.equal(result.data.reason, 'permission');
});
test('startup discards interrupted pending generation and safely recovers corrupt configuration', async () => {
  reset(); grant(); chromeMock.storage.local.values.pendingConfig = { ...baseConfig(), generation: 'interrupted' };
  await reconcile(); assert.equal(chromeMock.storage.local.values.pendingConfig, undefined); assert.equal(chromeMock.storage.local.values.config.generation, 'generation-1');
  const corrupt = { schemaVersion: 99, mappings: 'bad' }; chromeMock.storage.local.values.config = corrupt;
  const recovered = await reconcile(); assert.deepEqual(chromeMock.storage.local.values.corruptConfig, corrupt); assert.equal(recovered.config.mappings.length, 0); assert.equal(dynamicRules.length, 0);
});

const signingKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
function signedCatalog(sequence, modify = () => {}) {
  const issuedAt = new Date(now() - 3600000).toISOString(); const expiresAt = new Date(now() + 5 * 3600000).toISOString();
  const payload = { schemaVersion: 1, bundleSequence: sequence, issuedAt, expiresAt, minClientVersion: '0.2.0', policyVersion: 1, families: [{ id: 'docs', name: 'Documentation' }], aliases: [{ sourceOrigin: 'https://retired-docs.com', familyId: 'docs' }], decisions: [{ familyId: 'docs', destinationOrigin: 'https://current-docs.com', trustClass: 'registry_reviewed', validUntil: expiresAt, pathPolicy: { type: 'preserve', publicPrefixes: ['/docs/'] }, reasonCodes: ['REVIEWED_CONTINUITY'], requiresConfirmation: true }], revocations: [] };
  modify(payload);
  const encode = value => encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode({ alg: 'ES256', typ: 'web-switcher-catalog+jws', kid: 'test-registry-1' })}.${encode(payload)}`;
  return `${input}.${encodeBase64Url(sign('sha256', Buffer.from(input), { key: signingKeys.privateKey, dsaEncoding: 'ieee-p1363' }))}`;
}
function trustTestKey() { TRUSTED_REGISTRY_KEYS['test-registry-1'] = signingKeys.publicKey.export({ format: 'jwk' }); grant('https://retired-docs.com'); }
test('signed catalog installation is atomic across failed DNR activation', async () => {
  reset(); grant(); trustTestKey();
  const first = await send({ type: 'importCatalog', jws: signedCatalog(2) }); assert.equal(first.ok, true, first.error);
  const previous = clone(chromeMock.storage.local.values); const previousRules = clone(dynamicRules);
  failNextDnr = true; const failed = await send({ type: 'importCatalog', jws: signedCatalog(3) }); assert.equal(failed.ok, false);
  assert.deepEqual(chromeMock.storage.local.values.config, previous.config); assert.deepEqual(chromeMock.storage.local.values.catalogRecord, previous.catalogRecord); assert.deepEqual(chromeMock.storage.local.values.catalogHighwater, previous.catalogHighwater); assert.equal(chromeMock.storage.local.values.pendingConfig, undefined); assert.deepEqual(dynamicRules, previousRules);
});
test('persisted catalog high-water mark rejects an older cached record', async () => {
  reset(); trustTestKey(); assert.equal((await send({ type: 'importCatalog', jws: signedCatalog(3) })).ok, true);
  const accepted = clone(chromeMock.storage.local.values.catalogHighwater);
  const older = signedCatalog(2); chromeMock.storage.local.values.catalogRecord = { jws: older, memory: { ...accepted, sequence: 2 } };
  const read = await send({ type: 'read' }); assert.equal(read.ok, true, read.error); assert.match(read.data.registry.error, /rollback/); assert.equal(read.data.registry.sequence, undefined);
  await reconcile(); assert.equal(dynamicRules.length, 0);
});
test('clear local data preserves signature rollback memory and removes tab bypasses', async () => {
  reset(); trustTestKey(); assert.equal((await send({ type: 'importCatalog', jws: signedCatalog(3) })).ok, true);
  const highwater = clone(chromeMock.storage.local.values.catalogHighwater);
  sessionRules = [{ id: 1000007 }]; chromeMock.storage.session.values = { bypasses: { 7: { ruleId: 1000007, expiresAt: now() + 1000 } } };
  const cleared = await send({ type: 'CLEAR_LOCAL_DATA' }); assert.equal(cleared.ok, true, cleared.error);
  assert.deepEqual(chromeMock.storage.local.values.catalogHighwater, highwater); assert.equal(chromeMock.storage.local.values.catalogRecord, undefined); assert.equal(chromeMock.storage.local.values.config.mappings.length, 0); assert.equal(dynamicRules.length, 0); assert.equal(sessionRules.length, 0);
  assert.deepEqual(chromeMock.storage.local.values.catalogContinuityOrigins, ['https://retired-docs.com']);
});

test('revoked and removed signed aliases cannot fall back to weaker automatic continuity', async () => {
  reset({schemaVersion: 1, generation: 'empty', paused: false, mappings: []});
  trustTestKey();
  const sourceOrigin = 'https://retired-docs.com';
  assert.equal((await send({type: 'CONTINUITY_FOLLOW', sourceOrigin, enabled: true})).ok, true);
  assert.equal(dynamicRules.length, 1);
  assert.match(dynamicRules[0].action.redirect.regexSubstitution, /continuity-gate/);
  assert.equal((await send({type: 'importCatalog', jws: signedCatalog(1)})).ok, true);
  assert.equal(dynamicRules.length, 1);
  assert.match(dynamicRules[0].action.redirect.regexSubstitution, /route.html/);
  const revoked = signedCatalog(2, value => {
    value.decisions = [];
    value.revocations = [{familyId: 'docs', revokedAt: new Date(now() - 1000).toISOString(), reason: 'Conflicting ownership evidence'}];
  });
  assert.equal((await send({type: 'importCatalog', jws: revoked})).ok, true);
  assert.equal(dynamicRules.length, 0, 'revocation must not reactivate a followed source');
  const blocked = await send({type: 'CONTINUITY_DISCOVER', sourceOrigin});
  assert.equal(blocked.ok, true); assert.equal(blocked.data.reason, 'SIGNED_REGISTRY_PRECEDENCE');
  assert.equal((await send({type: 'importCatalog', jws: signedCatalog(3, value => { value.aliases = []; value.decisions = []; })})).ok, true);
  assert.equal(dynamicRules.length, 0, 'removing an alias does not erase its trust barrier');
  assert.equal((await send({type: 'CLEAR_LOCAL_DATA'})).ok, true);
  assert.equal((await send({type: 'CONTINUITY_FOLLOW', sourceOrigin, enabled: true})).ok, true);
  assert.equal(dynamicRules.length, 0, 'clearing private activity does not remove the public trust barrier');
});

test('automatic continuity messages reject web senders and subframe gates', async () => {
  reset();
  const before = clone(chromeMock.storage.local.values);
  for (const type of ['CONTINUITY_DISCOVER', 'CONTINUITY_FOLLOW', 'CONTINUITY_FORGET', 'CONTINUITY_OPEN']) {
    const response = await send({type, sourceOrigin: 'https://old-site.com', enabled: true}, {id: extensionId, url: 'https://hostile.com/options.html'});
    assert.equal(response.ok, false);
  }
  const subframe = await send({type: 'CONTINUITY_RESOLVE', envelope: envelope()}, {id: extensionId, url: extensionUrl('continuity-gate.html'), tab: {id: 7}, frameId: 2});
  assert.deepEqual(subframe.data, {status: 'blocked', reason: 'invalid'});
  assert.deepEqual(chromeMock.storage.local.values, before);
});


test('signed aliases share a per-family loop guard without merging local intent or other tabs', async () => {
  reset(); grant(); trustTestKey(); grant('https://older-docs.com');
  const catalog = signedCatalog(1, value => {
    value.aliases.push({ sourceOrigin: 'https://older-docs.com', familyId: 'docs' });
    value.decisions[0].requiresConfirmation = false;
  });
  assert.equal((await send({ type: 'importCatalog', jws: catalog })).ok, true);
  const generation = chromeMock.storage.local.values.config.generation;
  const signedEnvelope = (index, origin) => ({ generation, mappingId: `registry-${index}`, source: origin + '/docs/start' });
  const first = await send({ type: 'resolve', envelope: signedEnvelope(0, 'https://retired-docs.com') }, routeSender);
  assert.equal(first.data.status, 'ready'); assert.equal(first.data.familyId, 'docs');
  const sibling = await send({ type: 'resolve', envelope: signedEnvelope(1, 'https://older-docs.com') }, routeSender);
  assert.equal(sibling.data.reason, 'loop', 'a destination bouncing into a sibling alias cannot switch the family again');
  const otherTab = await send({ type: 'resolve', envelope: signedEnvelope(1, 'https://older-docs.com') }, { ...routeSender, tab: { id: 8 } });
  assert.equal(otherTab.data.status, 'ready', 'independent tabs retain independent attempts');
  const local = await send({ type: 'resolve', envelope: { ...envelope(), generation } }, routeSender);
  assert.equal(local.data.status, 'ready', 'manual mappings are not assigned registry family identity'); assert.equal(local.data.familyId, undefined);
  chromeMock.storage.session.values.attempts['7:registry:docs'] = now() - 15001;
  const expiredAttempt = await send({ type: 'resolve', envelope: signedEnvelope(1, 'https://older-docs.com') }, routeSender);
  assert.equal(expiredAttempt.data.status, 'ready', 'a new family attempt is allowed after the bounded guard window');
});

test('manual and confirmation previews of signed aliases retain the same family loop protection', async () => {
  reset(); trustTestKey(); grant('https://older-docs.com');
  assert.equal((await send({ type: 'importCatalog', jws: signedCatalog(1, value => value.aliases.push({ sourceOrigin: 'https://older-docs.com', familyId: 'docs' })) })).ok, true);
  const generation = chromeMock.storage.local.values.config.generation;
  const previewEnvelope = (index, source) => ({ generation, mappingId: `registry-${index}`, source });
  const firstEnvelope = previewEnvelope(0, 'https://retired-docs.com/docs/start');
  const first = await send({ type: 'resolve', envelope: firstEnvelope }, routeSender);
  assert.equal(first.data.reason, 'confirmation'); assert.equal(first.data.familyId, 'docs');
  const confirmed = await send({ type: 'confirmRoute', envelope: firstEnvelope, expectedUrl: first.data.homepage }, routeSender);
  assert.equal(confirmed.data.status, 'ready');
  const sensitiveEnvelope = previewEnvelope(1, 'https://older-docs.com/account?token=synthetic');
  const sensitive = await send({ type: 'resolve', envelope: sensitiveEnvelope }, routeSender);
  assert.equal(sensitive.data.reason, 'manual'); assert.equal(sensitive.data.familyId, 'docs');
  const second = await send({ type: 'confirmRoute', envelope: sensitiveEnvelope, expectedUrl: sensitive.data.homepage }, routeSender);
  assert.equal(second.data.reason, 'loop', 'confirmation must not bypass an already-used family attempt');
  const retry = await send({type: 'retryRoute', envelope: sensitiveEnvelope, expectedUrl: second.data.homepage, retryToken: second.data.retryToken}, routeSender);
  assert.equal(retry.data.status, 'ready'); assert.equal(retry.data.url, 'https://current-docs.com/');
  const sibling = await send({type: 'resolve', envelope: firstEnvelope}, {...routeSender, documentId: 'new-sibling-gate'});
  assert.equal(sibling.data.reason, 'confirmation');
  const siblingConfirmed = await send({type: 'confirmRoute', envelope: firstEnvelope, expectedUrl: sibling.data.homepage}, {...routeSender, documentId: 'new-sibling-gate'});
  assert.equal(siblingConfirmed.data.reason, 'loop', 'deliberate recovery renews the guard across signed sibling aliases');
});
