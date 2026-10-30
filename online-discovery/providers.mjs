import http from 'node:http';
import https from 'node:https';
import {parseStrictJson} from '../packages/security/catalog.mjs';
import {normalizeSource} from '../extension/continuity.js';

export class ProviderError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Fixed provider adapters call this transport. No public request can choose its
// destination or headers. Native Agent proxy support preserves managed egress;
// TLS verification and inherited CA configuration remain enabled.
export function createHttpRequester({proxyEnv = process.env} = {}) {
  const agents = {
    'http:': new http.Agent({keepAlive: true, maxSockets: 4, proxyEnv}),
    'https:': new https.Agent({keepAlive: true, maxSockets: 4, proxyEnv})
  };
  const request = (input, {signal, method = 'GET', headers = {}, body, maxBytes = 1024 * 1024, timeoutMs = 8000} = {}) => new Promise((resolve, reject) => {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || !['GET', 'POST'].includes(method) || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 32000 || body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body) > 4096 || method !== 'POST')) { reject(new ProviderError('INVALID_PROVIDER_REQUEST')); return; }
    const effective = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    const options = {method, signal: effective, agent: agents[url.protocol], headers: {'Accept': 'application/json, text/html;q=0.8', 'User-Agent': 'WebSwitcherDiscovery/0.1', ...headers}};
    const req = (url.protocol === 'https:' ? https : http).request(url, options, response => {
      const resultHeaders = {};
      for (const [key, value] of Object.entries(response.headers)) if (typeof value === 'string') resultHeaders[key] = value;
      if (response.statusCode >= 300 && response.statusCode < 400) {
        // Observe the Location without forwarding a provider key or fetching a
        // different origin. Do not drain an arbitrary redirect response body.
        resolve({status: response.statusCode, url: url.href, headers: resultHeaders, body: '', bytes: 0});
        response.destroy(); return;
      }
      const declared = Number(response.headers['content-length']);
      if ((Number.isFinite(declared) && declared > maxBytes) || ![undefined, 'identity'].includes(response.headers['content-encoding'])) {
        response.destroy(); reject(new ProviderError('PROVIDER_RESPONSE_LIMIT')); return;
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(new ProviderError('PROVIDER_RESPONSE_LIMIT')); return; }
        chunks.push(chunk);
      });
      response.on('error', error => reject(error instanceof ProviderError ? error : new ProviderError('PROVIDER_UNAVAILABLE')));
      response.on('end', () => {
        try {
          const text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
          resolve({status: response.statusCode, url: url.href, headers: resultHeaders, body: text, bytes});
        } catch { reject(new ProviderError('INVALID_PROVIDER_ENCODING')); }
      });
    });
    req.on('error', error => reject(error instanceof ProviderError ? error : new ProviderError(effective.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE')));
    if (body !== undefined) req.write(body);
    req.end();
  });
  request.close = () => Object.values(agents).forEach(agent => agent.destroy());
  return request;
}

const text = (value, max) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
export function createBraveSearch({apiKey = '', request, allowTestOrigins = false} = {}) {
  if (typeof request !== 'function') throw new Error('A provider transport is required.');
  if (apiKey && (!/^[\x21-\x7e]{8,512}$/.test(apiKey))) throw new Error('Invalid Brave credential format.');
  return {
    configured: Boolean(apiKey),
    async search(sourceOrigin, {signal} = {}) {
      if (!apiKey) return {leads: [], reasonCodes: ['SEARCH_NOT_CONFIGURED'], completeness: 'partial'};
      const source = normalizeSource(sourceOrigin, {allowTestOrigins});
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', `"${new URL(source).hostname}"`);
      url.searchParams.set('count', '10');
      url.searchParams.set('safesearch', 'strict');
      url.searchParams.set('spellcheck', 'false');
      const response = await request(url.href, {signal, maxBytes: 256 * 1024, headers: {'Accept': 'application/json', 'X-Subscription-Token': apiKey}});
      if (response.status === 401 || response.status === 403) throw new ProviderError('SEARCH_CREDENTIAL_REJECTED');
      if (response.status === 429) throw new ProviderError('SEARCH_QUOTA_REACHED');
      if (response.status !== 200) throw new ProviderError('SEARCH_UNAVAILABLE');
      if ((response.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new ProviderError('INVALID_SEARCH_RESPONSE');
      let payload;
      try { payload = parseStrictJson(response.body, {maxBytes: 256 * 1024}); }
      catch { throw new ProviderError('INVALID_SEARCH_RESPONSE'); }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.error !== undefined || payload.type !== undefined && payload.type !== 'search') throw new ProviderError('INVALID_SEARCH_RESPONSE');
      const results = payload.web?.results;
      if (payload.web !== undefined && (!payload.web || typeof payload.web !== 'object' || Array.isArray(payload.web) || !Array.isArray(results) || results.length > 100) || payload.web === undefined && payload.type !== 'search') throw new ProviderError('INVALID_SEARCH_RESPONSE');
      const leads = [];
      for (const result of results || []) {
        if (!result || typeof result.url !== 'string') continue;
        try {
          const origin = normalizeSource(result.url, {allowTestOrigins});
          if (origin === source || ['https://api.search.brave.com', 'https://search.brave.com', 'https://archive.org', 'https://web.archive.org'].includes(origin)) continue;
          const locator = new URL(result.url); locator.search = ''; locator.hash = '';
          leads.push({origin, title: text(result.title, 200), kind: 'search_result', sourceUrl: locator.href, summary: text(result.description, 500), provenanceGroup: locator.origin + locator.pathname});
        } catch { /* Invalid or unsafe search results are not candidate leads. */ }
        if (leads.length === 10) break;
      }
      return {leads, reasonCodes: leads.length ? ['PUBLIC_SEARCH_LEADS'] : ['NO_SEARCH_LEADS'], completeness: 'complete'};
    }
  };
}

export function createFetcherObserver({url = '', token = '', request, allowTestOrigins = false, now = Date.now} = {}) {
  if (!url && !token) return null;
  const endpoint = new URL(url);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname) || !/^[\x21-\x7e]{32,256}$/.test(token)) throw new Error('Configure an exact internal fetcher origin and valid bearer.');
  return async (origin, {signal} = {}) => {
    const input = normalizeSource(origin, {allowTestOrigins});
    const response = await request(new URL('/resolve', endpoint).href, {signal, method: 'POST', maxBytes: 64 * 1024, timeoutMs: 32000, headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`}, body: JSON.stringify({url: input + '/'})});
    if (response.status !== 200) throw new ProviderError('FETCHER_UNAVAILABLE');
    if ((response.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw new ProviderError('INVALID_FETCHER_RESPONSE');
    let payload;
    try { payload = parseStrictJson(response.body, {maxBytes: 64 * 1024}); }
    catch { throw new ProviderError('INVALID_FETCHER_RESPONSE'); }
    const expected = ['classification', 'httpStatus', 'finalOrigin', 'hops', 'chain', 'hints', 'bytes', 'sha256', 'checkedAt', 'identity', 'threatStatus'];
    try {
      const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
      const canonical = value => typeof value === 'string' && normalizeSource(value, {allowTestOrigins}) === value;
      const status = value => Number.isInteger(value) && value >= 100 && value <= 599;
      if (!object(payload, expected) || payload.identity !== 'UNVERIFIED' || payload.threatStatus !== 'UNKNOWN' || !status(payload.httpStatus) || !['REACHABLE', 'CHALLENGED_OR_THROTTLED', 'HTTP_ERROR'].includes(payload.classification) || !Array.isArray(payload.hops) || payload.hops.length < 1 || payload.hops.length > 4 || !Array.isArray(payload.chain) || payload.chain.length !== payload.hops.length - 1 || !Array.isArray(payload.hints) || payload.hints.length > 4 || !Number.isInteger(payload.bytes) || payload.bytes < 0 || payload.bytes > 1024 * 1024 || !/^[a-f0-9]{64}$/.test(payload.sha256 || '') || !canonical(payload.finalOrigin)) throw new Error();
      const terminal = payload.finalOrigin, checked = typeof payload.checkedAt === 'string' && payload.checkedAt.length <= 40 ? Date.parse(payload.checkedAt) : NaN;
      if (payload.hops[0]?.origin !== input || payload.hops.at(-1)?.origin !== terminal || !Number.isFinite(checked) || Math.abs(now() - checked) > 120000 || payload.hops.at(-1)?.status !== payload.httpStatus) throw new Error();
      const successful = payload.httpStatus >= 200 && payload.httpStatus < 300;
      const challenged = payload.httpStatus === 403 || payload.httpStatus === 429;
      if ((payload.classification === 'REACHABLE') !== successful || (payload.classification === 'CHALLENGED_OR_THROTTLED') !== challenged || payload.classification === 'HTTP_ERROR' && (successful || challenged)) throw new Error();
      for (const hop of payload.hops) if (!object(hop, ['origin', 'status']) || !canonical(hop.origin) || !status(hop.status)) throw new Error();
      const redirects = new Set([301, 302, 303, 307, 308]);
      for (const [index, edge] of payload.chain.entries()) {
        if (!object(edge, ['sourceOrigin', 'destinationOrigin', 'kind', 'httpStatus']) || edge.sourceOrigin !== payload.hops[index].origin || edge.destinationOrigin !== payload.hops[index + 1].origin || edge.httpStatus !== payload.hops[index].status || !['HTTP_REDIRECT', 'META_REFRESH', 'HTML_SUCCESSOR'].includes(edge.kind) || (edge.kind === 'HTTP_REDIRECT' ? !redirects.has(edge.httpStatus) : edge.httpStatus < 200 || edge.httpStatus >= 300)) throw new Error();
      }
      const hints = new Set();
      for (const hint of payload.hints) {
        if (!object(hint, ['origin', 'kind']) || hint.kind !== 'CANONICAL_HINT' || !canonical(hint.origin) || hints.has(hint.origin)) throw new Error();
        hints.add(hint.origin);
      }
      return {state: successful ? 'reachable' : 'unavailable', checkedAt: checked, vantage: 'server', terminalOrigin: terminal};
    } catch { throw new ProviderError('INVALID_FETCHER_RESPONSE'); }
  };
}
