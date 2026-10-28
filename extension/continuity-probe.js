import {originOf} from './core.js';
import {parseStrictJson} from './security/catalog.mjs';

const MAX_BODY = 128 * 1024;
const UNSAFE_PATH = /(?:^|\/)(?:auth|oauth|login|logout|signin|account|accounts|password|reset|checkout|payment|payments|download)(?:\/|$|[.])|\.(?:exe|msi|dmg|pkg|apk|zip|tar|gz|pdf)(?:$|\/)/i;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** All requests are scrubbed before network use; no credentials or private URLs. */
export function normalizeProbeUrl(value, base, {allowTestOrigins = false} = {}) {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\\]/.test(value)) throw new Error('INVALID_PROBE_URL');
  const url = new URL(value, base);
  const fixture = allowTestOrigins && url.hostname.endsWith('.test');
  if (url.protocol !== 'https:' && !(fixture && url.protocol === 'http:')) throw new Error('HTTPS_REQUIRED');
  if (url.username || url.password) throw new Error('CREDENTIALS_FORBIDDEN');
  originOf(url.origin, {allowTestOrigins});
  const decodedPath = decodeURIComponent(url.pathname);
  if (UNSAFE_PATH.test(url.pathname) || UNSAFE_PATH.test(decodedPath) || /%(?:2f|5c|2e)/i.test(url.pathname) || /%[0-9a-f]{2}/i.test(decodedPath) || /[\u0000-\u001f\u007f\\]/.test(decodedPath) || url.pathname.startsWith('//') || url.pathname.length > 2048) throw new Error('UNSAFE_PROBE_PATH');
  url.search = ''; url.hash = '';
  return url.href;
}

function entities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, token => {
    const name = token.slice(1, -1).toLowerCase();
    if (name[0] === '#') {
      const number = name[1] === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
    }
    return {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'}[name];
  });
}

function attributes(text) {
  const result = Object.create(null);
  let at = 0;
  while (at < text.length) {
    while (/\s/.test(text[at] || '') && at < text.length) at++;
    if (at === text.length || /^\/\s*$/.test(text.slice(at))) break;
    const name = /^[^\s"'<>/=\x00-\x1f]+/.exec(text.slice(at));
    if (!name) return null;
    const key = name[0].toLowerCase(); at += name[0].length;
    if (own(result, key)) return null; // Duplicates are ambiguous; never guess.
    while (/\s/.test(text[at] || '') && at < text.length) at++;
    let value = '';
    if (text[at] === '=') {
      at++; while (/\s/.test(text[at] || '') && at < text.length) at++;
      if (text[at] === '"' || text[at] === "'") {
        const quote = text[at++], end = text.indexOf(quote, at);
        if (end === -1) return null;
        value = text.slice(at, end); at = end + 1;
      } else {
        const unquoted = /^[^\s"'`=<>\x00-\x1f]+/.exec(text.slice(at));
        if (!unquoted) return null;
        value = unquoted[0]; at += value.length;
      }
    }
    result[key] = entities(value);
  }
  return result;
}

function refresh(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*;\s*url\s*=\s*(.*?)\s*$/i.exec(value);
  if (!match || Number(match[1]) > 10 || !match[2]) return null;
  let url = match[2];
  if (url[0] === '"' || url[0] === "'") {
    if (url.at(-1) !== url[0]) return null;
    url = url.slice(1, -1);
  }
  return url;
}

/** Non-executing, bounded extraction; ignores scripts, comments and inert trees. */
export function extractContinuityHints(html, base, options = {}) {
  if (typeof html !== 'string' || html.length > MAX_BODY) throw new Error('RESPONSE_TOO_LARGE');
  const hints = [];
  let at = 0, templateDepth = 0;
  const namespaces = [];
  while (at < html.length) {
    const start = html.indexOf('<', at); if (start === -1) break;
    if (html.startsWith('<!--', start)) { const end = html.indexOf('-->', start + 4); at = end === -1 ? html.length : end + 3; continue; }
    let end = start + 1, quote = '';
    for (; end < html.length; end++) {
      const char = html[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === html.length) break;
    const token = html.slice(start + 1, end), tag = /^(\/?)\s*([a-z][a-z0-9:-]*)(?=\s|\/|$)/i.exec(token);
    at = end + 1;
    if (!tag) continue;
    const name = tag[2].toLowerCase(), closing = Boolean(tag[1]);
    if (name === 'plaintext' && !closing) break;
    if (name === 'template') { templateDepth = Math.max(0, templateDepth + (closing ? -1 : 1)); continue; }
    if (['svg', 'math'].includes(name)) {
      if (closing && namespaces.at(-1) === name) namespaces.pop();
      else if (!closing && !/\/\s*$/.test(token)) namespaces.push(name);
      continue;
    }
    if (!closing && ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'].includes(name)) {
      const tail = new RegExp('</' + name + '\\s*>', 'ig'); tail.lastIndex = at;
      const close = tail.exec(html); at = close ? tail.lastIndex : html.length; continue;
    }
    if (closing || templateDepth || namespaces.length || !['meta', 'link'].includes(name)) continue;
    const attrs = attributes(token.slice(tag[0].length)); if (!attrs) continue;
    let candidate, evidence;
    if (name === 'meta' && attrs['http-equiv']?.trim().toLowerCase() === 'refresh') {
      candidate = refresh(attrs.content); evidence = 'meta_refresh';
    } else if (name === 'link' && attrs.rel?.toLowerCase().split(/\s+/).includes('web-switcher-successor')) {
      candidate = attrs.href; evidence = 'successor_link';
    }
    if (!candidate) continue;
    // Preserve unsafe explicit declarations as a refusal, not a silent fallback.
    try { hints.push({url: normalizeProbeUrl(candidate.trim(), base, options), evidence}); }
    catch { hints.push({evidence, invalid: true}); }
    if (hints.length > 8) throw new Error('TOO_MANY_SUCCESSOR_HINTS');
  }
  return hints;
}

function networkReason(error) {
  if (/^net::ERR_(?:CERT_|SSL_|BAD_SSL)/.test(error || '')) return 'TLS_ERROR';
  if (error === 'net::ERR_NAME_NOT_RESOLVED' || error === 'net::ERR_NAME_RESOLUTION_FAILED') return 'NETWORK_DNS_FAILURE';
  if (/^net::ERR_(?:CONNECTION_REFUSED|CONNECTION_CLOSED|CONNECTION_RESET|CONNECTION_TIMED_OUT|EMPTY_RESPONSE|TIMED_OUT|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)$/.test(error || '')) return 'NETWORK_CONNECTION_FAILURE';
  if (/BLOCKED|ACCESS_DENIED|CORS/.test(error || '')) return 'FETCH_BLOCKED';
  return 'FETCH_ERROR';
}

export function createContinuityProbe(chromeApi, {allowTestOrigins = false, fetchImpl = fetch} = {}) {
  const pending = new Map();
  const ownInitiator = chromeApi.runtime.getURL('').replace(/\/$/, '');
  const filter = {urls: ['https://*/*', ...(allowTestOrigins ? ['http://*.test/*'] : [])], types: ['xmlhttprequest']};
  const match = details => {
    const item = pending.get(details.url);
    if (!item || details.tabId !== -1 || details.type !== 'xmlhttprequest' || details.method !== 'GET' || details.initiator?.replace(/\/$/, '') !== ownInitiator) return null;
    if (item.requestId && item.requestId !== details.requestId) return null;
    item.requestId = details.requestId; return item;
  };
  const headers = details => {
    const item = match(details); if (!item || details.statusCode < 200) return;
    item.statusCode = details.statusCode;
    item.headers = (details.responseHeaders || []).filter(header => ['location', 'refresh', 'content-type'].includes(header.name?.toLowerCase()));
  };
  const failed = details => { const item = match(details); if (item) { item.networkError = details.error; item.errorReceived(); } };
  const ready = Boolean(chromeApi.webRequest?.onHeadersReceived && chromeApi.webRequest?.onErrorOccurred);
  if (ready) {
    chromeApi.webRequest.onHeadersReceived.addListener(headers, filter, ['responseHeaders']);
    chromeApi.webRequest.onErrorOccurred.addListener(failed, filter);
  }
  const options = {allowTestOrigins};
  const probe = async (input, {signal} = {}) => {
    let url;
    try { url = normalizeProbeUrl(input, undefined, options); }
    catch (error) { return {url: '', origin: '', status: 'blocked', httpStatus: 0, reason: error.message}; }
    const origin = new URL(url).origin;
    const base = {url, origin};
    if (!ready || !await chromeApi.permissions.contains({origins: [origin + '/*']})) return {...base, status: 'unavailable', httpStatus: 0, reason: 'PERMISSION_REQUIRED'};
    if (pending.has(url) || pending.size >= 4) return {...base, status: 'unavailable', httpStatus: 0, reason: 'PROBE_BUSY'};
    const item = {headers: []}; item.errorEvent = new Promise(resolve => { item.errorReceived = resolve; });
    pending.set(url, item);
    const controller = new AbortController(); let timer, timedOut = false, reader, response;
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('PROBE_TIMEOUT')); }, 8000); });
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('PROBE_ABORTED')), {once: true}));
    void aborted.catch(() => {});
    try {
      if (controller.signal.aborted) return {...base, status: 'unavailable', httpStatus: 0, reason: 'ABORTED'};
      response = await Promise.race([fetchImpl(url, {method: 'GET', redirect: 'manual', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal}), deadline, aborted]);
      const httpStatus = item.statusCode || response.status;
      if (response.redirected || (response.url && response.url !== url)) return {...base, status: 'blocked', httpStatus, reason: 'UNEXPECTED_TRANSPORT_REDIRECT'};
      const values = name => item.headers.filter(header => header.name.toLowerCase() === name).map(header => header.value || '');
      if ([301, 302, 303, 307, 308].includes(httpStatus)) {
        const locations = [...new Set(values('location').map(value => value.trim()))];
        if (locations.length !== 1 || !locations[0]) return {...base, status: 'ambiguous', httpStatus, reason: 'REDIRECT_LOCATION_UNAVAILABLE'};
        try { return {...base, status: 'redirect', httpStatus, successorUrl: normalizeProbeUrl(locations[0], url, options), evidence: 'http_redirect'}; }
        catch { return {...base, status: 'blocked', httpStatus, reason: 'UNSAFE_SUCCESSOR'}; }
      }
      if (httpStatus < 200 || httpStatus >= 300) return {...base, status: 'unavailable', httpStatus, reason: httpStatus ? 'HTTP_' + httpStatus : 'REDIRECT_HEADERS_UNAVAILABLE'};
      const hints = [];
      for (const value of values('refresh')) {
        const next = refresh(value); if (!next) continue;
        try { hints.push({url: normalizeProbeUrl(next, url, options), evidence: 'http_refresh'}); }
        catch { hints.push({evidence: 'http_refresh', invalid: true}); }
      }
      const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (['text/html', 'application/xhtml+xml', 'application/json'].includes(type)) {
        reader = response.body?.getReader();
        const chunks = []; let size = 0;
        if (reader) for (;;) {
          const {done, value} = await Promise.race([reader.read(), deadline, aborted]); if (done) break;
          size += value.byteLength; if (size > MAX_BODY) return {...base, status: 'blocked', httpStatus, reason: 'RESPONSE_TOO_LARGE'};
          chunks.push(value);
        }
        const bytes = new Uint8Array(size); let cursor = 0;
        for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
        const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
        if (type === 'application/json' && new URL(url).pathname === '/.well-known/web-switcher.json') {
          // This project convention is only reached when a preceding explicit
          // link/header advertised it; the probe never guesses/fetches this path.
          let document;
          try { document = parseStrictJson(text); }
          catch { return {...base, status: 'blocked', httpStatus, reason: 'INVALID_CONTINUITY_MANIFEST'}; }
          if (!document || Array.isArray(document) || document.schemaVersion !== 1 || Object.keys(document).some(key => !['schemaVersion', 'successorOrigin'].includes(key)) || typeof document.successorOrigin !== 'string') return {...base, status: 'blocked', httpStatus, reason: 'INVALID_CONTINUITY_MANIFEST'};
          try { hints.push({url: normalizeProbeUrl(originOf(document.successorOrigin, {...options, target: true}), undefined, options), evidence: 'well_known'}); }
          catch { return {...base, status: 'blocked', httpStatus, reason: 'UNSAFE_SUCCESSOR'}; }
        } else if (type !== 'application/json') hints.push(...extractContinuityHints(text, url, options));
      }
      if (hints.some(hint => hint.invalid)) return {...base, status: 'blocked', httpStatus, reason: 'UNSAFE_SUCCESSOR'};
      const targets = [...new Set(hints.map(hint => hint.url))];
      if (targets.length > 1) return {...base, status: 'ambiguous', httpStatus, hints, reason: 'CONFLICTING_SUCCESSORS'};
      // Same-origin metadata paths are returned too. The graph performs the next
      // request explicitly, so every HTTP request consumes one probe-budget unit.
      if (targets.length === 1) return {...base, status: 'redirect', httpStatus, successorUrl: targets[0], evidence: hints[0].evidence};
      return {...base, status: 'reachable', httpStatus};
    } catch (error) {
      if (!item.networkError && !timedOut && !signal?.aborted) await Promise.race([item.errorEvent, new Promise(resolve => setTimeout(resolve, 75))]);
      const reason = timedOut ? 'TIMEOUT' : signal?.aborted ? 'ABORTED' : error.message === 'RESPONSE_TOO_LARGE' ? 'RESPONSE_TOO_LARGE' : networkReason(item.networkError);
      return {...base, status: 'unavailable', httpStatus: item.statusCode || 0, reason};
    } finally {
      clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort); pending.delete(url);
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  };
  probe.dispose = () => {
    if (ready) { chromeApi.webRequest.onHeadersReceived.removeListener(headers); chromeApi.webRequest.onErrorOccurred.removeListener(failed); }
  };
  return probe;
}
