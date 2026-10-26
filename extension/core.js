export const MAX_MAPPINGS = 50;
export const MAX_URL_LENGTH = 8192;
export const MAX_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
export const LOOP_WINDOW_MS = 15000;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SENSITIVE_PATH = /(?:^|\/)(?:auth|oauth|login|logout|signin|account|accounts|password|reset|checkout|payment|payments|download)(?:\/|$|[.])/i;
const SENSITIVE_QUERY = /^(?:access_token|token|code|state|password|secret|signature|sig|api_key|key|authorization|session)$/i;
const DOWNLOAD_PATH = /\.(?:exe|msi|dmg|pkg|apk|zip|tar|gz|pdf)$/i;

export function originOf(value, {target = false, allowTestOrigins = false} = {}) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\s\\]/.test(value)) {
    throw new Error('Enter a complete origin, such as https://old-site.com.');
  }
  const url = new URL(value);
  const fixture = allowTestOrigins && url.hostname.endsWith('.test');
  if (!['https:', 'http:'].includes(url.protocol) || (target && url.protocol !== 'https:' && !fixture)) {
    throw new Error('The destination must use HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Enter an origin only, without a path, credentials, query, or fragment.');
  }
  if (url.port && !fixture) throw new Error('Custom ports are supported only by test fixtures.');
  if (url.hostname.endsWith('.') || !url.hostname.includes('.') || url.hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(url.hostname)) {
    throw new Error('Use a public domain name without a trailing dot.');
  }
  if (!fixture && /(?:^|\.)(?:localhost|local|internal|test|example|invalid)$/.test(url.hostname)) {
    throw new Error('Private and reserved hostnames are excluded from this prototype.');
  }
  const labels = url.hostname.split('.');
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error('The domain name is invalid.');
  }
  return url.origin;
}

export function validateConfig(config, options = {}) {
  if (!config || config.schemaVersion !== 1 || typeof config.generation !== 'string' || !ID.test(config.generation) || typeof config.paused !== 'boolean' || !Array.isArray(config.mappings) || config.mappings.length > MAX_MAPPINGS) {
    throw new Error('The local configuration is invalid.');
  }
  const ids = new Set();
  const sources = new Set();
  for (const mapping of config.mappings) {
    if (!mapping || typeof mapping.id !== 'string' || !ID.test(mapping.id) || ids.has(mapping.id) || typeof mapping.enabled !== 'boolean') throw new Error('Invalid or duplicate mapping.');
    if (originOf(mapping.sourceOrigin, options) !== mapping.sourceOrigin || originOf(mapping.destinationOrigin, {...options, target: true}) !== mapping.destinationOrigin) throw new Error('Origins must be normalized.');
    if (sources.has(mapping.sourceOrigin) || mapping.sourceOrigin === mapping.destinationOrigin) throw new Error('Each source needs a distinct destination and only one mapping.');
    if (!['homepage', 'preserve'].includes(mapping.pathPolicy)) throw new Error('Choose a supported path policy.');
    if (!Number.isSafeInteger(mapping.createdAt) || !Number.isSafeInteger(mapping.expiresAt) || mapping.createdAt < 0 || mapping.expiresAt - mapping.createdAt < 3600000 || mapping.expiresAt - mapping.createdAt > MAX_VALIDITY_MS) throw new Error('Mapping validity must be between one hour and seven days.');
    ids.add(mapping.id);
    sources.add(mapping.sourceOrigin);
  }
  if (config.mappings.some(mapping => sources.has(mapping.destinationOrigin))) {
    throw new Error('Point every old origin directly to the final destination. Chained mappings and loops are excluded.');
  }
  return config;
}

export function createMapping(input, now, id, options = {}) {
  const hours = Number(input.durationHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('Choose a validity between 1 and 168 hours.');
  const mapping = {
    id,
    sourceOrigin: originOf(input.sourceOrigin, options),
    destinationOrigin: originOf(input.destinationOrigin, {...options, target: true}),
    pathPolicy: input.pathPolicy,
    enabled: true,
    createdAt: now,
    expiresAt: now + hours * 3600000
  };
  validateConfig({schemaVersion: 1, generation: 'validation', paused: false, mappings: [mapping]}, options);
  return mapping;
}

export function permissionFor(origin) {
  return origin + '/*';
}

export function compileRules(config, gateUrl, grantedOrigins, now, options = {}) {
  validateConfig(config, options);
  const gate = new URL(gateUrl);
  if (gate.protocol !== 'chrome-extension:' || gate.pathname !== '/route.html' || gate.search || gate.hash) throw new Error('Invalid packaged gate.');
  if (config.paused) return [];
  return config.mappings.filter(m => m.enabled && m.expiresAt > now && grantedOrigins.has(m.sourceOrigin)).map((mapping, index) => ({
    id: index + 1,
    priority: 1,
    action: {type: 'redirect', redirect: {regexSubstitution: `${gateUrl}#g=${config.generation}&m=${mapping.id}&source=\\0`}},
    condition: {
      regexFilter: '^' + mapping.sourceOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/.*$',
      resourceTypes: ['main_frame'],
      requestMethods: ['get'],
      isUrlFilterCaseSensitive: false
    }
  }));
}

export function parseEnvelope(hash) {
  if (typeof hash !== 'string' || hash.length > MAX_URL_LENGTH + 200) throw new Error('The source address is too long.');
  const match = /^#g=([a-zA-Z0-9_-]{1,64})&m=([a-zA-Z0-9_-]{1,64})&source=(.+)$/s.exec(hash);
  if (!match) throw new Error('The routing request is invalid.');
  // The matched URL is raw, not URI-decoded. Decoding here changes encoded paths.
  return {generation: match[1], mappingId: match[2], source: match[3]};
}

export function resolveRoute(config, envelope, now, options = {}) {
  validateConfig(config, options);
  if (!envelope || envelope.generation !== config.generation) return blocked('changed');
  if (config.paused) return blocked('paused');
  const mapping = config.mappings.find(m => m.id === envelope.mappingId);
  if (!mapping) return blocked('unknown');
  if (!mapping.enabled) return blocked('paused');
  if (mapping.expiresAt <= now || mapping.createdAt > now) return blocked('expired');
  const raw = envelope.source;
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH || /[\u0000-\u0020\\]/.test(raw)) return blocked('invalid');
  let source;
  try { source = new URL(raw); } catch { return blocked('invalid'); }
  if (source.origin !== mapping.sourceOrigin || source.username || source.password) return blocked('invalid');
  const info = {sourceOrigin: mapping.sourceOrigin, destinationOrigin: mapping.destinationOrigin, mappingId: mapping.id};
  const ambiguousPath = source.pathname.startsWith('//') || /%(?:2f|5c|2e)/i.test(source.pathname);
  const sensitive = SENSITIVE_PATH.test(source.pathname) || DOWNLOAD_PATH.test(source.pathname) || [...source.searchParams.keys()].some(key => SENSITIVE_QUERY.test(key));
  if (ambiguousPath || sensitive) return {...blocked('manual'), ...info, homepage: mapping.destinationOrigin + '/'};
  const destination = new URL(mapping.destinationOrigin);
  if (mapping.pathPolicy === 'preserve') destination.pathname = source.pathname;
  destination.search = '';
  destination.hash = '';
  if (destination.origin !== mapping.destinationOrigin) return blocked('invalid');
  return {status: 'ready', ...info, url: destination.href};
}

export function blocked(reason) { return {status: 'blocked', reason}; }

export function loopDetected(previous, now) {
  return previous !== undefined && (now < previous || now - previous < LOOP_WINDOW_MS);
}
