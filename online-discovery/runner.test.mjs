import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {DiscoveryStore} from './store.mjs';
import {DiscoveryRunner} from './runner.mjs';

const OWNER = 'a'.repeat(64), SOURCE = 'https://old.runner.org', TARGET = 'https://current.runner.net';
function fixture(t, limits = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'ws-online-runner-')); let now = Date.now();
  const options = {path: join(directory, 'state.sqlite'), now: () => now, limits};
  let store = new DiscoveryStore(options), runner;
  t.after(async () => {await runner?.close(); store.close(); rmSync(directory, {recursive: true, force: true});});
  const wait = async id => {
    for (let attempt = 0; attempt < 100; attempt++) {const job = store.get(OWNER, id); if (!['queued', 'running'].includes(job.status)) return job; await delay(5);}
    throw new Error('Runner did not complete the bounded job.');
  };
  return {get store() {return store;}, advance(ms) {now += ms;}, reopen() {store.close(); store = new DiscoveryStore(options);}, start(config) {runner = new DiscoveryRunner({store, archiveEnabled: false, braveKey: 'test-provider-key', now: () => now, pollMs: 5, ...config}); runner.start();}, wait};
}

test('a reclaimed phase resumes persisted search progress without paying for the same query again', async t => {
  const f = fixture(t), job = f.store.enqueue(OWNER, SOURCE), first = f.store.claim();
  f.store.reserve(job.id, first.leaseToken, {kind: 'search', bytes: 256 * 1024});
  f.store.checkpoint(job.id, first.leaseToken, {searchDone: true, leads: [{origin: TARGET, kind: 'search_result', sourceUrl: TARGET + '/', title: 'Previously observed public result'}]});
  f.reopen(); f.advance(15001); let calls = 0;
  f.start({request: async () => {calls++; throw new Error('No repeated query is permitted.');}});
  const completed = await f.wait(job.id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.result.candidates[0].origin, TARGET);
  assert.equal(completed.attempt, 2); assert.equal(completed.searchCalls, 1); assert.equal(calls, 0);
  assert.equal(f.store.complete(job.id, first.leaseToken, {}), false);
});

test('paid reservations consumed before a crash cannot reset when unfinished search is retried', async t => {
  const f = fixture(t), job = f.store.enqueue(OWNER, SOURCE), first = f.store.claim();
  f.store.reserve(job.id, first.leaseToken, {kind: 'search', bytes: 256 * 1024});
  f.store.reserve(job.id, first.leaseToken, {kind: 'search', bytes: 256 * 1024});
  f.reopen(); f.advance(15001); let calls = 0;
  f.start({request: async () => {calls++; throw new Error('The third query must never be dispatched.');}});
  const completed = await f.wait(job.id);
  assert.equal(completed.result.outcome, 'unavailable'); assert.equal(completed.searchCalls, 2); assert.equal(calls, 0);
  assert.ok(completed.result.reasonCodes.includes('BUDGET_EXCEEDED'));
});

test('the entire internal fetcher request tree is reserved before a parent request can begin', async t => {
  const f = fixture(t, {maxBytes: 1024 * 1024}), job = f.store.enqueue(OWNER, SOURCE), calls = [];
  f.start({fetcherUrl: 'http://fetcher.internal:8081', fetcherToken: 'a'.repeat(32), request: async url => {
    calls.push(url);
    assert.equal(new URL(url).origin, 'https://api.search.brave.com');
    return {status: 200, url, headers: {'content-type': 'application/json'}, body: JSON.stringify({type: 'search', web: {results: [{url: TARGET + '/'}]}})};
  }});
  const completed = await f.wait(job.id);
  assert.equal(completed.result.outcome, 'candidates'); assert.equal(completed.result.completeness, 'partial');
  assert.equal(completed.result.candidates[0].availability.state, 'not_checked');
  assert.ok(completed.result.reasonCodes.includes('BYTE_BUDGET_EXCEEDED'));
  assert.equal(calls.length, 1); assert.equal(completed.fetcherCalls, 0);
});
