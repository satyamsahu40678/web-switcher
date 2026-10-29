import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, statSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {DiscoveryStore} from './store.mjs';
import {backupDiscoveryDatabase} from './backup.mjs';

test('a coherent private backup includes committed WAL state, owner data and spent reservations', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ws-online-backup-')), path = join(directory, 'state.sqlite'), output = join(directory, 'backup.sqlite');
  const store = new DiscoveryStore({path});
  t.after(() => {store.close(); rmSync(directory, {recursive: true, force: true});});
  const owner = 'a'.repeat(64), job = store.enqueue(owner, 'https://retired.backup.org'), claim = store.claim();
  store.reserve(job.id, claim.leaseToken, {kind: 'search', bytes: 256 * 1024});
  store.checkpoint(job.id, claim.leaseToken, {searchDone: true, leads: []});
  assert.equal(backupDiscoveryDatabase(path, output), output);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  const restored = new DiscoveryStore({path: output});
  try {
    const row = restored.get(owner, job.id);
    assert.equal(row.sourceOrigin, 'https://retired.backup.org'); assert.equal(row.searchCalls, 1); assert.equal(row.bytes, 256 * 1024); assert.equal(row.progress.searchDone, true);
    assert.equal(restored.get('b'.repeat(64), job.id), null);
  } finally {restored.close();}
  assert.throws(() => backupDiscoveryDatabase(path, output), /already exists/);
  assert.throws(() => backupDiscoveryDatabase(path, path), /distinct/);
});

test('missing or unsupported databases cannot be silently replaced with an empty successful backup', t => {
  const directory = mkdtempSync(join(tmpdir(), 'ws-online-backup-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const output = join(directory, 'backup.sqlite');
  assert.throws(() => backupDiscoveryDatabase(join(directory, 'missing.sqlite'), output)); assert.equal(existsSync(output), false);
  const source = join(directory, 'unsupported.sqlite'), db = new DatabaseSync(source); db.exec('PRAGMA user_version=99'); db.close();
  assert.throws(() => backupDiscoveryDatabase(source, output), /UNSUPPORTED_SCHEMA/); assert.equal(existsSync(output), false);
});
