import {originOf} from './core.js';

export const CONTINUITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_CONTINUITY_EDGES = 250;
export const MAX_CONTINUITY_SITES = 50;
const MAX_HOPS = 8;
const MAX_PROBES = 12;
const EVIDENCE = new Set(['http_redirect', 'http_refresh', 'meta_refresh', 'successor_link', 'well_known']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const RECOVERABLE = new Set(['NETWORK_DNS_FAILURE', 'NETWORK_CONNECTION_FAILURE', 'TIMEOUT', 'NETWORK_UNAVAILABLE']);
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SENSITIVE_PATH = /(?:^|\/)(?:auth|oauth|login|logout|signin|account|accounts|password|reset|checkout|payment|payments|download|session)(?:\/|$|[.])/i;
const DOWNLOAD_PATH = /\.(?:exe|msi|dmg|pkg|apk|zip|tar|gz|pdf)$/i;

function closed(value, fields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error(`Invalid ${name}.`);
}
function timestamp(value) { return Number.isSafeInteger(value) && value >= 0; }
function canonicalOrigin(value, options) {
  if (typeof value !== 'string' || originOf(value, {...options, target: true}) !== value) throw new Error('Continuity origins must be normalized public HTTPS origins.');
  return value;
}

/** The only user input needed is an old address; its private URL parts stay local. */
export function normalizeSource(value, options = {}) {
  if (typeof value !== 'string') throw new Error('Enter the old website address.');
  let text = value.trim();
  if (!text || text.length > 8192 || /[\u0000-\u0020\\]/.test(text)) throw new Error('Enter a valid public website address.');
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(text)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^[^/?#]+:\d+(?:[/?#]|$)/.test(text)) throw new Error('Use a public HTTPS website address.');
    text = 'https://' + text;
  }
  const url = new URL(text);
  if (url.username || url.password) throw new Error('Do not include credentials in the old address.');
  return originOf(url.origin, {...options, target: true});
}

// Redirect paths are transient network work, never persisted in graph history.
// Keep this policy independent of transport so malformed observations also stop.
function safeProbeUrl(value, base, options) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) throw new Error('Unsafe successor URL.');
  const url = new URL(value, base);
  canonicalOrigin(url.origin, options);
  if (url.username || url.password || url.search || url.hash || url.href.length > 2048 || url.pathname.startsWith('//') || /%(?:2f|5c|2e)/i.test(url.pathname) || SENSITIVE_PATH.test(url.pathname) || DOWNLOAD_PATH.test(url.pathname)) throw new Error('The successor contains unsupported private or ambiguous URL data.');
  return url.href;
}

export function emptyContinuityState() { return {schemaVersion: 1, sites: [], edges: []}; }

/** Structural validation does not make stored observations into identity proofs. */
export function validateContinuityState(raw, options = {}) {
  closed(raw, ['schemaVersion', 'sites', 'edges'], 'continuity state');
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.sites) || raw.sites.length > MAX_CONTINUITY_SITES || !Array.isArray(raw.edges) || raw.edges.length > MAX_CONTINUITY_EDGES) throw new Error('Continuity history exceeds supported limits.');
  const ids = new Set(), sources = new Set(), pairs = new Set();
  for (const site of raw.sites) {
    closed(site, ['id', 'sourceOrigin', 'enabled', 'createdAt'], 'followed site');
    canonicalOrigin(site.sourceOrigin, options);
    if (typeof site.id !== 'string' || !ID.test(site.id) || ids.has(site.id) || sources.has(site.sourceOrigin) || typeof site.enabled !== 'boolean' || !timestamp(site.createdAt)) throw new Error('Invalid or duplicate followed site.');
    ids.add(site.id); sources.add(site.sourceOrigin);
  }
  for (const edge of raw.edges) {
    closed(edge, ['fromOrigin', 'toOrigin', 'evidence', 'firstSeen', 'lastSeen', 'expiresAt'], 'continuity edge');
    canonicalOrigin(edge.fromOrigin, options); canonicalOrigin(edge.toOrigin, options);
    const key = edge.fromOrigin + '\n' + edge.toOrigin;
    if (edge.fromOrigin === edge.toOrigin || pairs.has(key) || !EVIDENCE.has(edge.evidence) || !timestamp(edge.firstSeen) || !timestamp(edge.lastSeen) || !timestamp(edge.expiresAt) || edge.firstSeen > edge.lastSeen || edge.expiresAt <= edge.lastSeen || edge.expiresAt - edge.lastSeen > CONTINUITY_TTL_MS) throw new Error('Invalid continuity edge.');
    pairs.add(key);
  }
  return structuredClone(raw);
}

/**
 * Walk live, source-declared successors. Remembered edges can skip unreachable
 * retired hosts or explicit 404/410 responses, but only a newly reachable
 * terminal origin can produce found.
 * No search result, name resemblance, canonical tag or stale endpoint is used.
 */
export async function discoverContinuity(source, {
  state = emptyContinuityState(), probe, hasPermission, now = Date.now,
  allowTestOrigins = false, budgetMs = 25000
} = {}) {
  const options = {allowTestOrigins};
  const sourceOrigin = normalizeSource(source, options);
  const nextState = validateContinuityState(state, options);
  if (typeof probe !== 'function' || typeof hasPermission !== 'function') throw new Error('A probe and permission checker are required.');
  if (!Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 25000) throw new Error('The discovery budget must be bounded by 25 seconds.');
  const clock = typeof now === 'function' ? now : () => now;
  const startedAt = clock();
  if (!timestamp(startedAt)) throw new Error('Invalid continuity clock.');
  const expiredSources = new Set(nextState.edges.filter(edge => edge.expiresAt <= startedAt).map(edge => edge.fromOrigin));
  nextState.edges = nextState.edges.filter(edge => edge.expiresAt > startedAt);
  const chain = [], attempts = [], visitedUrls = new Set(), visitedOrigins = new Set([sourceOrigin]);
  const controller = new AbortController();
  let timer;
  const exhausted = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(new Error('TIME_BUDGET')); controller.abort(); }, budgetMs);
  });
  const bounded = task => Promise.race([Promise.resolve().then(task), exhausted]);
  const finish = (status, reason, fields = {}) => ({state: nextState, result: {
    status, sourceOrigin, chain, attempts, checkedAt: clock(), ...(reason ? {reason} : {}), ...fields
  }});
  const outgoing = origin => nextState.edges.filter(edge => edge.fromOrigin === origin);
  const chainEdge = (edge, remembered = false) => ({
    fromOrigin: edge.fromOrigin, toOrigin: edge.toOrigin, evidence: edge.evidence,
    checkedAt: edge.lastSeen, ...(remembered ? {remembered: true} : {})
  });
  function remember(fromOrigin, toOrigin, evidence, checkedAt) {
    let edge = nextState.edges.find(item => item.fromOrigin === fromOrigin && item.toOrigin === toOrigin);
    if (edge) Object.assign(edge, {evidence, lastSeen: checkedAt, expiresAt: checkedAt + CONTINUITY_TTL_MS});
    else {
      if (nextState.edges.length >= MAX_CONTINUITY_EDGES) return null;
      edge = {fromOrigin, toOrigin, evidence, firstSeen: checkedAt, lastSeen: checkedAt, expiresAt: checkedAt + CONTINUITY_TTL_MS};
      nextState.edges.push(edge);
    }
    return edge;
  }
  let url = sourceOrigin + '/';
  try {
    for (let count = 0; count < MAX_PROBES; count++) {
      const origin = new URL(url).origin;
      const observedAt = clock();
      if (!timestamp(observedAt) || observedAt < startedAt || outgoing(origin).some(edge => edge.lastSeen > observedAt)) return finish('unavailable', 'CLOCK_ANOMALY');
      const history = outgoing(origin).filter(edge => edge.expiresAt > observedAt);
      if (history.length > 1) return finish('conflict', 'CONFLICTING_SUCCESSORS', {conflictingOrigins: history.map(edge => edge.toOrigin)});
      if (visitedUrls.has(url)) return finish('loop', 'REDIRECT_LOOP');
      visitedUrls.add(url);
      if (!await bounded(() => hasPermission(origin))) return finish('permission_required', 'SOURCE_PERMISSION_REQUIRED', {requiredOrigins: [origin]});
      let observation;
      try { observation = await bounded(() => probe(url, {signal: controller.signal})); }
      catch (error) {
        if (error.message === 'TIME_BUDGET') throw error;
        attempts.push({origin, status: 'unavailable', reason: 'PROBE_ERROR'});
        return finish('unavailable', 'PROBE_ERROR');
      }
      const completedAt = clock();
      if (!timestamp(completedAt) || completedAt < observedAt) return finish('unavailable', 'CLOCK_ANOMALY');
      const currentHistory = history.filter(edge => edge.expiresAt > completedAt);
      nextState.edges = nextState.edges.filter(edge => edge.expiresAt > completedAt);
      if (!observation || typeof observation !== 'object' || observation.origin !== origin || !['reachable', 'redirect', 'unavailable', 'ambiguous', 'blocked'].includes(observation.status)) return finish('unavailable', 'INVALID_PROBE_RESULT');
      if (observation.url !== undefined && observation.url !== url) return finish('unavailable', 'INVALID_PROBE_RESULT');
      const reason = typeof observation.reason === 'string' && /^[A-Z0-9_]{1,80}$/.test(observation.reason) ? observation.reason : undefined;
      attempts.push({origin, status: observation.status, ...(reason ? {reason} : {})});
      if (observation.status === 'ambiguous') return finish('conflict', reason || 'AMBIGUOUS_MIGRATION_EVIDENCE');
      if (observation.status === 'blocked') return finish('unknown', reason || 'UNSAFE_MIGRATION_EVIDENCE');
      if (observation.status === 'unavailable') {
        const networkOnly = (!observation.httpStatus || observation.httpStatus === 0) && RECOVERABLE.has(reason);
        const gone = (observation.httpStatus === 404 && reason === 'HTTP_404') || (observation.httpStatus === 410 && reason === 'HTTP_410');
        const canSkip = networkOnly || gone;
        if (!canSkip || currentHistory.length !== 1) return finish('unavailable', canSkip && (expiredSources.has(origin) || history.length !== currentHistory.length) ? 'HISTORY_EXPIRED' : reason || 'SOURCE_UNAVAILABLE');
        if (chain.length >= MAX_HOPS) return finish('unknown', 'HOP_LIMIT');
        const edge = currentHistory[0];
        chain.push(chainEdge(edge, true));
        if (visitedOrigins.has(edge.toOrigin)) return finish('loop', 'REDIRECT_LOOP');
        visitedOrigins.add(edge.toOrigin); url = edge.toOrigin + '/';
        continue;
      }
      if (observation.status === 'reachable' && !observation.successorUrl) {
        if (!Number.isInteger(observation.httpStatus) || observation.httpStatus < 200 || observation.httpStatus >= 300) return finish('unavailable', 'INVALID_PROBE_RESULT');
        if (currentHistory.length) return finish('unknown', 'MIGRATION_EVIDENCE_CHANGED');
        if (!chain.length) return finish('unknown', 'NO_MIGRATION_EVIDENCE', {originalReachable: true});
        return finish('found', undefined, {terminalOrigin: origin, trustClass: 'source_declared'});
      }
      if (!observation.successorUrl || !EVIDENCE.has(observation.evidence) || !Number.isInteger(observation.httpStatus) || (observation.evidence === 'http_redirect' ? !REDIRECTS.has(observation.httpStatus) : observation.httpStatus < 200 || observation.httpStatus >= 400)) return finish('unavailable', 'INVALID_PROBE_RESULT');
      let successor;
      try { successor = safeProbeUrl(observation.successorUrl, url, options); }
      catch { return finish('unknown', 'UNSAFE_SUCCESSOR'); }
      const toOrigin = new URL(successor).origin;
      if (toOrigin !== origin) {
        if (chain.length >= MAX_HOPS) return finish('unknown', 'HOP_LIMIT');
        const edge = remember(origin, toOrigin, observation.evidence, completedAt);
        if (!edge) return finish('unknown', 'HISTORY_LIMIT');
        chain.push(chainEdge(edge));
        const alternatives = outgoing(origin);
        if (alternatives.length > 1) return finish('conflict', 'CONFLICTING_SUCCESSORS', {conflictingOrigins: alternatives.map(item => item.toOrigin)});
        if (visitedOrigins.has(toOrigin)) return finish('loop', 'REDIRECT_LOOP');
        visitedOrigins.add(toOrigin);
      }
      url = successor;
    }
    return finish('unknown', 'PROBE_LIMIT');
  } catch (error) {
    return finish('unavailable', error.message === 'TIME_BUDGET' ? 'TIME_BUDGET' : 'PERMISSION_CHECK_FAILED');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
