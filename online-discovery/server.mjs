import http from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {mkdirSync, existsSync, statSync} from 'node:fs';
import {parseStrictJson} from '../packages/security/catalog.mjs';
import {normalizeSource} from '../extension/continuity.js';
import {buildInternetResult} from '../extension/internet-contract.js';
import {DiscoveryStore} from './store.mjs';
import {DiscoveryRunner} from './runner.mjs';
import {createHttpRequester} from './providers.mjs';

const digest = value => createHash('sha256').update(value).digest();
const publicError = (code, detail) => Object.assign(new Error(detail), {code});
function integer(value, fallback, min, max, name) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Invalid ${name}.`); return number;
}
export function configFromEnvironment(env = process.env) {
  const enabled = env.ONLINE_DISCOVERY_ENABLED === 'true';
  const tokens = (env.ONLINE_ACCESS_TOKENS || '').split(',').map(value => value.trim()).filter(Boolean);
  if (tokens.length > 100 || tokens.some(value => !/^[A-Za-z0-9_-]{32,256}$/.test(value)) || new Set(tokens).size !== tokens.length) throw new Error('Configure distinct 32–256 character invitation tokens.');
  if (enabled && !tokens.length) throw new Error('Enabled online discovery requires invitation tokens.');
  const allowedOrigins = (env.ONLINE_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) continue;
    const url = new URL(origin); if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('Invalid allowed browser origin.');
  }
  return {
    enabled, tokens, allowedOrigins,
    port: integer(env.ONLINE_PORT, 8082, 1, 65535, 'ONLINE_PORT'), bind: env.ONLINE_BIND || '127.0.0.1',
    databasePath: resolve(env.ONLINE_DATABASE_PATH || 'data/online-discovery.sqlite'),
    braveKey: env.BRAVE_SEARCH_API_KEY || '', archiveEnabled: env.ONLINE_ARCHIVE_ENABLED !== 'false',
    fetcherUrl: env.FETCHER_URL || '', fetcherToken: env.FETCHER_INTERNAL_TOKEN || '',
    concurrency: integer(env.ONLINE_CONCURRENCY, 2, 1, 4, 'ONLINE_CONCURRENCY')
  };
}
function ownerFor(request, tokenHashes) {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(value)) return null;
  const candidate = digest(value.slice(7)); let valid = false;
  for (const hash of tokenHashes) valid = timingSafeEqual(candidate, hash) || valid;
  return valid ? candidate.toString('hex') : null;
}
async function jsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw publicError('JSON_REQUIRED', 'Send application/json.');
  const size = Number(request.headers['content-length']); if (Number.isFinite(size) && size > 4096) throw publicError('BODY_TOO_LARGE', 'Request is too large.');
  let bytes = 0; const chunks = [];
  for await (const chunk of request) {bytes += chunk.length; if (bytes > 4096) throw publicError('BODY_TOO_LARGE', 'Request is too large.'); chunks.push(chunk);}
  try {return parseStrictJson(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)), {maxBytes: 4096});}
  catch {throw publicError('INVALID_JSON', 'Send one valid JSON object with unique keys.');}
}
function envelope(job) {
  if (job.result && job.status === 'completed') return structuredClone(job.result);
  const reason = job.reason || (job.status === 'cancelled' ? 'USER_CANCELLED' : job.status === 'expired' ? 'JOB_EXPIRED' : 'DISCOVERY_PENDING');
  return buildInternetResult(job.sourceOrigin, [], {jobId: job.id, createdAt: job.createdAt, expiresAt: job.expiresAt, status: job.status, outcome: ['failed', 'expired'].includes(job.status) ? 'unavailable' : 'unknown', reasonCodes: [reason], completeness: 'partial', phase: job.phase});
}

export function createDiscoveryApplication({store, request = createHttpRequester(), tokens, allowedOrigins = [], enabled = true, braveKey = '', archiveEnabled = true, fetcherUrl = '', fetcherToken = '', concurrency = 2, runnerOptions = {}} = {}) {
  if (!store) throw new Error('A durable discovery store is required.');
  if (!Array.isArray(tokens) || enabled && !tokens.length || tokens.length > 100 || tokens.some(token => !/^[A-Za-z0-9_-]{32,256}$/.test(token)) || new Set(tokens).size !== tokens.length) throw new Error('Distinct invitation tokens are required.');
  const tokenHashes = tokens.map(digest), cors = new Set(allowedOrigins);
  const runner = new DiscoveryRunner({store, request, braveKey, archiveEnabled, fetcherUrl, fetcherToken, concurrency, ...runnerOptions});
  const reply = (response, status, body, origin) => {
    const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'"};
    if (origin && cors.has(origin)) {headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin';}
    response.writeHead(status, headers); response.end(JSON.stringify(body));
  };
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    try {
      if (typeof request.url !== 'string' || request.url.includes('?') || request.url.includes('#') || /[\\\u0000-\u0020]/.test(request.url)) {reply(response, 404, {code: 'NOT_FOUND'}, origin); return;}
      if (request.url === '/health/live' && request.method === 'GET') {reply(response, 200, {status: 'UP'}, origin); return;}
      if (request.url === '/health/ready' && request.method === 'GET') {
        let ready = false; try {ready = enabled && (archiveEnabled || Boolean(braveKey)) && store.health();} catch { /* No database details in public errors. */ }
        reply(response, ready ? 200 : 503, {status: ready ? 'UP' : 'UNAVAILABLE', searchConfigured: Boolean(braveKey), archivesEnabled: archiveEnabled}, origin); return;
      }
      if (request.method === 'OPTIONS') {
        if (!origin || !cors.has(origin)) {reply(response, 403, {code: 'ORIGIN_NOT_ALLOWED'}, origin); return;}
        response.writeHead(204, {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Vary': 'Origin', 'Cache-Control': 'no-store'}); response.end(); return;
      }
      if (!enabled) {reply(response, 503, {code: 'DISCOVERY_DISABLED'}, origin); return;}
      if (origin && !cors.has(origin) && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {reply(response, 403, {code: 'ORIGIN_NOT_ALLOWED'}, origin); return;}
      const owner = ownerFor(request, tokenHashes);
      if (!owner) {reply(response, 401, {code: 'UNAUTHORIZED'}, origin); return;}
      if (request.url === '/v2/discoveries') {
        if (request.method !== 'POST') {reply(response, 405, {code: 'METHOD_NOT_ALLOWED'}, origin); return;}
        const data = await jsonBody(request);
        if (!data || Array.isArray(data) || Object.keys(data).some(key => !['hostname', 'clientVersion'].includes(key)) || typeof data.hostname !== 'string' || data.clientVersion !== undefined && (typeof data.clientVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(data.clientVersion))) throw publicError('INVALID_REQUEST', 'Supply a public hostname only.');
        const source = normalizeSource('https://' + data.hostname);
        if (new URL(source).hostname !== data.hostname || data.hostname.includes(':')) throw publicError('INVALID_HOSTNAME', 'Supply a normalized public hostname, without paths or URL data.');
        const job = store.enqueue(owner, source); runner.tick();
        reply(response, ['queued', 'running'].includes(job.status) ? 202 : 200, envelope(job), origin); return;
      }
      const match = /^\/v2\/discoveries\/([A-Za-z0-9_-]{1,80})$/.exec(request.url);
      if (!match) {reply(response, 404, {code: 'NOT_FOUND'}, origin); return;}
      if (!['GET', 'DELETE'].includes(request.method)) {reply(response, 405, {code: 'METHOD_NOT_ALLOWED'}, origin); return;}
      if (request.method === 'GET') store.admitPoll(owner);
      const job = request.method === 'DELETE' ? store.cancel(owner, match[1]) : store.get(owner, match[1]);
      if (!job) {reply(response, 404, {code: 'NOT_FOUND'}, origin); return;}
      if (request.method === 'DELETE') runner.cancel(job.id);
      reply(response, 200, envelope(job), origin);
    } catch (error) {
      const code = error.code || 'INVALID_REQUEST';
      const status = /BUDGET|RATE|QUEUE_LIMIT/.test(code) ? 429 : code === 'BODY_TOO_LARGE' ? 413 : code === 'JSON_REQUIRED' ? 415 : ['INVALID_REQUEST', 'INVALID_HOSTNAME', 'INVALID_JSON'].includes(code) || !error.code ? 400 : 503;
      reply(response, status, {code: /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'DISCOVERY_UNAVAILABLE'}, origin);
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 32; server.maxConnections = 100; server.maxRequestsPerSocket = 100;
  if (enabled) runner.start();
  return {server, runner, store, async close() {await runner.close(); const stopped = new Promise(resolveClose => server.close(resolveClose)); server.closeAllConnections(); await stopped; request.close?.();}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = configFromEnvironment();
  const directory = resolve(config.databasePath, '..');
  if (!existsSync(directory)) mkdirSync(directory, {recursive: true, mode: 0o700});
  const directoryInfo = statSync(directory);
  // Refuse a shared data directory rather than chmod an operator-selected
  // parent such as /tmp or another application's existing directory.
  if (!directoryInfo.isDirectory() || (directoryInfo.mode & 0o077) !== 0) throw new Error('The discovery database needs a private directory (mode 0700).');
  const store = new DiscoveryStore({path: config.databasePath, limits: {maxConcurrency: config.concurrency}});
  const app = createDiscoveryApplication({...config, store});
  app.server.listen(config.port, config.bind, () => console.log(`Online discovery listening on ${config.bind}:${config.port}; configured providers, authentication and budgets are enforced.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {void app.close().finally(() => {store.close(); process.exit(0);});});
}
