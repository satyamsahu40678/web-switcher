import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {DiscoveryStore, StoreError} from './store.mjs';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const origin = label => `https://${label}.example.org`;
function fixture(t, limits = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'web-switcher-online-store-'));
  let time = Date.UTC(2026, 0, 2, 12);
  const options = {path: join(directory, 'state.sqlite'), now: () => time, limits};
  let store = new DiscoveryStore(options);
  t.after(() => { try {store.close();} catch {} rmSync(directory, {recursive: true, force: true}); });
  return {directory, options, get store() {return store;}, set time(value) {time = value;}, get time() {return time;}, advance(ms) {time += ms;}, reopen() {store.close(); store = new DiscoveryStore(options); return store;}};
}
const code = expected => error => error instanceof StoreError && error.code === expected;
const claim = (store, owner = A, source = origin('old')) => {
  const job = store.enqueue(owner, source), claimed = store.claim();
  assert.ok(claimed); assert.equal(claimed.job.id, job.id);
  return claimed;
};

test('jobs are authenticated-owner scoped, public-origin-only and deduplicated', t => {
  const f = fixture(t), job = f.store.enqueue(A, origin('old'));
  assert.equal(f.store.enqueue(A, origin('old')).id, job.id);
  assert.equal(f.store.get(A, job.id).sourceOrigin, origin('old'));
  assert.equal(f.store.get(B, job.id), null); assert.equal(f.store.cancel(B, job.id), null);
  assert.notEqual(f.store.enqueue(B, origin('old')).id, job.id);
  assert.throws(() => f.store.enqueue('raw bearer token', origin('old')), code('INVALID_OWNER'));
  for (const source of ['http://old.example.org', 'https://old.example.org/path', 'https://old.example.org?token=private', 'https://old.example.org#fragment', 'https://user:pass@old.example.org', 'https://127.0.0.1', 'https://localhost', 'https://router.local', 'https://old.example.org:8443']) {
    assert.throws(() => f.store.enqueue(A, source), code('INVALID_SOURCE'), source);
  }
});

test('actual SQLite restart preserves reservations, progress and expired-lease fencing', t => {
  const f = fixture(t), first = claim(f.store);
  assert.equal(f.store.reserve(first.job.id, first.leaseToken, {kind: 'search', bytes: 400}), true);
  assert.equal(f.store.checkpoint(first.job.id, first.leaseToken, {searchDone: true, leads: [{origin: origin('current')}]}), true);
  f.reopen(); f.advance(15001);
  const second = f.store.claim(); assert.equal(second.job.id, first.job.id); assert.equal(second.job.attempt, 2);
  assert.equal(second.job.searchCalls, 1); assert.equal(second.job.bytes, 400); assert.equal(second.job.activeMs, 15000);
  assert.equal(second.job.progress.searchDone, true);
  assert.notEqual(second.leaseToken, first.leaseToken);
  assert.equal(f.store.complete(first.job.id, first.leaseToken, {outcome: 'candidates'}), false);
  assert.equal(f.store.checkpoint(first.job.id, first.leaseToken, {malicious: true}), false);
  assert.equal(f.store.reserve(first.job.id, first.leaseToken, {kind: 'search'}), false);
  assert.equal(f.store.complete(second.job.id, second.leaseToken, {outcome: 'candidates', candidates: []}), true);
});

test('concurrency limit is shared by separate database handles and releases on cancellation', t => {
  const f = fixture(t), other = new DiscoveryStore(f.options);
  t.after(() => other.close());
  const one = f.store.enqueue(A, origin('one')), two = f.store.enqueue(B, origin('two')), three = f.store.enqueue(C, origin('three'));
  const first = f.store.claim(), second = other.claim();
  assert.equal(new Set([first.job.id, second.job.id]).size, 2); assert.equal(other.claim(), null);
  assert.equal(f.store.cancel(A, one.id).status, 'cancelled');
  const next = other.claim(); assert.equal(next.job.id, three.id);
  assert.equal(f.store.get(B, two.id).status, 'running');
});

test('same-timestamp jobs keep submission order after restart regardless of UUID lexical order', t => {
  const f = fixture(t), expected = ['ffffffff-ffff-4fff-afff-ffffffffffff', '88888888-8888-4888-a888-888888888888', '00000000-0000-4000-a000-000000000000'];
  for (let i = 0; i < expected.length; i++) {
    const job = f.store.enqueue(A, origin('fifo-' + i));
    // Fixed adversarial IDs make an ORDER BY random UUID defect reproducible.
    f.store.db.prepare('UPDATE jobs SET id=? WHERE id=?').run(expected[i], job.id);
  }
  f.reopen();
  for (const id of expected) {
    const next = f.store.claim(); assert.equal(next.job.id, id);
    assert.equal(f.store.cancel(A, id).status, 'cancelled');
  }
});

test('poll quota is durably shared and cannot be reset by restarting or guessing references', t => {
  const f = fixture(t, {pollsPerOwnerHour: 1, pollsPerHour: 2});
  assert.equal(f.store.admitPoll(A), true); f.reopen();
  assert.throws(() => f.store.admitPoll(A), code('BUDGET_EXCEEDED'));
  assert.equal(f.store.admitPoll(B), true);
  assert.throws(() => f.store.admitPoll(C), code('BUDGET_EXCEEDED'));
});

test('heartbeat charges durable active wall time and cannot renew beyond the active budget', t => {
  const f = fixture(t, {activeMs: 1000, leaseMs: 500, deadlineMs: 5000}), active = claim(f.store);
  f.advance(300); assert.equal(f.store.renew(active.job.id, active.leaseToken), true);
  assert.equal(f.store.get(A, active.job.id).activeMs, 300);
  f.advance(300); assert.equal(f.store.renew(active.job.id, active.leaseToken), true);
  f.advance(400); assert.equal(f.store.renew(active.job.id, active.leaseToken), false);
  const ended = f.store.get(A, active.job.id);
  assert.equal(ended.status, 'failed'); assert.equal(ended.reason, 'TIME_BUDGET_EXCEEDED'); assert.equal(ended.activeMs, 1000);
  assert.equal(f.store.complete(active.job.id, active.leaseToken, {outcome: 'candidates'}), false);
});

test('absolute deadline includes queue waiting and does not reset when reclaimed', t => {
  const f = fixture(t, {deadlineMs: 1000, leaseMs: 500}), queued = f.store.enqueue(A, origin('waiting'));
  f.advance(1001); assert.equal(f.store.claim(), null);
  assert.equal(f.store.get(A, queued.id).status, 'expired');
  const next = f.store.enqueue(A, origin('waiting')); assert.notEqual(next.id, queued.id);
  const active = f.store.claim(); f.advance(501); const recovered = f.store.claim();
  assert.equal(recovered.job.deadlineAt, next.deadlineAt);
  f.advance(500); assert.equal(f.store.renew(recovered.job.id, recovered.leaseToken), false);
  assert.equal(f.store.get(A, next.id).reason, 'JOB_DEADLINE_EXCEEDED');
  assert.equal(f.store.complete(active.job.id, active.leaseToken, {}), false);
});

test('cancellation defeats late completion, progress, spending and lease renewal', t => {
  const f = fixture(t), active = claim(f.store);
  assert.equal(f.store.setPhase(active.job.id, active.leaseToken, 'archive_index'), true);
  assert.equal(f.store.cancel(A, active.job.id).status, 'cancelled');
  assert.equal(f.store.complete(active.job.id, active.leaseToken, {outcome: 'candidates'}), false);
  assert.equal(f.store.fail(active.job.id, active.leaseToken, 'UPSTREAM_ERROR'), false);
  assert.equal(f.store.checkpoint(active.job.id, active.leaseToken, {completed: true}), false);
  assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'search', bytes: 1024}), false);
  assert.equal(f.store.renew(active.job.id, active.leaseToken), false);
  assert.equal(f.store.get(A, active.job.id).bytes, 0);
  assert.equal(f.store.get(A, active.job.id).reason, 'USER_CANCELLED');
});

test('per-job paid reservations remain consumed after process restart', t => {
  const f = fixture(t), active = claim(f.store);
  assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'search'}), true);
  assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'search'}), true);
  f.reopen(); f.advance(15001); const recovered = f.store.claim();
  assert.throws(() => f.store.reserve(recovered.job.id, recovered.leaseToken, {kind: 'search'}), code('BUDGET_EXCEEDED'));
  assert.equal(f.store.get(A, active.job.id).searchCalls, 2);
});

test('daily paid quotas survive maintenance, new hourly windows and actual restart', t => {
  const f = fixture(t, {searchCallsPerDay: 2, searchCallsPerHour: 10});
  for (const label of ['one', 'two']) {
    const active = claim(f.store, A, origin(label));
    assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'search'}), true);
    assert.equal(f.store.complete(active.job.id, active.leaseToken, {outcome: 'unknown'}), true);
  }
  f.advance(3600000); f.reopen(); f.store.prune();
  const third = claim(f.store, B, origin('three'));
  assert.throws(() => f.store.reserve(third.job.id, third.leaseToken, {kind: 'search'}), code('BUDGET_EXCEEDED'));
  assert.equal(f.store.get(B, third.job.id).searchCalls, 0);
  assert.equal(f.store.db.prepare("SELECT used FROM budgets WHERE bucket='search:global:day'").get().used, 2);
});

test('queue admission charges once per new job and cannot evade owner/global quotas', t => {
  const f = fixture(t, {queuedPerOwnerHour: 1, queuedPerHour: 2});
  const first = f.store.enqueue(A, origin('one'));
  assert.equal(f.store.enqueue(A, origin('one')).id, first.id);
  assert.throws(() => f.store.enqueue(A, origin('two')), code('BUDGET_EXCEEDED'));
  f.store.enqueue(B, origin('two'));
  assert.throws(() => f.store.enqueue(C, origin('three')), code('BUDGET_EXCEEDED'));
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count, 2);
});

test('byte reservations are atomic, bounded and never refunded on uncertain failure', t => {
  const f = fixture(t, {maxBytes: 1000}), active = claim(f.store);
  assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'archive_index', bytes: 600}), true);
  assert.equal(f.store.addBytes(active.job.id, active.leaseToken, 400), true);
  assert.throws(() => f.store.reserve(active.job.id, active.leaseToken, {kind: 'search', bytes: 1}), code('BYTE_BUDGET_EXCEEDED'));
  let state = f.store.get(A, active.job.id); assert.equal(state.bytes, 1000); assert.equal(state.searchCalls, 0);
  assert.throws(() => f.store.addBytes(active.job.id, active.leaseToken, 1), code('BYTE_BUDGET_EXCEEDED'));
  f.store.fail(active.job.id, active.leaseToken, 'PROVIDER_TIMEOUT');
  state = f.store.get(A, active.job.id); assert.equal(state.bytes, 1000); assert.equal(state.archiveIndexCalls, 1);
});

test('child web-request reservations cover robots and redirect expansion', t => {
  const f = fixture(t, {maxWebRequests: 10}), active = claim(f.store);
  assert.throws(() => f.store.reserve(active.job.id, active.leaseToken, {kind: 'fetcher', webRequests: 1}), code('INVALID_RESERVATION'));
  assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'fetcher'}), true);
  assert.equal(f.store.get(A, active.job.id).webRequests, 8);
  assert.throws(() => f.store.reserve(active.job.id, active.leaseToken, {kind: 'fetcher'}), code('BUDGET_EXCEEDED'));
  assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'archive_snapshot'}), true);
  assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'archive_snapshot'}), true);
  assert.throws(() => f.store.reserve(active.job.id, active.leaseToken, {kind: 'archive_snapshot'}), code('BUDGET_EXCEEDED'));
  assert.equal(f.store.get(A, active.job.id).webRequests, 10);
});

test('archive index and snapshot ceilings remain separate bounded pools', t => {
  const f = fixture(t), active = claim(f.store);
  for (let i = 0; i < 2; i++) assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'archive_index'}), true);
  for (let i = 0; i < 3; i++) assert.equal(f.store.reserve(active.job.id, active.leaseToken, {kind: 'archive_snapshot'}), true);
  assert.throws(() => f.store.reserve(active.job.id, active.leaseToken, {kind: 'archive_index'}), code('BUDGET_EXCEEDED'));
  assert.throws(() => f.store.reserve(active.job.id, active.leaseToken, {kind: 'archive_snapshot'}), code('BUDGET_EXCEEDED'));
});

test('result caches are owner-scoped, bounded and distinct for candidates/unknown/outage', t => {
  const f = fixture(t, {positiveCacheMs: 1000, negativeCacheMs: 500, unavailableCacheMs: 100});
  for (const [label, outcome, ttl] of [['positive', 'candidates', 1000], ['negative', 'unknown', 500], ['outage', 'unavailable', 100]]) {
    const active = claim(f.store, A, origin(label));
    assert.equal(f.store.complete(active.job.id, active.leaseToken, {outcome, candidates: []}), true);
    assert.equal(f.store.enqueue(A, origin(label)).id, active.job.id);
    assert.equal(f.store.get(A, active.job.id).cacheUntil, f.time + ttl);
    f.advance(ttl + 1);
    assert.notEqual(f.store.enqueue(A, origin(label)).id, active.job.id);
    // Remove that queued refresh so the next case's claim is deterministic.
    f.store.cancel(A, f.store.enqueue(A, origin(label)).id);
  }
});

test('repeated lease loss reaches the attempt ceiling without resetting elapsed budget', t => {
  const f = fixture(t, {leaseMs: 1000, deadlineMs: 10000, activeMs: 5000}), first = claim(f.store);
  for (let attempt = 2; attempt <= 3; attempt++) {
    f.advance(1001); const recovered = f.store.claim();
    assert.equal(recovered.job.id, first.job.id); assert.equal(recovered.job.attempt, attempt);
  }
  f.advance(1001); assert.equal(f.store.claim(), null);
  const job = f.store.get(A, first.job.id); assert.equal(job.status, 'failed'); assert.equal(job.reason, 'ATTEMPT_LIMIT'); assert.equal(job.activeMs, 3000);
});

test('clock rollback fails closed for running work and cached future results', t => {
  const f = fixture(t), first = claim(f.store);
  f.advance(-1); assert.equal(f.store.renew(first.job.id, first.leaseToken), false);
  assert.equal(f.store.get(A, first.job.id).reason, 'CLOCK_ANOMALY');
  f.advance(100); const second = claim(f.store, B, origin('second'));
  f.store.complete(second.job.id, second.leaseToken, {outcome: 'candidates'});
  f.advance(-1); const result = f.store.get(B, second.job.id);
  assert.equal(result.status, 'failed'); assert.equal(result.reason, 'CLOCK_ANOMALY'); assert.equal(result.result, null);
});

test('retention physically prunes jobs and capacity refuses unbounded growth', t => {
  const f = fixture(t, {jobTtlMs: 1000, maxJobs: 1});
  const first = f.store.enqueue(A, origin('one'));
  assert.throws(() => f.store.enqueue(B, origin('two')), code('QUEUE_CAPACITY'));
  f.advance(1001); f.store.prune(); assert.equal(f.store.get(A, first.id), null);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count, 0);
  assert.ok(f.store.enqueue(B, origin('two')).id);
});

test('backups are coherent SQLite snapshots with private file permissions', t => {
  const f = fixture(t), active = claim(f.store);
  f.store.reserve(active.job.id, active.leaseToken, {kind: 'search', bytes: 100});
  f.store.checkpoint(active.job.id, active.leaseToken, {searchDone: true});
  const saved = f.store.backup(join(f.directory, 'backups', 'snapshot.sqlite'));
  const recovered = new DiscoveryStore({...f.options, path: saved});
  try {
    assert.equal(recovered.health(), true); assert.equal(recovered.get(A, active.job.id).searchCalls, 1);
    assert.equal(recovered.get(A, active.job.id).progress.searchDone, true);
    assert.equal(statSync(saved).mode & 0o777, 0o600); assert.equal(statSync(f.options.path).mode & 0o777, 0o600);
  } finally { recovered.close(); }
});

test('unsupported schemas, impossible limits and oversized progress fail explicitly', t => {
  const f = fixture(t), active = claim(f.store);
  assert.throws(() => f.store.checkpoint(active.job.id, active.leaseToken, {huge: 'x'.repeat(256 * 1024)}), code('RECORD_TOO_LARGE'));
  assert.throws(() => f.store.setPhase(active.job.id, active.leaseToken, 'UNTRUSTED PHASE'), code('INVALID_PHASE'));
  assert.throws(() => new DiscoveryStore({path: ':memory:', limits: {maxSearchCalls: 3}}), code('INVALID_LIMIT'));
  const unsupported = join(f.directory, 'future.sqlite'), future = new DatabaseSync(unsupported);
  future.exec('PRAGMA user_version=99'); future.close();
  assert.throws(() => new DiscoveryStore({path: unsupported}), code('UNSUPPORTED_SCHEMA'));
});
