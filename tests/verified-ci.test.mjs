import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hasVerifiedSourceRun} from '../infra/deploy/verified-ci.mjs';

const sourceSha = 'a'.repeat(40);
const passed = {head_sha: sourceSha, status: 'completed', conclusion: 'success', event: 'push'};

test('release accepts completed direct-source push and dispatch evidence', () => {
  assert.equal(hasVerifiedSourceRun([passed], sourceSha), true);
  assert.equal(hasVerifiedSourceRun([{...passed, event: 'workflow_dispatch'}], sourceSha), true);
});

test('a green PR merge check cannot authorize releasing its untested head tree', () => {
  assert.equal(hasVerifiedSourceRun([{...passed, event: 'pull_request'}], sourceSha), false);
  assert.equal(hasVerifiedSourceRun([{...passed, event: 'pull_request_target'}], sourceSha), false);
  assert.equal(hasVerifiedSourceRun([{...passed, head_sha: 'b'.repeat(40)}], sourceSha), false);
});

test('release rejects incomplete, unsuccessful and malformed run evidence', () => {
  for (const change of [{status: 'queued'}, {status: 'in_progress'}, {conclusion: 'failure'}, {conclusion: 'cancelled'}, {conclusion: 'skipped'}, {event: 'unknown'}]) {
    assert.equal(hasVerifiedSourceRun([{...passed, ...change}], sourceSha), false);
  }
  assert.equal(hasVerifiedSourceRun([null, {}], sourceSha), false);
  assert.equal(hasVerifiedSourceRun([], sourceSha), false);
  assert.throws(() => hasVerifiedSourceRun([], 'main'), TypeError);
  assert.throws(() => hasVerifiedSourceRun({}, sourceSha), TypeError);
});
