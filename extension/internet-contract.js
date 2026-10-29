import {normalizeSource} from './continuity.js';
import {originOf} from './core.js';

export const INTERNET_SCHEMA_VERSION = 2;
export const INTERNET_MAX_CANDIDATES = 10;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const KINDS = new Set(['archive_redirect', 'archive_metadata', 'archive_announcement', 'search_result', 'public_reference']);
const STATES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled', 'expired']);
const OUTCOMES = new Set(['candidates', 'unknown', 'unavailable', 'conflict', 'blocked']);
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
function closed(value, fields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid ' + name + '.');
}
function codes(values) { return Array.isArray(values) && values.length <= 16 && values.every(value => typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value)); }
export function normalizeInternetOrigin(value, options = {}) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid public origin.');
  const url = new URL(value);
  if (url.username || url.password) throw new Error('Credentials are not allowed.');
  return normalizeSource(url.origin, options);
}
export function internetEvidenceUrl(value, options = {}) {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\\]/.test(value)) throw new Error('Invalid evidence URL.');
  const url = new URL(value);
  originOf(url.origin, {...options, target: true});
  if (url.username || url.password) throw new Error('Invalid evidence URL.');
  url.search = ''; url.hash = '';
  return url.href;
}

/** Public observations rank candidates; no caller can manufacture routing trust. */
export function buildInternetResult(source, leads = [], settings = {}) {
  const sourceOrigin = normalizeSource(source, settings), now = settings.now ?? Date.now();
  const groups = new Map();
  for (const lead of leads.slice(0, 100)) {
    try {
      const origin = normalizeInternetOrigin(lead.origin, settings);
      if (origin === sourceOrigin || !KINDS.has(lead.kind)) continue;
      const sourceUrl = internetEvidenceUrl(lead.sourceUrl, settings);
      const evidence = {kind: lead.kind, sourceUrl, observedAt: now, summary: text(lead.summary, 500) ? lead.summary : 'Public source suggests this address; identity is unverified.', provenanceGroup: text(lead.provenanceGroup, 160) ? lead.provenanceGroup : sourceUrl.slice(0, 160)};
      const capturedAt = typeof lead.capturedAt === 'string' ? Date.parse(lead.capturedAt) : lead.capturedAt;
      if (time(capturedAt) && capturedAt <= now) evidence.capturedAt = capturedAt;
      let candidate = groups.get(origin);
      if (!candidate) {
        if (groups.size >= INTERNET_MAX_CANDIDATES) continue;
        candidate = {id: crypto.randomUUID(), origin, title: text(lead.title, 200) ? lead.title : origin, evidence: [], identityClass: 'unverified_candidate', navigation: 'confirm_only', availability: {state: 'not_checked'}, reasonCodes: ['IDENTITY_UNESTABLISHED']};
        groups.set(origin, candidate);
      }
      if (candidate.evidence.length < 5 && !candidate.evidence.some(item => item.kind === evidence.kind && item.sourceUrl === sourceUrl)) candidate.evidence.push(evidence);
    } catch { /* Reject an unsafe lead without weakening other observations. */ }
  }
  const candidates = [...groups.values()];
  const result = {schemaVersion: INTERNET_SCHEMA_VERSION, jobId: settings.jobId || crypto.randomUUID(), sourceOrigin, status: settings.status || 'completed', outcome: settings.outcome || (candidates.length ? 'candidates' : 'unknown'), completeness: settings.completeness || 'complete', reasonCodes: settings.reasonCodes || [], candidates, createdAt: settings.createdAt ?? now, expiresAt: settings.expiresAt ?? now + 3600000};
  if (settings.phase !== undefined) result.phase = settings.phase;
  return validateInternetResult(result, settings);
}

export function validateInternetResult(raw, options = {}) {
  closed(raw, ['schemaVersion', 'jobId', 'sourceOrigin', 'status', 'outcome', 'completeness', 'reasonCodes', 'candidates', 'createdAt', 'expiresAt', 'phase'], 'Internet discovery response');
  if (raw.schemaVersion !== INTERNET_SCHEMA_VERSION || !ID.test(raw.jobId || '') || !STATES.has(raw.status) || !OUTCOMES.has(raw.outcome) || !['complete', 'partial'].includes(raw.completeness) || !codes(raw.reasonCodes)) throw new Error('Unsupported Internet discovery response.');
  if (normalizeSource(raw.sourceOrigin, options) !== raw.sourceOrigin || options.expectedSourceOrigin && raw.sourceOrigin !== options.expectedSourceOrigin) throw new Error('The discovery response belongs to another source.');
  if (!time(raw.createdAt) || !time(raw.expiresAt) || raw.expiresAt <= raw.createdAt || raw.expiresAt - raw.createdAt > 86400000 || raw.phase !== undefined && !text(raw.phase, 80)) throw new Error('Invalid discovery lifetime.');
  if (!Array.isArray(raw.candidates) || raw.candidates.length > INTERNET_MAX_CANDIDATES) throw new Error('Too many discovery candidates.');
  const origins = new Set(), ids = new Set();
  for (const candidate of raw.candidates) {
    closed(candidate, ['id', 'origin', 'title', 'evidence', 'identityClass', 'navigation', 'availability', 'reasonCodes'], 'candidate');
    if (!ID.test(candidate.id || '') || ids.has(candidate.id) || normalizeInternetOrigin(candidate.origin, options) !== candidate.origin || origins.has(candidate.origin) || candidate.origin === raw.sourceOrigin || !text(candidate.title, 200) || candidate.identityClass !== 'unverified_candidate' || candidate.navigation !== 'confirm_only' || !codes(candidate.reasonCodes)) throw new Error('Invalid or falsely trusted discovery candidate.');
    origins.add(candidate.origin); ids.add(candidate.id);
    closed(candidate.availability, ['state', 'checkedAt', 'vantage'], 'availability');
    if (!['not_checked', 'reachable', 'unavailable'].includes(candidate.availability.state) || candidate.availability.checkedAt !== undefined && !time(candidate.availability.checkedAt) || candidate.availability.vantage !== undefined && !text(candidate.availability.vantage, 80)) throw new Error('Invalid availability.');
    if (candidate.availability.state !== 'not_checked' && (!time(candidate.availability.checkedAt) || !text(candidate.availability.vantage, 80))) throw new Error('Availability needs a time and vantage.');
    if (!Array.isArray(candidate.evidence) || !candidate.evidence.length || candidate.evidence.length > 5) throw new Error('Missing candidate evidence.');
    for (const item of candidate.evidence) {
      closed(item, ['kind', 'sourceUrl', 'capturedAt', 'observedAt', 'summary', 'provenanceGroup'], 'evidence');
      if (!KINDS.has(item.kind) || internetEvidenceUrl(item.sourceUrl, options) !== item.sourceUrl || !time(item.observedAt) || item.capturedAt !== undefined && (!time(item.capturedAt) || item.capturedAt > item.observedAt) || !text(item.summary, 500) || !text(item.provenanceGroup, 160)) throw new Error('Invalid candidate evidence.');
    }
  }
  if (raw.outcome === 'candidates' && !raw.candidates.length || raw.candidates.length && raw.outcome !== 'candidates') throw new Error('Discovery outcome contradicts its candidates.');
  if (raw.candidates.length && raw.status !== 'completed') throw new Error('Only a completed lookup can contain candidates.');
  if (JSON.stringify(raw).length > 65536) throw new Error('Internet discovery response is too large.');
  return structuredClone(raw);
}
