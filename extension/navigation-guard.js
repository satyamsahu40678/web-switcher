// Browser navigation metadata can distinguish ordinary new visits from most
// redirect chains. It is not proof of a physical user gesture; callers also
// retain a bounded burst guard for ambiguous/programmatic link navigations.
export const MAX_NAVIGATION_BURST = 6;

const GATE_PATHS = new Set(['/route.html', '/continuity-gate.html']);
const FRESH_TRANSITIONS = new Set(['typed', 'auto_bookmark', 'generated', 'keyword', 'keyword_generated', 'link']);
const FRESH_QUALIFIERS = new Set(['server_redirect', 'from_address_bar']);
const MAX_GATE_AGE_MS = 120000;
const BURST_WINDOW_MS = 15000;

function validDocument(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
function validTab(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function gatePath(value, extensionId) {
  if (typeof value !== 'string' || typeof extensionId !== 'string' || !extensionId) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'chrome-extension:' && url.host === extensionId && !url.username && !url.password && !url.search && GATE_PATHS.has(url.pathname) ? url.pathname : null;
  } catch { return null; }
}

export function gateNavigation(details, extensionId, now) {
  if (!details || details.frameId !== 0 || !validTab(details.tabId) || !validDocument(details.documentId) || !Number.isSafeInteger(now) || now < 0) return null;
  const path = gatePath(details.url, extensionId);
  if (!path) return null;
  const fresh = FRESH_TRANSITIONS.has(details.transitionType)
    && Array.isArray(details.transitionQualifiers)
    && details.transitionQualifiers.every(value => FRESH_QUALIFIERS.has(value))
    && (details.documentLifecycle === undefined || details.documentLifecycle === 'active');
  // In particular, the envelope in URL.hash and all remote paths stay out of
  // this record. The caller binds records to their tab and consumes fresh once.
  return {documentId: details.documentId, gatePath: path, observedAt: now, fresh};
}

export function freshGateNavigation(record, sender, now) {
  if (!record || record.fresh !== true || !validDocument(record.documentId) || !Number.isSafeInteger(record.observedAt) || record.observedAt < 0 || !Number.isSafeInteger(now) || now < record.observedAt || now - record.observedAt > MAX_GATE_AGE_MS) return false;
  if (!sender || sender.frameId !== 0 || !validTab(sender.tab?.id) || !validDocument(sender.documentId) || sender.documentId !== record.documentId) return false;
  return GATE_PATHS.has(record.gatePath) && gatePath(sender.url, sender.id) === record.gatePath;
}

export function navigationBurst(previous, now) {
  if (previous && Number.isSafeInteger(previous.startedAt) && previous.startedAt >= 0 && now >= previous.startedAt && now - previous.startedAt < BURST_WINDOW_MS && Number.isSafeInteger(previous.count) && previous.count >= 1 && previous.count <= 1000) {
    return {startedAt: previous.startedAt, count: previous.count};
  }
  // Deciding whether to increment is the caller's responsibility: a blocked
  // route must not be counted as an authorized switch.
  return {startedAt: now, count: 0};
}
