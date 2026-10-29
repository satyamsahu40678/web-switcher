import test from 'node:test';
import assert from 'node:assert/strict';
import {createInternetTransport} from '../extension/internet-transport.js';

const ORIGIN = 'https://archive.example.org', URL = ORIGIN + '/wayback/available?url=https%3A%2F%2Fold.example.com%2F';
const TOKEN = 'synthetic_operator_invite_token_for_fixture_only';
const opaque = () => ({status: 0, url: '', redirected: false, body: null});
function fixture({permission = true} = {}) {
  const listeners = [];
  const chrome = {
    runtime: {getURL: path => 'chrome-extension://fixture/' + path},
    permissions: {async contains() {return permission;}},
    webRequest: {onHeadersReceived: {addListener(fn) {listeners.push(fn);}, removeListener(fn) {const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1);}}}
  };
  const emit = (values = {}) => listeners.forEach(fn => fn({url: URL, requestId: 'request-one', initiator: 'chrome-extension://fixture', tabId: -1, type: 'xmlhttprequest', method: 'GET', statusCode: 200, responseHeaders: [{name: 'Content-Type', value: 'application/json'}], ...values}));
  return {chrome, emit, listeners};
}
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}

test('manual opaque redirects wait for late correlated headers and never fetch a successor', async () => {
  const f = fixture(), calls = [];
  const request = createInternetTransport(f.chrome, {fetchImpl: async (url, options) => {
    calls.push({url, options});
    setTimeout(() => f.emit({statusCode: 302, responseHeaders: [{name: 'Location', value: 'https://next.example.net/'}, {name: 'x-archive-orig-location', value: 'https://current.example.com/'}]}), 5);
    return opaque();
  }});
  const response = await request(URL, {allowedOrigins: [ORIGIN]});
  assert.equal(response.status, 302); assert.equal(response.headers.location, 'https://next.example.net/');
  assert.equal(response.headers['x-archive-orig-location'], 'https://current.example.com/');
  assert.equal(response.body, ''); assert.equal(calls.length, 1); assert.equal(calls[0].options.redirect, 'manual');
  request.dispose(); assert.equal(f.listeners.length, 0);
});

test('successful JSON also waits for its matching callback and exposes no cookie headers', async () => {
  const f = fixture();
  const request = createInternetTransport(f.chrome, {fetchImpl: async () => {
    setTimeout(() => f.emit({responseHeaders: [{name: 'Content-Type', value: 'application/json'}, {name: 'Set-Cookie', value: 'secret=never-return'}, {name: 'Refresh', value: '0;url=https://current.example.com/'}]}), 5);
    return new Response('{"archived_snapshots":{}}', {headers: {'Content-Type': 'application/json'}});
  }});
  const response = await request(URL, {allowedOrigins: [ORIGIN]});
  assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.body), {archived_snapshots: {}});
  assert.equal(response.headers.refresh, '0;url=https://current.example.com/');
  assert.equal(JSON.stringify(response.headers).includes('never-return'), false); request.dispose();
});

test('unrelated browsing, initiators, methods, URLs and request IDs cannot satisfy a provider request', async () => {
  const f = fixture(), fetched = deferred(), controller = new AbortController();
  const request = createInternetTransport(f.chrome, {fetchImpl: async () => {
    // Bind this request ID with an informational response, then reject an event
    // belonging to a different underlying request to the same URL.
    f.emit({statusCode: 100});
    for (const changes of [{initiator: 'https://hostile.example.com'}, {tabId: 7}, {type: 'main_frame'}, {method: 'POST'}, {url: ORIGIN + '/different'}, {requestId: 'another-request'}]) f.emit({statusCode: 302, responseHeaders: [{name: 'Location', value: 'https://attacker.example.com/'}], ...changes});
    fetched.resolve(); return opaque();
  }});
  let settled = false;
  const work = request(URL, {allowedOrigins: [ORIGIN], signal: controller.signal}).finally(() => {settled = true;});
  await fetched.promise; await new Promise(setImmediate); assert.equal(settled, false);
  controller.abort(); await assert.rejects(work, /CANCELLED/); request.dispose();
});

test('origin allowlists, browser grants and unsafe URL forms are checked before fetch', async () => {
  for (const [url, allowedOrigins, permission, reason] of [
    [URL, [], true, 'PROVIDER_URL_FORBIDDEN'],
    [URL, [ORIGIN], false, 'PROVIDER_PERMISSION_REQUIRED'],
    ['https://user:pass@archive.example.org/path', [ORIGIN], true, 'PROVIDER_URL_FORBIDDEN'],
    [ORIGIN + '/path#private', [ORIGIN], true, 'PROVIDER_URL_FORBIDDEN'],
    ['http://archive.example.org/path', ['http://archive.example.org'], true, 'PROVIDER_URL_FORBIDDEN'],
    ['ftp://archive.example.org/path', ['ftp://archive.example.org'], true, 'PROVIDER_URL_FORBIDDEN']
  ]) {
    const f = fixture({permission}); let fetches = 0;
    const request = createInternetTransport(f.chrome, {fetchImpl: async () => {fetches++; return opaque();}});
    await assert.rejects(request(url, {allowedOrigins}), new RegExp(reason)); assert.equal(fetches, 0); request.dispose();
  }
});

test('service bearer goes only to the configured requested origin with cookies and referrer omitted', async () => {
  const f = fixture(), calls = [];
  const request = createInternetTransport(f.chrome, {fetchImpl: async (url, options) => {
    calls.push({url, options});
    f.emit({method: 'POST', statusCode: 307, responseHeaders: [{name: 'Location', value: 'https://outside.example.com/steal'}]});
    return opaque();
  }});
  const response = await request(URL, {method: 'POST', json: {hostname: 'old.example.com'}, accessToken: TOKEN, allowedOrigins: [ORIGIN]});
  assert.equal(response.status, 307); assert.equal(calls.length, 1); assert.equal(calls[0].url, URL);
  const {options} = calls[0];
  assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN); assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), {hostname: 'old.example.com'});
  assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'manual'); assert.equal(options.signal.aborted, true); request.dispose();
});

test('conflicting response headers and unexpected automatic transport redirects are refused', async () => {
  for (const name of ['Location', 'Refresh', 'x-archive-orig-location']) for (const first of ['https://one.example.com/', '']) {
    const f = fixture();
    const request = createInternetTransport(f.chrome, {fetchImpl: async () => {
      f.emit({responseHeaders: [{name, value: first}, {name: name.toLowerCase(), value: 'https://two.example.com/'}]});
      return new Response('{}');
    }});
    await assert.rejects(request(URL, {allowedOrigins: [ORIGIN]}), /AMBIGUOUS_PROVIDER_HEADERS/); request.dispose();
  }
  const f = fixture();
  const request = createInternetTransport(f.chrome, {fetchImpl: async () => ({status: 200, redirected: true, url: 'https://outside.example.com/', body: null})});
  await assert.rejects(request(URL, {allowedOrigins: [ORIGIN]}), /PROVIDER_REDIRECT_FORBIDDEN/); request.dispose();
});

test('response byte limits and invalid credential/body requests fail without accepting content', async () => {
  const f = fixture(); let fetches = 0;
  const request = createInternetTransport(f.chrome, {fetchImpl: async () => {fetches++; f.emit(); return new Response('x'.repeat(256 * 1024 + 1));}});
  await assert.rejects(request(URL, {allowedOrigins: [ORIGIN]}), /PROVIDER_RESPONSE_TOO_LARGE/);
  assert.equal(fetches, 1);
  await assert.rejects(request(URL, {allowedOrigins: [ORIGIN], method: 'POST', accessToken: TOKEN + '\n'}), /INVALID_SERVICE_TOKEN/);
  await assert.rejects(request(URL, {allowedOrigins: [ORIGIN], method: 'POST', json: {body: 'x'.repeat(4096)}}), /INVALID_PROVIDER_REQUEST/);
  assert.equal(fetches, 1, 'Invalid requests must be refused before their provider fetch.'); request.dispose();
});

test('caller cancellation interrupts a hung body reader, cancels it and frees the pending slot', async () => {
  const f = fixture(), reading = deferred(), controller = new AbortController(); let cancelled = false, attempt = 0;
  const request = createInternetTransport(f.chrome, {fetchImpl: async () => {
    f.emit();
    if (++attempt > 1) return new Response('{}');
    return {status: 200, url: URL, redirected: false, body: {getReader: () => ({read() {reading.resolve(); return new Promise(() => {});}, async cancel() {cancelled = true;}})}};
  }});
  const work = request(URL, {allowedOrigins: [ORIGIN], signal: controller.signal});
  await reading.promise; controller.abort(); await assert.rejects(work, /CANCELLED/); assert.equal(cancelled, true);
  const retry = await request(URL, {allowedOrigins: [ORIGIN]}); assert.equal(retry.body, '{}'); request.dispose();
});
