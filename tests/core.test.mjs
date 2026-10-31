import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapping, validateConfig, originOf, compileRules, parseEnvelope, resolveRoute, loopDetected, advanceMappingGroup, importSettings} from '../extension/core.js';

const now = 1800000000000;
const mapping = (overrides = {}) => ({...createMapping({sourceOrigin: 'https://old-site.com', destinationOrigin: 'https://current-site.com', pathPolicy: 'preserve', durationHours: 24}, now, 'mapping-1'), ...overrides});
const config = (overrides = {}) => ({schemaVersion: 1, generation: 'generation-1', paused: false, mappings: [mapping()], ...overrides});
const envelope = source => ({generation: 'generation-1', mappingId: 'mapping-1', source});

test('ordinary public page keeps its encoded path, drops query and fragment', () => {
  const result = resolveRoute(config(), envelope('https://old-site.com/Docs/a%20b?q=hello#part'), now);
  assert.equal(result.status, 'ready');
  assert.equal(result.url, 'https://current-site.com/Docs/a%20b');
});
test('homepage policy does not claim to repair a deep link', () => {
  const result = resolveRoute(config({mappings: [mapping({pathPolicy: 'homepage'})]}), envelope('https://old-site.com/articles/42?q=x'), now);
  assert.equal(result.url, 'https://current-site.com/');
});
test('an unrelated source cannot use a valid mapping id', () => {
  for (const source of ['https://old-site.com.evil.org/page', 'https://sub.old-site.com/page', 'http://old-site.com/page', 'https://old-site.com:8443/page', 'https://evil.org/page']) {
    assert.equal(resolveRoute(config(), envelope(source), now).reason, 'invalid', source);
  }
});
test('URL credentials prevent automatic routing', () => {
  assert.equal(resolveRoute(config(), envelope('https://user:secret@old-site.com/page'), now).reason, 'invalid');
});
test('expiry is enforced at use time, including the exact boundary', () => {
  const current = config();
  const result = resolveRoute(current, envelope('https://old-site.com/page'), current.mappings[0].expiresAt);
  assert.equal(result.reason, 'expired');
});
test('clock reversal before mapping creation stops routing', () => {
  assert.equal(resolveRoute(config(), envelope('https://old-site.com/page'), now - 1).reason, 'expired');
});
test('global pause and per-mapping pause both stop the gate', () => {
  assert.equal(resolveRoute(config({paused: true}), envelope('https://old-site.com/page'), now).reason, 'paused');
  assert.equal(resolveRoute(config({mappings: [mapping({enabled: false})]}), envelope('https://old-site.com/page'), now).reason, 'paused');
});
test('old generation stops a gate opened during a configuration update', () => {
  assert.equal(resolveRoute(config({generation: 'next'}), envelope('https://old-site.com/page'), now).reason, 'changed');
});
test('unknown mapping id is refused', () => {
  assert.equal(resolveRoute(config(), {...envelope('https://old-site.com/page'), mappingId: 'missing'}, now).reason, 'unknown');
});
test('authentication and account paths pause for manual review', () => {
  for (const path of ['/oauth/callback', '/account/profile', '/password/reset', '/checkout', '/download', '/invoice.pdf']) {
    const result = resolveRoute(config(), envelope('https://old-site.com' + path), now);
    assert.equal(result.reason, 'manual', path);
    assert.equal(result.homepage, 'https://current-site.com/');
    assert.equal(result.url, undefined);
  }
});
test('sensitive query keys pause instead of forwarding a token', () => {
  for (const key of ['access_token', 'code', 'state', 'password', 'session']) {
    assert.equal(resolveRoute(config(), envelope(`https://old-site.com/page?${key}=synthetic`), now).reason, 'manual');
  }
});
test('encoded separators and authority-like paths pause for review', () => {
  for (const path of ['/x/%2Fencoded', '/x/%5cother', '//evil.org/page']) {
    assert.equal(resolveRoute(config(), envelope('https://old-site.com' + path), now).reason, 'manual', path);
  }
});
test('raw backslashes, whitespace and oversized input are refused', () => {
  for (const source of ['https://old-site.com/a\\b', 'https://old-site.com/a b', 'https://old-site.com/' + 'x'.repeat(8192)]) {
    assert.equal(resolveRoute(config(), envelope(source), now).reason, 'invalid');
  }
});
test('source envelope preserves encoded path and query delimiters', () => {
  const raw = 'https://old-site.com/a%26b?q=one&another=two#fragment';
  assert.deepEqual(parseEnvelope('#g=generation-1&m=mapping-1&source=' + raw), envelope(raw));
});
test('malformed or oversized gate envelopes are refused', () => {
  for (const hash of ['', '#source=https://old-site.com', '#g=x&m=y&target=https://evil.org', '#g=x&m=y&source=' + 'x'.repeat(8500)]) assert.throws(() => parseEnvelope(hash));
});
test('origin normalization handles IDNA and default HTTPS port', () => {
  assert.equal(originOf('https://münich.de'), 'https://xn--mnich-kva.de');
  assert.equal(originOf('https://OLD-SITE.com:443/'), 'https://old-site.com');
});
test('production target rejects HTTP, private IPs and reserved names', () => {
  for (const value of ['http://current-site.com', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://host.internal', 'https://old.test', 'https://old-site.com.', 'https://old-site.com:8443']) {
    assert.throws(() => originOf(value, {target: true}), value);
  }
});
test('origin fields cannot contain URLs with secrets or paths', () => {
  for (const value of ['https://old-site.com/page', 'https://old-site.com?token=x', 'https://old-site.com#x', 'https://user@old-site.com', 'https://old-site.com/a\\b']) assert.throws(() => originOf(value));
});
test('test origins require the explicit fixture flag', () => {
  assert.throws(() => originOf('http://old.test:7777'));
  assert.equal(originOf('http://old.test:7777', {allowTestOrigins: true}), 'http://old.test:7777');
  assert.throws(() => originOf('http://public-site.com', {target: true, allowTestOrigins: true}));
});
test('validity and schema are bounded', () => {
  for (const durationHours of [0, -1, 169, 1.5, 'NaN']) assert.throws(() => createMapping({sourceOrigin: 'https://old-site.com', destinationOrigin: 'https://current-site.com', pathPolicy: 'preserve', durationHours}, now, 'x'));
  assert.throws(() => validateConfig(config({generation: undefined})));
  assert.throws(() => validateConfig(config({mappings: [mapping({id: undefined})]})));
  assert.throws(() => validateConfig(config({mappings: [mapping({expiresAt: now + 1})]})));
});
test('duplicate sources and self redirects are refused', () => {
  assert.throws(() => validateConfig(config({mappings: [mapping(), mapping({id: 'other'})]})));
  assert.throws(() => validateConfig(config({mappings: [mapping({destinationOrigin: 'https://old-site.com'})]})));
});
test('manual chains and cycles must be flattened by the user', () => {
  const first = mapping();
  const second = mapping({id: 'next', sourceOrigin: 'https://current-site.com', destinationOrigin: 'https://final-site.com'});
  assert.throws(() => validateConfig(config({mappings: [first, second]})));
  assert.throws(() => validateConfig(config({mappings: [first, {...second, destinationOrigin: 'https://old-site.com'}]})));
});
test('multiple historical origins may share a current destination', () => {
  assert.doesNotThrow(() => validateConfig(config({mappings: [mapping(), mapping({id: 'second', sourceOrigin: 'https://older-site.com'})]})));
});
test('following future destination moves is an explicit local mapping option', () => {
  const input = {sourceOrigin: 'https://old-site.com', destinationOrigin: 'https://current-site.com', pathPolicy: 'preserve', durationHours: 24};
  assert.equal(createMapping({...input, followDestination: true}, now, 'follow-1').followOrigin, 'https://current-site.com');
  for (const followDestination of [false, undefined]) assert.equal(Object.hasOwn(createMapping({...input, followDestination}, now, 'static-1'), 'followOrigin'), false);
  for (const followDestination of ['true', 1, null, {}]) assert.throws(() => createMapping({...input, followDestination}, now, 'bad-1'));
});
const grouped = (overrides = {}) => mapping({followOrigin: 'https://current-site.com', ...overrides});
test('all old aliases and former current domains advance together through later moves', () => {
  const initial = config({mappings: [grouped(), grouped({id: 'older-1', sourceOrigin: 'https://older-site.com', pathPolicy: 'homepage'})]});
  const original = structuredClone(initial);
  const next = advanceMappingGroup(initial, 'https://current-site.com', 'https://current-site.com', 'https://next-site.com', now + 1000, 'derived-current');
  assert.deepEqual(initial, original, 'A proposed group advancement does not mutate the committed configuration.');
  assert.deepEqual(next.mappings.map(item => item.sourceOrigin), ['https://old-site.com', 'https://older-site.com', 'https://current-site.com']);
  assert.ok(next.mappings.every(item => item.destinationOrigin === 'https://next-site.com' && item.followOrigin === 'https://current-site.com'));
  assert.deepEqual(next.mappings.slice(0, 2), original.mappings.map(item => ({...item, destinationOrigin: 'https://next-site.com'})));
  const latest = advanceMappingGroup(next, 'https://current-site.com', 'https://next-site.com', 'https://latest-site.com', now + 2000, 'derived-next');
  assert.ok(latest.mappings.every(item => item.destinationOrigin === 'https://latest-site.com'));
  assert.equal(latest.mappings.at(-1).sourceOrigin, 'https://next-site.com');
  assert.equal(latest.mappings.at(-1).createdAt, initial.mappings[0].createdAt);
  assert.equal(latest.mappings.at(-1).expiresAt, initial.mappings[0].expiresAt);
  const result = resolveRoute(latest, envelope('https://old-site.com/download-invincible-hindi-dubbed-series/?public=yes#part'), now + 2000);
  assert.equal(result.url, 'https://latest-site.com/download-invincible-hindi-dubbed-series/');
});
test('group advancement does not reactivate paused or expired members or extend consent', () => {
  const paused = grouped({id: 'paused-1', sourceOrigin: 'https://paused-site.com', enabled: false});
  const expired = grouped({id: 'expired-1', sourceOrigin: 'https://expired-site.com', createdAt: now - 7200000, expiresAt: now - 3600000});
  const initial = config({mappings: [grouped(), paused, expired]});
  const next = advanceMappingGroup(initial, 'https://current-site.com', 'https://current-site.com', 'https://next-site.com', now, 'derived-current');
  assert.deepEqual(next.mappings[1], {...paused, destinationOrigin: 'https://next-site.com'});
  assert.deepEqual(next.mappings[2], {...expired, destinationOrigin: 'https://next-site.com'});
  assert.equal(next.mappings[0].expiresAt, initial.mappings[0].expiresAt);
  assert.equal(resolveRoute(next, {...envelope('https://paused-site.com/article'), mappingId: paused.id}, now).reason, 'paused');
  assert.equal(resolveRoute(next, {...envelope('https://expired-site.com/article'), mappingId: expired.id}, now).reason, 'expired');
  assert.throws(() => advanceMappingGroup(config({paused: true, mappings: [grouped()]}), 'https://current-site.com', 'https://current-site.com', 'https://next-site.com', now, 'no-consent'));
  assert.throws(() => advanceMappingGroup(config({mappings: [paused, expired]}), 'https://current-site.com', 'https://current-site.com', 'https://next-site.com', now, 'no-consent'));
});
test('group pointers cannot diverge or inherit registry provenance', () => {
  assert.throws(() => validateConfig(config({mappings: [grouped(), grouped({id: 'older-1', sourceOrigin: 'https://older-site.com', destinationOrigin: 'https://other-site.com'})]})));
  for (const followOrigin of ['http://current-site.com', 'https://current-site.com/private', undefined]) assert.throws(() => validateConfig(config({mappings: [grouped({followOrigin})]})));
  assert.throws(() => validateConfig(config({mappings: [grouped({provenance: 'registry'})]})));
});
test('shared destination moves reject stale pointers, cycles and unrelated manual chains atomically', () => {
  const initial = config({mappings: [grouped(), grouped({id: 'older-1', sourceOrigin: 'https://older-site.com'})]});
  const copy = structuredClone(initial);
  for (const destination of ['https://old-site.com', 'https://older-site.com', 'http://next-site.com', 'https://127.0.0.1']) assert.throws(() => advanceMappingGroup(initial, 'https://current-site.com', 'https://current-site.com', destination, now, 'derived-current'));
  assert.throws(() => advanceMappingGroup(initial, 'https://current-site.com', 'https://stale-site.com', 'https://next-site.com', now, 'derived-current'));
  assert.throws(() => advanceMappingGroup(initial, 'https://missing-group.com', 'https://current-site.com', 'https://next-site.com', now, 'derived-current'));
  const staticSource = mapping({id: 'static-1', sourceOrigin: 'https://static-site.com', destinationOrigin: 'https://next-site.com'});
  assert.throws(() => advanceMappingGroup(config({mappings: [...initial.mappings, staticSource]}), 'https://current-site.com', 'https://current-site.com', 'https://static-site.com', now, 'derived-current'));
  const staticDependency = mapping({id: 'static-2', sourceOrigin: 'https://static-site.com'});
  const mixed = config({mappings: [...initial.mappings, staticDependency]});
  assert.throws(() => advanceMappingGroup(mixed, 'https://current-site.com', 'https://current-site.com', 'https://next-site.com', now, 'derived-current'), /Chained mappings/);
  assert.equal(mixed.mappings.at(-1).destinationOrigin, 'https://current-site.com', 'A group update must not change an unrelated static mapping.');
  assert.deepEqual(initial, copy);
});
test('unchanged current destinations do not add aliases or mutate configuration', () => {
  const initial = config({mappings: [grouped()]});
  const checked = advanceMappingGroup(initial, 'https://current-site.com', 'https://current-site.com', 'https://current-site.com', now, 'unused-id');
  assert.deepEqual(checked, initial); assert.notEqual(checked, initial);
});
test('following another move cannot exceed the local alias limit', () => {
  const initial = config({mappings: Array.from({length: 50}, (_, index) => grouped({id: `alias-${index}`, sourceOrigin: `https://old-${index}.com`}))});
  const copy = structuredClone(initial);
  assert.throws(() => advanceMappingGroup(initial, 'https://current-site.com', 'https://current-site.com', 'https://next-site.com', now, 'derived-current'), /50 local mappings/);
  assert.deepEqual(initial, copy);
});
test('portable follow groups round-trip as local decisions while forged authority stays rejected', () => {
  const initial = config({mappings: [grouped(), grouped({id: 'older-1', sourceOrigin: 'https://older-site.com'})]});
  const portable = {schemaVersion: 1, paused: initial.paused, mappings: initial.mappings};
  assert.deepEqual(importSettings(JSON.parse(JSON.stringify(portable)), 'restored-generation'), {...initial, generation: 'restored-generation'});
  for (const extra of [{familyId: 'signed-family'}, {trustClass: 'owner_verified'}, {provenance: 'registry'}]) {
    assert.throws(() => importSettings({...portable, mappings: [{...grouped(), ...extra}]}, 'restored-generation'));
  }
});
test('rules require a live enabled mapping and explicit source grant', () => {
  const gate = 'chrome-extension://fixture/route.html';
  assert.equal(compileRules(config(), gate, new Set(), now).length, 0);
  assert.equal(compileRules(config({paused: true}), gate, new Set(['https://old-site.com']), now).length, 0);
  assert.equal(compileRules(config(), gate, new Set(['https://old-site.com']), now + 86400000).length, 0);
});
test('compiled rule matches exact origin and only top-level GET requests', () => {
  const [rule] = compileRules(config(), 'chrome-extension://fixture/route.html', new Set(['https://old-site.com']), now);
  const match = new RegExp(rule.condition.regexFilter, 'i');
  assert.equal(match.test('https://old-site.com/page'), true);
  assert.equal(match.test('https://old-siteXcom/page'), false);
  assert.equal(match.test('https://old-site.com.evil.org/page'), false);
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  assert.deepEqual(rule.condition.requestMethods, ['get']);
  assert.equal(rule.action.redirect.regexSubstitution, 'chrome-extension://fixture/route.html#g=generation-1&m=mapping-1&source=\\0');
});
test('loop guard blocks repeated or clock-reversed attempts, then releases', () => {
  assert.equal(loopDetected(undefined, now), false);
  assert.equal(loopDetected(now, now), true);
  assert.equal(loopDetected(now + 1, now), true);
  assert.equal(loopDetected(now - 15000, now), false);
});
