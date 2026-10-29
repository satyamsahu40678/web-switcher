import {mkdir, cp, rm, readFile, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const config = await readFile('extension/build-config.js', 'utf8');
assert.match(config, /export const ALLOW_TEST_ORIGINS = false;/, 'Never package fixture mode.');
await mkdir('dist', {recursive: true});
await rm('dist/web-switcher', {recursive: true, force: true});
await cp('extension', 'dist/web-switcher', {recursive: true});
if (process.env.WS_REGISTRY_KEYS_FILE || process.env.WS_REGISTRY_URL) {
  assert(process.env.WS_REGISTRY_KEYS_FILE && process.env.WS_REGISTRY_URL, 'Configure both registry public keys and URL.');
  const keys = JSON.parse(await readFile(process.env.WS_REGISTRY_KEYS_FILE, 'utf8'));
  assert(keys && !Array.isArray(keys) && Object.keys(keys).length > 0 && Object.keys(keys).length <= 8, 'Supply 1–8 pinned public keys.');
  for (const [kid, key] of Object.entries(keys)) {
    assert(/^[a-zA-Z0-9_-]{1,64}$/.test(kid) && key.kty === 'EC' && key.crv === 'P-256' && typeof key.x === 'string' && typeof key.y === 'string' && !key.d, 'Only named public ES256 keys may be packaged.');
    await crypto.subtle.importKey('jwk', key, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
  }
  const url = new URL(process.env.WS_REGISTRY_URL);
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && !url.search, 'Registry must use a fixed HTTPS endpoint.');
  await writeFile('dist/web-switcher/build-config.js', `export const ALLOW_TEST_ORIGINS = false;\nexport const TRUSTED_REGISTRY_KEYS = ${JSON.stringify(keys)};\nexport const REGISTRY_URL = ${JSON.stringify(url.href)};\nexport const INTERNET_PROVIDER_FIXTURES = null;\n`);
  const manifest = JSON.parse(await readFile('dist/web-switcher/manifest.json', 'utf8'));
  manifest.host_permissions = [url.origin + '/*'];
  await writeFile('dist/web-switcher/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}
const zip = spawnSync('python3', ['-c', "from pathlib import Path; from zipfile import ZipFile,ZIP_DEFLATED; root=Path('dist/web-switcher'); z=ZipFile('dist/web-switcher-0.2.0.zip','w',ZIP_DEFLATED); [z.write(p,p.relative_to(root)) for p in sorted(root.rglob('*')) if p.is_file()]; z.close()"], {stdio: 'inherit'});
if (zip.status !== 0) throw new Error('ZIP creation requires Python 3.');
console.log('Created dist/web-switcher-0.2.0.zip. Load dist/web-switcher unpacked in a permitted browser profile. Store and production release gates remain open.');
