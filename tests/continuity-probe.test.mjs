import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createContinuityProbe, extractContinuityHints, normalizeProbeUrl} from '../extension/continuity-probe.js';

const source = 'https://old.continuity.org/';
function fixture(permission = true) {
  const listeners = {headers: [], errors: []};
  const event = key => ({addListener(fn) { listeners[key].push(fn); }, removeListener(fn) { listeners[key] = listeners[key].filter(value => value !== fn); }});
  const chrome = {runtime: {getURL: path => 'chrome-extension://fixture/' + path}, permissions: {contains: async () => permission}, webRequest: {onHeadersReceived: event('headers'), onErrorOccurred: event('errors')}};
  const emit = (key, values = {}) => listeners[key].forEach(listener => listener({url: source, requestId: '1', initiator: 'chrome-extension://fixture', tabId: -1, type: 'xmlhttprequest', method: 'GET', ...values}));
  return {chrome, emit, listeners};
}
const opaque = () => ({status: 0, url: '', redirected: false, headers: new Headers(), body: null});
const html = value => new Response(value, {status: 200, headers: {'Content-Type': 'text/html; charset=utf-8'}});

test('probe URLs scrub secrets and refuse private, credentialed, downgraded and sensitive targets', () => {
  assert.equal(normalizeProbeUrl('/docs/?token=never-send#private', source), 'https://old.continuity.org/docs/');
  for (const value of ['http://current.org/', 'https://127.0.0.1/', 'https://[::1]/', 'https://router.local/', 'https://localhost/', 'https://a.test/', 'https://user:pass@current.org/', 'https://current.org:8443/', 'https://current.org/account/reset', 'https://current.org/%61ccount/profile', 'https://current.org/%2561ccount/profile', 'https://current.org/file.zip', 'https://current.org/x%2Fy', 'javascript:alert(1)', 'https://current.org/a b']) assert.throws(() => normalizeProbeUrl(value));
  assert.equal(normalizeProbeUrl('http://next.test:1234/', undefined, {allowTestOrigins: true}), 'http://next.test:1234/');
});

test('only explicit inertly parsed refresh and successor-link declarations produce hints', () => {
  const hints = extractContinuityHints(`<head><meta content="0; URL='https://next.org/?ref=old&amp;x=1'" HTTP-EQUIV="Refresh"><link href="https://next.org/" rel="alternate web-switcher-successor"><link rel="canonical" href="https://impostor.org/"><meta property="og:url" content="https://impostor.org/"></head>`, source);
  assert.deepEqual(hints, [{url: 'https://next.org/', evidence: 'meta_refresh'}, {url: 'https://next.org/', evidence: 'successor_link'}]);
  assert.equal(extractContinuityHints('<meta http-equiv=refresh content="30;url=https://later.org/">', source).length, 0);
});

test('comments, raw text, nested templates/namespaces and duplicate attributes cannot forge metadata', () => {
  const tag = '<meta http-equiv="refresh" content="0;url=https://impostor.org/">';
  for (const value of [`<!-- ${tag} -->`, `<script>const html='${tag}'</script>`, `<style>${tag}</style>`, `<textarea>${tag}</textarea>`, `<template><template>${tag}</template>${tag}</template>`, `<svg><svg></svg>${tag}</svg>`, `<plaintext>${tag}`, '<meta http-equiv=refresh content="0;url=https://one.org/" CONTENT="0;url=https://two.org/">']) assert.deepEqual(extractContinuityHints(value, source), [], value);
  assert.throws(() => extractContinuityHints(tag.repeat(9), source), /TOO_MANY/);
});

test('opaque manual redirects use captured headers without following the next host', async () => {
  const f = fixture(); const calls = [];
  const probe = createContinuityProbe(f.chrome, {fetchImpl: async (url, options) => {
    calls.push({url, options}); f.emit('headers', {statusCode: 302, responseHeaders: [{name: 'Location', value: 'https://next.org/?secret=drop#fragment'}]}); return opaque();
  }});
  const result = await probe(source);
  assert.equal(result.status, 'redirect'); assert.equal(result.successorUrl, 'https://next.org/'); assert.equal(result.evidence, 'http_redirect');
  assert.equal(calls.length, 1); assert.equal(calls[0].options.redirect, 'manual'); assert.equal(calls[0].options.credentials, 'omit'); assert.equal(calls[0].options.referrerPolicy, 'no-referrer'); assert.equal(calls[0].options.cache, 'no-store');
  probe.dispose(); assert.equal(f.listeners.headers.length, 0);
});

test('unrelated browsing/header events cannot supply an extension probe successor', async () => {
  const f = fixture();
  const probe = createContinuityProbe(f.chrome, {fetchImpl: async () => {
    for (const change of [{initiator: 'https://attacker.org'}, {tabId: 4}, {url: 'https://other.org/'}, {method: 'POST'}, {type: 'main_frame'}, {initiator: undefined}]) f.emit('headers', {statusCode: 302, responseHeaders: [{name: 'Location', value: 'https://attacker.org/'}], ...change});
    return opaque();
  }});
  const result = await probe(source); assert.equal(result.status, 'unavailable'); assert.equal(result.successorUrl, undefined); probe.dispose();
});

test('unsafe and conflicting server successors are refused instead of contacted', async () => {
  for (const [headers, status] of [[[{name: 'Location', value: 'https://127.0.0.1/'}], 'blocked'], [[{name: 'Location', value: 'https://one.org/'}, {name: 'Location', value: 'https://two.org/'}], 'ambiguous']]) {
    const f = fixture(); let requests = 0;
    const probe = createContinuityProbe(f.chrome, {fetchImpl: async () => { requests++; f.emit('headers', {statusCode: 301, responseHeaders: headers}); return opaque(); }});
    assert.equal((await probe(source)).status, status); assert.equal(requests, 1); probe.dispose();
  }
});

test('header/meta conflicts abstain and generic canonical links do not move a site', async () => {
  const f = fixture(); let body = '<meta http-equiv=refresh content="0;url=https://two.org/">';
  const probe = createContinuityProbe(f.chrome, {fetchImpl: async () => { f.emit('headers', {statusCode: 200, responseHeaders: [{name: 'Refresh', value: '0;url=https://one.org/'}]}); return html(body); }});
  assert.equal((await probe(source)).status, 'ambiguous'); probe.dispose();
  const f2 = fixture(); const probe2 = createContinuityProbe(f2.chrome, {fetchImpl: async () => html('<link rel=canonical href="https://canonical.org/"><a href="https://generic.org/">New domain</a>')});
  assert.equal((await probe2(source)).status, 'reachable'); probe2.dispose();
});

test('advertised well-known JSON is a closed unverified convention with duplicate-key rejection', async () => {
  const f = fixture(); let body = '{"schemaVersion":1,"successorOrigin":"https://next.org"}';
  const probe = createContinuityProbe(f.chrome, {fetchImpl: async () => new Response(body, {headers: {'Content-Type': 'application/json'}})});
  const result = await probe(source + '.well-known/web-switcher.json'); assert.equal(result.status, 'redirect'); assert.equal(result.evidence, 'well_known');
  body = '{"schemaVersion":1,"successorOrigin":"https://one.org","successorOrigin":"https://two.org"}';
  assert.equal((await probe(source + '.well-known/web-switcher.json')).reason, 'INVALID_CONTINUITY_MANIFEST'); probe.dispose();
});

test('an advertised same-origin manifest consumes a separate explicit probe call', async () => {
  const f = fixture(), requests = [];
  const probe = createContinuityProbe(f.chrome, {fetchImpl: async url => {
    requests.push(url);
    return url.endsWith('/.well-known/web-switcher.json') ? new Response('{"schemaVersion":1,"successorOrigin":"https://next.org"}', {headers: {'Content-Type': 'application/json'}}) : html('<link rel="web-switcher-successor" href="/.well-known/web-switcher.json">');
  }});
  const advertised = await probe(source);
  assert.equal(advertised.url, source); assert.equal(advertised.successorUrl, source + '.well-known/web-switcher.json'); assert.equal(advertised.evidence, 'successor_link');
  assert.deepEqual(requests, [source], 'Discovering a link must not issue an unbudgeted second request.');
  const result = await probe(advertised.successorUrl);
  assert.equal(result.successorUrl, 'https://next.org/'); assert.equal(result.evidence, 'well_known');
  assert.deepEqual(requests, [source, source + '.well-known/web-switcher.json']); probe.dispose();
});

test('network event causes distinguish dead connections from TLS and generic fetch errors', async () => {
  for (const [networkError, expected] of [['net::ERR_NAME_NOT_RESOLVED', 'NETWORK_DNS_FAILURE'], ['net::ERR_CONNECTION_REFUSED', 'NETWORK_CONNECTION_FAILURE'], ['net::ERR_EMPTY_RESPONSE', 'NETWORK_CONNECTION_FAILURE'], ['net::ERR_CERT_AUTHORITY_INVALID', 'TLS_ERROR'], ['net::ERR_BLOCKED_BY_CLIENT', 'FETCH_BLOCKED'], ['net::ERR_FAILED', 'FETCH_ERROR']]) {
    const f = fixture(); const probe = createContinuityProbe(f.chrome, {fetchImpl: async () => { f.emit('errors', {error: networkError}); throw new TypeError('Failed to fetch'); }});
    assert.equal((await probe(source)).reason, expected); probe.dispose();
  }
});

test('response byte limits and an overall caller abort stop work without accepting a successor', async () => {
  const f = fixture(); const probe = createContinuityProbe(f.chrome, {fetchImpl: async () => html('a'.repeat(128 * 1024 + 1))});
  const oversized = await probe(source); assert.equal(oversized.reason, 'RESPONSE_TOO_LARGE'); probe.dispose();
  const f2 = fixture(), controller = new AbortController();
  const probe2 = createContinuityProbe(f2.chrome, {fetchImpl: async () => new Promise(() => {})});
  const work = probe2(source, {signal: controller.signal}); setTimeout(() => controller.abort(), 10);
  assert.equal((await work).reason, 'ABORTED'); probe2.dispose();
});

test('missing permission and unexpected automatic transport redirects fail closed', async () => {
  const f = fixture(false); let requests = 0;
  const probe = createContinuityProbe(f.chrome, {fetchImpl: async () => { requests++; return html(''); }});
  assert.equal((await probe(source)).reason, 'PERMISSION_REQUIRED'); assert.equal(requests, 0); probe.dispose();
  const f2 = fixture(); const probe2 = createContinuityProbe(f2.chrome, {fetchImpl: async () => ({status: 200, redirected: true, url: 'https://unexpected.org/', body: null})});
  assert.equal((await probe2(source)).reason, 'UNEXPECTED_TRANSPORT_REDIRECT'); probe2.dispose();
});
