import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { parseStrictJson, encodeBase64Url, decodeBase64Url, validateCatalog, verifyCatalog, verifyPassport } from './catalog.mjs';
import { ownerSiteId, signPassport } from './owner-cli.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = keys.publicKey.export({ format: 'jwk' });
const trusted = { 'demo-registry-1': jwk };
const encode = value => encodeBase64Url(new TextEncoder().encode(value));
function catalog() {
  return {
    schemaVersion: 1, bundleSequence: 3, issuedAt: '2026-10-26T11:00:00Z', expiresAt: '2026-10-26T17:00:00Z', minClientVersion: '0.2.0', policyVersion: 1,
    families: [{ id: 'demo-docs', name: 'Demo documentation' }],
    aliases: [{ sourceOrigin: 'https://old.web-switcher.test', familyId: 'demo-docs' }],
    decisions: [{ familyId: 'demo-docs', destinationOrigin: 'https://current.web-switcher.test', trustClass: 'registry_reviewed', validUntil: '2026-10-26T16:00:00Z', pathPolicy: { type: 'preserve', publicPrefixes: ['/docs/'] }, reasonCodes: ['REVIEWED_CONTINUITY'], requiresConfirmation: true }], revocations: [],
  };
}
function signed(payload = catalog(), header = { alg: 'ES256', typ: 'web-switcher-catalog+jws', kid: 'demo-registry-1' }) {
  const input = `${encode(typeof header === 'string' ? header : JSON.stringify(header))}.${encode(typeof payload === 'string' ? payload : JSON.stringify(payload))}`;
  return `${input}.${encodeBase64Url(sign('sha256', Buffer.from(input), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }))}`;
}
const verify = (record, extra = {}) => verifyCatalog(record, { keys: trusted, now: NOW, ...extra });

test('strict parser preserves JSON values without invoking __proto__ setters', () => {
  assert.deepEqual(parseStrictJson('{"a":[true,false,null,1,-2.5e3,"x\\\"y"]}'), { a: [true, false, null, 1, -2500, 'x"y'] });
  const parsed = parseStrictJson('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal({}.polluted, undefined);
});
test('strict parser rejects duplicate keys including escaped and nested keys', () => {
  for (const value of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"safe":[{"x":1,"x":2}]}']) assert.throws(() => parseStrictJson(value), /Duplicate/);
});
test('strict parser rejects malformed, trailing, oversized and deep JSON', () => {
  for (const value of ['', 'null null', '{"a":1,}', '[1,]', '01', '1e9999', '"\\x"', '"\n"']) assert.throws(() => parseStrictJson(value));
  assert.throws(() => parseStrictJson('"1234"', { maxBytes: 3 }), /size/);
  assert.throws(() => parseStrictJson('[[[[0]]]]', { maxDepth: 2 }), /nesting/);
});
test('base64url decoder accepts canonical bytes and refuses padding/alternate encodings', () => {
  assert.deepEqual([...decodeBase64Url('_w')], [255]);
  for (const value of ['_w==', '/w', '_x', 'a', 'a b', '']) assert.throws(() => decodeBase64Url(value));
});
test('Node IEEE P1363 signing is verified by Web Crypto over original encoded bytes', async () => {
  const result = await verify(signed());
  assert.equal(result.sequence, 3); assert.equal(result.acceptedAt, NOW); assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.catalog, catalog());
});
test('modified payload and modified signature both fail', async () => {
  const record = signed(); const parts = record.split('.');
  parts[1] = encode(JSON.stringify({ ...catalog(), bundleSequence: 4 }));
  await assert.rejects(verify(parts.join('.')), /signature/);
  parts[1] = record.split('.')[1]; const signature = decodeBase64Url(parts[2]); signature[0] ^= 1; parts[2] = encodeBase64Url(signature);
  await assert.rejects(verify(parts.join('.')), /signature/);
});
test('unknown keys, private keys, unsupported algorithms and record types fail', async () => {
  await assert.rejects(verify(signed(), { keys: {} }), /Unknown signing key/);
  await assert.rejects(verify(signed(), { keys: { 'demo-registry-1': keys.privateKey.export({ format: 'jwk' }) } }), /public P-256/);
  for (const header of [
    { alg: 'none', typ: 'web-switcher-catalog+jws', kid: 'demo-registry-1' },
    { alg: 'ES256', typ: 'web-switcher-passport+jws', kid: 'demo-registry-1' },
    { alg: 'ES256', typ: 'web-switcher-catalog+jws', kid: 'demo-registry-1', jku: 'https://attacker.test/key' },
    { alg: 'ES256', typ: 'web-switcher-catalog+jws', kid: 'demo-registry-1', crit: ['exp'] },
  ]) await assert.rejects(verify(signed(catalog(), header)));
});
test('even valid signatures cannot authorize duplicate JSON keys', async () => {
  const payload = JSON.stringify(catalog()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  await assert.rejects(verify(signed(payload)), /Duplicate/);
  await assert.rejects(verify(signed(catalog(), '{"alg":"ES256","typ":"web-switcher-catalog+jws","kid":"demo-registry-1","kid":"demo-registry-1"}')), /Duplicate/);
});
test('catalog rollback and same-sequence equivocation fail; immutable reread succeeds', async () => {
  const record = signed(); const checkpoint = await verify(record);
  const again = await verify(record, { previous: checkpoint }); assert.equal(again.digest, checkpoint.digest);
  await assert.rejects(verify(signed(), { previous: checkpoint }), /equivocation/);
  const old = catalog(); old.bundleSequence = 2;
  await assert.rejects(verify(signed(old), { previous: checkpoint }), /rollback/);
  const next = catalog(); next.bundleSequence = 4;
  assert.equal((await verify(signed(next), { previous: checkpoint })).sequence, 4);
});
test('clock rollback is not concealed by a fresh signature', async () => {
  const record = signed(); const checkpoint = await verify(record);
  await assert.rejects(verify(signed(), { previous: { ...checkpoint, acceptedAt: NOW + 600_000 } }), /Clock rollback/);
  const smallRollback = await verify(record, { now: NOW - 240_000, previous: checkpoint });
  assert.equal(smallRollback.acceptedAt, NOW);
  await assert.rejects(verify(record, { now: NOW - 480_000, previous: smallRollback }), /Clock rollback/);
});
test('catalog expiry, future issue, overlong lifespan and impossible date fail', () => {
  for (const changes of [
    { expiresAt: '2026-10-26T12:00:00Z' }, { issuedAt: '2026-10-26T12:06:00Z' },
    { expiresAt: '2026-10-28T12:00:00Z' }, { issuedAt: '2026-02-30T11:00:00Z' },
  ]) assert.throws(() => validateCatalog({ ...catalog(), ...changes }, { now: NOW }));
});
test('closed schemas and future policy/client requirements fail', () => {
  for (const changes of [{ policyVersion: 2 }, { schemaVersion: 2 }, { minClientVersion: '0.3.0' }, { minClientVersion: '0.2.0-beta' }, { executablePolicy: 'alert(1)' }, { bundleSequence: 1.5 }]) assert.throws(() => validateCatalog({ ...catalog(), ...changes }, { now: NOW }));
  const altered = catalog(); altered.families[0].extra = true; assert.throws(() => validateCatalog(altered, { now: NOW }), /Unknown family/);
});
test('origins cannot introduce credentials, insecure schemes, ports, paths or lookalike serialization', () => {
  for (const sourceOrigin of ['http://old.test', 'https://user:pass@old.test', 'https://old.test:8443', 'https://old.test/', 'https://old.test/path', 'https://old.test?token=x', 'https://old.test#x', 'https://old.test.', 'https://OLD.test', 'https://127.0.0.1', 'https://localhost', 'https://[::1]', 'https://old.test\\evil']) {
    const value = catalog(); value.aliases[0].sourceOrigin = sourceOrigin; assert.throws(() => validateCatalog(value, { now: NOW }), sourceOrigin);
  }
});
test('duplicate aliases and family ambiguity fail', () => {
  const value = catalog(); value.aliases.push({ ...value.aliases[0] });
  assert.throws(() => validateCatalog(value, { now: NOW }), /Duplicate or conflicting/);
  value.aliases.pop(); value.decisions.push({ ...value.decisions[0] });
  assert.throws(() => validateCatalog(value, { now: NOW }), /duplicate decision/);
});
test('cycles and uncompressed chains cannot become browser redirects', () => {
  const value = catalog(); value.decisions[0].destinationOrigin = value.aliases[0].sourceOrigin;
  assert.throws(() => validateCatalog(value, { now: NOW }), /cycle or nonterminal/);
  value.families.push({ id: 'other', name: 'Other' }); value.aliases.push({ familyId: 'other', sourceOrigin: 'https://next.test' });
  value.decisions.push({ ...value.decisions[0], familyId: 'other', destinationOrigin: 'https://terminal.test' }); value.decisions[0].destinationOrigin = 'https://next.test';
  assert.throws(() => validateCatalog(value, { now: NOW }), /nonterminal/);
});
test('expired/outliving decisions and unsigned trust upgrades fail', () => {
  for (const changes of [{ validUntil: '2026-10-26T12:00:00Z' }, { validUntil: '2026-10-26T18:00:00Z' }, { trustClass: 'local_manual' }, { requiresConfirmation: 'false' }]) {
    const value = catalog(); Object.assign(value.decisions[0], changes); assert.throws(() => validateCatalog(value, { now: NOW }));
  }
});
test('path policies allow only bounded literal directory transformations', () => {
  for (const pathPolicy of [{ type: 'homepage' }, { type: 'prefix_replace', fromPrefix: '/old/', toPrefix: '/new/' }]) {
    const value = catalog(); value.decisions[0].pathPolicy = pathPolicy; assert.doesNotThrow(() => validateCatalog(value, { now: NOW }));
  }
  for (const pathPolicy of [{ type: 'regex', expression: '.*' }, { type: 'preserve', publicPrefixes: ['/docs'] }, { type: 'preserve', publicPrefixes: ['//attacker/'] }, { type: 'preserve', publicPrefixes: ['/x/../'] }, { type: 'preserve', publicPrefixes: ['/%2f/'] }, { type: 'preserve', publicPrefixes: ['/%2e%2e/'] }]) {
    const value = catalog(); value.decisions[0].pathPolicy = pathPolicy; assert.throws(() => validateCatalog(value, { now: NOW }));
  }
});
test('revocation release keeps alias evidence but cannot retain an active decision', () => {
  const value = catalog(); value.revocations = [{ familyId: 'demo-docs', revokedAt: '2026-10-26T11:30:00Z', reason: 'Identity conflict' }];
  assert.throws(() => validateCatalog(value, { now: NOW }), /Revoked family/);
  value.decisions = []; assert.doesNotThrow(() => validateCatalog(value, { now: NOW }));
});
test('catalog maximum alias budget fails before rule compilation', () => {
  const value = catalog(); value.aliases = Array.from({ length: 201 }, (_, index) => ({ sourceOrigin: `https://old${index}.test`, familyId: 'demo-docs' }));
  assert.throws(() => validateCatalog(value, { now: NOW }), /aliases count/);
});

async function passport() {
  return {
    schemaVersion: 1, siteId: await ownerSiteId(jwk), sequence: 1, previousRecordHash: null,
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    currentOrigins: ['https://current.test'], retiredOrigins: ['https://old.test'], pathPolicy: { type: 'homepage' }, queryPolicy: { type: 'drop' }, fragmentPolicy: 'drop', keyId: 'owner-1',
  };
}
test('owner record is a distinct signature context and requires enrolled owner key', async () => {
  const payload = await passport(); const record = signPassport(payload, keys.privateKey.export({ format: 'jwk' }), 'owner-1');
  const verified = await verifyPassport(record, { keys: { 'owner-1': jwk } }); assert.equal(verified.siteId, payload.siteId);
  await assert.rejects(verifyCatalog(record, { keys: { 'owner-1': jwk } }), /record type/);
  await assert.rejects(verifyPassport(record, { keys: {} }), /Unknown signing key/);
});
test('owner history binds exact previous record and genesis identity', async () => {
  const first = await passport(); const key = keys.privateKey.export({ format: 'jwk' });
  const checkpoint = await verifyPassport(signPassport(first, key, 'owner-1'), { keys: { 'owner-1': jwk } });
  const next = { ...first, sequence: 2, previousRecordHash: checkpoint.digest };
  const record = signPassport(next, key, 'owner-1');
  assert.equal((await verifyPassport(record, { keys: { 'owner-1': jwk }, previous: checkpoint })).sequence, 2);
  await assert.rejects(verifyPassport(record, { keys: { 'owner-1': jwk } }), /history checkpoint/);
  await assert.rejects(verifyPassport(record, { keys: { 'owner-1': jwk }, previous: { ...checkpoint, digest: '0'.repeat(64) } }), /history/);
});
test('a first owner record cannot claim a different enrolled genesis identity', async () => {
  const payload = await passport(); payload.siteId = `urn:webswitcher:site:${'x'.repeat(43)}`;
  const record = signPassport(payload, keys.privateKey.export({ format: 'jwk' }), 'owner-1');
  await assert.rejects(verifyPassport(record, { keys: { 'owner-1': jwk } }), /genesis identity/);
});
