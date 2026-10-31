import {advanceMappingGroup, originOf, resolveRoute, validateConfig} from './core.js';

const EVIDENCE = new Set(['http_redirect', 'http_refresh', 'meta_refresh', 'successor_link', 'well_known']);
const stop = (reason, fields = {}) => ({status: 'blocked', reason, ...fields});
function samePolicySnapshot(left, right, depth = 0) {
  if (left === right) return true;
  if (depth > 64 || !left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) return left.length === right.length && left.every((value, index) => samePolicySnapshot(value, right[index], depth + 1));
  const leftKeys = Object.keys(left).sort(), rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && samePolicySnapshot(left[key], right[key], depth + 1));
}
class PolicyStopped extends Error {
  constructor(blocked) { super('The mapping group can no longer be followed.'); this.blocked = blocked; }
}

/**
 * Follow an explicitly selected shared destination, never an old alias URL.
 * Manual aliases stay user configured. Observed moves are not signed authority.
 */
export function createMappingFollower({continuity, readConfig, commitConfig, isReserved, hasPermission, allowTestOrigins = false, now = Date.now, makeId = () => crypto.randomUUID()}) {
  if (typeof continuity?.discover !== 'function' || typeof readConfig !== 'function' || typeof commitConfig !== 'function' || typeof isReserved !== 'function' || typeof hasPermission !== 'function') throw new Error('Mapping following requires discovery, current policy, permissions and signed reservation checks.');
  const options = {allowTestOrigins};
  const clock = typeof now === 'function' ? now : () => now;
  const canonical = value => {
    if (typeof value !== 'string' || originOf(value, {...options, target: true}) !== value) throw new Error('Invalid observed origin.');
    return value;
  };
  const groupOf = (config, seed) => config.mappings.filter(mapping => mapping.followOrigin === seed);
  const groupOrigins = (config, mapping) => new Set([mapping.followOrigin, mapping.destinationOrigin, ...groupOf(config, mapping.followOrigin).map(item => item.sourceOrigin)]);
  async function reserved(origins) {
    for (const origin of origins) if (await isReserved(origin)) return true;
    return false;
  }
  async function permissions(origins, chain = []) {
    const missing = [];
    for (const origin of new Set(origins)) if (!await hasPermission(origin)) missing.push(origin);
    return missing.length ? {status: 'permission_required', reason: 'destination_permission', requiredOrigins: missing, chain} : null;
  }
  function observation(result, expectedCurrent) {
    if (!result || result.sourceOrigin !== expectedCurrent || !Array.isArray(result.chain) || result.chain.length > 8 || !Array.isArray(result.attempts) || result.attempts.length > 12) throw new Error('Invalid discovery binding.');
    const origins = new Set([expectedCurrent]), chain = [], visited = new Set([expectedCurrent]);
    let last = expectedCurrent;
    for (const edge of result.chain) {
      const fromOrigin = canonical(edge?.fromOrigin), toOrigin = canonical(edge?.toOrigin);
      if (fromOrigin !== last || fromOrigin === toOrigin || !EVIDENCE.has(edge.evidence)) throw new Error('Invalid discovery chain.');
      if (result.status === 'found' && visited.has(toOrigin)) throw new Error('A cyclic chain cannot establish a current origin.');
      visited.add(toOrigin);
      origins.add(fromOrigin); origins.add(toOrigin); last = toOrigin;
      chain.push({fromOrigin, toOrigin, evidence: edge.evidence, ...(edge.remembered === true ? {remembered: true} : {})});
    }
    for (const attempt of result.attempts) origins.add(canonical(attempt?.origin));
    let terminalOrigin;
    if (result.terminalOrigin !== undefined) { terminalOrigin = canonical(result.terminalOrigin); origins.add(terminalOrigin); }
    let requiredOrigins = [];
    if (result.requiredOrigins !== undefined) {
      if (!Array.isArray(result.requiredOrigins) || result.requiredOrigins.length > 8) throw new Error('Invalid permission boundary.');
      requiredOrigins = [...new Set(result.requiredOrigins.map(canonical))];
      for (const origin of requiredOrigins) origins.add(origin);
    }
    if (result.status === 'found' && (!chain.length || terminalOrigin !== last)) throw new Error('Unbound terminal origin.');
    if (result.status === 'permission_required' && !requiredOrigins.length) throw new Error('Missing next permission boundary.');
    return {origins, chain, terminalOrigin, requiredOrigins};
  }
  async function inspect(expected, mappingId, extraOrigins = [], networkOrigins = [], chain = []) {
    const latest = validateConfig(await readConfig(), options);
    // Generation is mandatory, and complete snapshot equality also fences
    // direct storage edits that neglected to rotate that generation. Chrome
    // storage may reorder object keys; mapping-array order and values matter.
    if (latest.generation !== expected.generation || !samePolicySnapshot(latest, expected)) return stop('changed');
    if (latest.paused) return stop('paused');
    const mapping = latest.mappings.find(item => item.id === mappingId);
    if (!mapping?.enabled || !mapping.followOrigin) return stop('paused');
    const at = clock();
    if (!Number.isSafeInteger(at) || at < mapping.createdAt || at >= mapping.expiresAt) return stop('expired');
    const origins = new Set([...groupOrigins(latest, mapping), ...extraOrigins]);
    if (await reserved(origins)) return stop('override');
    return permissions([mapping.sourceOrigin, mapping.destinationOrigin, ...networkOrigins], chain);
  }
  async function resolve(config, envelope) {
    try {
      validateConfig(config, options);
      const initial = resolveRoute(config, envelope, clock(), options);
      if (!initial.sourceOrigin) return {blocked: initial};
      const mapping = config.mappings.find(item => item.id === envelope.mappingId);
      if (!mapping.followOrigin) return {config, envelope};
      if (mapping.provenance === 'registry') return {blocked: stop('override')};
      const seed = canonical(mapping.followOrigin), previousOrigin = canonical(mapping.destinationOrigin);
      const before = await inspect(config, mapping.id);
      if (before) return {blocked: before};
      let result;
      try { result = await continuity.discover(previousOrigin, {blockedOrigins: groupOf(config, seed).map(item => item.sourceOrigin)}); }
      catch { return {blocked: stop('unavailable')}; }
      if (result?.reason === 'SIGNED_REGISTRY_PRECEDENCE') {
        const changed = await inspect(config, mapping.id);
        return {blocked: changed || stop('override')};
      }
      let checked;
      try { checked = observation(result, previousOrigin); }
      catch { return {blocked: stop('unavailable')}; }
      const allOrigins = checked.origins;
      const oldAliases = new Set(groupOf(config, seed).map(item => item.sourceOrigin));
      if (checked.chain.some(edge => oldAliases.has(edge.toOrigin))) {
        // Discovery checks permissions before dispatching its blocked-origin
        // probe. A return to a selected old alias is a loop even when that
        // alias has no current grant; do not ask users to grant it just to
        // rediscover the same prohibited return.
        const changed = await inspect(config, mapping.id, allOrigins, [], checked.chain);
        return {blocked: changed || stop('loop', {chain: checked.chain})};
      }
      const actualNetworkOrigins = new Set([previousOrigin, ...result.attempts.map(attempt => attempt.origin), ...checked.chain.flatMap(edge => [edge.fromOrigin, edge.toOrigin]), ...(checked.terminalOrigin ? [checked.terminalOrigin] : [])]);
      const after = await inspect(config, mapping.id, allOrigins, actualNetworkOrigins, checked.chain);
      if (after) return {blocked: after};
      if (result.status === 'permission_required') return {blocked: {status: 'permission_required', reason: 'destination_permission', requiredOrigins: checked.requiredOrigins, chain: checked.chain}};
      const unchanged = result.status === 'unknown' && result.reason === 'NO_MIGRATION_EVIDENCE' && result.originalReachable === true && !checked.chain.length && !checked.terminalOrigin;
      if (result.status !== 'found' && !unchanged) return {blocked: stop(result.reason === 'MAPPING_GROUP_LOOP' ? 'loop' : ['conflict', 'loop', 'unavailable'].includes(result.status) ? result.status : 'unknown', {chain: checked.chain})};
      const currentOrigin = unchanged ? previousOrigin : checked.terminalOrigin;
      // An observed successor cannot turn back into any selected old alias.
      if (groupOf(config, seed).some(item => item.sourceOrigin === currentOrigin)) return {blocked: stop('loop', {chain: checked.chain})};
      let committed = config;
      if (currentOrigin !== previousOrigin) {
        let next;
        try {
          next = advanceMappingGroup(config, seed, previousOrigin, currentOrigin, clock(), makeId(), options);
          next.generation = makeId();
          validateConfig(next, options);
        } catch { return {blocked: stop('conflict', {chain: checked.chain})}; }
        const guard = async () => {
          const blocked = await inspect(config, mapping.id, allOrigins, actualNetworkOrigins, checked.chain);
          if (blocked) throw new PolicyStopped(blocked);
        };
        try { await commitConfig(next, guard); }
        catch (error) { return {blocked: error instanceof PolicyStopped ? error.blocked : stop('unavailable')}; }
        committed = next;
      }
      const validate = async () => inspect(committed, mapping.id, allOrigins, actualNetworkOrigins, checked.chain);
      const final = await validate();
      if (final) return {blocked: {...final, generation: committed.generation}};
      return {config: committed, envelope: {...envelope, generation: committed.generation}, discovery: {...result, chain: checked.chain}, localGroupId: seed, previousOrigin, currentOrigin, updated: currentOrigin !== previousOrigin, validate};
    } catch { return {blocked: stop('unavailable')}; }
  }
  async function check(followOrigin, generation) {
    try {
      const seed = canonical(followOrigin), config = validateConfig(await readConfig(), options);
      if (config.generation !== generation) return {blocked: stop('changed')};
      if (config.paused) return {blocked: stop('paused')};
      const at = clock();
      const group = groupOf(config, seed), mapping = group.find(item => item.enabled && item.createdAt <= at && item.expiresAt > at);
      if (!mapping) return {blocked: stop(group.length ? 'expired' : 'unknown')};
      const resolved = await resolve(config, {generation, mappingId: mapping.id, source: mapping.sourceOrigin + '/'});
      if (resolved.blocked) return resolved;
      return {status: 'checked', localGroupId: seed, previousOrigin: resolved.previousOrigin, currentOrigin: resolved.currentOrigin, updated: resolved.updated, mappingCount: groupOf(resolved.config, seed).length, chain: resolved.discovery.chain, checkedAt: clock()};
    } catch { return {blocked: stop('unavailable')}; }
  }
  return {resolve, check};
}
