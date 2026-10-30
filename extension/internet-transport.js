// Provider-only transport. Candidate websites use the separate continuity probe.
const MAX_BODY = 256 * 1024;
export function createInternetTransport(chromeApi, {allowTestOrigins = false, fetchImpl = fetch} = {}) {
  const pending = new Map(), initiator = chromeApi.runtime.getURL('').replace(/\/$/, '');
  const match = details => {
    const item = pending.get(details.url);
    if (!item || details.initiator?.replace(/\/$/, '') !== initiator || details.tabId !== -1 || details.type !== 'xmlhttprequest' || details.method !== item.method || item.requestId && item.requestId !== details.requestId) return null;
    item.requestId = details.requestId; return item;
  };
  const received = details => {
    const item = match(details); if (!item || details.statusCode < 200) return;
    item.status = details.statusCode; item.headers = {};
    for (const header of details.responseHeaders || []) {
      const name = header.name?.toLowerCase();
      if (!['location', 'x-archive-orig-location', 'refresh', 'content-type'].includes(name)) continue;
      const value = header.value || '';
      if (value.length > 4096) { item.invalid = true; continue; }
      if (Object.hasOwn(item.headers, name) && item.headers[name] !== value) item.invalid = true;
      item.headers[name] = value;
    }
    item.resolveHeaders();
  };
  const filter = {urls: ['https://*/*', ...(allowTestOrigins ? ['http://*.test/*'] : [])], types: ['xmlhttprequest']};
  if (chromeApi.webRequest?.onHeadersReceived) chromeApi.webRequest.onHeadersReceived.addListener(received, filter, ['responseHeaders']);
  const request = async (value, {signal, method = 'GET', json, accessToken, allowedOrigins = []} = {}) => {
    const url = new URL(value);
    if (url.username || url.password || url.hash || !allowedOrigins.includes(url.origin) || url.protocol !== 'https:' && !(allowTestOrigins && url.protocol === 'http:' && url.hostname.endsWith('.test')) || !['GET', 'POST', 'DELETE'].includes(method)) throw new Error('PROVIDER_URL_FORBIDDEN');
    if (!await chromeApi.permissions.contains({origins: [url.origin + '/*']})) throw new Error('PROVIDER_PERMISSION_REQUIRED');
    if (!chromeApi.webRequest?.onHeadersReceived || pending.has(url.href) || pending.size >= 4) throw new Error('PROVIDER_BUSY');
    const item = {method}; item.headerEvent = new Promise(resolve => {item.resolveHeaders = resolve;}); pending.set(url.href, item);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once: true});
    let timer, reader, response;
    const deadline = new Promise((_, reject) => {timer = setTimeout(() => {controller.abort(); reject(new Error('PROVIDER_TIMEOUT'));}, 8000);});
    const aborted = new Promise((_, reject) => {if (controller.signal.aborted) reject(new Error('CANCELLED')); else controller.signal.addEventListener('abort', () => reject(new Error('CANCELLED')), {once: true});});
    void aborted.catch(() => {});
    try {
      const headers = {};
      if (accessToken) {
        if (typeof accessToken !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(accessToken)) throw new Error('INVALID_SERVICE_TOKEN');
        headers.Authorization = 'Bearer ' + accessToken;
      }
      let body;
      if (json !== undefined) {body = JSON.stringify(json); if (body.length > 4096 || method !== 'POST') throw new Error('INVALID_PROVIDER_REQUEST'); headers['Content-Type'] = 'application/json';}
      response = await Promise.race([fetchImpl(url.href, {method, headers, body, redirect: 'manual', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal}), deadline, aborted]);
      if (response.redirected || response.url && response.url !== url.href) throw new Error('PROVIDER_REDIRECT_FORBIDDEN');
      await Promise.race([item.headerEvent, deadline, aborted]);
      if (item.invalid) throw new Error('AMBIGUOUS_PROVIDER_HEADERS');
      if (item.status >= 300 && item.status < 400) return {status: item.status, url: url.href, headers: item.headers, body: ''};
      reader = response.body?.getReader(); const chunks = []; let size = 0;
      if (reader) for (;;) {
        const {done, value: bytes} = await Promise.race([reader.read(), deadline, aborted]); if (done) break;
        size += bytes.byteLength; if (size > MAX_BODY) throw new Error('PROVIDER_RESPONSE_TOO_LARGE'); chunks.push(bytes);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
      return {status: item.status, url: url.href, headers: item.headers, body: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
    } finally {
      clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort); pending.delete(url.href);
      if (reader) void reader.cancel().catch(() => {}); else if (response?.body) void response.body.cancel().catch(() => {});
    }
  };
  request.dispose = () => chromeApi.webRequest?.onHeadersReceived.removeListener(received);
  return request;
}
