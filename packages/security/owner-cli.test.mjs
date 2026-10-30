import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ownerSiteId } from './owner-cli.mjs';

const cli = fileURLToPath(new URL('./owner-cli.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('offline CLI creates private files exclusively, signs, and verifies an owner genesis', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'web-switcher-owner-test-'));
  try {
    const privatePath = join(directory, 'private.json'); const publicPath = join(directory, 'public.json');
    const generated = run(['keygen', privatePath, publicPath]);
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal((await stat(privatePath)).mode & 0o777, 0o600);
    const privateBytes = await readFile(privatePath, 'utf8'); const publicJwk = JSON.parse(await readFile(publicPath, 'utf8'));
    assert.equal(Object.hasOwn(publicJwk, 'd'), false);
    assert.equal(generated.stdout.includes(JSON.parse(privateBytes).d), false);
    assert.notEqual(run(['keygen', privatePath, publicPath]).status, 0);
    assert.equal(await readFile(privatePath, 'utf8'), privateBytes);
    const payload = {
      schemaVersion: 1, siteId: await ownerSiteId(publicJwk), sequence: 1, previousRecordHash: null,
      issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
      currentOrigins: ['https://current.test'], retiredOrigins: ['https://old.test'], pathPolicy: { type: 'homepage' }, queryPolicy: { type: 'drop' }, fragmentPolicy: 'drop', keyId: 'owner-1',
    };
    const payloadPath = join(directory, 'payload.json'); const signedPath = join(directory, 'record.jws');
    await writeFile(payloadPath, JSON.stringify(payload));
    const signed = run(['sign', payloadPath, privatePath, 'owner-1', signedPath]); assert.equal(signed.status, 0, signed.stderr);
    const verified = run(['verify', signedPath, publicPath, 'owner-1']); assert.equal(verified.status, 0, verified.stderr);
    const checkpoint = JSON.parse(verified.stdout); assert.equal(checkpoint.siteId, payload.siteId); assert.equal(checkpoint.sequence, 1);
    assert.notEqual(run(['sign', payloadPath, privatePath, 'owner-1', signedPath]).status, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
