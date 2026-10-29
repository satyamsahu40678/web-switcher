import {normalizeSource} from './continuity.js';
import {normalizeProbeUrl} from './continuity-probe.js';
import {parseStrictJson} from './security/catalog.mjs';

const DEFAULT_URLS = Object.freeze({
  availability: 'https://archive.org/wayback/available',
  cdx: 'https://web.archive.org/cdx/search/cdx',
  replay: 'https://web.archive.org'
});
const MAX_BODY = 128 * 1024;
const MAX_TOTAL_BODY = 512 * 1024;
const MAX_CAPTURES = 3;
const MAX_LEADS = 10;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'li', 'h1', 'h2', 'h3', 'header', 'footer', 'aside', 'br']);
const MOVE = /\b(?:we\s+(?:have\s+)?(?:moved|relocated)|(?:this\s+(?:website|site)|our\s+site)\s+(?:has\s+)?(?:moved|relocated)|our\s+(?:new|current)\s+(?:website|domain|address|home)|new\s+(?:official\s+)?(?:domain|website|address))\b/i;
const WARNING = /\b(?:do\s+not|don't|never|avoid|scam|fake|fraud|warning)\b/i;

function fail(code) { const error = new Error(code); error.code = code; return error; }
function checkAbort(signal) { if (signal?.aborted) throw fail('CANCELLED'); }
function entities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, token => {
    const name = token.slice(1, -1).toLowerCase();
    if (name[0] === '#') {
      const n = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
    }
    return {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'}[name];
  });
}
function attributes(value) {
  const result = Object.create(null); let at = 0;
  while (at < value.length) {
    while (at < value.length && /\s/.test(value[at])) at++;
    if (at === value.length || /^\/\s*$/.test(value.slice(at))) break;
    const name = /^[^\s"'<>/=\x00-\x1f]+/.exec(value.slice(at));
    if (!name) return null;
    const key = name[0].toLowerCase(); at += name[0].length;
    if (Object.hasOwn(result, key)) return null;
    while (at < value.length && /\s/.test(value[at])) at++;
    let text = '';
    if (value[at] === '=') {
      at++; while (at < value.length && /\s/.test(value[at])) at++;
      if (value[at] === '"' || value[at] === "'") {
        const quote = value[at++], end = value.indexOf(quote, at);
        if (end < 0) return null;
        text = value.slice(at, end); at = end + 1;
      } else {
        const unquoted = /^[^\s"'`=<>\x00-\x1f]+/.exec(value.slice(at));
        if (!unquoted) return null;
        text = unquoted[0]; at += text.length;
      }
    }
    result[key] = entities(text);
  }
  return result;
}

// This is inert extraction, not HTML rendering. Raw-text, comments, template and
// foreign namespace trees cannot manufacture migration statements or anchors.
function htmlLeads(html) {
  const declarations = [], announcements = [];
  let at = 0, templates = 0, text = '', anchor;
  const namespaces = [];
  const appendText = value => {
    if (templates || namespaces.length) return;
    const clean = entities(value).replace(/\s+/g, ' ');
    text = (text + clean).slice(-300);
    if (anchor) anchor.text = (anchor.text + clean).slice(0, 200);
  };
  while (at < html.length) {
    const start = html.indexOf('<', at);
    if (start < 0) { appendText(html.slice(at)); break; }
    appendText(html.slice(at, start));
    if (html.startsWith('<!--', start)) {
      const close = html.indexOf('-->', start + 4); at = close < 0 ? html.length : close + 3; continue;
    }
    let end = start + 1, quote = '';
    for (; end < html.length; end++) {
      const character = html[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === html.length) break;
    const token = html.slice(start + 1, end), match = /^(\/?)\s*([a-z][a-z0-9:-]*)(?=\s|\/|$)/i.exec(token);
    at = end + 1;
    if (!match) continue;
    const name = match[2].toLowerCase(), closing = Boolean(match[1]);
    if (!closing && name === 'plaintext') break;
    if (name === 'template') { templates = Math.max(0, templates + (closing ? -1 : 1)); continue; }
    if (name === 'svg' || name === 'math') {
      if (closing && namespaces.at(-1) === name) namespaces.pop();
      else if (!closing && !/\/\s*$/.test(token)) namespaces.push(name);
      continue;
    }
    if (!closing && RAW_TEXT.has(name)) {
      const tail = new RegExp('</' + name + '\\s*>', 'ig'); tail.lastIndex = at;
      at = tail.exec(html) ? tail.lastIndex : html.length; continue;
    }
    if (templates || namespaces.length) continue;
    if (name === 'a' && closing) {
      if (anchor) {
        const context = (anchor.before + ' ' + anchor.text).trim();
        if (MOVE.test(context) && !WARNING.test(context)) announcements.push({url: anchor.href, kind: 'archive_announcement'});
        if (declarations.length + announcements.length > 24) throw fail('ARCHIVE_TOO_MANY_HINTS');
      }
      anchor = undefined; continue;
    }
    if (BLOCKS.has(name)) { text = ''; anchor = undefined; }
    if (closing) continue;
    const attrs = attributes(token.slice(match[0].length));
    if (!attrs) continue;
    if (name === 'a' && attrs.href) anchor = {href: attrs.href, before: text.slice(-200), text: ''};
    if (name === 'meta' && attrs['http-equiv']?.trim().toLowerCase() === 'refresh') {
      const target = refresh(attrs.content);
      if (target) declarations.push({url: target, kind: 'archive_metadata'});
    }
    if (name === 'link' && attrs.rel?.toLowerCase().split(/\s+/).includes('web-switcher-successor') && attrs.href) declarations.push({url: attrs.href, kind: 'archive_metadata'});
    if (declarations.length + announcements.length > 24) throw fail('ARCHIVE_TOO_MANY_HINTS');
  }
  return {declarations, announcements};
}
function refresh(value) {
  if (typeof value !== 'string') return null;
  const found = /^\s*(\d+(?:\.\d+)?)\s*;\s*url\s*=\s*(.*?)\s*$/i.exec(value);
  if (!found || Number(found[1]) > 10 || !found[2]) return null;
  let target = found[2];
  if (target[0] === '"' || target[0] === "'") {
    if (target.at(-1) !== target[0]) return null;
    target = target.slice(1, -1);
  }
  return target;
}

function configuredUrls(providerUrls, allowTestOrigins) {
  if (providerUrls === undefined || providerUrls === null) return DEFAULT_URLS;
  if (!allowTestOrigins || !providerUrls || typeof providerUrls !== 'object' || Array.isArray(providerUrls) || Object.keys(providerUrls).some(k => !['availability', 'cdx', 'replay'].includes(k))) throw fail('INVALID_ARCHIVE_CONFIGURATION');
  const parsed = {};
  for (const key of ['availability', 'cdx', 'replay']) {
    const url = new URL(providerUrls[key]);
    if (url.protocol !== 'http:' || !url.hostname.endsWith('.test') || url.username || url.password || url.search || url.hash) throw fail('INVALID_ARCHIVE_CONFIGURATION');
    normalizeSource(url.origin, {allowTestOrigins: true});
    const expected = {availability: '/wayback/available', cdx: '/cdx/search/cdx', replay: '/'}[key];
    if (url.pathname !== expected) throw fail('INVALID_ARCHIVE_CONFIGURATION');
    parsed[key] = key === 'replay' ? url.origin : url.href;
  }
  return parsed;
}
function captureTime(timestamp, now) {
  if (typeof timestamp !== 'string' || !/^\d{14}$/.test(timestamp)) throw fail('INVALID_ARCHIVE_CAPTURE');
  const iso = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`;
  const time = Date.parse(iso);
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== iso.slice(0, 19) || time < Date.UTC(1990, 0, 1) || time > now + 5 * 60000) throw fail('INVALID_ARCHIVE_CAPTURE');
  return new Date(time).toISOString();
}
function rootOriginal(value, source, allowTestOrigins) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\\]/.test(value)) throw fail('INVALID_ARCHIVE_CAPTURE');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.hostname !== source.hostname || url.port !== source.port) throw fail('INVALID_ARCHIVE_CAPTURE');
  if (!allowTestOrigins && url.port) throw fail('INVALID_ARCHIVE_CAPTURE');
  return url;
}

/**
 * Keyless public archive investigation. It never contacts the old site or a
 * proposed new site. Every returned lead is an unverified historical hint;
 * callers must separately establish present reachability and user intent.
 */
export function createArchiveDiscovery({request, allowTestOrigins = false, providerUrls, now = Date.now, budgetMs = 30000} = {}) {
  if (typeof request !== 'function') throw new Error('A bounded archive transport is required.');
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 45000) throw fail('INVALID_ARCHIVE_BUDGET');
  const urls = configuredUrls(providerUrls, allowTestOrigins), replay = new URL(urls.replay);
  const clock = typeof now === 'function' ? now : () => now;
  return async function discover(sourceOrigin, {signal} = {}) {
    const source = new URL(normalizeSource(sourceOrigin, {allowTestOrigins}));
    const reasons = new Set(), leads = [], uniqueOrigins = new Set(), captures = [], seenCaptures = new Set();
    let requests = 0, bytes = 0, partial = false;
    const controller = new AbortController();
    const cancel = () => controller.abort(fail('CANCELLED'));
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, {once: true});
    const timer = setTimeout(() => controller.abort(fail('ARCHIVE_TIME_BUDGET')), budgetMs);
    const result = () => ({leads, reasonCodes: [...reasons], completeness: partial ? 'partial' : 'complete', requests, bytes});
    function unpackCapture(value, sourceOnly) {
      if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\\]/.test(value)) throw fail('INVALID_ARCHIVE_CAPTURE');
      const url = new URL(value, urls.replay);
      const productionHttpUpgrade = !allowTestOrigins && url.protocol === 'http:' && url.hostname === replay.hostname && !url.port;
      if ((!productionHttpUpgrade && url.origin !== replay.origin) || url.username || url.password || url.search || url.hash) throw fail('INVALID_ARCHIVE_CAPTURE');
      const found = /^\/web\/(\d{14})(?:id_)?\/(https?:\/\/.+)$/.exec(url.pathname);
      if (!found) throw fail('INVALID_ARCHIVE_CAPTURE');
      const capturedAt = captureTime(found[1], clock());
      const original = sourceOnly ? rootOriginal(found[2], source, allowTestOrigins) : new URL(found[2]);
      if (original.username || original.password || original.search || original.hash) throw fail('INVALID_ARCHIVE_CAPTURE');
      return {timestamp: found[1], capturedAt, original: original.href, url: `${urls.replay}/web/${found[1]}id_/${original.href}`};
    }
    function queueCapture(capture) {
      if (!seenCaptures.has(capture.url)) { seenCaptures.add(capture.url); captures.push(capture); }
    }
    function candidate(value, capture) {
      if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u0020\\]/.test(value.trim())) throw fail('UNSAFE_ARCHIVED_TARGET');
      let url = new URL(value.trim(), capture.original);
      if (url.origin === replay.origin || (!allowTestOrigins && url.hostname === replay.hostname)) url = new URL(unpackCapture(url.href, false).original);
      if (url.username || url.password) throw fail('UNSAFE_ARCHIVED_TARGET');
      const upgraded = url.protocol === 'http:' && !(allowTestOrigins && url.hostname.endsWith('.test'));
      if (upgraded) url.protocol = 'https:';
      const cleaned = new URL(normalizeProbeUrl(url.href, undefined, {allowTestOrigins}));
      const origin = normalizeSource(cleaned.origin, {allowTestOrigins});
      if (cleaned.hostname === source.hostname && cleaned.port === source.port) return null;
      if ([new URL(urls.availability).hostname, replay.hostname].includes(cleaned.hostname)) return null;
      return {origin, upgraded};
    }
    function addLead(value, kind, capture) {
      const target = candidate(value, capture);
      if (!target || (!uniqueOrigins.has(target.origin) && uniqueOrigins.size >= MAX_LEADS)) return;
      if (leads.some(lead => lead.origin === target.origin && lead.kind === kind && lead.sourceUrl === capture.url)) return;
      uniqueOrigins.add(target.origin);
      leads.push({origin: target.origin, kind, sourceUrl: capture.url, capturedAt: capture.capturedAt,
        summary: kind === 'archive_redirect' ? `Historical redirect captured ${capture.capturedAt.slice(0, 10)}; current identity and availability are unverified.${target.upgraded ? ' The historical HTTP destination is proposed as an HTTPS origin.' : ''}`
          : kind === 'archive_metadata' ? `Historical explicit move metadata captured ${capture.capturedAt.slice(0, 10)}; current identity and availability are unverified.`
            : `A historical page linked this origin near a move announcement on ${capture.capturedAt.slice(0, 10)}; the claim is unverified.`,
        provenanceGroup: `archive:${source.host}`});
    }
    async function get(url) {
      checkAbort(controller.signal);
      if (requests >= 5 || bytes >= MAX_TOTAL_BODY) throw fail('ARCHIVE_RESOURCE_LIMIT');
      requests++;
      const child = new AbortController(), stopped = () => child.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', stopped, {once: true});
      const deadline = setTimeout(() => child.abort(fail('ARCHIVE_REQUEST_TIMEOUT')), 8000);
      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(child.signal.reason || fail('CANCELLED'));
        child.signal.addEventListener('abort', onAbort, {once: true});
      });
      try {
        const response = await Promise.race([Promise.resolve().then(() => request(url, {signal: child.signal})), aborted]);
        checkAbort(controller.signal);
        if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || (response.url && response.url !== url) || typeof response.body !== 'string' || !response.headers || typeof response.headers !== 'object' || Array.isArray(response.headers)) throw fail('INVALID_ARCHIVE_RESPONSE');
        if (response.body.length > MAX_BODY) throw fail('ARCHIVE_RESPONSE_TOO_LARGE');
        const size = new TextEncoder().encode(response.body).byteLength;
        bytes += size;
        if (size > MAX_BODY || bytes > MAX_TOTAL_BODY) throw fail('ARCHIVE_RESPONSE_TOO_LARGE');
        return response;
      } finally {
        clearTimeout(deadline); child.signal.removeEventListener('abort', onAbort);
        controller.signal.removeEventListener('abort', stopped); child.abort();
      }
    }
    function header(response, key) {
      const found = Object.entries(response.headers).filter(([name]) => name.toLowerCase() === key);
      if (!found.length) return null;
      if (found.length !== 1 || typeof found[0][1] !== 'string' || found[0][1].length > 4096) throw fail('INVALID_ARCHIVE_RESPONSE');
      return found[0][1];
    }
    async function indexAvailability() {
      const url = new URL(urls.availability); url.searchParams.set('url', source.origin + '/');
      const response = await get(url.href);
      if (response.status !== 200) throw fail('ARCHIVE_AVAILABILITY_UNAVAILABLE');
      const data = parseStrictJson(response.body, {maxBytes: MAX_BODY});
      if (!data || typeof data !== 'object' || Array.isArray(data) || !data.archived_snapshots || typeof data.archived_snapshots !== 'object' || Array.isArray(data.archived_snapshots)) throw fail('INVALID_ARCHIVE_INDEX');
      const closest = data.archived_snapshots.closest;
      if (closest === undefined) return;
      if (!closest || typeof closest !== 'object' || Array.isArray(closest) || closest.available !== true || !['string', 'number'].includes(typeof closest.status) || !/^(?:200|301|302|303|307|308)$/.test(String(closest.status))) throw fail('INVALID_ARCHIVE_INDEX');
      const capture = unpackCapture(closest.url, true);
      if (closest.timestamp !== undefined && closest.timestamp !== capture.timestamp) throw fail('INVALID_ARCHIVE_CAPTURE');
      queueCapture(capture);
    }
    async function indexRedirects() {
      const url = new URL(urls.cdx);
      for (const [name, value] of Object.entries({url: source.host + '/', matchType: 'exact', output: 'json', fl: 'timestamp,original,statuscode', filter: 'statuscode:3..', collapse: 'digest', limit: '-3'})) url.searchParams.set(name, value);
      const response = await get(url.href);
      if (response.status !== 200) throw fail('ARCHIVE_INDEX_UNAVAILABLE');
      const data = parseStrictJson(response.body, {maxBytes: MAX_BODY});
      if (!Array.isArray(data) || data.length > 50) throw fail('INVALID_ARCHIVE_INDEX');
      if (!data.length) return;
      const columns = data[0];
      if (!Array.isArray(columns) || columns.length > 8 || columns.some(column => typeof column !== 'string') || new Set(columns).size !== columns.length || ['timestamp', 'original', 'statuscode'].some(name => !columns.includes(name))) throw fail('INVALID_ARCHIVE_INDEX');
      const found = [];
      for (const row of data.slice(1)) {
        if (!Array.isArray(row) || row.length !== columns.length || row.some(cell => typeof cell !== 'string')) throw fail('INVALID_ARCHIVE_INDEX');
        const record = Object.fromEntries(columns.map((key, at) => [key, row[at]]));
        if (!REDIRECTS.has(Number(record.statuscode))) continue;
        const original = rootOriginal(record.original, source, allowTestOrigins);
        captureTime(record.timestamp, clock());
        found.push(unpackCapture(`${urls.replay}/web/${record.timestamp}id_/${original.href}`, true));
      }
      found.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      for (const capture of found.slice(0, MAX_CAPTURES)) queueCapture(capture);
    }
    function note(error, fallback) {
      if (controller.signal.aborted) throw controller.signal.reason || fail('CANCELLED');
      partial = true;
      reasons.add(typeof error?.code === 'string' && /^[A-Z_]{1,80}$/.test(error.code) ? error.code : fallback);
    }
    try {
      checkAbort(controller.signal);
      try { await indexAvailability(); } catch (error) { note(error, 'ARCHIVE_AVAILABILITY_UNAVAILABLE'); }
      try { await indexRedirects(); } catch (error) { note(error, 'ARCHIVE_INDEX_UNAVAILABLE'); }
      for (let index = 0; index < captures.length && index < MAX_CAPTURES; index++) {
        const capture = captures[index], before = leads.length;
        try {
          const response = await get(capture.url);
          if (REDIRECTS.has(response.status)) {
            const originalLocation = header(response, 'x-archive-orig-location'), location = header(response, 'location');
            if (originalLocation) addLead(originalLocation, 'archive_redirect', capture);
            else if (location) {
              const target = new URL(location, capture.url);
              // Only archive-wrapped original URLs can make an ordinary replay
              // Location into historical evidence. Archive login/help redirects
              // and naked service destinations are not original-site claims.
              const redirected = unpackCapture(target.href, false);
              const original = new URL(redirected.original);
              if (original.hostname === source.hostname && original.port === source.port && original.pathname === '/') queueCapture(unpackCapture(target.href, true));
              else addLead(target.href, 'archive_redirect', capture);
            } else throw fail('ARCHIVE_REDIRECT_WITHOUT_EVIDENCE');
          } else if (response.status === 200) {
            const type = (header(response, 'content-type') || '').split(';')[0].trim().toLowerCase();
            if (!['text/html', 'application/xhtml+xml'].includes(type)) throw fail('ARCHIVE_UNSUPPORTED_CONTENT');
            // A Location field on an archived HTTP 200 response is not an HTTP
            // redirect. Only supported move metadata in its inert body supplies
            // a candidate here; do not upgrade an arbitrary header to a move.
            const hints = htmlLeads(response.body);
            for (const hint of hints.declarations) addLead(hint.url, hint.kind, capture);
            // Announcements produce suggestions only. Their ordinary links never
            // enter the implemented source-declared continuity graph.
            for (const hint of hints.announcements) {
              try { addLead(hint.url, hint.kind, capture); }
              catch { reasons.add('ARCHIVE_UNSAFE_ANNOUNCEMENT_IGNORED'); }
            }
          } else throw fail('ARCHIVE_CAPTURE_UNAVAILABLE');
        } catch (error) {
          leads.splice(before); uniqueOrigins.clear(); for (const lead of leads) uniqueOrigins.add(lead.origin);
          note(error, 'ARCHIVE_CAPTURE_UNAVAILABLE');
        }
      }
      if (!leads.length) reasons.add('ARCHIVE_NO_SUPPORTED_SUCCESSOR');
      else reasons.add('ARCHIVE_CANDIDATES_FOUND');
      if (uniqueOrigins.size > 1) reasons.add('ARCHIVE_MULTIPLE_CANDIDATES');
      return result();
    } catch (error) {
      partial = true;
      const code = signal?.aborted ? 'CANCELLED' : error?.code === 'ARCHIVE_TIME_BUDGET' ? 'ARCHIVE_TIME_BUDGET' : 'ARCHIVE_UNAVAILABLE';
      reasons.add(code);
      if (code === 'CANCELLED') leads.splice(0);
      return result();
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.abort();
    }
  };
}
