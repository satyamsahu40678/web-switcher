import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const temp = await mkdtemp(path.join(os.tmpdir(), 'web-switcher-browser-'));
const extension = path.join(temp, 'extension');
const profile = path.join(temp, 'profile');
await cp('extension', extension, {recursive: true});
// Keep the complete module contract: the service worker also imports registry
// configuration. Replacing the entire file with one fixture flag prevents its
// ES module from instantiating and misleadingly times out at worker startup.
const fixtureConfig = await readFile(path.join(extension, 'build-config.js'), 'utf8');
assert.match(fixtureConfig, /export const ALLOW_TEST_ORIGINS = false;/, 'The source build must never already be in fixture mode.');
await writeFile(path.join(extension, 'build-config.js'), fixtureConfig.replace('export const ALLOW_TEST_ORIGINS = false;', 'export const ALLOW_TEST_ORIGINS = true;'));
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
// Pregranted fixtures avoid a native permission dialog. Permission onboarding is
// explicitly NOT covered by this suite. The distributed extension has no grants.
manifest.host_permissions = ['http://*.test/*'];
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
await mkdir('test-results', {recursive: true});
const hits = [];
const checks = [];
let activeCheck = 'launch';
let context;
let worker;
let extensionId;
let browserVersion;
let bounceHomepage = false;
const server = http.createServer((req, res) => {
  hits.push({host: req.headers.host, method: req.method, path: req.url, referrer: req.headers.referer || null});
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/form') {
    res.end(`<form method="post" action="http://old.test:${port}/submit"><input name="value" value="fixture"><button>Send</button></form>`);
  } else if (req.url === '/iframe') {
    res.end(`<iframe title="fixture" src="http://old.test:${port}/frame"></iframe>`);
  } else if (req.headers.host.startsWith('new.test:') && req.url === '/' && bounceHomepage) {
    res.statusCode = 302;
    res.setHeader('Location', `http://old.test:${port}/different-old-path-after-retry`);
    res.end();
  } else if (req.headers.host.startsWith('new.test:') && req.url === '/bounce') {
    res.statusCode = 302;
    res.setHeader('Location', `http://old.test:${port}/return`);
    res.end();
  } else {
    res.end('<!doctype html><title>Controlled origin</title><h1>Controlled origin</h1>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const sourceOrigin = `http://old.test:${port}`;
const targetOrigin = `http://new.test:${port}`;
const gateUrl = () => `chrome-extension://${extensionId}/route.html`;
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}),
    viewport: {width: 1280, height: 1000},
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-proxy-server', '--host-resolver-rules=MAP *.test 127.0.0.1']
  });
  context.setDefaultTimeout(10000);
  [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  extensionId = worker.url().split('/')[2];
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
}
async function check(id, fn) {
  activeCheck = id;
  await fn();
  checks.push({id, passed: true});
  console.log(`PASS ${id}`);
}
async function currentConfig() {
  return worker.evaluate(async () => (await chrome.storage.local.get('config')).config);
}
async function writeConfig(config) {
  await worker.evaluate(config => chrome.storage.local.set({config}), config);
}
async function freshPage() {
  return context.newPage();
}
async function navigate(page, url) {
  try { await page.goto(url, {waitUntil: 'domcontentloaded'}); }
  catch (error) { if (!error.message.includes('ERR_ABORTED')) throw error; }
}
async function expectBlocked(page, reason) {
  await page.waitForFunction(reason => document.body.dataset.reason === reason, reason);
  assert.equal(page.url(), gateUrl(), 'The raw source envelope should be removed from the gate address.');
}
try {
  await launch();
  const settings = await freshPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByText('Local switching enabled', {exact: true}).waitFor();
  await settings.screenshot({path: 'test-results/options-empty.png', fullPage: true});
  await check('B01_save_mapping_through_ui', async () => {
    await settings.getByLabel('Old origin', {exact: true}).fill(sourceOrigin);
    await settings.getByLabel('Current origin', {exact: true}).fill(targetOrigin);
    await settings.getByLabel('When opening a link').selectOption('preserve');
    await settings.getByLabel('I have checked that this destination is the site I intend to visit.').check();
    await settings.getByRole('button', {name: 'Connect these addresses'}).click();
    await settings.getByText(`Connection saved for ${sourceOrigin}.`, {exact: true}).waitFor();
    assert.equal((await currentConfig()).mappings.length, 1);
    await settings.screenshot({path: 'test-results/options-saved.png', fullPage: true});
  });
  const baseline = await currentConfig();
  await check('B02_redirect_public_path_without_query_or_fragment', async () => {
    const page = await freshPage();
    await navigate(page, `${sourceOrigin}/Docs/a%20b?q=fixture#section`);
    await page.waitForURL(`${targetOrigin}/Docs/a%20b`);
  });
  await check('B03_old_origin_not_requested_and_no_referrer', async () => {
    assert.equal(hits.filter(hit => hit.host === `old.test:${port}`).length, 0);
    const destinationHit = hits.find(hit => hit.host === `new.test:${port}` && hit.path === '/Docs/a%20b');
    assert.ok(destinationHit);
    assert.equal(destinationHit.referrer, null);
  });
  await check('B04_encoded_ampersand_and_unicode_paths', async () => {
    for (const suffix of ['/docs/a%26b', '/docs/%E2%9C%93']) {
      const page = await freshPage();
      await navigate(page, sourceOrigin + suffix);
      await page.waitForURL(targetOrigin + suffix);
    }
  });
  await check('B05_exact_host_excludes_suffix_lookalike', async () => {
    const page = await freshPage();
    const url = `http://old.test.evil.test:${port}/page`;
    await page.goto(url);
    assert.equal(page.url(), url);
  });
  await check('B06_post_navigation_not_rewritten', async () => {
    const page = await freshPage();
    await page.goto(`http://launcher.test:${port}/form`);
    await Promise.all([page.waitForURL(`${sourceOrigin}/submit`), page.getByRole('button', {name: 'Send'}).click()]);
    assert.ok(hits.some(hit => hit.host === `old.test:${port}` && hit.method === 'POST'));
  });
  await check('B07_iframe_navigation_not_rewritten', async () => {
    const page = await freshPage();
    await page.goto(`http://launcher.test:${port}/iframe`);
    await page.frameLocator('iframe').getByRole('heading', {name: 'Controlled origin'}).waitFor();
    assert.ok(hits.some(hit => hit.host === `old.test:${port}` && hit.path === '/frame'));
  });
  await check('B08_expired_mapping_blocked_with_persisted_rule', async () => {
    const expired = structuredClone(baseline);
    expired.mappings[0].createdAt = Date.now() - 7200000;
    expired.mappings[0].expiresAt = Date.now() - 3600000;
    await writeConfig(expired);
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 1);
    const page = await freshPage();
    await navigate(page, `${sourceOrigin}/expired`);
    await expectBlocked(page, 'expired');
    await writeConfig(baseline);
  });
  await check('B09_paused_mapping_blocked_with_persisted_rule', async () => {
    const paused = structuredClone(baseline);
    paused.mappings[0].enabled = false;
    await writeConfig(paused);
    const page = await freshPage();
    await navigate(page, `${sourceOrigin}/paused`);
    await expectBlocked(page, 'paused');
    await writeConfig(baseline);
  });
  await check('B10_stale_generation_rejected', async () => {
    const page = await freshPage();
    await page.goto(`${gateUrl()}#g=stale&m=${baseline.mappings[0].id}&source=${sourceOrigin}/page`);
    await expectBlocked(page, 'changed');
  });
  await check('B11_forged_source_rejected', async () => {
    const page = await freshPage();
    await page.goto(`${gateUrl()}#g=${baseline.generation}&m=${baseline.mappings[0].id}&source=http://evil.test:${port}/page`);
    await expectBlocked(page, 'invalid');
  });
  await check('B12_sensitive_link_requires_homepage_click', async () => {
    const page = await freshPage();
    await navigate(page, `${sourceOrigin}/page?token=synthetic`);
    await expectBlocked(page, 'manual');
    await Promise.all([page.waitForURL(targetOrigin + '/'), page.getByRole('button', {name: 'Open destination homepage'}).click()]);
  });
  await check('B13_ambiguous_path_requires_review', async () => {
    const page = await freshPage();
    await navigate(page, `${sourceOrigin}/path/%2Fencoded`);
    await expectBlocked(page, 'manual');
  });
  await check('B14_destination_return_loop_stopped', async () => {
    const page = await freshPage();
    await navigate(page, `${sourceOrigin}/bounce`);
    await expectBlocked(page, 'loop');
  });
  await check('B14a_deliberate_same_tab_retry_opens_only_saved_homepage', async () => {
    const homepage = structuredClone(baseline);
    homepage.mappings[0].pathPolicy = 'homepage';
    await writeConfig(homepage);
    const page = await freshPage();
    const oldLink = `${sourceOrigin}/download-peaky-blinders-the-immortal-man-2026-hindi-dubbed-org-english-480p-720p-1080p/?source=synthetic#private`;
    try {
      await navigate(page, oldLink);
      await page.waitForURL(targetOrigin + '/');
      await page.getByRole('heading', {name: 'Controlled origin'}).waitFor();
      const beforeRepeat = hits.length;
      await navigate(page, oldLink);
      await expectBlocked(page, 'loop');
      const retry = page.getByRole('button', {name: 'Open destination homepage once', exact: true});
      await retry.waitFor({state: 'visible'});
      await page.getByText(targetOrigin + '/', {exact: true}).waitFor();
      assert.equal(hits.slice(beforeRepeat).filter(hit => hit.host === `new.test:${port}` && hit.path !== '/favicon.ico').length, 0,
        'A blocked repeat must not retry the destination automatically.');
      await Promise.all([page.waitForURL(targetOrigin + '/'), retry.click()]);
      await page.getByRole('heading', {name: 'Controlled origin'}).waitFor();
      const retried = hits.slice(beforeRepeat).filter(hit => hit.host === `new.test:${port}` && hit.path !== '/favicon.ico');
      assert.equal(retried.length, 1);
      assert.equal(retried[0].path, '/', 'The retry must strip the old deep path, query and fragment.');
      assert.equal(retried[0].referrer, null);
      assert.equal(hits.slice(beforeRepeat).some(hit => hit.host === `old.test:${port}`), false);
    } finally {
      await page.close();
      await writeConfig(baseline);
    }
  });
  await check('B14b_homepage_retry_still_blocks_a_new_destination_bounce', async () => {
    const homepage = structuredClone(baseline);
    homepage.mappings[0].pathPolicy = 'homepage';
    await writeConfig(homepage);
    const page = await freshPage();
    try {
      await navigate(page, sourceOrigin + '/first-link');
      await page.waitForURL(targetOrigin + '/');
      await page.getByRole('heading', {name: 'Controlled origin'}).waitFor();
      await navigate(page, sourceOrigin + '/another-deliberate-link');
      await expectBlocked(page, 'loop');
      const retry = page.getByRole('button', {name: 'Open destination homepage once', exact: true});
      await retry.waitFor({state: 'visible'});
      await page.evaluate(() => { window.__beforeLoopRetry = true; });
      const beforeRetry = hits.length;
      bounceHomepage = true;
      await retry.click();
      await page.waitForFunction(() => !window.__beforeLoopRetry && document.body.dataset.reason === 'loop');
      await expectBlocked(page, 'loop');
      await page.getByRole('button', {name: 'Open destination homepage once', exact: true}).waitFor({state: 'visible'});
      const retried = hits.slice(beforeRetry).filter(hit => hit.host === `new.test:${port}` && hit.path !== '/favicon.ico');
      assert.equal(retried.length, 1, 'One deliberate retry must not disable protection or produce automatic retries.');
      assert.equal(retried[0].path, '/');
      assert.equal(hits.slice(beforeRetry).some(hit => hit.host === `old.test:${port}`), false,
        'A bounce into another old path must be stopped before reaching the old origin.');
    } finally {
      bounceHomepage = false;
      await page.close();
      await writeConfig(baseline);
    }
  });
  await check('B14c_loop_retry_revalidates_changed_mapping_policy', async () => {
    const homepage = structuredClone(baseline);
    homepage.mappings[0].pathPolicy = 'homepage';
    await writeConfig(homepage);
    const page = await freshPage();
    try {
      await navigate(page, sourceOrigin + '/first-link');
      await page.waitForURL(targetOrigin + '/');
      await page.getByRole('heading', {name: 'Controlled origin'}).waitFor();
      await navigate(page, sourceOrigin + '/repeat-link');
      await expectBlocked(page, 'loop');
      const retry = page.getByRole('button', {name: 'Open destination homepage once', exact: true});
      await retry.waitFor({state: 'visible'});
      const changed = structuredClone(homepage);
      changed.generation = 'loop-retry-policy-changed';
      changed.mappings[0].destinationOrigin = `http://replacement.test:${port}`;
      await writeConfig(changed);
      const beforeRetry = hits.length;
      await retry.click();
      await expectBlocked(page, 'changed');
      assert.equal(hits.slice(beforeRetry).filter(hit => hit.path !== '/favicon.ico').length, 0,
        'A stale loop-recovery choice must not contact either the old or changed destination.');
    } finally {
      await page.close();
      await writeConfig(baseline);
    }
  });
  await check('B15_ungranted_source_gate_refused', async () => {
    const ungranted = structuredClone(baseline);
    ungranted.mappings[0].sourceOrigin = 'https://ungranted-site.com';
    ungranted.mappings[0].destinationOrigin = 'https://destination-site.com';
    await writeConfig(ungranted);
    const page = await freshPage();
    await page.goto(`${gateUrl()}#g=${baseline.generation}&m=${baseline.mappings[0].id}&source=https://ungranted-site.com/page`);
    await expectBlocked(page, 'permission');
    await writeConfig(baseline);
  });
  await check('B16_global_pause_removes_interception', async () => {
    await settings.reload();
    await settings.getByRole('button', {name: 'Pause all switching'}).click();
    await settings.getByText('All switching paused', {exact: true}).waitFor();
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 0);
    const page = await freshPage();
    await page.goto(`${sourceOrigin}/ordinary`);
    assert.equal(page.url(), `${sourceOrigin}/ordinary`);
    await settings.getByRole('button', {name: 'Resume switching'}).click();
    await settings.getByText('Local switching enabled', {exact: true}).waitFor();
  });
  await check('B17_configuration_survives_browser_restart', async () => {
    await context.close();
    context = undefined;
    await launch();
    const settings = await freshPage();
    await settings.goto(`chrome-extension://${extensionId}/options.html`);
    await settings.getByText('Local switching enabled', {exact: true}).waitFor();
    const page = await freshPage();
    await navigate(page, `${sourceOrigin}/after-restart`);
    await page.waitForURL(`${targetOrigin}/after-restart`);
  });
  await check('B18_receipts_have_no_path_query_or_fragment', async () => {
    const receipts = await worker.evaluate(async () => (await chrome.storage.local.get('receipts')).receipts);
    assert.ok(receipts.length > 0 && receipts.length <= 20);
    for (const receipt of receipts) assert.deepEqual(Object.keys(receipt).sort(), ['at', 'destinationOrigin', 'sourceOrigin']);
    assert.ok(!JSON.stringify(receipts).includes('synthetic'));
  });
  await check('B19_removing_mapping_clears_rules', async () => {
    const settings = await freshPage();
    await settings.goto(`chrome-extension://${extensionId}/options.html`);
    await settings.getByRole('button', {name: 'Remove', exact: true}).click();
    await settings.getByText('A new thread starts here', {exact: true}).waitFor();
    assert.equal((await currentConfig()).mappings.length, 0);
    assert.equal((await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length, 0);
    // These test hosts are deliberately required/pregranted. Chrome cannot
    // revoke them through permissions.remove; that cleanup limitation must not
    // turn a committed mapping removal into an error or leave stale UI/rules.
    assert.equal(await worker.evaluate(origin => chrome.permissions.contains({origins: [origin + '/*']}), sourceOrigin), true);
    const notice = settings.locator('#notice');
    const removalMessage = await notice.textContent();
    assert.match(removalMessage, /^Mapping removed\./);
    assert.match(removalMessage, /source access/);
    assert.match(removalMessage, /browser/);
    assert.equal(await notice.evaluate(node => node.classList.contains('error')), false);
    const original = await freshPage();
    await original.goto(sourceOrigin + '/after-removal');
    assert.equal(original.url(), sourceOrigin + '/after-removal');
    assert.ok(hits.some(hit => hit.host === `old.test:${port}` && hit.path === '/after-removal' && hit.method === 'GET'));
  });
} catch (error) {
  const notices = [];
  for (const page of context?.pages() || []) {
    try {
      for (const selector of ['#notice', '#message']) {
        const node = page.locator(selector);
        if (await node.count()) notices.push((await node.textContent({timeout: 1000}))?.slice(0, 600));
      }
    } catch { /* Failure diagnostics must preserve the original test failure. */ }
  }
  if (notices.some(Boolean)) error.message += `; page notices: ${notices.filter(Boolean).join(' | ')}`;
  console.error(`FAIL ${activeCheck}: ${error.message}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    // Check-run annotations remain readable through the GitHub API even when
    // the runner's redirected log-storage host cannot be reached by a reviewer.
    const detail = `${activeCheck}: ${error.message}`.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.error(`::error title=Web Switcher extension browser acceptance::${detail}`);
  }
  checks.push({id: activeCheck, passed: false, error: error.message});
  process.exitCode = 1;
} finally {
  await writeFile('test-results/browser-results.json', JSON.stringify({
    executedAt: new Date().toISOString(), browserVersion,
    passedChecks: checks.filter(check => check.passed).length, checks,
    limitations: ['Fixture hosts are pregranted; native permission prompts and permission removal are not verified.', 'Chromium reference build only; current Chrome/Edge store builds are untested.', 'No real DNS/TLS ownership, signed registry, automatic discovery, BFCache, or source service-worker coverage.']
  }, null, 2) + '\n');
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temp, {recursive: true, force: true});
}
