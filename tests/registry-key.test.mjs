import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, statSync, chmodSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createPrivateKey, sign} from 'node:crypto';
import {verifyCatalog} from '../packages/security/catalog.mjs';
const run = (...args) => spawnSync(process.execPath, ['scripts/registry-key.mjs', ...args], {encoding: 'utf8'});

test('publisher PKCS8 tooling creates protected keys and signs browser-compatible ES256 catalogs', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'web-switcher-publisher-'));
  try {
    const generated = run('generate', '--directory', directory, '--kid', 'registry-2026');
    assert.equal(generated.status, 0, generated.stderr);
    const summary = JSON.parse(generated.stdout), privateFile = path.join(directory, 'publisher-private.pk8');
    assert.equal(statSync(privateFile).mode & 0o777, 0o600);
    const bytes = readFileSync(privateFile); assert(!generated.stdout.includes(bytes.toString('base64')));
    assert.equal(summary.keyId, 'registry-2026'); assert(summary.publicThumbprint);
    const checked = run('check', '--private', privateFile, '--trust', path.join(directory, 'registry-trust-anchors.json'), '--kid', 'registry-2026');
    assert.equal(checked.status, 0, checked.stderr); assert.equal(JSON.parse(checked.stdout).verified, true);
    const now = Date.now(), payload = {schemaVersion: 1, bundleSequence: 1, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), minClientVersion: '0.2.0', policyVersion: 1, families: [], aliases: [], decisions: [], revocations: []};
    const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const content = enc({alg: 'ES256', typ: 'web-switcher-catalog+jws', kid: 'registry-2026'}) + '.' + enc(payload);
    const key = createPrivateKey({key: bytes, format: 'der', type: 'pkcs8'});
    const jws = content + '.' + sign('sha256', Buffer.from(content), {key, dsaEncoding: 'ieee-p1363'}).toString('base64url');
    assert.equal((await verifyCatalog(jws, {keys: JSON.parse(readFileSync(path.join(directory, 'registry-trust-anchors.json')))})).sequence, 1);
    assert.equal(readFileSync(privateFile).compare(bytes), 0);
    const again = run('generate', '--directory', directory, '--kid', 'replacement');
    assert.notEqual(again.status, 0); assert.equal(readFileSync(privateFile).compare(bytes), 0, 'generation must never replace an existing identity');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('publisher check refuses loose permissions and mismatched public trust', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'web-switcher-publisher-'));
  try {
    assert.equal(run('generate', '--directory', directory, '--kid', 'registry').status, 0);
    const file = path.join(directory, 'publisher-private.pk8'), trust = path.join(directory, 'registry-trust-anchors.json');
    chmodSync(file, 0o644); assert.notEqual(run('check', '--private', file, '--trust', trust, '--kid', 'registry').status, 0);
    chmodSync(file, 0o600); const data = JSON.parse(readFileSync(trust)); data.registry.x = Buffer.alloc(32).toString('base64url'); writeFileSync(trust, JSON.stringify(data));
    assert.notEqual(run('check', '--private', file, '--trust', trust, '--kid', 'registry').status, 0);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
