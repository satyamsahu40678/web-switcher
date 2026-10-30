import {resolveRoute, validateConfig} from './core.js';

export function combineConfig(local, catalog, options = {}) {
  if (!catalog) return local;
  const decisions = new Map(catalog.decisions.map(decision => [decision.familyId, decision]));
  const revoked = new Set(catalog.revocations.map(item => typeof item === 'string' ? item : item.familyId));
  const sources = new Set(local.mappings.map(mapping => mapping.sourceOrigin));
  const mappings = [...local.mappings];
  catalog.aliases.forEach((alias, index) => {
    const decision = decisions.get(alias.familyId);
    if (!decision || revoked.has(alias.familyId) || sources.has(alias.sourceOrigin)) return;
    mappings.push({provenance: 'registry', id: `registry-${index}`, sourceOrigin: alias.sourceOrigin, destinationOrigin: decision.destinationOrigin,
      pathPolicy: decision.pathPolicy.type === 'homepage' ? 'homepage' : 'preserve', enabled: true,
      createdAt: Date.parse(catalog.issuedAt), expiresAt: Math.min(Date.parse(catalog.expiresAt), Date.parse(decision.validUntil))});
  });
  return validateConfig({...local, mappings}, options);
}

export function resolveWithCatalog(config, envelope, now, catalog, options = {}) {
  let result = resolveRoute(config, envelope, now, options);
  if (config.mappings.find(mapping => mapping.id === envelope.mappingId)?.provenance !== 'registry') return result;
  const alias = catalog?.aliases[Number(envelope.mappingId.slice('registry-'.length))];
  const decision = catalog?.decisions.find(item => item.familyId === alias?.familyId);
  if (!decision) return {status: 'blocked', reason: 'unknown'};
  // Only signed registry provenance supplies family identity. Carry it through
  // manual previews and click-time confirmation as well as automatic routing.
  result = {...result, familyId: decision.familyId};
  if (result.status !== 'ready') return result;
  const source = new URL(envelope.source);
  const policy = decision.pathPolicy;
  if (policy.type === 'preserve' && !policy.publicPrefixes.some(prefix => source.pathname.startsWith(prefix))) {
    return {...result, status: 'blocked', reason: 'manual', url: undefined, homepage: decision.destinationOrigin + '/'};
  }
  if (policy.type === 'prefix_replace') {
    if (!source.pathname.startsWith(policy.fromPrefix)) return {...result, status: 'blocked', reason: 'manual', url: undefined, homepage: decision.destinationOrigin + '/'};
    const destination = new URL(decision.destinationOrigin);
    destination.pathname = policy.toPrefix + source.pathname.slice(policy.fromPrefix.length);
    if (destination.origin !== decision.destinationOrigin) return {status: 'blocked', reason: 'invalid'};
    result.url = destination.href;
  }
  if (decision.requiresConfirmation) return {...result, status: 'blocked', reason: 'confirmation', url: undefined, homepage: result.url};
  return result;
}
