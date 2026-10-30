import {buildInternetResult, validateInternetResult} from '../extension/internet-contract.js';
import {createArchiveDiscovery} from '../extension/internet-sources.js';
import {createBraveSearch, createFetcherObserver, ProviderError} from './providers.mjs';

const MAX_LEADS = 40;
const codeOf = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'PROVIDER_UNAVAILABLE';

/** Every external call passes a durable reservation before reaching transport. */
export class DiscoveryRunner {
  constructor({store, request, braveKey = '', archiveEnabled = true, fetcherUrl = '', fetcherToken = '', concurrency = 2, pollMs = 250, allowTestOrigins = false, providerUrls, archiveFactory = createArchiveDiscovery, now = Date.now}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid discovery concurrency.');
    this.store = store; this.request = request; this.braveKey = braveKey;
    this.archiveEnabled = archiveEnabled; this.allowTestOrigins = allowTestOrigins;
    this.providerUrls = providerUrls; this.archiveFactory = archiveFactory;
    this.now = now; this.concurrency = concurrency; this.pollMs = pollMs;
    this.observer = createFetcherObserver({url: fetcherUrl, token: fetcherToken, request, allowTestOrigins});
    this.active = new Map(); this.closed = false;
  }
  start() {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => this.tick(), this.pollMs); this.timer.unref(); this.tick();
  }
  tick() {
    if (this.closed) return;
    try {
      while (this.active.size < this.concurrency) {
        const claim = this.store.claim(); if (!claim) break;
        const controller = new AbortController();
        this.active.set(claim.job.id, {controller});
        const task = this.run(claim, controller).catch(() => { /* Lost storage leaves only a bounded reclaimable lease. */ }).finally(() => {this.active.delete(claim.job.id);});
        this.active.get(claim.job.id).task = task;
      }
    } catch { /* Store health/readiness exposes failures; never bypass admission. */ }
  }
  cancel(id) { this.active.get(id)?.controller.abort(); }
  async close() {
    this.closed = true; clearInterval(this.timer);
    for (const {controller} of this.active.values()) controller.abort();
    await Promise.allSettled([...this.active.values()].map(value => value.task));
  }
  async run({job, leaseToken}, controller) {
    const fence = () => {
      if (controller.signal.aborted || !this.store.renew(job.id, leaseToken)) throw new ProviderError('JOB_NO_LONGER_ACTIVE');
    };
    const reserve = (kind, bytes) => { fence(); if (!this.store.reserve(job.id, leaseToken, {kind, bytes})) throw new ProviderError('JOB_NO_LONGER_ACTIVE'); };
    const heartbeat = setInterval(() => {try {if (!this.store.renew(job.id, leaseToken)) controller.abort();} catch {controller.abort();}}, 5000);
    heartbeat.unref();
    const deadline = setTimeout(() => controller.abort(), Math.max(1, Math.min(60000, job.deadlineAt - this.now()))); deadline.unref();
    const progress = job.progress && typeof job.progress === 'object' ? structuredClone(job.progress) : {};
    let leads = Array.isArray(progress.leads) ? progress.leads.slice(0, MAX_LEADS) : [];
    const reasons = new Set(Array.isArray(progress.reasons) ? progress.reasons : []);
    let partial = Boolean(progress.partial);
    const checkpoint = () => {fence(); if (!this.store.checkpoint(job.id, leaseToken, {...progress, leads, reasons: [...reasons].slice(0, 16), partial})) throw new ProviderError('JOB_NO_LONGER_ACTIVE');};
    try {
      if (!progress.searchDone) {
        this.store.setPhase(job.id, leaseToken, 'search');
        const search = createBraveSearch({apiKey: this.braveKey, allowTestOrigins: this.allowTestOrigins, request: async (url, options) => {
          reserve('search', 256 * 1024);
          return this.request(url, {...options, signal: controller.signal});
        }});
        try {
          const result = await search.search(job.sourceOrigin, {signal: controller.signal});
          leads.push(...result.leads); result.reasonCodes.forEach(reason => reasons.add(reason)); partial ||= result.completeness === 'partial';
        } catch (error) {reasons.add(codeOf(error)); partial = true;}
        progress.searchDone = true; leads = leads.slice(0, MAX_LEADS); checkpoint();
      }
      if (!progress.archiveDone) {
        this.store.setPhase(job.id, leaseToken, 'archives');
        if (!this.archiveEnabled) {reasons.add('ARCHIVE_DISABLED'); partial = true;}
        else {
          const archive = this.archiveFactory({allowTestOrigins: this.allowTestOrigins, providerUrls: this.providerUrls, request: async (url, options) => {
            const target = new URL(url);
            const snapshot = /\/web\/\d{14}/.test(target.pathname);
            reserve(snapshot ? 'archive_snapshot' : 'archive_index', snapshot ? 1024 * 1024 : 256 * 1024);
            return this.request(url, {...options, signal: controller.signal, maxBytes: snapshot ? 1024 * 1024 : 256 * 1024});
          }});
          try {
            const result = await archive(job.sourceOrigin, {signal: controller.signal});
            // Prefer explicit historical pointers over search placement when
            // the bounded result set cannot include every lead.
            leads = [...result.leads, ...leads]; result.reasonCodes.forEach(reason => reasons.add(reason)); partial ||= result.completeness === 'partial';
          } catch (error) {reasons.add(codeOf(error)); partial = true;}
        }
        progress.archiveDone = true; leads = leads.slice(0, MAX_LEADS); checkpoint();
      }
      fence(); this.store.setPhase(job.id, leaseToken, 'evidence');
      const result = buildInternetResult(job.sourceOrigin, leads, {jobId: job.id, createdAt: job.createdAt, expiresAt: job.expiresAt, reasonCodes: [...reasons].slice(0, 16), completeness: partial ? 'partial' : 'complete', now: this.now(), allowTestOrigins: this.allowTestOrigins});
      if (this.observer) {
        const observations = progress.observations || {};
        for (const candidate of result.candidates) {
          if (observations[candidate.origin]) {candidate.availability = observations[candidate.origin]; continue;}
          try {
            // Existing /resolve can fetch four pages and four robots files.
            // Charge its whole worst-case tree before issuing the parent call.
            reserve('fetcher', 4 * 1024 * 1024 + 4 * 65536 + 65536);
            const observed = await this.observer(candidate.origin, {signal: controller.signal}); fence();
            if (observed.terminalOrigin === candidate.origin) candidate.availability = {state: observed.state, checkedAt: observed.checkedAt, vantage: observed.vantage};
            else if (!result.reasonCodes.includes('BROWSER_RECHECK_REQUIRED') && result.reasonCodes.length < 16) result.reasonCodes.push('BROWSER_RECHECK_REQUIRED');
            observations[candidate.origin] = candidate.availability;
            progress.observations = observations; checkpoint();
          } catch (error) {
            if (controller.signal.aborted) throw error;
            const code = codeOf(error); if (result.reasonCodes.length < 16 && !result.reasonCodes.includes(code)) result.reasonCodes.push(code);
            result.completeness = 'partial';
            // Quota exhaustion must not trigger more unaffordable attempts.
            if (/BUDGET|LIMIT|NO_LONGER/.test(code)) break;
          }
        }
      }
      fence();
      if (!result.candidates.length && partial) result.outcome = 'unavailable';
      validateInternetResult(result, {allowTestOrigins: this.allowTestOrigins});
      const cacheSeconds = result.candidates.length ? 3600 : result.outcome === 'unavailable' ? 300 : 900;
      this.store.complete(job.id, leaseToken, result, {cacheSeconds});
    } catch (error) {
      if (!this.closed && !controller.signal.aborted) this.store.fail(job.id, leaseToken, codeOf(error));
      else if (!this.closed) this.store.fail(job.id, leaseToken, 'DISCOVERY_TIMEOUT');
      // Shutdown leaves a bounded lease for the next process to reclaim.
    } finally {clearInterval(heartbeat); clearTimeout(deadline);}
  }
}
