#!/usr/bin/env node
/** Offline owner tooling; private material is written only to a new mode-0600 file. */
import { generateKeyPairSync, createPublicKey, createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { encodeBase64Url, parseStrictJson, sha256, validatePassport, verifyPassport } from './catalog.mjs';

const bytes = value => new TextEncoder().encode(value);

export function signPassport(payload, privateJwk, kid) {
  validatePassport(payload);
  if (payload.keyId !== kid) throw new Error('Passport keyId must match signing key ID');
  if (privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || typeof privateJwk.d !== 'string') throw new Error('Expected a private P-256 JWK');
  const protectedHeader = encodeBase64Url(bytes(JSON.stringify({ alg: 'ES256', typ: 'web-switcher-passport+jws', kid })));
  const body = encodeBase64Url(bytes(JSON.stringify(payload)));
  const signingInput = `${protectedHeader}.${body}`;
  const signature = sign('sha256', Buffer.from(signingInput), { key: createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${encodeBase64Url(signature)}`;
}

export async function ownerSiteId(publicJwk) {
  const thumbprintInput = JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y });
  const hex = await sha256(thumbprintInput);
  return `urn:webswitcher:site:${encodeBase64Url(Uint8Array.from(hex.match(/../g), byte => parseInt(byte, 16)))}`;
}

async function jsonFile(path) { return parseStrictJson(await readFile(path, 'utf8'), { maxBytes: 64 * 1024 }); }
async function main(args) {
  const [command, first, second, third, fourth] = args;
  if (command === 'keygen' && args.length === 3) {
    const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const privateJwk = keys.privateKey.export({ format: 'jwk' });
    const publicJwk = keys.publicKey.export({ format: 'jwk' });
    // The exclusive flag prevents accidentally destroying a prior identity.
    await writeFile(first, `${JSON.stringify(privateJwk, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await writeFile(second, `${JSON.stringify(publicJwk, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
    console.log(`Created owner key files. Genesis site ID: ${await ownerSiteId(publicJwk)}`);
  } else if (command === 'sign' && args.length === 5) {
    const payload = await jsonFile(first); const privateJwk = await jsonFile(second);
    const jws = signPassport(payload, privateJwk, third);
    // Verify the output against its public key before preserving a signed record.
    const publicJwk = createPublicKey(createPrivateKey({ key: privateJwk, format: 'jwk' })).export({ format: 'jwk' });
    const previous = payload.sequence === 1 ? undefined : { siteId: payload.siteId, sequence: payload.sequence - 1, digest: payload.previousRecordHash, acceptedAt: Date.now() };
    await verifyPassport(jws, { keys: { [third]: publicJwk }, previous });
    await writeFile(fourth, `${jws}\n`, { flag: 'wx', mode: 0o644 });
    console.log('Signed record written. A signature alone does not establish website ownership.');
  } else if (command === 'verify' && (args.length === 4 || args.length === 5)) {
    const record = (await readFile(first, 'utf8')).trim(); const publicJwk = await jsonFile(second);
    const previous = fourth ? await jsonFile(fourth) : undefined;
    const result = await verifyPassport(record, { keys: { [third]: publicJwk }, previous });
    console.log(JSON.stringify(result, null, 2));
  } else throw new Error('Usage: owner-cli.mjs keygen PRIVATE.json PUBLIC.json | sign PAYLOAD.json PRIVATE.json KEY_ID RECORD.jws | verify RECORD.jws PUBLIC.json KEY_ID [PREVIOUS_CHECKPOINT.json]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
