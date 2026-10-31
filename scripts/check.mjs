import {readFile, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'declarativeNetRequestWithHostAccess', 'activeTab', 'alarms', 'webRequest', 'webNavigation']);
assert.equal(manifest.host_permissions, undefined, 'Production must not start with granted host access.');
assert.equal(manifest.content_scripts, undefined);
assert.equal(manifest.externally_connectable, undefined);
assert.match(await readFile('extension/build-config.js', 'utf8'), /export const ALLOW_TEST_ORIGINS = false;/);
assert.match(await readFile('extension/build-config.js', 'utf8'), /export const INTERNET_PROVIDER_FIXTURES = null;/, 'Never distribute provider fixtures.');
for (const name of await readdir('extension')) {
  if (name.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', `extension/${name}`], {stdio: 'inherit'});
    assert.equal(result.status, 0, name);
  }
  if (name.endsWith('.html')) {
    const text = await readFile(`extension/${name}`, 'utf8');
    assert.doesNotMatch(text, /<script(?![^>]*\bsrc=)[^>]*>/i, 'No inline JavaScript.');
    assert.doesNotMatch(text, /\son\w+\s*=/i, 'No inline event handlers.');
  }
}
console.log('Manifest, fixture exclusion, CSP-compatible HTML, and JavaScript syntax checks passed.');
