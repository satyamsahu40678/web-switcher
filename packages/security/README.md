# Signed data verification

`catalog.mjs` runs in modern browsers and Node 22+ without runtime dependencies.
The extension must ship the module as packaged code and pin trusted public JWKs.
It never downloads a key from an untrusted `jku`, `x5u`, or record body.

```js
const accepted = await verifyCatalog(compactJws, {
  keys: { 'registry-key-1': pinnedPublicJwk },
  now: Date.now(),
  previous: storedCheckpoint, // { sequence, digest, acceptedAt }, optional on first use
});
```

The return value has `catalog`, `sequence`, `digest`, and `acceptedAt`. Digests are
lowercase SHA-256 hex of the exact compact JWS, and `acceptedAt` is Unix time in
milliseconds. Preserve the checkpoint separately from the disposable catalog
cache. A same-sequence re-signing is treated as equivocation; publisher releases
must retain immutable signed bytes. Clock rollback beyond five minutes fails
closed. Verification does not make an incorrect device clock trustworthy.

Catalogs use protected header `{alg:"ES256",typ:"web-switcher-catalog+jws",kid}`.
They have closed schemas, a 512 KiB decoded payload limit, maximum depth 48,
duplicate-key rejection, canonical base64url, and a 64-byte JOSE ECDSA signature.
Only schema/policy version 1 is accepted. Validity is at most 24 hours with five
minutes of issue-clock skew. Each decision expires no later than its catalog.
Clients check the current time again at every use; successful download is not a
permanent authorization. Offline devices cannot learn revocation immediately.

There are at most 200 families, aliases, decisions, and revocations each. Origins
are exact canonical HTTPS origins without credentials, ports, paths, query, or
fragment, and use ASCII IDNA hostnames. IP literals and single-label names are
excluded. A source origin has one family, each family has at most one active
decision, and destinations must be terminal (not any source alias). The publisher
must compress reviewed migration chains while preserving their provenance.

Decisions contain `familyId`, `destinationOrigin`, `trustClass` (`registry_reviewed`
or `owner_verified`), `validUntil`, `pathPolicy`, `reasonCodes`, and
`requiresConfirmation`. Supported policies are `{type:"homepage"}`,
`{type:"preserve",publicPrefixes:["/docs/"]}`, and
`{type:"prefix_replace",fromPrefix:"/old/",toPrefix:"/new/"}`. Literal directory
prefixes are bounded and reject ambiguous encoded separators/dot segments.
Query strings and fragments are always dropped by the consuming routing policy.
Revocations are `{familyId,revokedAt,reason}`; a revoked family has no active
decision in that release. Signing authenticates the issuer, not the correctness
of an identity claim or the safety of future website content.

## Experimental offline owner tooling

```sh
node packages/security/owner-cli.mjs keygen /secure/owner.private.json owner.public.json
node packages/security/owner-cli.mjs sign passport.json /secure/owner.private.json owner-key-1 passport.jws
node packages/security/owner-cli.mjs verify passport.jws owner.public.json owner-key-1 > checkpoint.json
```

Keep private files outside the repository. Key generation creates new files
exclusively, writes private keys with mode 0600, and never prints private material.
Keys are unencrypted JWKs: the operator must use encrypted storage or a secret
manager. Genesis IDs are RFC 7638-style P-256 public-JWK thumbprints prefixed with
`urn:webswitcher:site:`. The CLI signs payloads only; no website data is fetched.

Passports have separate `web-switcher-passport+jws` record type and a seven-day
maximum validity. The closed fields are those in the research plan, with null
`previousRecordHash` at sequence 1 and the prior compact-JWS SHA-256 hex thereafter.
For a later record, `verify` requires the previous verification checkpoint as its
last argument. A pinned history must advance exactly one sequence and preserve
the genesis identity. Signing a later record checks internal consistency, but it
cannot prove the claimed previous hash without an independently preserved history.

The verifier's `keys` must come from a previously enrolled family-to-owner binding.
An arbitrary self-signed key proves neither historical ownership nor domain
control. Automatic owner enrollment, DNS/HTTPS challenge execution, rotation,
recovery, transfer, key revocation distribution, and independent witnesses are
not implemented here. A lost key freezes this experimental identity until a
separately reviewed recovery process establishes a new binding. Never upgrade a
manual mapping to an owner-verified decision based only on this CLI output.

Run validation with `node --test packages/security/*.test.mjs`.
