#!/usr/bin/env node
// Offline publisher key provisioning. Private material is written only to an
// owner-only PKCS8 DER file, never stdout, a browser bundle, or Git configuration.
import {generateKeyPairSync, createPrivateKey, createPublicKey, createHash, sign, verify} from 'node:crypto';
import {mkdirSync, lstatSync, statSync, realpathSync, openSync, writeFileSync, closeSync, unlinkSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {parseStrictJson} from '../packages/security/catalog.mjs';

function args(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index], value = values[index + 1];
    if (!['--directory', '--kid', '--private', '--trust'].includes(name) || !value || value.startsWith('--') || name in result) throw new Error('Use named, unique options with their values.');
    result[name] = value;
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(result['--kid'] || '')) throw new Error('Supply a public key ID with --kid (letters, digits, underscore or hyphen; at most64).');
  return result;
}
function publicKey(key, kid) {
  const jwk = createPublicKey(key).export({format: 'jwk'});
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('Only a P-256 publisher key is supported.');
  return {kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, use: 'sig', alg: 'ES256'};
}
function fingerprint(jwk) {
  return createHash('sha256').update(JSON.stringify({crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y})).digest('base64url');
}
function protectedPrivate(file) {
  const state = lstatSync(file);
  if (!state.isFile() || state.isSymbolicLink() || (state.mode & 0o077) || (process.getuid && state.uid !== process.getuid())) throw new Error('The private key must be a regular owner-only file owned by the current user.');
  return createPrivateKey({key: readFileSync(file), format: 'der', type: 'pkcs8'});
}
try {
  const [command, ...values] = process.argv.slice(2);
  const options = args(values), kid = options['--kid'];
  if (command === 'generate') {
    if (!options['--directory'] || Object.keys(options).some(key => !['--directory', '--kid'].includes(key))) throw new Error('generate requires --directory /absolute/protected/path --kid KEY_ID.');
    const requested = options['--directory'];
    if (!path.isAbsolute(requested)) throw new Error('Use an absolute key directory.');
    mkdirSync(requested, {recursive: true, mode: 0o700});
    const state = lstatSync(requested);
    if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o077) || (process.getuid && state.uid !== process.getuid())) throw new Error('The key directory must be mode0700 and owned by the current user.');
    const directory = realpathSync(requested);
    const {privateKey} = generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
    const jwk = publicKey(privateKey, kid);
    const outputs = [
      ['publisher-private.pk8', privateKey.export({format: 'der', type: 'pkcs8'}), 0o600],
      ['registry-public.jwk.json', JSON.stringify(jwk, null, 2) + '\n', 0o644],
      ['registry-trust-anchors.json', JSON.stringify({[kid]: jwk}, null, 2) + '\n', 0o644],
    ];
    const created = [];
    try {
      for (const [name, contents, mode] of outputs) {
        const file = path.join(directory, name), fd = openSync(file, 'wx', mode);
        created.push({file, inode: statSync(file).ino});
        try { writeFileSync(fd, contents); } finally { closeSync(fd); }
      }
    } catch (error) {
      // Only this invocation's newly created files are removed. Existing keys
      // and trust files are never overwritten or deleted.
      for (const item of created.reverse()) { try { if (lstatSync(item.file).ino === item.inode) unlinkSync(item.file); } catch {} }
      throw error;
    }
    console.log(JSON.stringify({keyId: kid, publicThumbprint: fingerprint(jwk), privateKeyFile: path.join(directory, 'publisher-private.pk8'), publicTrustFile: path.join(directory, 'registry-trust-anchors.json')}, null, 2));
  } else if (command === 'check') {
    if (!options['--private'] || !options['--trust'] || Object.keys(options).some(key => !['--private', '--trust', '--kid'].includes(key))) throw new Error('check requires --private FILE --trust FILE --kid KEY_ID.');
    const key = protectedPrivate(options['--private']);
    const expected = publicKey(key, kid), trust = parseStrictJson(readFileSync(options['--trust'], 'utf8'));
    const actual = trust?.[kid];
    if (!actual || Object.keys(actual).some(name => !['kty', 'crv', 'x', 'y', 'kid', 'use', 'alg', 'key_ops', 'ext'].includes(name)) || ['kty', 'crv', 'x', 'y'].some(name => actual[name] !== expected[name]) || (actual.kid !== undefined && actual.kid !== kid) || (actual.use !== undefined && actual.use !== 'sig') || (actual.alg !== undefined && actual.alg !== 'ES256') || (actual.key_ops !== undefined && (!Array.isArray(actual.key_ops) || actual.key_ops.length !== 1 || actual.key_ops[0] !== 'verify'))) throw new Error('The supplied public trust anchor does not match this private P-256 key.');
    const payload = Buffer.from('web-switcher-publisher-key-possession-v1');
    const signature = sign('sha256', payload, {key, dsaEncoding: 'ieee-p1363'});
    if (signature.length !== 64 || !verify('sha256', payload, {key: createPublicKey({key: actual, format: 'jwk'}), dsaEncoding: 'ieee-p1363'}, signature)) throw new Error('Key possession verification failed.');
    console.log(JSON.stringify({keyId: kid, publicThumbprint: fingerprint(expected), verified: true}, null, 2));
  } else throw new Error('Commands: generate --directory DIR --kid ID; check --private FILE --trust FILE --kid ID.');
} catch (error) { console.error('Publisher key operation failed: ' + error.message); process.exitCode = 1; }
