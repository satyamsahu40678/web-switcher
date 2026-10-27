// Genuine UI -> Java/database -> signed publication -> UI acceptance.
// This intentionally changes only a new, unique reserved .test family in an
// explicitly enabled loopback demo. API responses are never intercepted/mocked.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {verifyCatalog} from '../../../packages/security/catalog.mjs';

const baseUrl = new URL(process.env.LIVE_WEB_BASE || 'http://127.0.0.1:5173');
assert(['127.0.0.1', 'localhost'].includes(baseUrl.hostname), 'Full browser E2E mutations are allowed only on loopback.');
assert(['http:', 'https:'].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash && baseUrl.pathname === '/', 'Use a loopback origin without credentials/path/query.');
const base = baseUrl.origin;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const resultDirectory = path.join(root, 'test-results');
const runId = randomUUID().replaceAll('-', '').slice(0, 16);
const sourceHost = `old-browser-${runId}.web-switcher.test`;
const targetHost = `new-browser-${runId}.web-switcher.test`;
const destinationOrigin = `https://${targetHost}`;
const checks = [];
let activeCheck = 'start';
let browser;
let candidateId;
let publishedFamilyId;
let publishedSequence;
const errors = [];
const observedLookupBodies = [];
async function check(name, work) {
  activeCheck = name;
  await work();
  checks.push({name, passed: true});
  console.log(`PASS ${name}`);
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/v1/lookups' && request.method() === 'POST') observedLookupBodies.push(JSON.parse(request.postData()));
  });
  const api = async (url, options = {}) => {
    const response = await context.request.fetch(base + url, {timeout: 15000, ...options});
    return {response, text: await response.text()};
  };
  const session = async () => {
    const {response} = await api('/v1/session');
    assert.equal(response.status(), 200);
    const result = await response.json();
    assert.equal(result.demo, true, 'This test refuses to mutate a production/non-demo registry.');
    return result;
  };
  const mutate = async (url, data) => {
    const current = await session();
    return api(url, {method: 'POST', headers: {[current.csrfHeader]: current.csrfToken, 'Content-Type': 'application/json'}, data});
  };
  const lookup = async () => {
    const {response} = await api('/v1/lookups', {method: 'POST', data: {hostname: sourceHost}});
    assert.equal(response.status(), 200);
    return response.json();
  };
  const loginThroughUi = async (username) => {
    await page.getByLabel('Username', {exact: true}).fill(username);
    await page.getByLabel('Password', {exact: true}).fill('demo-password');
    await page.getByRole('button', {name: /^Sign in/}).click();
    await page.getByRole('heading', {name: /Review queue/}).waitFor();
    const current = await session();
    assert.equal(current.authenticated, true);
    assert.equal(current.username, username);
  };

  let beforeCatalog;
  await check('explicit loopback demo guard and anonymous unknown-host abstention', async () => {
    const current = await session();
    assert.equal(current.authenticated, false);
    assert.equal((await lookup()).status, 'unknown');
    const {response, text} = await api('/v1/catalog/current');
    assert.equal(response.status(), 200);
    beforeCatalog = text;
  });
  await check('public report travels from the actual React UI into the real moderation queue', async () => {
    await page.goto(base);
    await page.getByRole('heading', {name: /Addresses change/}).waitFor();
    await page.getByRole('button', {name: 'Know about a move? Submit a report'}).click();
    await page.getByLabel('Old hostname', {exact: true}).fill(sourceHost);
    await page.getByLabel('Proposed hostname').fill(targetHost);
    await page.getByLabel('Why are these the same site?').fill('Controlled synthetic browser E2E fixture; no claim about real domain ownership.');
    const result = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/reports' && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Submit for review'}).click();
    const response = await result;
    assert.equal(response.status(), 202);
    candidateId = (await response.json()).id;
    assert.match(candidateId, /^[a-f0-9-]{36}$/);
    await page.getByRole('status').filter({hasText: 'Report received for review'}).waitFor();
    assert.equal((await lookup()).status, 'unknown');
    assert.equal((await api('/v1/catalog/current')).text, beforeCatalog, 'A public report cannot alter published routing.');
  });
  await check('reviewer login, real candidate inspection and evidence-backed approval remain separate from publication', async () => {
    await page.getByRole('link', {name: 'Registry desk'}).click();
    await loginThroughUi('demo-reviewer');
    await page.getByRole('button', {name: new RegExp(sourceHost.replaceAll('.', '\\.'))}).click();
    await page.getByRole('heading', {name: 'Inspect the proposed move'}).waitFor();
    await page.getByLabel('Your decision and evidence').fill('Independent controlled fixture evidence reviewed for this synthetic acceptance test only.');
    const result = page.waitForResponse(response => new URL(response.url()).pathname === `/v1/admin/candidates/${candidateId}/decisions` && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Approve for publication'}).click();
    assert.equal((await result).status(), 200);
    await page.getByRole('status').filter({hasText: 'Decision recorded'}).waitFor();
    assert.equal((await lookup()).status, 'unknown');
    assert.equal((await api('/v1/catalog/current')).text, beforeCatalog, 'Pending review cannot activate a decision before publication.');
  });
  await check('reviewer cannot publish through either the UI or direct authenticated API', async () => {
    await page.getByRole('button', {name: 'Publications'}).click();
    const publish = page.getByRole('button', {name: /^Publish next catalog/});
    await publish.waitFor();
    assert.equal(await publish.isDisabled(), true);
    const denied = await mutate('/v1/admin/releases', {});
    assert.equal(denied.response.status(), 403);
    assert.equal((await api('/v1/catalog/current')).text, beforeCatalog);
    await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  });
  await check('a separate publisher activates the reviewed decision through the real UI', async () => {
    await loginThroughUi('demo-publisher');
    await page.getByRole('button', {name: 'Publications'}).click();
    const publish = page.getByRole('button', {name: /^Publish next catalog/});
    await publish.waitFor();
    assert.equal(await publish.isEnabled(), true);
    const result = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/admin/releases' && response.request().method() === 'POST');
    page.once('dialog', dialog => dialog.accept());
    await publish.click();
    assert.equal((await result).status(), 200);
    await page.getByRole('status').filter({hasText: 'New signed release published'}).waitFor();
  });
  await check('published Java ES256 bytes verify in WebCrypto and authorize only the reviewed origin', async () => {
    const keysResponse = await api('/v1/keys');
    assert.equal(keysResponse.response.status(), 200);
    const keys = Object.fromEntries((await keysResponse.response.json()).keys.map(key => [key.kid, key]));
    const compact = (await api('/v1/catalog/current')).text;
    assert.notEqual(compact, beforeCatalog);
    const verified = await verifyCatalog(compact, {keys});
    publishedSequence = verified.sequence;
    const alias = verified.catalog.aliases.find(item => item.sourceOrigin === `https://${sourceHost}`);
    assert(alias, 'The signed publication must contain this exact test source.');
    publishedFamilyId = alias.familyId;
    const decision = verified.catalog.decisions.find(item => item.familyId === publishedFamilyId);
    assert.equal(decision.destinationOrigin, destinationOrigin);
    assert.equal(decision.trustClass, 'registry_reviewed');
    assert.equal(decision.requiresConfirmation, true);
    assert.equal(decision.pathPolicy.type, 'homepage', 'Arbitrary report approvals do not establish deep-path compatibility.');
    const outcome = await lookup();
    assert.equal(outcome.status, 'verified');
    assert.equal(outcome.catalogSequence, verified.sequence);
    assert.equal(outcome.destinationOrigin, destinationOrigin);
  });
  await check('public lookup UI displays the approved destination using hostname-only requests', async () => {
    await page.getByRole('link', {name: 'Web Switcher home', exact: true}).click();
    await page.getByRole('heading', {name: /Addresses change/}).waitFor();
    await page.getByLabel('The old hostname').fill(sourceHost);
    await page.getByRole('button', {name: 'Look up hostname'}).click();
    await page.getByRole('heading', {name: 'A reviewed destination is available'}).waitFor();
    await page.getByText(destinationOrigin, {exact: true}).waitFor();
    assert(observedLookupBodies.length >= 1);
    for (const body of observedLookupBodies) {
      assert.deepEqual(Object.keys(body), ['hostname']);
      assert.equal(body.hostname, sourceHost);
    }
  });
  await check('authorized revocation produces a newer signed release and the actual UI abstains', async () => {
    assert.equal((await session()).username, 'demo-publisher');
    assert.match(publishedFamilyId, /^reviewed-[a-f0-9-]{36}$/);
    const revoked = await mutate(`/v1/admin/families/${encodeURIComponent(publishedFamilyId)}/revoke`, {reason: 'Controlled browser E2E revocation drill for this synthetic family only.'});
    assert.equal(revoked.response.status(), 200);
    const keys = Object.fromEntries((await (await api('/v1/keys')).response.json()).keys.map(key => [key.kid, key]));
    const verified = await verifyCatalog((await api('/v1/catalog/current')).text, {keys});
    assert(verified.sequence > publishedSequence);
    assert(verified.catalog.revocations.some(item => item.familyId === publishedFamilyId));
    assert(!verified.catalog.decisions.some(item => item.familyId === publishedFamilyId));
    assert.equal((await lookup()).status, 'unknown');
    await page.getByRole('button', {name: 'Look up hostname'}).click();
    await page.getByRole('heading', {name: 'No verified replacement found'}).waitFor();
    assert.equal(await page.getByText(destinationOrigin, {exact: true}).count(), 0);
    assert.deepEqual(errors, [], 'The actual UI must not produce uncaught browser errors.');
  });
  await page.screenshot({path: path.join(resultDirectory, 'web-e2e-final.png'), fullPage: true}).catch(() => {});
} catch (error) {
  checks.push({name: activeCheck, passed: false, error: error.message});
  console.error(`FAIL ${activeCheck}: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await mkdir(resultDirectory, {recursive: true});
  await writeFile(path.join(resultDirectory, 'web-e2e-results.json'), JSON.stringify({
    executedAt: new Date().toISOString(), base, sourceHost, candidateId, publishedFamilyId,
    passedChecks: checks.filter(check => check.passed).length, checks,
    limitations: ['Synthetic loopback demo with real React, Java, database and Chromium; no mocked API responses.', 'Does not validate production OIDC/TLS, real domain ownership, browser-store builds or extension navigation.'],
  }, null, 2) + '\n');
}
