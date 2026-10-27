// Small, bounded local catalog/cache concurrency check. It never benchmarks a
// public deployment and does not turn a synthetic result into a production SLO.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {verifyCatalog} from '../packages/security/catalog.mjs';
const base = new URL(process.env.API_BASE || 'http://127.0.0.1:8088');
assert(['localhost', '127.0.0.1'].includes(base.hostname) && ['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'Use an isolated loopback demo origin.');
const count = Number(process.env.CATALOG_SAMPLE_REQUESTS || 128), concurrency = Number(process.env.CATALOG_SAMPLE_CONCURRENCY || 8);
assert(Number.isInteger(count) && count >= 16 && count <= 500 && Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 16, 'Supported bounds are16–500 requests and1–16 concurrent clients.');
const get = (path, options = {}) => fetch(new URL(path, base), {redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000), ...options});
const session = await get('/v1/session'); assert.equal(session.status, 200); assert.equal((await session.json()).demo, true, 'This sampler refuses a production instance.');
const response = await get('/v1/catalog/current'); assert.equal(response.status, 200);
const compact = await response.text(), etag = response.headers.get('ETag'); assert(etag);
const keyResponse = await get('/v1/keys'); assert.equal(keyResponse.status, 200);
const keys = Object.fromEntries((await keyResponse.json()).keys.map(key => [key.kid, key]));
const verified = await verifyCatalog(compact, {keys});
let cursor = 0;
const samples = [], failures = [], statuses = {};
const started = performance.now();
await Promise.all(Array.from({length: concurrency}, async () => {
  for (;;) {
    const index = cursor++; if (index >= count) return;
    const conditional = index % 2 === 1, before = performance.now();
    try {
      const result = await get('/v1/catalog/current', conditional ? {headers: {'If-None-Match': etag}} : {});
      const body = await result.text(); assert.equal(result.status, conditional ? 304 : 200);
      assert.equal(body, conditional ? '' : compact, 'Concurrent reads must return the same complete immutable publication.');
      assert.equal(result.headers.get('ETag'), etag);
      statuses[result.status] = (statuses[result.status] || 0) + 1;
      samples.push(performance.now() - before);
    } catch (error) { failures.push({index, detail: error.message}); }
  }
}));
const elapsedMs = performance.now() - started;
samples.sort((a, b) => a - b);
const percentile = fraction => samples.length ? Math.round(samples[Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)] * 100) / 100 : null;
const report = {executedAt: new Date().toISOString(), base: base.origin, requests: count, concurrency, passed: samples.length, failures, statuses, sequence: verified.sequence, elapsedMs: Math.round(elapsedMs), requestsPerSecond: Math.round(samples.length / elapsedMs * 1000), p50Ms: percentile(.5), p95Ms: percentile(.95), limitations: ['Synthetic loopback fixture and bounded catalog/cache reads only.', 'No production capacity, regional availability, paid-provider quota or public deployment SLO claim.']};
await mkdir('test-results', {recursive: true});
await writeFile('test-results/catalog-concurrency.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({...report, failures: failures.length}, null, 2));
assert.equal(failures.length, 0, 'Some concurrent catalog reads failed; inspect the current result JSON.');
assert.equal(samples.length, count, 'Every scheduled sample must complete.');
