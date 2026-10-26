// Live demo API contract and Java -> WebCrypto interoperability acceptance.
// Start backend with the explicit demo profile before running this test.
import assert from 'node:assert/strict';
import {writeFile, mkdir} from 'node:fs/promises';
import {verifyCatalog} from '../packages/security/catalog.mjs';
const base = process.env.API_BASE || 'http://127.0.0.1:8080';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Demo credentials may only be sent to loopback.');
const checks = [];
async function check(name, run) { await run(); checks.push({name, passed: true}); console.log(`PASS ${name}`); }
async function request(path, {method = 'GET', body, cookie, csrf, raw, headers = {}} = {}) {
  const response = await fetch(base + path, {signal: AbortSignal.timeout(15000), method, headers: {...(cookie ? {Cookie: cookie} : {}), ...(csrf ? {'X-CSRF-TOKEN': csrf} : {}), ...(body ? {'Content-Type': 'application/json'} : {}), ...headers}, body: raw ?? (body ? JSON.stringify(body) : undefined), redirect: 'manual'});
  const text = await response.text();
  return {status: response.status, headers: response.headers, text, json: text && response.headers.get('Content-Type')?.includes('json') ? JSON.parse(text) : null};
}
async function login(username) {
  const initial = await request('/v1/session');
  const cookie = initial.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const result = await request('/v1/admin/login', {method: 'POST', cookie, csrf: initial.json.csrfToken, raw: new URLSearchParams({username, password: 'demo-password'}).toString(), headers: {'Content-Type': 'application/x-www-form-urlencoded'}});
  assert.equal(result.status, 200, result.text);
  const newCookie = result.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') || cookie;
  const session = await request('/v1/session', {cookie: newCookie});
  assert(session.json.authenticated);
  return {cookie: newCookie, csrf: session.json.csrfToken};
}
let sequence, keys, firstCatalog, reviewer, publisher, candidate;
try {
  await check('database readiness responds from live Java process', async () => { assert.equal((await request('/health/ready')).json.status, 'UP'); });
  await check('Java ES256 raw JWS verifies using browser-compatible WebCrypto', async () => {
    const response = await request('/v1/keys');
    keys = Object.fromEntries(response.json.keys.map(key => [key.kid, key]));
    firstCatalog = await request('/v1/catalog/current'); assert.equal(firstCatalog.status, 200);
    const verified = await verifyCatalog(firstCatalog.text, {keys}); sequence = verified.sequence;
    assert(verified.catalog.aliases.some(alias => alias.sourceOrigin === 'https://old.web-switcher.test'));
  });
  await check('catalog ETag yields 304 and versioned bytes remain identical', async () => {
    assert.equal((await request('/v1/catalog/current', {headers: {'If-None-Match': firstCatalog.headers.get('ETag')}})).status, 304);
    assert.equal((await request(`/v1/catalog/${sequence}`)).text, firstCatalog.text);
  });
  await check('modified Java signature is rejected', async () => {
    const parts = firstCatalog.text.split('.');
    const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1; parts[2] = signature.toString('base64url');
    await assert.rejects(verifyCatalog(parts.join('.'), {keys}));
  });
  await check('public lookup accepts only a hostname and refuses a full URL', async () => {
    assert.equal((await request('/v1/lookups', {method: 'POST', body: {hostname: 'old.web-switcher.test'}})).json.status, 'verified');
    assert.equal((await request('/v1/lookups', {method: 'POST', body: {hostname: 'https://old.web-switcher.test/private?secret=value'}})).status, 400);
    assert.equal((await request('/v1/lookups', {method: 'POST', body: {hostname: 'unknown.web-switcher.test'}})).json.status, 'unknown');
  });
  await check('public report queues a candidate without changing signed routing', async () => {
    const report = await request('/v1/reports', {method: 'POST', body: {sourceHost: `old-${Date.now()}.web-switcher.test`, proposedHost: 'new.web-switcher.test', reason: 'Synthetic controlled test of review and publish separation.'}});
    assert.equal(report.status, 202); candidate = report.json.id;
    assert.equal((await request('/v1/catalog/current')).text, firstCatalog.text);
  });
  await check('admin routes require authentication; mutations also require CSRF', async () => {
    assert.equal((await request('/v1/admin/candidates')).status, 401);
    reviewer = await login('demo-reviewer');
    assert.equal((await request(`/v1/admin/candidates/${candidate}/decisions`, {method: 'POST', cookie: reviewer.cookie, body: {version: 0, decision: 'approved', reason: 'A controlled fixture, not real website ownership.'}})).status, 403);
  });
  await check('review uses optimistic concurrency and cannot publish', async () => {
    assert.equal((await request(`/v1/admin/candidates/${candidate}/decisions`, {method: 'POST', ...reviewer, body: {version: 0, decision: 'approved', reason: 'Controlled acceptance fixture demonstrates an independent review.'}})).status, 200);
    assert.equal((await request(`/v1/admin/candidates/${candidate}/decisions`, {method: 'POST', ...reviewer, body: {version: 0, decision: 'approved', reason: 'Stale optimistic version must not override current state.'}})).status, 409);
    assert.equal((await request('/v1/admin/releases', {method: 'POST', ...reviewer, body: {}})).status, 403);
    assert.equal((await request('/v1/catalog/current')).text, firstCatalog.text);
  });
  await check('independent publisher activates a monotonic immutable release', async () => {
    publisher = await login('demo-publisher');
    const response = await request('/v1/admin/releases', {method: 'POST', ...publisher, body: {}});
    assert.equal(response.status, 200, response.text);
    const compact = (await request('/v1/catalog/current')).text;
    const next = await verifyCatalog(compact, {keys}); assert(next.sequence > sequence);
    assert(next.catalog.aliases.length >= 2);
    assert.equal((await request(`/v1/catalog/${sequence}`)).text, firstCatalog.text);
  });
  await check('published revocation remains schema-valid and stops family routing', async () => {
    const result = await request('/v1/admin/families/demo-docs/revoke', {method: 'POST', ...publisher, body: {reason: 'Controlled revocation acceptance drill.'}});
    assert.equal(result.status, 200, result.text);
    const verified = await verifyCatalog((await request('/v1/catalog/current')).text, {keys});
    assert(verified.catalog.revocations.some(revocation => revocation.familyId === 'demo-docs'));
    assert(!verified.catalog.decisions.some(decision => decision.familyId === 'demo-docs'));
    assert.equal((await request('/v1/lookups', {method: 'POST', body: {hostname: 'old.web-switcher.test'}})).json.status, 'unknown');
  });
  await check('API rejects duplicate JSON keys and oversized bodies', async () => {
    assert.equal((await request('/v1/lookups', {method: 'POST', raw: '{"hostname":"old.test","hostname":"evil.test"}', headers: {'Content-Type': 'application/json'}})).status, 400);
    assert.equal((await request('/v1/lookups', {method: 'POST', body: {hostname: 'a'.repeat(40000)}})).status, 413);
  });
} catch (error) { checks.push({name: 'failure', passed: false, error: error.message}); console.error(error); process.exitCode = 1; }
await mkdir('test-results', {recursive: true});
await writeFile('test-results/http-demo.json', JSON.stringify({executedAt: new Date().toISOString(), base, checks, limitations: ['Uses synthetic demo data, loopback HTTP, and local throwaway demo identities.', 'Does not validate production OIDC, TLS, private egress, or external ownership.']}, null, 2) + '\n');
