import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { combineConfig, resolveWithCatalog } from '../extension/catalog-adapter.js';
import { createMapping, compileRules } from '../extension/core.js';
import { verifyCatalog, encodeBase64Url } from '../packages/security/catalog.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const empty = () => ({ schemaVersion: 1, generation: 'adapter-generation', paused: false, mappings: [] });
function payload() {
  return {
    schemaVersion: 1, bundleSequence: 1, issuedAt: '2026-10-26T11:00:00Z', expiresAt: '2026-10-26T17:00:00Z', minClientVersion: '0.2.0', policyVersion: 1,
    families: [{ id: 'library', name: 'Library documentation' }], aliases: [{ familyId: 'library', sourceOrigin: 'https://old-library.com' }],
    decisions: [{ familyId: 'library', destinationOrigin: 'https://current-library.com', trustClass: 'registry_reviewed', validUntil: '2026-10-26T16:00:00Z', pathPolicy: { type: 'preserve', publicPrefixes: ['/docs/'] }, reasonCodes: ['REVIEWED_CONTINUITY'], requiresConfirmation: false }], revocations: [],
  };
}
async function accepted(modify = () => {}) {
  const catalog = payload(); modify(catalog);
  const encode = value => encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  const input = `${encode({ alg: 'ES256', typ: 'web-switcher-catalog+jws', kid: 'adapter-test-1' })}.${encode(catalog)}`;
  const signature = sign('sha256', Buffer.from(input), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return (await verifyCatalog(`${input}.${encodeBase64Url(signature)}`, { keys: { 'adapter-test-1': keys.publicKey.export({ format: 'jwk' }) }, now: NOW })).catalog;
}
const envelope = (source = 'https://old-library.com/docs/Guide%20One?lang=en#section') => ({ generation: 'adapter-generation', mappingId: 'registry-0', source });

test('a signature-verified registry alias routes only its exact origin and approved public prefix', async () => {
  const catalog = await accepted(); const config = combineConfig(empty(), catalog);
  const result = resolveWithCatalog(config, envelope(), NOW, catalog);
  assert.equal(result.status, 'ready'); assert.equal(result.url, 'https://current-library.com/docs/Guide%20One');
  assert.equal(resolveWithCatalog(config, envelope('https://old-library.com.evil.org/docs/start'), NOW, catalog).reason, 'invalid');
  assert.equal(resolveWithCatalog(config, envelope('https://sub.old-library.com/docs/start'), NOW, catalog).reason, 'invalid');
});
test('unknown path structure offers the homepage rather than pretending to repair a deep link', async () => {
  const catalog = await accepted(); const config = combineConfig(empty(), catalog);
  for (const path of ['/private/page', '/docs-other/page', '/docs']) {
    const result = resolveWithCatalog(config, envelope('https://old-library.com' + path), NOW, catalog);
    assert.equal(result.reason, 'manual', path); assert.equal(result.homepage, 'https://current-library.com/'); assert.equal(result.url, undefined);
  }
});
test('literal public prefix replacement keeps encoded path/case and drops query/fragment', async () => {
  const catalog = await accepted(value => { value.decisions[0].pathPolicy = { type: 'prefix_replace', fromPrefix: '/docs/', toPrefix: '/reference/' }; });
  const config = combineConfig(empty(), catalog);
  const result = resolveWithCatalog(config, envelope(), NOW, catalog); assert.equal(result.url, 'https://current-library.com/reference/Guide%20One');
  assert.equal(resolveWithCatalog(config, envelope('https://old-library.com/articles/start'), NOW, catalog).reason, 'manual');
});
test('registry confirmation preview binds the exact cleaned and transformed destination', async () => {
  const catalog = await accepted(value => { value.decisions[0].requiresConfirmation = true; value.decisions[0].pathPolicy = { type: 'prefix_replace', fromPrefix: '/docs/', toPrefix: '/reference/' }; });
  const config = combineConfig(empty(), catalog); const result = resolveWithCatalog(config, envelope(), NOW, catalog);
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'confirmation'); assert.equal(result.homepage, 'https://current-library.com/reference/Guide%20One'); assert.equal(result.url, undefined);
});
test('signed approval does not bypass sensitive-route or token confirmation', async () => {
  const catalog = await accepted(value => { value.decisions[0].pathPolicy = { type: 'preserve', publicPrefixes: ['/'] }; });
  const config = combineConfig(empty(), catalog);
  for (const source of ['https://old-library.com/oauth/callback?code=synthetic', 'https://old-library.com/account', 'https://old-library.com/docs/file.pdf', 'https://old-library.com/docs/%2fencoded']) {
    const result = resolveWithCatalog(config, envelope(source), NOW, catalog); assert.equal(result.reason, 'manual'); assert.equal(result.homepage, 'https://current-library.com/'); assert.equal(result.url, undefined);
  }
});
test('an explicit local override wins without inheriting registry trust or path policy', async () => {
  const catalog = await accepted(value => { value.decisions[0].requiresConfirmation = true; });
  const local = empty(); local.mappings.push(createMapping({ sourceOrigin: 'https://old-library.com', destinationOrigin: 'https://my-library.com', pathPolicy: 'homepage', durationHours: 24 }, NOW - 1000, 'local-mapping-1'));
  const prior = structuredClone(local); const config = combineConfig(local, catalog);
  assert.deepEqual(local, prior); assert.equal(config.mappings.length, 1);
  const result = resolveWithCatalog(config, { ...envelope(), mappingId: 'local-mapping-1' }, NOW, catalog);
  assert.equal(result.status, 'ready'); assert.equal(result.url, 'https://my-library.com/');
});
test('a local ID resembling generated registry IDs cannot acquire registry provenance', async () => {
  const catalog = await accepted(value => { value.decisions[0].requiresConfirmation = true; });
  const local = empty(); local.mappings.push(createMapping({ sourceOrigin: 'https://old-library.com', destinationOrigin: 'https://my-library.com', pathPolicy: 'homepage', durationHours: 24 }, NOW - 1000, 'registry-0'));
  const config = combineConfig(local, catalog);
  const result = resolveWithCatalog(config, envelope(), NOW, catalog);
  assert.equal(result.status, 'ready'); assert.equal(result.url, 'https://my-library.com/');
});
test('family-wide signed revocation removes routing while preserving public family history', async () => {
  const catalog = await accepted(value => { value.decisions = []; value.revocations = [{ familyId: 'library', revokedAt: '2026-10-26T11:30:00Z', reason: 'Conflicting ownership evidence' }]; });
  const config = combineConfig(empty(), catalog); assert.equal(config.mappings.length, 0); assert.equal(catalog.families.length, 1);
  assert.equal(resolveWithCatalog(config, envelope(), NOW, catalog).reason, 'unknown');
});
test('registry support still requires selected source permission and respects global pause', async () => {
  const catalog = await accepted(); const config = combineConfig(empty(), catalog);
  const gate = 'chrome-extension://fixture/route.html';
  assert.equal(compileRules(config, gate, new Set(), NOW).length, 0);
  assert.equal(compileRules(config, gate, new Set(['https://old-library.com']), NOW).length, 1);
  config.paused = true; assert.equal(compileRules(config, gate, new Set(['https://old-library.com']), NOW).length, 0);
  assert.equal(resolveWithCatalog(config, envelope(), NOW, catalog).reason, 'paused');
});
test('fresh catalog or local state cannot extend a decision beyond its own expiry', async () => {
  const catalog = await accepted(); const config = combineConfig(empty(), catalog);
  const decisionExpiry = Date.parse(catalog.decisions[0].validUntil);
  assert.equal(config.mappings[0].expiresAt, decisionExpiry);
  assert.equal(resolveWithCatalog(config, envelope(), decisionExpiry, catalog).reason, 'expired');
});
test('short-lived signed decisions are supported without weakening local mapping validity bounds', async () => {
  const catalog = await accepted(value => {
    value.issuedAt = '2026-10-26T11:59:00Z'; value.expiresAt = '2026-10-26T12:01:00Z'; value.decisions[0].validUntil = '2026-10-26T12:00:30Z';
  });
  const config = combineConfig(empty(), catalog);
  assert.equal(resolveWithCatalog(config, envelope(), NOW, catalog).status, 'ready');
  assert.equal(resolveWithCatalog(config, envelope(), NOW + 30_000, catalog).reason, 'expired');
  assert.throws(() => createMapping({ sourceOrigin: 'https://old-library.com', destinationOrigin: 'https://current-library.com', pathPolicy: 'homepage', durationHours: 0.5 }, NOW, 'local-short'));
});
