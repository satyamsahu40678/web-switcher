import {normalizeSource, emptyContinuityState, validateContinuityState, discoverContinuity} from './continuity.js';
import {createContinuityProbe} from './continuity-probe.js';
import {permissionFor, resolveRoute} from './core.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function compileContinuityRules(config, state, grantedOrigins, gateUrl, reservations = {}) {
  if (config.paused || reservations.blockedAll) return [];
  const reserved = new Set([...config.mappings.map(mapping => mapping.sourceOrigin), ...(reservations.origins || [])]);
  return state.sites.filter(site => site.enabled && !reserved.has(site.sourceOrigin) && grantedOrigins.has(site.sourceOrigin)).map((site, index) => ({
    id: 10001 + index, priority: 1,
    action: {type: 'redirect', redirect: {regexSubstitution: `${gateUrl}#g=${config.generation}&m=${site.id}&source=\\0`}},
    condition: {regexFilter: '^' + escapeRegex(site.sourceOrigin) + '/.*$', resourceTypes: ['main_frame'], requestMethods: ['get'], isUrlFilterCaseSensitive: false}
  }));
}

export function createContinuityController({chromeApi, allowTestOrigins = false, probeOverride, isReserved = async () => false}) {
  const options = {allowTestOrigins};
  const probe = probeOverride || createContinuityProbe(chromeApi, options);
  const normalized = value => normalizeSource(value, options);
  const allowed = origin => chromeApi.permissions.contains({origins: [permissionFor(origin)]});
  async function read() {
    const {continuityState} = await chromeApi.storage.local.get('continuityState');
    if (!continuityState) return emptyContinuityState();
    try {
      const clean = validateContinuityState(continuityState, options);
      clean.edges = clean.edges.filter(edge => edge.expiresAt > Date.now());
      if (clean.edges.length !== continuityState.edges.length) await chromeApi.storage.local.set({continuityState: clean});
      return clean;
    }
    catch {
      await chromeApi.storage.local.set({corruptContinuity: continuityState, continuityState: emptyContinuityState()});
      return emptyContinuityState();
    }
  }
  async function save(state) {
    validateContinuityState(state, options);
    await chromeApi.storage.local.set({continuityState: state});
  }
  async function discover(value) {
    const sourceOrigin = normalized(value);
    if (await isReserved(sourceOrigin)) return {status: 'unknown', sourceOrigin, chain: [], reason: 'SIGNED_REGISTRY_PRECEDENCE'};
    const before = await read();
    const resolved = await discoverContinuity(sourceOrigin, {state: before, probe, hasPermission: allowed, allowTestOrigins});
    // A discovery result must not restore a site or its history after another
    // context paused, forgot, or cleared it while the network was in flight.
    // Discard stale learning rather than overwrite newer user decisions.
    if (JSON.stringify(await read()) === JSON.stringify(before)) await save(resolved.state);
    return resolved.result;
  }
  async function rules(config, reservations = {}) {
    const state = await read(), grants = new Set();
    for (const site of state.sites) if (await allowed(site.sourceOrigin)) grants.add(site.sourceOrigin);
    return compileContinuityRules(config, state, grants, chromeApi.runtime.getURL('continuity-gate.html'), reservations);
  }
  async function mutate(work, reinstall) {
    const previous = await read(), next = structuredClone(previous);
    work(next); await save(next);
    try { await reinstall(); }
    catch (error) { await save(previous); await reinstall().catch(() => {}); throw error; }
    return {ok: true};
  }
  async function follow(message, reinstall) {
    const sourceOrigin = normalized(message.sourceOrigin);
    if (typeof message.enabled !== 'boolean') throw new Error('Choose whether to follow this site.');
    if (message.enabled && !(await allowed(sourceOrigin))) throw new Error('Allow checks for this source before following it.');
    return mutate(state => {
      const site = state.sites.find(item => item.sourceOrigin === sourceOrigin);
      if (site) site.enabled = message.enabled;
      else {
        if (state.sites.length >= 50) throw new Error('At most 50 followed sites are supported.');
        state.sites.push({id: 'continuity-' + crypto.randomUUID(), sourceOrigin, enabled: message.enabled, createdAt: Date.now()});
      }
    }, reinstall);
  }
  async function forget(message, reinstall) {
    const sourceOrigin = normalized(message.sourceOrigin);
    return mutate(state => {
      state.sites = state.sites.filter(site => site.sourceOrigin !== sourceOrigin);
      const component = new Set([sourceOrigin]);
      for (let i = 0; i <= state.edges.length; i++) {
        const before = component.size;
        for (const edge of state.edges) if (component.has(edge.fromOrigin) || component.has(edge.toOrigin)) {component.add(edge.fromOrigin); component.add(edge.toOrigin);}
        if (component.size === before) break;
      }
      state.edges = state.edges.filter(edge => !component.has(edge.fromOrigin) && !component.has(edge.toOrigin));
    }, reinstall);
  }
  async function open(message) {
    const expected = normalized(message.expectedOrigin), result = await discover(message.sourceOrigin);
    if (result.status !== 'found' || result.terminalOrigin !== expected) throw new Error('The current address changed or could not be rechecked. Find it again before opening.');
    if (!(await allowed(result.sourceOrigin)) || await isReserved(result.sourceOrigin)) throw new Error('Source permission or registry authority changed. Check this site again.');
    await chromeApi.tabs.create({url: expected + '/'});
    return {ok: true, terminalOrigin: expected};
  }
  async function bypassOriginal(sender, sourceUrl) {
    const ruleId = 1000000 + sender.tab.id, source = new URL(sourceUrl);
    const {bypasses = {}} = await chromeApi.storage.session.get('bypasses');
    await chromeApi.declarativeNetRequest.updateSessionRules({removeRuleIds: [ruleId], addRules: [{id: ruleId, priority: 100, action: {type: 'allow'}, condition: {tabIds: [sender.tab.id], regexFilter: '^' + escapeRegex(source.origin) + '/.*$', resourceTypes: ['main_frame'], requestMethods: ['get']}}]});
    bypasses[sender.tab.id] = {ruleId, sourceOrigin: source.origin, expiresAt: Date.now() + 30000};
    await chromeApi.storage.session.set({bypasses});
    await chromeApi.alarms.create('cleanup', {delayInMinutes: 0.5});
    await chromeApi.tabs.update(sender.tab.id, {url: source.href});
    return {status: 'original', reason: 'NO_MIGRATION_EVIDENCE'};
  }
  async function resolveGate(message, sender, {readConfig, recordSwitch}) {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return {status: 'blocked', reason: 'invalid'};
    const config = await readConfig(), envelope = message.envelope;
    if (!envelope || envelope.generation !== config.generation) return {status: 'blocked', reason: 'changed'};
    if (config.paused) return {status: 'blocked', reason: 'paused'};
    const state = await read(), site = state.sites.find(item => item.id === envelope.mappingId);
    if (!site?.enabled) return {status: 'blocked', reason: 'paused'};
    if (site.createdAt > Date.now()) return {status: 'blocked', reason: 'expired'};
    if (config.mappings.some(mapping => mapping.sourceOrigin === site.sourceOrigin)) return {status: 'blocked', reason: 'override'};
    if (await isReserved(site.sourceOrigin)) return {status: 'blocked', reason: 'override'};
    let source;
    try {
      if (typeof envelope.source !== 'string' || envelope.source.length > 8192 || /[\u0000-\u0020\\]/.test(envelope.source)) throw new Error();
      source = new URL(envelope.source);
      if (source.origin !== site.sourceOrigin || source.username || source.password) throw new Error();
    } catch { return {status: 'blocked', reason: 'invalid'}; }
    if (!(await allowed(site.sourceOrigin))) return {status: 'blocked', reason: 'permission'};
    const result = await discover(site.sourceOrigin);
    // Browser grants and storage can change while a bounded network request is
    // in flight, even when extension messages themselves are serialized.
    async function recheck() {
      const latest = await readConfig(), current = (await read()).sites.find(item => item.id === site.id);
      if (latest.generation !== envelope.generation) return {status: 'blocked', reason: 'changed'};
      if (latest.paused || !current?.enabled || current.sourceOrigin !== site.sourceOrigin) return {status: 'blocked', reason: 'paused'};
      if (current.createdAt > Date.now()) return {status: 'blocked', reason: 'expired'};
      if (latest.mappings.some(mapping => mapping.sourceOrigin === site.sourceOrigin) || await isReserved(site.sourceOrigin)) return {status: 'blocked', reason: 'override'};
      if (!(await allowed(site.sourceOrigin))) return {status: 'blocked', reason: 'permission'};
      return null;
    }
    const stopped = await recheck(); if (stopped) return stopped;
    if (result.status !== 'found') {
      if (result.originalReachable && result.sourceOrigin === site.sourceOrigin) return bypassOriginal(sender, source.href);
      return result;
    }
    const target = normalized(result.terminalOrigin);
    const now = Date.now();
    const synthetic = {schemaVersion: 1, generation: config.generation, paused: false, mappings: [{id: site.id, sourceOrigin: site.sourceOrigin, destinationOrigin: target, pathPolicy: 'homepage', enabled: true, createdAt: now, expiresAt: now + 3600000}]};
    const pathCheck = resolveRoute(synthetic, envelope, now, options);
    if (message.type === 'CONTINUITY_CONFIRM' && message.expectedOrigin !== target) return {status: 'blocked', reason: 'changed'};
    if (pathCheck.status !== 'ready' && message.type !== 'CONTINUITY_CONFIRM') return {...result, status: 'confirmation', reason: 'manual', homepage: target + '/'};
    if (pathCheck.status !== 'ready' && pathCheck.reason !== 'manual') return pathCheck;
    const checked = await recordSwitch({status: 'ready', reason: 'source_declared', trustClass: 'source_declared', url: target + '/', sourceOrigin: site.sourceOrigin, destinationOrigin: target, mappingId: site.id}, sender);
    const changed = await recheck(); if (changed) return changed;
    return {...result, ...checked};
  }
  return {read, rules, discover, follow, forget, open, resolveGate};
}
