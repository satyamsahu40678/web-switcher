import test from 'node:test';
import assert from 'node:assert/strict';
import {createArchiveDiscovery} from '../extension/internet-sources.js';

const A = 'https://retired.sample.org';
const B = 'https://current.sample.net';
const NOW = Date.UTC(2026, 9, 28);
const T = '20260101000000';
const replay = (original = A + '/', stamp = T) => `https://web.archive.org/web/${stamp}id_/${original}`;
const availability = (url = replay()) => ({archived_snapshots: {closest: {available: true, status: '200', timestamp: T, url}}});
const cdx = rows => [['timestamp', 'original', 'statuscode'], ...rows];
function response(url, body, {status = 200, headers = {'content-type': 'application/json'}} = {}) {
  return {url, status, headers, body: typeof body === 'string' ? body : JSON.stringify(body)};
}
function fixture({available = availability(), index = cdx([]), capture, urls, extra} = {}) {
  const calls = [];
  const discovery = createArchiveDiscovery({now: () => NOW, ...extra, request: async (url, options) => {
    calls.push({url, signal: options.signal});
    const parsed = new URL(url);
    if (parsed.pathname === '/wayback/available') return response(url, available);
    if (parsed.pathname === '/cdx/search/cdx') return response(url, index);
    return capture ? capture(url, options) : response(url, '<h1>No move announcement</h1>', {headers: {'content-type': 'text/html'}});
  }, ...(urls ? {allowTestOrigins: true, providerUrls: urls} : {})});
  return {calls, discovery};
}

test('a first-time dead source yields an archive redirect candidate without contacting either live domain', async () => {
  const f = fixture({capture: url => response(url, '', {status: 302, headers: {'x-archive-orig-location': B + '/public?tracking=discard#fragment'}})});
  const result = await f.discovery(A + '/account?token=never-transmit#private');
  assert.equal(result.completeness, 'complete'); assert.equal(result.requests, 3);
  assert.equal(result.leads.length, 1); assert.equal(result.leads[0].origin, B);
  assert.equal(result.leads[0].kind, 'archive_redirect'); assert.equal(result.leads[0].capturedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(result.leads[0].sourceUrl, replay()); assert.equal(result.leads[0].provenanceGroup, 'archive:retired.sample.org');
  for (const call of f.calls) assert.ok(['archive.org', 'web.archive.org'].includes(new URL(call.url).hostname));
  assert.equal(JSON.stringify(f.calls.map(call => call.url)).includes('never-transmit'), false);
  assert.equal(JSON.stringify(result).includes('tracking='), false);
  assert.equal(new URL(f.calls[0].url).searchParams.get('url'), A + '/');
  assert.equal(new URL(f.calls[1].url).searchParams.get('url'), 'retired.sample.org/');
  assert.equal(new URL(f.calls[1].url).searchParams.get('matchType'), 'exact');
});

test('inert archived move metadata and contextual announcements are useful, unverified hints', async () => {
  const html = `<html><meta http-equiv="refresh" content="0;url=${B}/"><p>We have moved to <a href="https://second.sample.net/">our new home</a></p><p>Useful links: <a href="https://unrelated.sample.net/">Partner</a></p></html>`;
  const f = fixture({capture: url => response(url, html, {headers: {'content-type': 'text/html; charset=UTF-8'}})});
  const result = await f.discovery(A);
  assert.deepEqual(result.leads.map(lead => [lead.origin, lead.kind]), [[B, 'archive_metadata'], ['https://second.sample.net', 'archive_announcement']]);
  assert.ok(result.leads.every(lead => /unverified/i.test(lead.summary)));
  assert.ok(result.reasonCodes.includes('ARCHIVE_MULTIPLE_CANDIDATES'));
  assert.equal(result.leads.some(lead => 'trustClass' in lead || 'navigation' in lead), false);
});

test('archived HTTP targets are proposed as HTTPS while fixture HTTP ports remain unchanged', async () => {
  const f = fixture({capture: url => response(url, '', {status: 301, headers: {'x-archive-orig-location': 'http://current.sample.net/'}})});
  const result = await f.discovery(A); assert.equal(result.leads[0].origin, B); assert.match(result.leads[0].summary, /historical HTTP/);
  const urls = {availability: 'http://archive.test:1234/wayback/available', cdx: 'http://replay.test:1234/cdx/search/cdx', replay: 'http://replay.test:1234'};
  const capture = `http://replay.test:1234/web/${T}id_/http://old.test:1234/`;
  const f2 = fixture({urls, available: availability(capture), capture: url => response(url, '<meta http-equiv=refresh content="0;url=http://new.test:1234/">', {headers: {'content-type': 'text/html'}})});
  assert.equal((await f2.discovery('http://old.test:1234')).leads[0].origin, 'http://new.test:1234');
});

test('CDX can locate old redirect captures even when availability has no capture', async () => {
  const f = fixture({available: {archived_snapshots: {}}, index: cdx([[T, 'http://retired.sample.org/', '301']]), capture: url => response(url, '', {status: 302, headers: {location: `/web/${T}id_/${B}/`}})});
  const result = await f.discovery(A);
  assert.equal(result.leads.length, 1); assert.equal(result.leads[0].origin, B);
  assert.equal(result.leads[0].sourceUrl, replay('http://retired.sample.org/'));
  assert.equal(f.calls.length, 3);
});

test('archive internal redirects do not become website successors or arbitrary outbound requests', async () => {
  for (const location of ['https://archive.org/account/login', 'https://current.sample.net/', '/web/20260101000000/https://retired.sample.org/account?token=secret', '/web/20260101000000id_/http://127.0.0.1/']) {
    const f = fixture({capture: url => response(url, '', {status: 302, headers: {location}})});
    const result = await f.discovery(A);
    assert.equal(result.leads.length, 0, location);
    assert.equal(f.calls.length, 3, location);
    assert.equal(result.completeness, 'partial');
    assert.ok(f.calls.every(call => !new URL(call.url).hostname.startsWith('127.')));
  }
});

test('same-source replay canonicalization is followed under the shared capture and request caps', async () => {
  const newer = '20260201000000';
  const f = fixture({capture: url => url.includes(T) ? response(url, '', {status: 302, headers: {location: `/web/${newer}id_/${A}/`}}) : response(url, '', {status: 301, headers: {'x-archive-orig-location': B}})});
  const result = await f.discovery(A);
  assert.equal(result.leads[0].origin, B); assert.equal(result.leads[0].capturedAt, '2026-02-01T00:00:00.000Z'); assert.equal(f.calls.length, 4);
});

test('capture metadata cannot forge another source, private target, path or future timestamp', async () => {
  for (const url of [replay('https://different.sample.org/'), replay(A + '/private'), replay(A + '/?token=secret'), 'https://attacker.sample.org/web/' + T + 'id_/' + A + '/', replay(A + '/', '20990101000000'), replay(A + '/', '20260231000000'), 'https://web.archive.org:8443/web/' + T + 'id_/' + A + '/', 'https://web.archive.org/web/' + T + 'if_/' + A + '/']) {
    const f = fixture({available: availability(url)});
    const result = await f.discovery(A);
    assert.equal(f.calls.length, 2, url); assert.equal(result.leads.length, 0); assert.equal(result.completeness, 'partial');
    assert.ok(result.reasonCodes.includes('INVALID_ARCHIVE_CAPTURE'));
  }
});

test('script, comment, template, foreign, canonical and warning links do not create announcements', async () => {
  const announcement = `<p>We have moved to <a href="${B}">our new domain</a></p>`;
  for (const body of [`<!-- ${announcement} -->`, `<script>const value='${announcement}';fetch('https://never.sample.org')</script>`, `<template>${announcement}</template>`, `<svg>${announcement}</svg>`, `<textarea>${announcement}</textarea>`, `<link rel=canonical href="${B}"><meta property=og:url content="${B}">`, `<p>Warning: avoid the fake new domain <a href="${B}">cloned site</a></p>`, `<p>We have moved.</p><p>Other links <a href="${B}">Advertisement</a></p>`, `<meta http-equiv=refresh content="0;url=${B}" content="0;url=https://other.sample.org">`]) {
    const f = fixture({capture: url => response(url, body, {headers: {'content-type': 'text/html'}})});
    assert.deepEqual((await f.discovery(A)).leads, [], body);
    assert.equal(f.calls.length, 3);
  }
});

test('unsafe explicit declarations invalidate that capture rather than falling through to another hint', async () => {
  for (const target of ['https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://router.local/', 'https://user:password@current.sample.net/', 'https://current.sample.net:8443/', 'javascript:alert(1)', 'https://current.sample.net/account/reset?token=secret']) {
    const body = `<link rel=web-switcher-successor href="${B}"><meta http-equiv=refresh content="0;url=${target}">`;
    const f = fixture({capture: url => response(url, body, {headers: {'content-type': 'text/html'}})});
    const result = await f.discovery(A);
    assert.equal(result.leads.length, 0, target); assert.equal(result.completeness, 'partial');
  }
});

test('archive providers can independently fail and partial evidence is not promoted to certainty', async () => {
  const calls = [];
  const discover = createArchiveDiscovery({now: NOW, request: async url => {
    calls.push(url);
    if (url.includes('/wayback/available')) throw new Error('Provider unavailable');
    if (url.includes('/cdx/')) return response(url, cdx([[T, A + '/', '302']]));
    return response(url, '', {status: 302, headers: {'x-archive-orig-location': B}});
  }});
  const result = await discover(A);
  assert.equal(result.completeness, 'partial'); assert.equal(result.leads[0].origin, B); assert.ok(result.reasonCodes.includes('ARCHIVE_AVAILABILITY_UNAVAILABLE')); assert.equal(calls.length, 3);
});

test('malformed, duplicate-key, oversized and unexpected transport replies are bounded refusals', async () => {
  for (const body of ['{"archived_snapshots":{},"archived_snapshots":{}}', '{} trailing', 'null', JSON.stringify({archived_snapshots: []}), 'x'.repeat(128 * 1024 + 1)]) {
    const f = fixture({available: body});
    const result = await f.discovery(A);
    assert.equal(result.leads.length, 0); assert.equal(result.completeness, 'partial'); assert.ok(f.calls.length <= 2);
  }
  const f = fixture({capture: url => response('https://unexpected.sample.org/', '<meta http-equiv=refresh content="0;url=' + B + '">', {headers: {'content-type': 'text/html'}})});
  assert.equal((await f.discovery(A)).leads.length, 0);
});

test('only the selected root appears in requests and explicit cancellation prevents late leads', async () => {
  const controller = new AbortController(); let started;
  const ready = new Promise(resolve => {started = resolve;});
  const discover = createArchiveDiscovery({now: NOW, request: async (url, {signal}) => {
    started(); assert.equal(signal.aborted, false); return new Promise(() => {});
  }});
  const work = discover(A, {signal: controller.signal}); await ready; controller.abort();
  const result = await work;
  assert.deepEqual(result.leads, []); assert.equal(result.requests, 1); assert.ok(result.reasonCodes.includes('CANCELLED'));
  const cancelled = new AbortController(); cancelled.abort();
  const f = fixture(); const early = await f.discovery(A, {signal: cancelled.signal});
  assert.equal(f.calls.length, 0); assert.ok(early.reasonCodes.includes('CANCELLED'));
});

test('global time and request/capture ceilings remain bounded even for noncooperative transports', async () => {
  const discover = createArchiveDiscovery({now: NOW, budgetMs: 15, request: () => new Promise(() => {})});
  const result = await discover(A);
  assert.equal(result.requests, 1); assert.equal(result.completeness, 'partial'); assert.ok(result.reasonCodes.includes('ARCHIVE_TIME_BUDGET'));
  const rows = Array.from({length: 12}, (_, i) => [`202601${String(i + 1).padStart(2, '0')}000000`, A + '/', '301']);
  const f = fixture({index: cdx(rows), capture: url => response(url, `<meta http-equiv=refresh content="0;url=${B}">`, {headers: {'content-type': 'text/html'}})});
  const bounded = await f.discovery(A); assert.ok(bounded.requests <= 5); assert.ok(f.calls.length <= 5); assert.ok(bounded.leads.length <= 3);
});

test('production configuration is fixed and test overrides cannot target non-test infrastructure', () => {
  const request = async () => {};
  assert.throws(() => createArchiveDiscovery({request, providerUrls: {}}), /CONFIGURATION/);
  const valid = {availability: 'http://archive.test:1234/wayback/available', cdx: 'http://replay.test:1234/cdx/search/cdx', replay: 'http://replay.test:1234'};
  for (const urls of [{...valid, replay: 'http://127.0.0.1'}, {...valid, availability: 'https://archive.org/wayback/available'}, {...valid, cdx: 'http://replay.test:1234/arbitrary'}, {...valid, extra: 'value'}]) assert.throws(() => createArchiveDiscovery({request, allowTestOrigins: true, providerUrls: urls}));
  assert.throws(() => createArchiveDiscovery({request, budgetMs: 50000}), /BUDGET/);
});

test('malformed index cell types and credentialed or whitespace originals cannot be coerced into captures', async () => {
  for (const row of [[T, [A + '/'], '301'], [T, A + '/', ['301']], [T, A + '/\n', '301'], [T, A + '\\', '301'], [T, 'https://user@retired.sample.org/', '301']]) {
    const f = fixture({available: {archived_snapshots: {}}, index: cdx([row])});
    const result = await f.discovery(A);
    assert.deepEqual(result.leads, []); assert.equal(f.calls.length, 2); assert.equal(result.completeness, 'partial');
  }
  const available = availability(); available.archived_snapshots.closest.status = ['200'];
  const f = fixture({available});
  assert.deepEqual((await f.discovery(A)).leads, []); assert.equal(f.calls.length, 2);
});

test('a Location field on HTTP 200 alone is not historical redirect evidence', async () => {
  const f = fixture({capture: url => response(url, '<h1>Ordinary historical homepage</h1>', {headers: {'content-type': 'text/html', 'x-archive-orig-location': B, location: B}})});
  assert.deepEqual((await f.discovery(A)).leads, []);
  const withMetadata = fixture({capture: url => response(url, `<meta http-equiv=refresh content="0;url=${B}">`, {headers: {'content-type': 'text/html', 'x-archive-orig-location': 'https://unrelated.sample.net/'}})});
  assert.deepEqual((await withMetadata.discovery(A)).leads.map(lead => [lead.origin, lead.kind]), [[B, 'archive_metadata']]);
});

test('the final announcement anchor cannot escape the aggregate hint ceiling', async () => {
  const body = '<p>We have moved to ' + Array.from({length: 25}, (_, n) => `<a href="https://candidate${n}.sample.net/">our new domain</a>`).join('');
  const f = fixture({capture: url => response(url, body, {headers: {'content-type': 'text/html'}})});
  const result = await f.discovery(A);
  assert.deepEqual(result.leads, []); assert.equal(result.completeness, 'partial');
  assert.ok(result.reasonCodes.includes('ARCHIVE_TOO_MANY_HINTS'));
});

test('future capture dates beyond small clock skew and invalid clocks do not supply history', async () => {
  const future = '20261028010000';
  const available = availability(replay(A + '/', future));
  available.archived_snapshots.closest.timestamp = future;
  const f = fixture({available});
  const result = await f.discovery(A);
  assert.deepEqual(result.leads, []); assert.equal(f.calls.length, 2);
  assert.ok(result.reasonCodes.includes('INVALID_ARCHIVE_CAPTURE'));
  const invalidClock = fixture({extra: {now: () => Number.NaN}});
  const invalid = await invalidClock.discovery(A);
  assert.deepEqual(invalid.leads, []); assert.equal(invalidClock.calls.length, 2);
  assert.ok(invalid.reasonCodes.includes('INVALID_ARCHIVE_CAPTURE'));
});
