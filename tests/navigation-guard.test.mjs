import test from 'node:test';
import assert from 'node:assert/strict';
import {gateNavigation, freshGateNavigation, navigationBurst, MAX_NAVIGATION_BURST} from '../extension/navigation-guard.js';

const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const now = 1800000000000;
const url = `chrome-extension://${extensionId}/route.html`;
const details = overrides => ({tabId: 7, frameId: 0, documentId: 'document-1', url: url + '#g=current&m=manual-1&source=https://old-site.com/private/path?token=secret', transitionType: 'typed', transitionQualifiers: ['server_redirect', 'from_address_bar'], documentLifecycle: 'active', ...overrides});
const sender = overrides => ({id: extensionId, tab: {id: 7}, frameId: 0, documentId: 'document-1', url, ...overrides});

test('own top-level gate commits retain only document identity and minimized navigation state', () => {
  const record = gateNavigation(details(), extensionId, now);
  assert.deepEqual(record, {documentId: 'document-1', gatePath: '/route.html', observedAt: now, fresh: true});
  assert.doesNotMatch(JSON.stringify(record), /old-site|private|token|secret|current|manual-1/);
  assert.equal(gateNavigation(details({url: `chrome-extension://${extensionId}/continuity-gate.html#private`}), extensionId, now).gatePath, '/continuity-gate.html');
});

test('unrelated pages, extension lookalikes, subframes and malformed identities create no gate record', () => {
  const invalid = [
    {url: 'https://hostile.com/route.html'},
    {url: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/route.html'},
    {url: url + '/extra'},
    {url: url.replace('/route.html', '/%72oute.html')},
    {url: url + '?source=private'},
    {url: url.replace('/route.html', '/options.html')},
    {url: 'not a URL'},
    {frameId: 1}, {tabId: -1}, {tabId: 1.5}, {tabId: Number.MAX_SAFE_INTEGER + 1},
    {documentId: ''}, {documentId: 7}, {documentId: 'x'.repeat(129)},
  ];
  for (const change of invalid) assert.equal(gateNavigation(details(change), extensionId, now), null, JSON.stringify(change));
  assert.equal(gateNavigation(null, extensionId, now), null);
  assert.equal(gateNavigation(details(), extensionId, -1), null);
  assert.equal(gateNavigation(details(), extensionId, NaN), null);
});

test('ordinary fresh visit classifications permit DNR server redirects without declaring a user gesture', () => {
  for (const transitionType of ['typed', 'auto_bookmark', 'generated', 'keyword', 'keyword_generated', 'link']) {
    assert.equal(gateNavigation(details({transitionType, transitionQualifiers: []}), extensionId, now).fresh, true, transitionType);
    assert.equal(gateNavigation(details({transitionType, transitionQualifiers: ['server_redirect']}), extensionId, now).fresh, true, transitionType);
  }
});

test('client redirects, unknown qualifiers and ambiguous reload/history transitions retain the loop guard', () => {
  for (const transitionType of ['reload', 'form_submit', 'auto_toplevel', 'auto_subframe', 'manual_subframe', 'script', '', undefined]) {
    assert.equal(gateNavigation(details({transitionType}), extensionId, now).fresh, false, String(transitionType));
  }
  for (const transitionQualifiers of [['client_redirect'], ['client_redirect', 'server_redirect'], ['forward_back'], ['new_unknown_qualifier'], undefined, null, 'server_redirect']) {
    assert.equal(gateNavigation(details({transitionQualifiers}), extensionId, now).fresh, false, JSON.stringify(transitionQualifiers));
  }
});

test('prerendered, cached and pending-deletion documents cannot reset a live routing guard', () => {
  for (const documentLifecycle of ['prerender', 'cached', 'pending_deletion', null, 'unknown']) {
    assert.equal(gateNavigation(details({documentLifecycle}), extensionId, now).fresh, false, String(documentLifecycle));
  }
  assert.equal(gateNavigation(details({documentLifecycle: undefined}), extensionId, now).fresh, true);
});

test('fresh records bind exact gate document and sender page, not message-supplied URL intent', () => {
  const record = gateNavigation(details(), extensionId, now);
  assert.equal(freshGateNavigation(record, sender(), now), true);
  for (const change of [
    {documentId: 'other-document'}, {documentId: undefined}, {frameId: 1}, {tab: {id: -1}}, {tab: undefined},
    {url: 'https://hostile.com/route.html'}, {url: `chrome-extension://${extensionId}/continuity-gate.html`},
    {url: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/route.html'},
    {url: url + '?forged=intent'}, {id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}, {id: undefined},
  ]) assert.equal(freshGateNavigation(record, sender(change), now), false, JSON.stringify(change));
  assert.equal(freshGateNavigation({...record, fresh: false}, sender(), now), false);
  assert.equal(freshGateNavigation({...record, gatePath: '/options.html'}, sender(), now), false);
  assert.equal(freshGateNavigation(null, sender(), now), false);
});

test('fresh records expire at a bounded age and fail closed when the clock reverses', () => {
  const record = gateNavigation(details(), extensionId, now);
  assert.equal(freshGateNavigation(record, sender(), now + 120000), true);
  assert.equal(freshGateNavigation(record, sender(), now + 120001), false);
  assert.equal(freshGateNavigation(record, sender(), now - 1), false);
  assert.equal(freshGateNavigation(record, sender(), NaN), false);
  assert.equal(freshGateNavigation({...record, observedAt: -1}, sender(), now), false);
  assert.equal(freshGateNavigation({...record, observedAt: '1800000000000'}, sender(), now), false);
});

test('burst state counts authorized switches separately from navigation freshness', () => {
  assert.equal(MAX_NAVIGATION_BURST, 6);
  assert.deepEqual(navigationBurst(undefined, now), {startedAt: now, count: 0});
  const previous = {startedAt: now - 1000, count: MAX_NAVIGATION_BURST};
  const burst = navigationBurst(previous, now);
  assert.deepEqual(burst, previous);
  assert.notEqual(burst, previous);
  assert.equal(previous.count, MAX_NAVIGATION_BURST, 'The helper must neither increment nor mutate stored authorization counts.');
});

test('burst windows reset exactly at their boundary and discard reversed or malformed state', () => {
  assert.deepEqual(navigationBurst({startedAt: now - 14999, count: 3}, now), {startedAt: now - 14999, count: 3});
  for (const previous of [
    {startedAt: now - 15000, count: 3}, {startedAt: now + 1, count: 3},
    {startedAt: -1, count: 3}, {startedAt: NaN, count: 3}, {startedAt: String(now), count: 3},
    {startedAt: now, count: 0}, {startedAt: now, count: -1}, {startedAt: now, count: 1.5},
    {startedAt: now, count: 1001}, {startedAt: now, count: '3'}, null,
  ]) assert.deepEqual(navigationBurst(previous, now), {startedAt: now, count: 0});
});
