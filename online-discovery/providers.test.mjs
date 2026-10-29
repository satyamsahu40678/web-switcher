import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHttpRequester, createBraveSearch, createFetcherObserver, ProviderError} from './providers.mjs';

const SOURCE = 'https://old.example.org';
const CURRENT = 'https://current.example.net';
const TOKEN = 'provider-fixture-token-never-a-live-secret';
const json = body => ({status: 200, headers: {'content-type': 'application/json; charset=utf-8'}, body: JSON.stringify(body)});
const code = expected => error => error instanceof ProviderError && error.code === expected;

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));});
  const request = createHttpRequester({proxyEnv: {}});
  t.after(() => request.close());
  return {server, request, url: `http://127.0.0.1:${server.address().port}`};
}

test('transport preserves manual redirects without visiting their destination or draining their body', async t => {
  let destinationRequests = 0;
  const f = await fixture(t, (req, res) => {
    if (req.url === '/destination') {destinationRequests++; res.end('never fetch'); return;}
    res.writeHead(302, {Location: '/destination'}); res.write('x'.repeat(4096));
  });
  const result = await f.request(f.url + '/redirect', {maxBytes: 16, headers: {'X-Subscription-Token': TOKEN}});
  assert.equal(result.status, 302); assert.equal(result.headers.location, '/destination');
  assert.equal(result.body, ''); assert.equal(result.bytes, 0); assert.equal(destinationRequests, 0);
});

test('transport rejects declared, streamed and encoded over-budget responses', async t => {
  const f = await fixture(t, (req, res) => {
    if (req.url === '/declared') {res.writeHead(200, {'Content-Length': '1000'}); res.end('x');}
    else if (req.url === '/stream') {res.writeHead(200); res.write('x'.repeat(17)); res.end();}
    else {res.writeHead(200, {'Content-Encoding': 'gzip'}); res.end('compressed data is not decoded');}
  });
  for (const path of ['/declared', '/stream', '/encoded']) await assert.rejects(f.request(f.url + path, {maxBytes: 16}), code('PROVIDER_RESPONSE_LIMIT'));
});

test('transport refuses invalid UTF-8 rather than parsing replacement text', async t => {
  const f = await fixture(t, (_req, res) => {res.end(Buffer.from([0xc3, 0x28]));});
  await assert.rejects(f.request(f.url + '/'), code('INVALID_PROVIDER_ENCODING'));
});

test('transport caller cancellation and per-request deadlines terminate hung responses', async t => {
  const f = await fixture(t, (_req, _res) => {});
  await assert.rejects(f.request(f.url + '/timeout', {timeoutMs: 20}), code('PROVIDER_TIMEOUT'));
  const controller = new AbortController();
  const work = f.request(f.url + '/cancel', {signal: controller.signal}); controller.abort();
  await assert.rejects(work, code('PROVIDER_TIMEOUT'));
});

test('transport uses the supplied native proxy configuration instead of silently going direct', async t => {
  let seen;
  const proxy = await fixture(t, (req, res) => {seen = {url: req.url, host: req.headers.host}; res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"proxied":true}');});
  const request = createHttpRequester({proxyEnv: {HTTP_PROXY: proxy.url}}); t.after(() => request.close());
  const result = await request('http://provider.test/controlled-fixture?selected=1');
  assert.equal(result.body, '{"proxied":true}');
  assert.equal(seen.url, 'http://provider.test/controlled-fixture?selected=1'); assert.equal(seen.host, 'provider.test');
});

test('transport rejects credentialed URLs, fragments, excessive limits and arbitrary methods before networking', async () => {
  const request = createHttpRequester({proxyEnv: {}});
  try {
    for (const [url, options] of [
      ['http://user:pass@127.0.0.1/', {}], ['http://127.0.0.1/#fragment', {}], ['file:///tmp/test', {}],
      ['http://127.0.0.1/', {maxBytes: 1048577}], ['http://127.0.0.1/', {timeoutMs: 32001}],
      ['http://127.0.0.1/', {method: 'CONNECT'}], ['http://127.0.0.1/', {body: 'unexpected'}],
      ['http://127.0.0.1/', {method: 'POST', body: 'a'.repeat(4097)}]
    ]) await assert.rejects(request(url, options), code('INVALID_PROVIDER_REQUEST'));
  } finally {request.close();}
});

test('unconfigured search spends no request and reports its missing provider', async () => {
  let requests = 0;
  const search = createBraveSearch({request: async () => {requests++;}});
  assert.equal(search.configured, false);
  assert.deepEqual(await search.search(SOURCE), {leads: [], reasonCodes: ['SEARCH_NOT_CONFIGURED'], completeness: 'partial'});
  assert.equal(requests, 0);
});

test('Brave search derives only a hostname query, sends the key to its fixed API and returns unverified leads', async () => {
  const calls = [];
  const search = createBraveSearch({apiKey: TOKEN, request: async (url, options) => {
    calls.push({url, options});
    return json({type: 'search', web: {results: [{url: CURRENT + '/public-announcement?tracking=discard#section', title: '<b>Current site</b>', description: 'Public index lead'}]}});
  }});
  const result = await search.search(SOURCE + '/account?token=private-original#fragment');
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://api.search.brave.com'); assert.equal(url.pathname, '/res/v1/web/search');
  assert.equal(url.searchParams.get('q'), '"old.example.org"'); assert.equal(url.searchParams.get('count'), '10');
  assert.equal(calls[0].options.headers['X-Subscription-Token'], TOKEN);
  assert.equal(calls[0].options.maxBytes, 256 * 1024);
  assert.equal(JSON.stringify(calls).includes('private-original'), false);
  assert.equal(result.leads[0].origin, CURRENT); assert.equal(result.leads[0].sourceUrl, CURRENT + '/public-announcement');
  assert.equal(result.leads[0].title, 'Current site'); assert.equal(result.leads[0].kind, 'search_result');
  assert.equal('navigation' in result.leads[0], false); assert.equal('identityClass' in result.leads[0], false);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('poisoned search URLs and provider replay pages never become current candidates', async () => {
  const urls = [SOURCE, 'https://127.0.0.1/', 'https://router.local/', 'https://user:secret@current.example.net/', 'https://current.example.net:8443/', 'javascript:alert(1)', 'http://untrusted.example.net/', 'https://web.archive.org/web/20260101000000/https://old.example.org/', 'https://search.brave.com/redirect?q=old', CURRENT];
  const search = createBraveSearch({apiKey: TOKEN, request: async () => json({web: {results: urls.map(url => ({url, title: 'matching logo', description: 'same content'}))}})});
  const result = await search.search(SOURCE);
  assert.deepEqual(result.leads.map(lead => lead.origin), [CURRENT]);
  assert.equal(result.leads[0].kind, 'search_result');
});

test('search quota, credentials and redirects fail explicitly without retrying or forwarding the key', async () => {
  for (const [status, reason] of [[401, 'SEARCH_CREDENTIAL_REJECTED'], [403, 'SEARCH_CREDENTIAL_REJECTED'], [429, 'SEARCH_QUOTA_REACHED'], [302, 'SEARCH_UNAVAILABLE'], [503, 'SEARCH_UNAVAILABLE']]) {
    let calls = 0;
    const search = createBraveSearch({apiKey: TOKEN, request: async () => {calls++; return {status, headers: {location: 'https://attacker.example.org/'}, body: ''};}});
    await assert.rejects(search.search(SOURCE), code(reason)); assert.equal(calls, 1);
  }
});

test('malformed, duplicated, oversized or wrong-type search envelopes fail as unavailable evidence', async () => {
  for (const response of [
    {status: 200, headers: {'content-type': 'text/html'}, body: '<html>challenge</html>'},
    {status: 200, headers: {'content-type': 'application/json'}, body: '{"web":{},"web":{}}'},
    {status: 200, headers: {'content-type': 'application/json'}, body: '{"web":{"results":[]}}garbage'},
    {status: 200, headers: {'content-type': 'application/json'}, body: ' '.repeat(256 * 1024 + 1)},
    json(null), json([]), json({}), json({error: 'provider failure'}), json({web: []}), json({web: {results: {}}}), json({web: {results: Array(101).fill({})}})
  ]) {
    const search = createBraveSearch({apiKey: TOKEN, request: async () => response});
    await assert.rejects(search.search(SOURCE), code('INVALID_SEARCH_RESPONSE'));
  }
});

test('a real empty search response remains distinct from provider failure', async () => {
  for (const payload of [{type: 'search'}, {web: {results: []}}]) {
    const search = createBraveSearch({apiKey: TOKEN, request: async () => json(payload)});
    assert.deepEqual(await search.search(SOURCE), {leads: [], reasonCodes: ['NO_SEARCH_LEADS'], completeness: 'complete'});
  }
});

const stamp = Date.UTC(2026, 9, 29, 12);
function resolution() {
  return {classification: 'REACHABLE', httpStatus: 200, finalOrigin: CURRENT, hops: [{origin: SOURCE, status: 302}, {origin: CURRENT, status: 200}], chain: [{sourceOrigin: SOURCE, destinationOrigin: CURRENT, kind: 'HTTP_REDIRECT', httpStatus: 302}], hints: [], bytes: 12, sha256: 'a'.repeat(64), checkedAt: new Date(stamp).toISOString(), identity: 'UNVERIFIED', threatStatus: 'UNKNOWN'};
}
function observer(payload, override = {}) {
  return createFetcherObserver({url: 'http://fetcher.internal:8081', token: TOKEN, now: () => stamp, request: async () => json(payload), ...override});
}

test('fetcher is optional but partial/credentialed configuration is rejected', () => {
  assert.equal(createFetcherObserver(), null);
  for (const options of [{url: 'https://fetcher.example.org'}, {token: TOKEN}, {url: 'https://user:pass@fetcher.example.org', token: TOKEN}, {url: 'https://fetcher.example.org/path', token: TOKEN}, {url: 'https://fetcher.example.org?target=arbitrary', token: TOKEN}, {url: 'https://fetcher.example.org#path', token: TOKEN}]) assert.throws(() => createFetcherObserver(options));
});

test('fetcher request goes only to the configured internal resolve endpoint and remains unverified', async () => {
  let seen;
  const check = observer(resolution(), {request: async (url, options) => {seen = {url, options}; return json(resolution());}});
  const result = await check(SOURCE);
  assert.equal(seen.url, 'http://fetcher.internal:8081/resolve'); assert.equal(seen.options.headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(JSON.parse(seen.options.body), {url: SOURCE + '/'});
  assert.equal(seen.options.maxBytes, 65536); assert.equal(seen.options.timeoutMs, 32000);
  assert.deepEqual(result, {state: 'reachable', checkedAt: stamp, vantage: 'server', terminalOrigin: CURRENT});
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('fetcher redirect/meta edges must bind the source, intermediate statuses and terminal exactly', async () => {
  const payload = resolution(); payload.hops[0].status = 200; payload.chain[0].kind = 'META_REFRESH'; payload.chain[0].httpStatus = 200;
  assert.equal((await observer(payload)(SOURCE)).state, 'reachable');
  const mutations = [
    value => {value.hops[0].origin = CURRENT;}, value => {value.hops.at(-1).origin = SOURCE;}, value => {value.chain = [];},
    value => {value.chain[0].destinationOrigin = SOURCE;}, value => {value.chain[0].sourceOrigin = CURRENT;},
    value => {value.chain[0].httpStatus = 307;}, value => {value.chain[0].kind = 'CANONICAL_HINT';},
    value => {value.hops[0].status = 200;}, value => {value.hops.at(-1).status = 404;},
    value => {value.hops[0].trusted = true;}, value => {value.chain[0].proof = 'forged';}
  ];
  for (const mutate of mutations) {const value = resolution(); mutate(value); await assert.rejects(observer(value)(SOURCE), code('INVALID_FETCHER_RESPONSE'));}
});

test('fetcher refuses false authority, private targets, stale clocks, invented classifications and hint trust fields', async () => {
  const mutations = [
    value => {value.identity = 'VERIFIED';}, value => {value.threatStatus = 'SAFE';}, value => {value.classification = 'OWNER_VERIFIED';},
    value => {value.httpStatus = 403; value.hops.at(-1).status = 403;}, value => {value.finalOrigin = 'https://127.0.0.1';},
    value => {value.hops[1].origin = CURRENT + '/path';}, value => {value.checkedAt = new Date(stamp - 120001).toISOString();},
    value => {value.checkedAt = new Date(stamp + 120001).toISOString();}, value => {value.bytes = 1048577;},
    value => {value.sha256 = 'not-a-digest';}, value => {value.hints = [{origin: CURRENT, kind: 'CANONICAL_HINT', verified: true}];},
    value => {value.hints = [{origin: 'https://router.local', kind: 'CANONICAL_HINT'}];}, value => {value.unexpected = true;},
    value => {delete value.hints;}, value => {value.hops = Array(5).fill({origin: SOURCE, status: 302});}
  ];
  for (const mutate of mutations) {const value = resolution(); mutate(value); await assert.rejects(observer(value)(SOURCE), code('INVALID_FETCHER_RESPONSE'));}
});

test('challenged or HTTP-error fetcher responses are availability failures, not successor proof', async () => {
  for (const [status, classification] of [[403, 'CHALLENGED_OR_THROTTLED'], [429, 'CHALLENGED_OR_THROTTLED'], [404, 'HTTP_ERROR'], [500, 'HTTP_ERROR']]) {
    const payload = resolution(); payload.httpStatus = status; payload.classification = classification; payload.hops.at(-1).status = status;
    const result = await observer(payload)(SOURCE); assert.equal(result.state, 'unavailable');
  }
});

test('fetcher MIME, duplicate JSON, excess bytes and non-200 responses fail closed', async () => {
  const responses = [
    [{status: 503, headers: {}, body: ''}, 'FETCHER_UNAVAILABLE'],
    [{status: 302, headers: {location: 'https://attacker.example.org/'}, body: ''}, 'FETCHER_UNAVAILABLE'],
    [{status: 200, headers: {'content-type': 'text/html'}, body: '<html>login</html>'}, 'INVALID_FETCHER_RESPONSE'],
    [{status: 200, headers: {'content-type': 'application/json'}, body: '{"identity":"UNVERIFIED","identity":"VERIFIED"}'}, 'INVALID_FETCHER_RESPONSE'],
    [{status: 200, headers: {'content-type': 'application/json'}, body: ' '.repeat(65537)}, 'INVALID_FETCHER_RESPONSE']
  ];
  for (const [response, reason] of responses) await assert.rejects(observer(null, {request: async () => response})(SOURCE), code(reason));
});
