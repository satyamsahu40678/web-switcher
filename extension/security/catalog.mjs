/** Packaged, dependency-free verification for registry data. No network key discovery. */
export const CLIENT_VERSION = '0.2.0';
export const MAX_CATALOG_BYTES = 512 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const SKEW = 5 * 60 * 1000;
const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function fail(message) { throw new Error(message); }
function assert(value, message) { if (!value) fail(message); }

/** JSON.parse accepts duplicate keys; this bounded recursive parser rejects them. */
export function parseStrictJson(text, { maxBytes = MAX_CATALOG_BYTES, maxDepth = 48 } = {}) {
  assert(typeof text === 'string' && utf8.encode(text).length <= maxBytes, 'JSON size limit exceeded');
  let offset = 0;
  const space = () => { while (/[\t\n\r ]/.test(text[offset] ?? '\0')) offset++; };
  function string() {
    const start = offset++;
    for (; offset < text.length; offset++) {
      const character = text[offset];
      if (character === '"') { offset++; return JSON.parse(text.slice(start, offset)); }
      if (character === '\\') offset++;
      else assert(character.charCodeAt(0) >= 0x20, 'Invalid JSON string');
    }
    fail('Unterminated JSON string');
  }
  function value(depth) {
    assert(depth <= maxDepth, 'JSON nesting limit exceeded');
    space();
    const character = text[offset];
    if (character === '"') return string();
    if (character === '{') {
      offset++; space();
      const result = {};
      const keys = new Set();
      if (text[offset] === '}') { offset++; return result; }
      while (offset < text.length) {
        space(); assert(text[offset] === '"', 'Expected JSON object key');
        const key = string();
        assert(!keys.has(key), `Duplicate JSON key: ${key}`); keys.add(key);
        space(); assert(text[offset++] === ':', 'Expected JSON colon');
        Object.defineProperty(result, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        space(); const next = text[offset++];
        if (next === '}') return result;
        assert(next === ',', 'Expected JSON comma');
      }
      fail('Unterminated JSON object');
    }
    if (character === '[') {
      offset++; space(); const result = [];
      if (text[offset] === ']') { offset++; return result; }
      while (offset < text.length) {
        result.push(value(depth + 1));
        space(); const next = text[offset++];
        if (next === ']') return result;
        assert(next === ',', 'Expected JSON comma');
      }
      fail('Unterminated JSON array');
    }
    for (const [literal, decoded] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return decoded; }
    }
    const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    assert(number?.index === 0, 'Invalid JSON value'); offset += number[0].length;
    const result = Number(number[0]); assert(Number.isFinite(result), 'Non-finite JSON number'); return result;
  }
  const result = value(0); space(); assert(offset === text.length, 'Unexpected trailing JSON data'); return result;
}

function object(value, required, optional = [], label = 'record') {
  assert(value && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
  assert(required.every(key => Object.hasOwn(value, key)), `Missing ${label} field`);
  const allowed = new Set([...required, ...optional]);
  assert(Object.keys(value).every(key => allowed.has(key)), `Unknown ${label} field`);
}
function text(value, max, label) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), `Invalid ${label}`);
}
function identifier(value, label = 'identifier') {
  assert(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), `Invalid ${label}`);
}
function list(value, max, label, min = 0) {
  assert(Array.isArray(value) && value.length >= min && value.length <= max, `Invalid ${label} count`);
}
function instant(value, label) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value), `Invalid ${label}`);
  const parsed = Date.parse(value);
  const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
  assert(Number.isFinite(parsed) && new Date(parsed).toISOString() === normalized, `Invalid ${label}`);
  return parsed;
}
function integer(value, label) { assert(Number.isSafeInteger(value) && value >= 1, `Invalid ${label}`); }
function version(value) {
  assert(typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value), 'Invalid client version');
  const result = value.split('.').map(Number); assert(result.every(Number.isSafeInteger), 'Invalid client version'); return result;
}
function supports(minimum, current) {
  const left = version(minimum); const right = version(current);
  for (let index = 0; index < 3; index++) { if (left[index] !== right[index]) return left[index] < right[index]; }
  return true;
}

export function validateOrigin(value) {
  text(value, 2048, 'origin');
  assert(!/[\s\\]/.test(value), 'Invalid origin');
  let url; try { url = new URL(value); } catch { fail('Invalid origin'); }
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/' && url.origin === value, 'Expected a canonical HTTPS origin without path or credentials');
  assert(url.hostname.length <= 253 && url.hostname.includes('.') && !url.hostname.endsWith('.') && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':'), 'Invalid registry hostname');
  assert(url.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)), 'Invalid registry hostname');
  return value;
}

function prefix(value) {
  text(value, 1024, 'path prefix');
  assert(value.startsWith('/') && value.endsWith('/') && !/[\s\\?#]/.test(value) && !value.includes('//') && !/%(?:2e|2f|5c)/i.test(value) && !/(?:^|\/)\.{1,2}(?:\/|$)/.test(value), 'Invalid literal path prefix');
  assert(new URL(value, 'https://path.test').pathname === value, 'Noncanonical path prefix');
}
export function validatePathPolicy(policy) {
  assert(policy && typeof policy === 'object', 'Invalid path policy');
  if (policy.type === 'homepage') object(policy, ['type'], [], 'path policy');
  else if (policy.type === 'preserve') {
    object(policy, ['type', 'publicPrefixes'], [], 'path policy');
    list(policy.publicPrefixes, 16, 'public prefixes', 1);
    policy.publicPrefixes.forEach(prefix);
    assert(new Set(policy.publicPrefixes).size === policy.publicPrefixes.length, 'Duplicate path prefix');
  } else if (policy.type === 'prefix_replace') {
    object(policy, ['type', 'fromPrefix', 'toPrefix'], [], 'path policy'); prefix(policy.fromPrefix); prefix(policy.toPrefix);
  } else fail('Unsupported path policy');
  return policy;
}

export function validateCatalog(catalog, { now = Date.now(), clientVersion = CLIENT_VERSION } = {}) {
  assert(Number.isFinite(now), 'Invalid verification time');
  object(catalog, ['schemaVersion', 'bundleSequence', 'issuedAt', 'expiresAt', 'minClientVersion', 'policyVersion', 'families', 'aliases', 'decisions', 'revocations'], [], 'catalog');
  assert(catalog.schemaVersion === 1 && catalog.policyVersion === 1, 'Unsupported catalog policy or schema');
  integer(catalog.bundleSequence, 'bundle sequence');
  assert(supports(catalog.minClientVersion, clientVersion), 'Catalog requires a newer client');
  const issuedAt = instant(catalog.issuedAt, 'catalog issue time'); const expiresAt = instant(catalog.expiresAt, 'catalog expiry');
  assert(issuedAt <= now + SKEW && expiresAt > now && expiresAt > issuedAt && expiresAt - issuedAt <= DAY, 'Catalog expired or outside validity bounds');
  list(catalog.families, 200, 'families'); list(catalog.aliases, 200, 'aliases'); list(catalog.decisions, 200, 'decisions'); list(catalog.revocations, 200, 'revocations');
  const families = new Set();
  for (const family of catalog.families) {
    object(family, ['id', 'name'], [], 'family'); identifier(family.id, 'family ID'); text(family.name, 160, 'family name');
    assert(!families.has(family.id), 'Duplicate family ID'); families.add(family.id);
  }
  const aliases = new Map();
  for (const alias of catalog.aliases) {
    object(alias, ['sourceOrigin', 'familyId'], [], 'alias'); validateOrigin(alias.sourceOrigin);
    assert(families.has(alias.familyId), 'Alias references unknown family');
    assert(!aliases.has(alias.sourceOrigin), 'Duplicate or conflicting alias origin'); aliases.set(alias.sourceOrigin, alias.familyId);
  }
  const decisions = new Map();
  for (const decision of catalog.decisions) {
    object(decision, ['familyId', 'destinationOrigin', 'trustClass', 'validUntil', 'pathPolicy', 'reasonCodes', 'requiresConfirmation'], [], 'decision');
    assert(families.has(decision.familyId) && !decisions.has(decision.familyId), 'Unknown or duplicate decision family');
    validateOrigin(decision.destinationOrigin);
    assert(['registry_reviewed', 'owner_verified'].includes(decision.trustClass), 'Unsupported decision trust class');
    const validUntil = instant(decision.validUntil, 'decision expiry');
    assert(validUntil > now && validUntil > issuedAt && validUntil <= expiresAt, 'Decision expired or outlives catalog');
    validatePathPolicy(decision.pathPolicy);
    list(decision.reasonCodes, 16, 'reason codes', 1);
    assert(decision.reasonCodes.every(reason => typeof reason === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(reason)) && new Set(decision.reasonCodes).size === decision.reasonCodes.length, 'Invalid reason codes');
    assert(typeof decision.requiresConfirmation === 'boolean', 'Invalid confirmation policy');
    decisions.set(decision.familyId, decision);
  }
  // Clients consume terminal mappings, never an unreviewed browser redirect chain.
  for (const decision of decisions.values()) assert(!aliases.has(decision.destinationOrigin), 'Migration cycle or nonterminal destination: compress approved graph before publication');
  const revoked = new Set();
  for (const revocation of catalog.revocations) {
    object(revocation, ['familyId', 'revokedAt', 'reason'], [], 'revocation');
    assert(families.has(revocation.familyId) && !revoked.has(revocation.familyId), 'Unknown or duplicate revocation family');
    assert(instant(revocation.revokedAt, 'revocation time') <= now + SKEW, 'Future revocation'); text(revocation.reason, 256, 'revocation reason'); revoked.add(revocation.familyId);
    assert(!decisions.has(revocation.familyId), 'Revoked family has active decision');
  }
  for (const familyId of aliases.values()) assert(decisions.has(familyId) || revoked.has(familyId), 'Alias has no current decision or revocation');
  return catalog;
}

export function encodeBase64Url(bytes) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeBase64Url(value, limit = MAX_CATALOG_BYTES) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(limit * 4 / 3) && /^[A-Za-z0-9_-]+$/.test(value) && value.length % 4 !== 1, 'Invalid base64url encoding');
  let bytes; try { bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)); } catch { fail('Invalid base64url encoding'); }
  assert(bytes.length <= limit && encodeBase64Url(bytes) === value, 'Noncanonical base64url encoding'); return bytes;
}
export async function sha256(value) {
  const bytes = typeof value === 'string' ? utf8.encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyJws(jws, keys, type, maxBytes = MAX_CATALOG_BYTES) {
  assert(typeof jws === 'string' && jws.length <= Math.ceil(maxBytes * 4 / 3) + 2048, 'JWS size limit exceeded');
  const parts = jws.split('.'); assert(parts.length === 3, 'Expected compact JWS');
  const header = parseStrictJson(decoder.decode(decodeBase64Url(parts[0], 1024)), { maxBytes: 1024 });
  object(header, ['alg', 'typ', 'kid'], [], 'JWS header');
  assert(header.alg === 'ES256' && header.typ === type, 'Unsupported JWS algorithm or record type');
  identifier(header.kid, 'signing key ID');
  assert(keys && Object.hasOwn(keys, header.kid), 'Unknown signing key');
  const jwk = keys[header.kid];
  assert(jwk && jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string' && !Object.hasOwn(jwk, 'd'), 'Expected public P-256 verification key');
  const payload = decodeBase64Url(parts[1], maxBytes); const signature = decodeBase64Url(parts[2], 64);
  assert(signature.length === 64, 'Invalid ES256 signature length');
  let key; try { key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); } catch { fail('Invalid verification key'); }
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, utf8.encode(`${parts[0]}.${parts[1]}`));
  assert(valid, 'Invalid JWS signature');
  return { payload: parseStrictJson(decoder.decode(payload), { maxBytes }), header, digest: await sha256(jws) };
}

export async function verifyCatalog(jws, { keys, now = Date.now(), previous, clientVersion = CLIENT_VERSION } = {}) {
  const { payload: catalog, digest } = await verifyJws(jws, keys, 'web-switcher-catalog+jws');
  validateCatalog(catalog, { now, clientVersion });
  if (previous) {
    integer(previous.sequence, 'previous sequence');
    assert(typeof previous.digest === 'string' && /^[a-f0-9]{64}$/.test(previous.digest) && Number.isFinite(previous.acceptedAt), 'Invalid previous catalog checkpoint');
    assert(now >= previous.acceptedAt - SKEW, 'Clock rollback detected');
    assert(catalog.bundleSequence >= previous.sequence, 'Catalog rollback rejected');
    assert(catalog.bundleSequence !== previous.sequence || digest === previous.digest, 'Catalog equivocation rejected');
  }
  // Retain the time high-water mark; repeated small backward steps must not
  // gradually erase a previously observed clock value.
  return { catalog, sequence: catalog.bundleSequence, digest, acceptedAt: Math.max(now, previous?.acceptedAt ?? now) };
}

export function validatePassport(passport, { now = Date.now() } = {}) {
  object(passport, ['schemaVersion', 'siteId', 'sequence', 'previousRecordHash', 'issuedAt', 'expiresAt', 'currentOrigins', 'retiredOrigins', 'pathPolicy', 'queryPolicy', 'fragmentPolicy', 'keyId'], [], 'passport');
  assert(passport.schemaVersion === 1, 'Unsupported passport schema');
  assert(typeof passport.siteId === 'string' && /^urn:webswitcher:site:[A-Za-z0-9_-]{43}$/.test(passport.siteId), 'Invalid genesis-bound site ID');
  integer(passport.sequence, 'passport sequence'); identifier(passport.keyId, 'owner key ID');
  assert(passport.sequence === 1 ? passport.previousRecordHash === null : typeof passport.previousRecordHash === 'string' && /^[a-f0-9]{64}$/.test(passport.previousRecordHash), 'Invalid passport history digest');
  const issuedAt = instant(passport.issuedAt, 'passport issue time'); const expiresAt = instant(passport.expiresAt, 'passport expiry');
  assert(issuedAt <= now + SKEW && expiresAt > now && expiresAt > issuedAt && expiresAt - issuedAt <= 7 * DAY, 'Passport expired or outside validity bounds');
  list(passport.currentOrigins, 16, 'current origins', 1); list(passport.retiredOrigins, 200, 'retired origins');
  const origins = [...passport.currentOrigins, ...passport.retiredOrigins]; origins.forEach(validateOrigin);
  assert(new Set(origins).size === origins.length, 'Conflicting or duplicate passport origins');
  validatePathPolicy(passport.pathPolicy); object(passport.queryPolicy, ['type'], [], 'query policy');
  assert(passport.queryPolicy.type === 'drop' && passport.fragmentPolicy === 'drop', 'Unsupported passport URL policy');
  return passport;
}

/** keys must come from an independently enrolled owner binding, never this record. */
export async function verifyPassport(jws, { keys, now = Date.now(), previous } = {}) {
  const { payload: passport, header, digest } = await verifyJws(jws, keys, 'web-switcher-passport+jws', 64 * 1024);
  validatePassport(passport, { now });
  assert(header.kid === passport.keyId, 'Passport key ID mismatch');
  if (previous) {
    assert(passport.siteId === previous.siteId && passport.sequence === previous.sequence + 1 && passport.previousRecordHash === previous.digest, 'Passport history does not extend pinned record');
    assert(Number.isFinite(previous.acceptedAt) && now >= previous.acceptedAt - SKEW, 'Owner clock rollback detected');
  } else {
    assert(passport.sequence === 1, 'Passport history checkpoint required');
    const publicJwk = keys[header.kid];
    const thumbprint = await crypto.subtle.digest('SHA-256', utf8.encode(JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y })));
    assert(passport.siteId === `urn:webswitcher:site:${encodeBase64Url(new Uint8Array(thumbprint))}`, 'Passport genesis identity does not match enrolled key');
  }
  return { passport, sequence: passport.sequence, siteId: passport.siteId, digest, acceptedAt: Math.max(now, previous?.acceptedAt ?? now) };
}
