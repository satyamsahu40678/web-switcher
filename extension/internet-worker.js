import {normalizeSource} from './continuity.js';
import {permissionFor} from './core.js';
import {parseStrictJson} from './security/catalog.mjs';
import {buildInternetResult, validateInternetResult} from './internet-contract.js';
import {createArchiveDiscovery} from './internet-sources.js';
import {createInternetTransport} from './internet-transport.js';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const LIVE = new Set(['queued', 'running']);
const TTL = 3600000;
const clone = value => structuredClone(value);

/** Unverified Internet suggestions remain separate from observed successor edges. */
export function createInternetController({chromeApi, continuity, allowTestOrigins = false, providerUrls, requestOverride, archiveOverride, isReserved = async () => false, readConfig, saveChoice}) {
  const options = {allowTestOrigins};
  const transport = requestOverride || createInternetTransport(chromeApi, options);
  const providers = providerUrls || {availability: 'https://archive.org/wayback/available', cdx: 'https://web.archive.org/cdx/search/cdx', replay: 'https://web.archive.org'};
  const archiveOrigins = [...new Set(Object.values(providers).map(value => new URL(value).origin))];
  const active = new Map(), polls = new Map();
  let writes = Promise.resolve();
  function stored(work) {
    const operation = writes.then(work); writes = operation.catch(() => {}); return operation;
  }
  async function load() {
    const {internetJobs} = await chromeApi.storage.local.get('internetJobs');
    const entries = [];
    if (internetJobs?.schemaVersion === 1 && Array.isArray(internetJobs.jobs)) {
      for (const value of internetJobs.jobs.slice(-10)) {
        try {
          if (!['archives', 'service'].includes(value.mode) || typeof value.generation !== 'string' || !ID.test(value.epoch || '')) continue;
          const result = validateInternetResult(value.result, options);
          if (result.expiresAt <= Date.now() || result.createdAt > Date.now() + 300000) {active.get(result.jobId)?.abort(); continue;}
          if (value.serviceOrigin && normalizeSource(value.serviceOrigin, options) !== value.serviceOrigin || value.serviceJobId && !ID.test(value.serviceJobId)) continue;
          const entry = {...value, result};
          if (LIVE.has(result.status) && !active.has(result.jobId) && (value.mode === 'archives' || !value.serviceJobId)) {
            entry.result = {...result, status: 'failed', outcome: 'unavailable', candidates: [], completeness: 'partial', reasonCodes: ['BROWSER_RESTART_INTERRUPTED']};
          }
          entries.push(entry);
        } catch { /* Malformed local data never becomes a candidate or a route. */ }
      }
    }
    await chromeApi.storage.local.set({internetJobs: {schemaVersion: 1, jobs: entries}});
    return entries;
  }
  async function lookup(jobId) {
    if (!ID.test(jobId || '')) throw new Error('Invalid discovery reference.');
    return stored(async () => {
      const entry = (await load()).find(item => item.result.jobId === jobId);
      if (!entry) throw new Error('This lookup expired or was deleted. Search again.');
      return clone(entry);
    });
  }
  async function update(jobId, epoch, work) {
    return stored(async () => {
      const entries = await load(), index = entries.findIndex(item => item.result.jobId === jobId && item.epoch === epoch);
      if (index === -1 || !LIVE.has(entries[index].result.status)) return null;
      work(entries[index]);
      entries[index].result = validateInternetResult(entries[index].result, options);
      await chromeApi.storage.local.set({internetJobs: {schemaVersion: 1, jobs: entries}});
      return clone(entries[index]);
    });
  }
  async function configured() {
    const {internetConfig} = await chromeApi.storage.local.get('internetConfig');
    let serviceOrigin = '';
    try {if (internetConfig?.serviceOrigin) serviceOrigin = normalizeSource(internetConfig.serviceOrigin, options);} catch { /* Unusable config stays disabled. */ }
    const {internetAccess} = await chromeApi.storage.session.get('internetAccess');
    const accessToken = internetAccess?.serviceOrigin === serviceOrigin && typeof internetAccess.accessToken === 'string' ? internetAccess.accessToken : '';
    return {serviceOrigin, accessToken};
  }
  async function configGet() {
    const {serviceOrigin, accessToken} = await configured();
    return {serviceOrigin, hasAccessToken: Boolean(accessToken)};
  }
  async function configSet(message) {
    const serviceOrigin = message.serviceOrigin ? normalizeSource(message.serviceOrigin, options) : '';
    if (message.serviceOrigin && message.serviceOrigin !== serviceOrigin) throw new Error('Use an exact HTTPS service origin without a path, query or credentials.');
    const previous = await configured();
    const accessToken = message.accessToken === undefined || message.accessToken === '' ? (previous.serviceOrigin === serviceOrigin ? previous.accessToken : '') : message.accessToken;
    if (accessToken && (typeof accessToken !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(accessToken))) throw new Error('Use the service operator’s invite token, 32–256 letters, digits, hyphens or underscores.');
    if (!serviceOrigin && accessToken) throw new Error('Configure the service origin first.');
    if (serviceOrigin && !await chromeApi.permissions.contains({origins: [permissionFor(serviceOrigin)]})) throw new Error('Grant access to this service before saving it.');
    if (previous.serviceOrigin !== serviceOrigin || accessToken !== previous.accessToken) {
      const jobs = await stored(load);
      for (const entry of jobs) if (entry.mode === 'service' && LIVE.has(entry.result.status)) await cancel({jobId: entry.result.jobId});
    }
    await chromeApi.storage.local.set({internetConfig: {serviceOrigin}});
    if (serviceOrigin && accessToken) await chromeApi.storage.session.set({internetAccess: {serviceOrigin, accessToken}});
    else await chromeApi.storage.session.remove('internetAccess');
    return configGet();
  }
  async function remote(entry, method = 'GET', initial = false, signal) {
    const config = await configured();
    if (!config.serviceOrigin || config.serviceOrigin !== entry.serviceOrigin || !config.accessToken) throw new Error('SERVICE_NOT_CONFIGURED');
    const url = config.serviceOrigin + '/v2/discoveries' + (initial ? '' : '/' + encodeURIComponent(entry.serviceJobId));
    const response = await transport(url, {method, ...(initial ? {json: {hostname: new URL(entry.result.sourceOrigin).hostname, clientVersion: '0.2.0'}} : {}), accessToken: config.accessToken, allowedOrigins: [config.serviceOrigin], signal});
    if (![200, 202].includes(response.status)) throw new Error(response.status === 401 || response.status === 403 ? 'SERVICE_ACCESS_DENIED' : response.status === 429 ? 'SERVICE_BUDGET_EXCEEDED' : 'SERVICE_UNAVAILABLE');
    const result = validateInternetResult(parseStrictJson(response.body, {maxBytes: 65536}), {...options, expectedSourceOrigin: entry.result.sourceOrigin});
    if (result.createdAt > Date.now() + 300000 || result.expiresAt <= Date.now()) throw new Error('SERVICE_RESULT_EXPIRED');
    return result;
  }
  function localize(result, original) {
    return {...result, jobId: original.jobId, createdAt: original.createdAt, expiresAt: Math.min(result.expiresAt, original.expiresAt)};
  }
  async function filterPolicy(result) {
    if (await isReserved(result.sourceOrigin)) return {...result, status: LIVE.has(result.status) ? 'completed' : result.status, outcome: 'blocked', candidates: [], reasonCodes: ['SIGNED_REGISTRY_PRECEDENCE']};
    const candidates = [];
    for (const candidate of result.candidates) if (!await isReserved(candidate.origin)) candidates.push(candidate);
    if (candidates.length !== result.candidates.length) return {...result, candidates, outcome: candidates.length ? 'candidates' : 'blocked', completeness: 'partial', reasonCodes: [...new Set([...result.reasonCodes, 'SIGNED_REGISTRY_PRECEDENCE'])].slice(0, 16)};
    return result;
  }
  async function run(entry, controller) {
    const {jobId} = entry.result;
    try {
      await update(jobId, entry.epoch, item => {item.result.status = 'running'; item.result.phase = entry.mode === 'archives' ? 'Reading public archives' : 'Asking the configured search service';});
      let result;
      if (entry.mode === 'archives') {
        let bytes = 0;
        const request = async (url, parameters) => {
          if (await isReserved(entry.result.sourceOrigin)) throw new Error('SIGNED_REGISTRY_PRECEDENCE');
          const response = await transport(url, {...parameters, allowedOrigins: archiveOrigins});
          bytes += new TextEncoder().encode(response.body).length;
          if (bytes > 1024 * 1024) throw new Error('ARCHIVE_RESOURCE_LIMIT');
          return response;
        };
        const discover = archiveOverride || createArchiveDiscovery({request, allowTestOrigins, providerUrls});
        const found = await discover(entry.result.sourceOrigin, {signal: controller.signal});
        result = buildInternetResult(entry.result.sourceOrigin, found.leads, {...options, jobId, createdAt: entry.result.createdAt, expiresAt: entry.result.expiresAt, reasonCodes: found.reasonCodes, completeness: found.completeness});
        if (!result.candidates.length && found.completeness === 'partial') result.outcome = 'unavailable';
      } else {
        const received = await remote(entry, 'POST', true, controller.signal);
        entry.serviceJobId = received.jobId;
        result = localize(received, entry.result);
      }
      result = await filterPolicy(result);
      if (controller.signal.aborted) return;
      await update(jobId, entry.epoch, item => {item.result = result; if (entry.serviceJobId) item.serviceJobId = entry.serviceJobId;});
    } catch (error) {
      if (!controller.signal.aborted) await update(jobId, entry.epoch, item => {item.result = {...item.result, status: 'failed', outcome: 'unavailable', candidates: [], completeness: 'partial', reasonCodes: [/^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'PROVIDER_UNAVAILABLE']};});
    } finally {active.delete(jobId);}
  }
  async function start(message) {
    const sourceOrigin = normalizeSource(message.sourceOrigin, options), mode = message.mode || 'archives';
    if (!['archives', 'service'].includes(mode)) throw new Error('Choose archives or the configured search service.');
    if (await isReserved(sourceOrigin)) throw new Error('A signed registry decision takes precedence for this source.');
    if (active.size >= 2) throw new Error('Two lookups are already active. Cancel one before searching again.');
    let serviceOrigin;
    if (mode === 'archives') {
      for (const origin of archiveOrigins) if (!await chromeApi.permissions.contains({origins: [permissionFor(origin)]})) throw new Error('Allow public archive access before starting online discovery.');
    } else {
      const config = await configured(); serviceOrigin = config.serviceOrigin;
      if (!serviceOrigin || !config.accessToken) throw new Error('Configure a search service and its invite token, or choose keyless archives.');
      if (!await chromeApi.permissions.contains({origins: [permissionFor(serviceOrigin)]})) throw new Error('Allow access to the configured service.');
    }
    const config = await readConfig(), createdAt = Date.now(), jobId = crypto.randomUUID(), controller = new AbortController();
    const entry = {mode, generation: config.generation, epoch: crypto.randomUUID(), ...(serviceOrigin ? {serviceOrigin} : {}), result: buildInternetResult(sourceOrigin, [], {...options, jobId, status: 'queued', createdAt, expiresAt: createdAt + TTL, phase: 'Queued'})};
    active.set(jobId, controller);
    try {
      await stored(async () => {
        const entries = await load();
        while (entries.length >= 10) {
          const index = entries.findIndex(item => !LIVE.has(item.result.status));
          if (index === -1) throw new Error('Too many active lookups.'); entries.splice(index, 1);
        }
        entries.push(entry); await chromeApi.storage.local.set({internetJobs: {schemaVersion: 1, jobs: entries}});
      });
    } catch (error) {active.delete(jobId); controller.abort(); throw error;}
    void run(clone(entry), controller).catch(() => {});
    return {jobId};
  }
  async function status({jobId}) {
    const entry = await lookup(jobId);
    if (entry.mode === 'service' && entry.serviceJobId && LIVE.has(entry.result.status) && !active.has(jobId)) {
      if (!polls.has(jobId)) {
        const work = (async () => {
          try {
            const result = await filterPolicy(localize(await remote(entry), entry.result));
            await update(jobId, entry.epoch, item => {item.result = result;});
          } catch (error) {
            await update(jobId, entry.epoch, item => {item.result = {...item.result, status: 'failed', outcome: 'unavailable', completeness: 'partial', candidates: [], reasonCodes: [/^[A-Z0-9_]{1,80}$/.test(error.message) ? error.message : 'SERVICE_UNAVAILABLE']};});
          } finally {polls.delete(jobId);}
        })();
        polls.set(jobId, work);
      }
      await polls.get(jobId);
    }
    return filterPolicy((await lookup(jobId)).result);
  }
  async function cancel({jobId}) {
    const entry = await lookup(jobId); active.get(jobId)?.abort(); active.delete(jobId);
    const cancelled = await stored(async () => {
      const entries = await load(), item = entries.find(value => value.result.jobId === jobId);
      if (!item) throw new Error('This lookup was deleted.');
      item.result = {...item.result, status: 'cancelled', outcome: 'unknown', completeness: 'partial', candidates: [], reasonCodes: ['CANCELLED']};
      await chromeApi.storage.local.set({internetJobs: {schemaVersion: 1, jobs: entries}}); return clone(item.result);
    });
    if (entry.serviceJobId) void remote(entry, 'DELETE').catch(() => {});
    return cancelled;
  }
  async function clear() {
    for (const controller of active.values()) controller.abort(); active.clear();
    const entries = await stored(load);
    for (const entry of entries) if (entry.serviceJobId && LIVE.has(entry.result.status)) void remote(entry, 'DELETE').catch(() => {});
    await stored(() => chromeApi.storage.local.remove(['internetJobs', 'internetConfig']));
    await chromeApi.storage.session.remove('internetAccess');
  }
  async function selected(message) {
    const entry = await lookup(message.jobId);
    const candidate = entry.result.candidates.find(item => item.id === message.candidateId);
    if (entry.result.status !== 'completed' || !candidate) throw new Error('Select a current candidate from a completed lookup.');
    if (await isReserved(entry.result.sourceOrigin) || await isReserved(candidate.origin)) throw new Error('A signed registry decision takes precedence in this chain.');
    return {entry, candidate};
  }
  async function currentChoice(entry, candidate, chain = []) {
    const latest = await lookup(entry.result.jobId), config = await readConfig();
    if (latest.epoch !== entry.epoch || latest.result.status !== 'completed' || !latest.result.candidates.some(item => item.id === candidate.id && item.origin === candidate.origin) || config.generation !== entry.generation) throw new Error('This lookup or your settings changed. Search again.');
    if (config.paused) throw new Error('Switching is paused. Resume it before opening a suggestion.');
    const origins = new Set([entry.result.sourceOrigin, candidate.origin, ...chain.flatMap(edge => [edge.fromOrigin, edge.toOrigin])]);
    for (const origin of origins) if (await isReserved(origin)) throw new Error('A signed registry decision takes precedence in this chain.');
    const final = await lookup(entry.result.jobId), finalConfig = await readConfig();
    if (final.result.status !== 'completed' || final.epoch !== entry.epoch || finalConfig.generation !== entry.generation || finalConfig.paused) throw new Error('This lookup or your settings changed. Search again.');
  }
  async function check(message) {
    const {entry, candidate} = await selected(message);
    await currentChoice(entry, candidate);
    const result = await continuity.discover(candidate.origin);
    await currentChoice(entry, candidate, result.chain);
    if (result.status === 'permission_required') return {...result, sourceOrigin: entry.result.sourceOrigin, candidateOrigin: candidate.origin};
    if (!(result.status === 'found' || result.originalReachable === true)) return {...result, status: 'unavailable', sourceOrigin: entry.result.sourceOrigin, candidateOrigin: candidate.origin};
    const terminalOrigin = result.terminalOrigin || candidate.origin;
    if (await isReserved(terminalOrigin)) throw new Error('A signed registry decision takes precedence for this destination.');
    if (!await chromeApi.permissions.contains({origins: [permissionFor(candidate.origin)]})) throw new Error('Candidate permission changed. Check it again.');
    return {status: 'ready', sourceOrigin: entry.result.sourceOrigin, candidateOrigin: candidate.origin, terminalOrigin, chain: result.chain || [], identityClass: 'unverified_candidate'};
  }
  async function open(message) {
    const result = await check(message);
    if (result.status !== 'ready' || result.terminalOrigin !== message.expectedOrigin) throw new Error('The destination changed or could not be rechecked. Check the candidate again.');
    const {entry, candidate} = await selected(message); await currentChoice(entry, candidate, result.chain);
    await stored(async () => {
      const latest = (await load()).find(item => item.result.jobId === entry.result.jobId), config = await readConfig();
      if (!latest || latest.epoch !== entry.epoch || latest.result.status !== 'completed' || config.generation !== entry.generation || config.paused) throw new Error('This lookup or your settings changed. Search again.');
      const origins = new Set([candidate.origin, result.terminalOrigin, ...result.chain.flatMap(edge => [edge.fromOrigin, edge.toOrigin])]);
      for (const origin of origins) if (await isReserved(origin) || !await chromeApi.permissions.contains({origins: [permissionFor(origin)]})) throw new Error('Permission or registry authority changed. Check the candidate again.');
      if (await isReserved(entry.result.sourceOrigin)) throw new Error('A signed registry decision takes precedence for this source.');
      await chromeApi.tabs.create({url: result.terminalOrigin + '/'});
    });
    return {ok: true, terminalOrigin: result.terminalOrigin};
  }
  async function save(message) {
    if (message.confirmed !== true || message.durationHours !== 24) throw new Error('Explicitly confirm a 24-hour unverified choice before saving it.');
    const result = await check(message);
    if (result.status !== 'ready' || result.terminalOrigin !== message.expectedOrigin) throw new Error('The destination changed. Check it again before remembering this choice.');
    const {entry, candidate} = await selected(message); await currentChoice(entry, candidate, result.chain);
    if (!await chromeApi.permissions.contains({origins: [permissionFor(entry.result.sourceOrigin)]})) throw new Error('Allow access to the old source before remembering this choice.');
    await saveChoice({sourceOrigin: entry.result.sourceOrigin, destinationOrigin: result.terminalOrigin, durationHours: 24, pathPolicy: 'homepage'}, {validate: () => currentChoice(entry, candidate, result.chain)});
    return {ok: true, trustClass: 'user_configured'};
  }
  async function maintenance() {await stored(load);}
  return {configGet, configSet, start, status, cancel, clear, check, open, save, maintenance};
}
