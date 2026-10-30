import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync, chmodSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {originOf} from '../extension/core.js';

export class StoreError extends Error {
  constructor(code, message = code) { super(message); this.name = 'StoreError'; this.code = code; }
}

export const DEFAULT_LIMITS = Object.freeze({
  jobTtlMs: 24 * 60 * 60 * 1000, deadlineMs: 120000, activeMs: 60000,
  leaseMs: 15000, attempts: 3, maxConcurrency: 2,
  maxSearchCalls: 2, maxArchiveIndexCalls: 2, maxArchiveSnapshotCalls: 3,
  maxFetcherCalls: 3, maxWebRequests: 30, maxBytes: 8 * 1024 * 1024,
  queuedPerOwnerHour: 20, queuedPerHour: 100, maxJobs: 1000,
  searchCallsPerOwnerHour: 20, searchCallsPerHour: 20, searchCallsPerDay: 100,
  archiveCallsPerOwnerHour: 100, archiveCallsPerHour: 500, archiveCallsPerDay: 2000,
  pollsPerOwnerHour: 1200, pollsPerHour: 10000,
  positiveCacheMs: 3600000, negativeCacheMs: 900000, unavailableCacheMs: 300000,
});
const PHASE = /^[a-z][a-z0-9_-]{0,47}$/;
const REASON = /^[A-Z][A-Z0-9_]{0,79}$/;
const OWNER = /^[a-f0-9]{64}$/;
const terminal = new Set(['completed', 'failed', 'cancelled', 'expired']);
const byteLength = value => Buffer.byteLength(value, 'utf8');

function serializable(value, maximum = 256 * 1024) {
  let text;
  try { text = JSON.stringify(value); } catch { throw new StoreError('INVALID_RECORD'); }
  if (typeof text !== 'string' || byteLength(text) > maximum) throw new StoreError('RECORD_TOO_LARGE');
  return text;
}
function positiveInteger(value, key) {
  if (!Number.isSafeInteger(value) || value < 1) throw new StoreError('INVALID_LIMIT', `Invalid ${key}.`);
}
function sourceOrigin(value) {
  if (typeof value !== 'string' || value.length > 512) throw new StoreError('INVALID_SOURCE');
  let url;
  try { url = new URL(value); } catch { throw new StoreError('INVALID_SOURCE'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.port || !/^[a-z0-9.-]+$/i.test(url.hostname)) throw new StoreError('INVALID_SOURCE');
  try { if (originOf(value, {target: true}) !== value) throw new Error(); } catch { throw new StoreError('INVALID_SOURCE'); }
  return value;
}

/**
 * Separate durable storage for the optional online service. It has no registry
 * database connection, signing key, or ability to publish a trusted route.
 * All methods are synchronous short SQLite transactions; no network I/O occurs
 * under a database lock. Callers must supply an already authenticated owner hash.
 */
export class DiscoveryStore {
  constructor({path = './data/online-discovery.sqlite', now = Date.now, limits = {}} = {}) {
    if (Object.keys(limits).some(key => !Object.hasOwn(DEFAULT_LIMITS, key))) throw new StoreError('INVALID_LIMIT', 'Unknown discovery limit.');
    this.now = now;
    this.limits = {...DEFAULT_LIMITS, ...limits};
    for (const [key, value] of Object.entries(this.limits)) positiveInteger(value, key);
    if (this.limits.maxConcurrency > 4 || this.limits.maxSearchCalls > 2 || this.limits.maxArchiveIndexCalls > 2 || this.limits.maxArchiveSnapshotCalls > 3 || this.limits.maxFetcherCalls > 3 || this.limits.maxWebRequests > 30 || this.limits.maxBytes > 8 * 1024 * 1024 || this.limits.deadlineMs > 120000 || this.limits.activeMs > 60000 || this.limits.attempts > 3 || this.limits.leaseMs > 15000) throw new StoreError('INVALID_LIMIT', 'Limits may tighten the hard ceilings, not relax them.');
    this.path = path === ':memory:' ? path : resolve(path);
    if (this.path !== ':memory:') mkdirSync(dirname(this.path), {recursive: true, mode: 0o700});
    this.db = new DatabaseSync(this.path);
    if (this.path !== ':memory:') chmodSync(this.path, 0o600);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA journal_mode=WAL;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version !== 0 && version !== 1) { this.db.close(); throw new StoreError('UNSUPPORTED_SCHEMA'); }
    if (version === 0) {
      const tables = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (tables.length) { this.db.close(); throw new StoreError('UNSUPPORTED_SCHEMA'); }
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE jobs (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL CHECK(length(owner)=64), source_origin TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled','expired')),
          phase TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          deadline_at INTEGER NOT NULL, cache_until INTEGER NOT NULL DEFAULT 0,
          attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0 AND attempt<=3),
          active_ms INTEGER NOT NULL DEFAULT 0 CHECK(active_ms>=0),
          last_active_at INTEGER, lease_token TEXT, lease_until INTEGER,
          search_calls INTEGER NOT NULL DEFAULT 0 CHECK(search_calls>=0 AND search_calls<=2),
          archive_index_calls INTEGER NOT NULL DEFAULT 0 CHECK(archive_index_calls>=0 AND archive_index_calls<=2),
          archive_snapshot_calls INTEGER NOT NULL DEFAULT 0 CHECK(archive_snapshot_calls>=0 AND archive_snapshot_calls<=3),
          fetcher_calls INTEGER NOT NULL DEFAULT 0 CHECK(fetcher_calls>=0 AND fetcher_calls<=3),
          web_requests INTEGER NOT NULL DEFAULT 0 CHECK(web_requests>=0 AND web_requests<=30),
          bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes>=0 AND bytes<=8388608),
          progress TEXT, result TEXT, reason TEXT
        );
        CREATE INDEX jobs_ready ON jobs(status,created_at);
        CREATE INDEX jobs_owner_source ON jobs(owner,source_origin,created_at DESC);
        CREATE TABLE budgets (bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, used INTEGER NOT NULL CHECK(used>=0));
        PRAGMA user_version=1;
        COMMIT;
      `);
    }
  }

  #at() {
    const at = this.now();
    if (!Number.isSafeInteger(at) || at < 0) throw new StoreError('CLOCK_ANOMALY');
    return at;
  }
  #transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const answer = work(); this.db.exec('COMMIT'); return answer; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  #row(id) { return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id); }
  #job(row) {
    if (!row) return null;
    return {id: row.id, jobId: row.id, owner: row.owner, sourceOrigin: row.source_origin,
      status: row.status, phase: row.phase, createdAt: row.created_at, expiresAt: row.expires_at,
      deadlineAt: row.deadline_at, cacheUntil: row.cache_until, attempt: row.attempt,
      activeMs: row.active_ms, lastActiveAt: row.last_active_at,
      leaseToken: row.lease_token, leaseUntil: row.lease_until,
      searchCalls: row.search_calls, archiveIndexCalls: row.archive_index_calls,
      archiveSnapshotCalls: row.archive_snapshot_calls, fetcherCalls: row.fetcher_calls,
      webRequests: row.web_requests, bytes: row.bytes,
      progress: row.progress ? JSON.parse(row.progress) : null,
      result: row.result ? JSON.parse(row.result) : null,
      reason: row.reason, reasonCodes: row.reason ? [row.reason] : []};
  }
  #end(row, at, status, reason, cacheMs = 0) {
    this.db.prepare('UPDATE jobs SET status=?,phase=?,reason=?,lease_token=NULL,lease_until=NULL,last_active_at=NULL,cache_until=? WHERE id=?').run(status, status, reason, Math.min(row.expires_at, at + cacheMs), row.id);
  }
  #touch(row, at) {
    if (!row || row.status !== 'running') return row;
    if (at < row.created_at || at < row.last_active_at) {
      this.#end(row, at, 'failed', 'CLOCK_ANOMALY'); return this.#row(row.id);
    }
    const elapsed = Math.max(0, Math.min(at, row.lease_until, row.deadline_at) - row.last_active_at);
    this.db.prepare('UPDATE jobs SET active_ms=active_ms+?,last_active_at=? WHERE id=?').run(elapsed, Math.min(at, row.lease_until, row.deadline_at), row.id);
    row = this.#row(row.id);
    if (at >= row.deadline_at) this.#end(row, at, 'expired', 'JOB_DEADLINE_EXCEEDED');
    else if (row.active_ms >= this.limits.activeMs) this.#end(row, at, 'failed', 'TIME_BUDGET_EXCEEDED', this.limits.unavailableCacheMs);
    else if (at >= row.lease_until) {
      if (row.attempt >= this.limits.attempts) this.#end(row, at, 'failed', 'ATTEMPT_LIMIT', this.limits.unavailableCacheMs);
      else this.db.prepare("UPDATE jobs SET status='queued',phase='recovering',lease_token=NULL,lease_until=NULL,last_active_at=NULL WHERE id=?").run(row.id);
    }
    return this.#row(row.id);
  }
  #maintain(at) {
    this.db.prepare('DELETE FROM jobs WHERE expires_at<=?').run(at);
    for (const row of this.db.prepare("SELECT * FROM jobs WHERE status='running'").all()) this.#touch(row, at);
    this.db.prepare("UPDATE jobs SET status='expired',phase='expired',reason='JOB_DEADLINE_EXCEEDED',cache_until=0 WHERE status='queued' AND deadline_at<=?").run(at);
    // Clock rollback cannot make a future accepted cache result current again.
    this.db.prepare("UPDATE jobs SET status='failed',phase='failed',reason='CLOCK_ANOMALY',cache_until=0,result=NULL,lease_token=NULL,lease_until=NULL,last_active_at=NULL WHERE created_at>?").run(at);
    // Hourly and daily windows have different units. Deleting a daily row by
    // an hourly threshold would reset paid quotas on every maintenance pass.
    this.db.prepare("DELETE FROM budgets WHERE (bucket LIKE '%:hour' AND window<?) OR (bucket LIKE '%:day' AND window<?)").run(Math.floor(at / 3600000) - 48, Math.floor(at / 86400000) - 2);
  }
  #owned(id, token, at) {
    const row = this.#touch(this.#row(id), at);
    return row && row.status === 'running' && row.lease_token === token && row.lease_until > at && row.deadline_at > at ? row : null;
  }
  #charge(items) {
    for (const {bucket, window, amount = 1, ceiling} of items) {
      const previous = this.db.prepare('SELECT window,used FROM budgets WHERE bucket=?').get(bucket);
      if (previous && previous.window > window) throw new StoreError('CLOCK_ANOMALY');
      const used = previous?.window === window ? previous.used : 0;
      if (used + amount > ceiling) throw new StoreError('BUDGET_EXCEEDED');
    }
    for (const {bucket, window, amount = 1} of items) {
      this.db.prepare('INSERT INTO budgets(bucket,window,used) VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET used=CASE WHEN budgets.window=excluded.window THEN budgets.used+excluded.used ELSE excluded.used END,window=excluded.window').run(bucket, window, amount);
    }
  }

  enqueue(owner, source) {
    if (!OWNER.test(owner)) throw new StoreError('INVALID_OWNER');
    source = sourceOrigin(source);
    return this.#transaction(() => {
      const at = this.#at(); this.#maintain(at);
      const cached = this.db.prepare("SELECT * FROM jobs WHERE owner=? AND source_origin=? AND ((status IN ('queued','running') AND deadline_at>?) OR (status IN ('completed','failed') AND cache_until>?)) ORDER BY created_at DESC,rowid DESC LIMIT 1").get(owner, source, at, at);
      if (cached) return this.#job(cached);
      if (this.db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count >= this.limits.maxJobs) throw new StoreError('QUEUE_CAPACITY');
      const hour = Math.floor(at / 3600000);
      this.#charge([{bucket: 'queue:global:hour', window: hour, ceiling: this.limits.queuedPerHour}, {bucket: `queue:owner:${owner}:hour`, window: hour, ceiling: this.limits.queuedPerOwnerHour}]);
      const id = randomUUID();
      this.db.prepare("INSERT INTO jobs(id,owner,source_origin,status,phase,created_at,expires_at,deadline_at) VALUES(?,?,?,'queued','queued',?,?,?)").run(id, owner, source, at, at + this.limits.jobTtlMs, at + this.limits.deadlineMs);
      return this.#job(this.#row(id));
    });
  }
  get(owner, id) {
    if (!OWNER.test(owner) || typeof id !== 'string') return null;
    return this.#transaction(() => { this.#maintain(this.#at()); const row = this.#row(id); return row?.owner === owner ? this.#job(row) : null; });
  }
  admitPoll(owner) {
    if (!OWNER.test(owner)) throw new StoreError('INVALID_OWNER');
    return this.#transaction(() => {
      const at = this.#at(); this.#maintain(at); const hour = Math.floor(at / 3600000);
      this.#charge([{bucket: 'poll:global:hour', window: hour, ceiling: this.limits.pollsPerHour}, {bucket: `poll:owner:${owner}:hour`, window: hour, ceiling: this.limits.pollsPerOwnerHour}]);
      return true;
    });
  }
  cancel(owner, id) {
    if (!OWNER.test(owner)) return null;
    return this.#transaction(() => {
      const at = this.#at(); this.#maintain(at); const row = this.#row(id);
      if (!row || row.owner !== owner) return null;
      // A caller can withdraw a completed suggestion too. Do not reintroduce
      // that cached result on the next lookup; keep charged budgets intact.
      if (row.status !== 'cancelled') this.#end(row, at, 'cancelled', 'USER_CANCELLED');
      return this.#job(this.#row(id));
    });
  }
  claim() {
    return this.#transaction(() => {
      const at = this.#at(); this.#maintain(at);
      if (this.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status='running'").get().count >= this.limits.maxConcurrency) return null;
      // UUID lexical order is unrelated to submission order. SQLite rowid is
      // the durable insertion tie-breaker for jobs sharing one clock tick.
      const row = this.db.prepare("SELECT * FROM jobs WHERE status='queued' AND deadline_at>? AND attempt<? ORDER BY created_at,rowid LIMIT 1").get(at, this.limits.attempts);
      if (!row) return null;
      const token = randomUUID();
      this.db.prepare("UPDATE jobs SET status='running',phase=CASE WHEN phase='queued' THEN 'discovering' ELSE phase END,attempt=attempt+1,lease_token=?,lease_until=?,last_active_at=? WHERE id=?").run(token, Math.min(at + this.limits.leaseMs, row.deadline_at), at, row.id);
      return {job: this.#job(this.#row(row.id)), leaseToken: token};
    });
  }
  renew(id, token) {
    return this.#transaction(() => {
      const at = this.#at(); const row = this.#owned(id, token, at); if (!row) return false;
      this.db.prepare('UPDATE jobs SET lease_until=? WHERE id=?').run(Math.min(at + this.limits.leaseMs, row.deadline_at), id); return true;
    });
  }
  setPhase(id, token, phase) {
    if (!PHASE.test(phase)) throw new StoreError('INVALID_PHASE');
    return this.#transaction(() => { const row = this.#owned(id, token, this.#at()); if (!row) return false; this.db.prepare('UPDATE jobs SET phase=? WHERE id=?').run(phase, id); return true; });
  }
  checkpoint(id, token, progress) {
    const text = serializable(progress);
    return this.#transaction(() => { const row = this.#owned(id, token, this.#at()); if (!row) return false; this.db.prepare('UPDATE jobs SET progress=? WHERE id=?').run(text, id); return true; });
  }
  reserve(id, token, {kind, bytes = 0, webRequests} = {}) {
    const definitions = {
      search: ['search_calls', this.limits.maxSearchCalls, 0],
      archive_index: ['archive_index_calls', this.limits.maxArchiveIndexCalls, 0],
      archive_snapshot: ['archive_snapshot_calls', this.limits.maxArchiveSnapshotCalls, 1],
      fetcher: ['fetcher_calls', this.limits.maxFetcherCalls, 8],
    };
    if (!definitions[kind] || !Number.isSafeInteger(bytes) || bytes < 0 || (webRequests !== undefined && (!Number.isSafeInteger(webRequests) || webRequests < 0))) throw new StoreError('INVALID_RESERVATION');
    const [column, limit, minimumWeb] = definitions[kind];
    if (webRequests !== undefined && webRequests < minimumWeb) throw new StoreError('INVALID_RESERVATION');
    webRequests ??= minimumWeb;
    return this.#transaction(() => {
      const at = this.#at(), row = this.#owned(id, token, at); if (!row) return false;
      if (row[column] >= limit || row.web_requests + webRequests > this.limits.maxWebRequests) throw new StoreError('BUDGET_EXCEEDED');
      if (row.bytes + bytes > this.limits.maxBytes) throw new StoreError('BYTE_BUDGET_EXCEEDED');
      if (kind === 'search' || kind.startsWith('archive_')) {
        const category = kind === 'search' ? 'search' : 'archive';
        const capitalized = category === 'search' ? 'searchCalls' : 'archiveCalls';
        this.#charge([
          {bucket: `${category}:global:hour`, window: Math.floor(at / 3600000), ceiling: this.limits[capitalized + 'PerHour']},
          {bucket: `${category}:global:day`, window: Math.floor(at / 86400000), ceiling: this.limits[capitalized + 'PerDay']},
          {bucket: `${category}:owner:${row.owner}:hour`, window: Math.floor(at / 3600000), ceiling: this.limits[capitalized + 'PerOwnerHour']},
        ]);
      }
      this.db.prepare(`UPDATE jobs SET ${column}=${column}+1,bytes=bytes+?,web_requests=web_requests+? WHERE id=?`).run(bytes, webRequests, id); return true;
    });
  }
  addBytes(id, token, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new StoreError('INVALID_RESERVATION');
    return this.#transaction(() => {
      const row = this.#owned(id, token, this.#at()); if (!row) return false;
      if (row.bytes + bytes > this.limits.maxBytes) throw new StoreError('BYTE_BUDGET_EXCEEDED');
      this.db.prepare('UPDATE jobs SET bytes=bytes+? WHERE id=?').run(bytes, id); return true;
    });
  }
  complete(id, token, result, {cacheSeconds} = {}) {
    const text = serializable(result);
    if (cacheSeconds !== undefined && (!Number.isSafeInteger(cacheSeconds) || cacheSeconds < 0 || cacheSeconds > 3600)) throw new StoreError('INVALID_CACHE');
    return this.#transaction(() => {
      const at = this.#at(), row = this.#owned(id, token, at); if (!row) return false;
      const outcome = result?.outcome;
      const cacheMs = cacheSeconds !== undefined ? cacheSeconds * 1000 : outcome === 'candidates' ? this.limits.positiveCacheMs : outcome === 'unavailable' ? this.limits.unavailableCacheMs : this.limits.negativeCacheMs;
      this.db.prepare("UPDATE jobs SET status='completed',phase='completed',result=?,reason=NULL,cache_until=?,lease_token=NULL,lease_until=NULL,last_active_at=NULL WHERE id=?").run(text, Math.min(row.expires_at, at + cacheMs), id); return true;
    });
  }
  fail(id, token, reason = 'DISCOVERY_UNAVAILABLE') {
    if (!REASON.test(reason)) throw new StoreError('INVALID_REASON');
    return this.#transaction(() => { const at = this.#at(), row = this.#owned(id, token, at); if (!row) return false; this.#end(row, at, 'failed', reason, this.limits.unavailableCacheMs); return true; });
  }
  prune() { return this.#transaction(() => { this.#maintain(this.#at()); return true; }); }
  health() { return this.db.prepare('PRAGMA quick_check').get().quick_check === 'ok'; }
  backup(path) {
    const destination = resolve(path); mkdirSync(dirname(destination), {recursive: true, mode: 0o700});
    this.db.prepare('VACUUM INTO ?').run(destination); chmodSync(destination, 0o600); return destination;
  }
  close() { this.db.close(); }
}
