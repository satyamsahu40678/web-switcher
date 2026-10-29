import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInternetResult, validateInternetResult, internetEvidenceUrl} from '../extension/internet-contract.js';

const A = 'https://old.example.com', B = 'https://current.example.net';
const lead = (origin = B) => ({origin, kind: 'archive_redirect', sourceUrl: 'https://web.archive.org/web/20260101000000id_/https://old.example.com/', capturedAt: '2026-01-01T00:00:00Z', summary: 'Dated source declaration', provenanceGroup: 'archive:old.example.com'});
const result = () => buildInternetResult(A, [lead()]);

test('candidate construction needs only the source and public observations, with historical capture dates retained', () => {
  const built = buildInternetResult(A + '/private?token=secret#local', [lead()]);
  assert.equal(built.sourceOrigin, A); assert.equal(built.candidates.length, 1);
  const [candidate] = built.candidates;
  assert.equal(candidate.identityClass, 'unverified_candidate'); assert.equal(candidate.navigation, 'confirm_only');
  assert.deepEqual(candidate.availability, {state: 'not_checked'});
  assert.equal(candidate.evidence[0].capturedAt, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(JSON.stringify(built).includes('secret'), false);
});

test('construction rejects unsafe leads and bounds origins and per-origin evidence independently', () => {
  const leads = ['https://127.0.0.1', 'https://localhost', 'https://user:pass@current.example.net', 'http://current.example.net', A].map(lead);
  leads.push({...lead(), kind: 'owner_verified'});
  leads.push({...lead(), sourceUrl: 'javascript:alert(1)'});
  assert.equal(buildInternetResult(A, leads).candidates.length, 0);
  const many = Array.from({length: 15}, (_, index) => lead(`https://site${index}.example.net`));
  const bounded = buildInternetResult(A, many);
  assert.equal(bounded.candidates.length, 10);
  const repeated = Array.from({length: 10}, (_, index) => ({...lead(), sourceUrl: `https://announcement.example.org/move-${index}`}));
  assert.equal(buildInternetResult(A, repeated).candidates[0].evidence.length, 5);
  assert.equal(buildInternetResult(A, [lead(), lead()]).candidates[0].evidence.length, 1);
});

test('provider suggestions cannot forge navigation authority, trust, unexpected fields or a confidence flag', () => {
  for (const mutate of [
    value => {value.candidates[0].identityClass = 'owner_verified';},
    value => {value.candidates[0].navigation = 'automatic';},
    value => {value.candidates[0].trustClass = 'registry_reviewed';},
    value => {value.candidates[0].confidence = 0.99;},
    value => {value.signed = true;},
    value => {value.candidates[0].evidence[0].approved = true;}
  ]) {
    const value = result(); mutate(value); assert.throws(() => validateInternetResult(value));
  }
});

test('results bind an exact source, distinct candidate origins and unique candidate identifiers', () => {
  assert.throws(() => validateInternetResult(result(), {expectedSourceOrigin: 'https://another.example.org'}), /another source/);
  const duplicate = result(); duplicate.candidates.push(structuredClone(duplicate.candidates[0]));
  assert.throws(() => validateInternetResult(duplicate), /Invalid|duplicate/);
  for (const origin of ['https://127.0.0.1', 'https://current.example.net/path', A]) {
    const value = result(); value.candidates[0].origin = origin; assert.throws(() => validateInternetResult(value));
  }
});

test('candidate evidence has bounded structured dates, types, URLs and availability claims', () => {
  for (const mutate of [
    value => {value.candidates[0].evidence = [];},
    value => {value.candidates[0].evidence[0].kind = 'signed_passport';},
    value => {value.candidates[0].evidence[0].capturedAt = value.candidates[0].evidence[0].observedAt + 1;},
    value => {value.candidates[0].evidence[0].sourceUrl = 'https://127.0.0.1/private';},
    value => {value.candidates[0].evidence[0].summary = 'a'.repeat(501);},
    value => {value.candidates[0].availability = {state: 'reachable'};},
    value => {value.candidates[0].availability = {state: 'safe', checkedAt: Date.now(), vantage: 'test'};}
  ]) {
    const value = result(); mutate(value); assert.throws(() => validateInternetResult(value));
  }
  const value = result(); value.candidates[0].availability = {state: 'reachable', checkedAt: Date.now(), vantage: 'controlled-test'};
  assert.equal(validateInternetResult(value).candidates[0].identityClass, 'unverified_candidate');
});

test('lifetimes and result envelopes reject contradictions, invalid states and unbounded evidence', () => {
  const unicode = result();
  unicode.candidates = Array.from({length: 10}, (_, index) => ({...structuredClone(unicode.candidates[0]), id: `candidate-${index}`, origin: `https://candidate${index}.example.net`, title: '界'.repeat(200), evidence: Array.from({length: 5}, () => ({...structuredClone(unicode.candidates[0].evidence[0]), summary: '界'.repeat(500)}))}));
  assert.ok(JSON.stringify(unicode).length < 65536);
  assert.throws(() => validateInternetResult(unicode), /too large/);
  for (const mutate of [
    value => {value.expiresAt = value.createdAt;},
    value => {value.expiresAt = value.createdAt + 86400001;},
    value => {value.status = 'verified';},
    value => {value.outcome = 'unknown';},
    value => {value.jobId = '../other-job';},
    value => {value.reasonCodes = ['not a reason'];},
    value => {value.candidates = Array.from({length: 11}, () => structuredClone(value.candidates[0]));}
  ]) {
    const value = result(); mutate(value); assert.throws(() => validateInternetResult(value));
  }
});

test('pending, failed and cancelled jobs cannot retain actionable candidate envelopes', () => {
  for (const status of ['queued', 'running', 'failed', 'cancelled', 'expired']) {
    const value = result(); value.status = status;
    assert.equal(value.outcome, 'candidates');
    assert.throws(() => validateInternetResult(value), /Only a completed lookup/);
  }
});

test('evidence URL normalization drops tracking secrets and validation returns a clone', () => {
  assert.equal(internetEvidenceUrl('https://announcement.example.org/moved?token=private#local'), 'https://announcement.example.org/moved');
  const original = result(), validated = validateInternetResult(original);
  validated.candidates[0].title = 'Changed'; assert.notEqual(original.candidates[0].title, 'Changed');
});
