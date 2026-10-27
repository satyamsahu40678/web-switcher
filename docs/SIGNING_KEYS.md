# Publisher key provisioning

`node scripts/registry-key.mjs` generates the standard P-256 PKCS8 DER private key accepted by the Java publisher and the matching public JWK map accepted by extension packaging. The public thumbprint is an RFC7638 SHA-256 fingerprint. A key authenticates its publisher; it does not establish ownership of a website.

Generate the operational identity on the intended protected host or offline key-management machine. Tests generate temporary identities and remove them; they do not provision a production trust anchor. Keep the operator's existing keys and backups: this command refuses existing output files rather than replacing an identity.

```sh
node scripts/registry-key.mjs generate \
  --directory /absolute/protected/publisher-keys \
  --kid registry-2026-01
```

The directory must be owned by the current user and mode0700. The generated `publisher-private.pk8` is mode0600. `registry-public.jwk.json` and `registry-trust-anchors.json` contain public material only. Stdout lists public key ID/thumbprint and file paths; it never prints private key bytes.

Verify the correspondence before deployment:

```sh
node scripts/registry-key.mjs check \
  --private /absolute/protected/publisher-keys/publisher-private.pk8 \
  --trust /absolute/protected/publisher-keys/registry-trust-anchors.json \
  --kid registry-2026-01
```

The check rejects mismatched keys, unsupported key types, private material in a public trust map, and broadly readable private files. It performs actual raw-JOSE ES256 signing/verification to check possession. It does not publish a key, create registry decisions, or rotate an existing trust anchor.

Provision the private file only for the isolated publisher as described in [deployment](DEPLOYMENT.md). Configure its `PUBLISHING_KEY_ID` to the same public ID. The API and discovery worker must remain keyless. Use separate identities and public trust roots for staging and production.

Pass only the reviewed public map and an owned fixed HTTPS endpoint into extension packaging:

```sh
WS_REGISTRY_KEYS_FILE=/absolute/protected/publisher-keys/registry-trust-anchors.json \
WS_REGISTRY_URL=https://your-owned-registry.example/v1/catalog/current \
npm run package
```

Replace the example endpoint with the actual deployed origin. Public trust roots must be distributed through an independently trusted channel; downloading an arbitrary key from the same untrusted server as a catalog does not bootstrap trust. Record the public thumbprint out of band and keep an independently protected encrypted backup of the private key.

A key change is a separate trust-transition operation. Do not overwrite or silently reuse an old key ID for different key material, reset catalog sequences, or clear client rollback memory. Client support for production trust-root rotation/recovery and the related incident drill remain explicit release gates.
