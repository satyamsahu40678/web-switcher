# Encrypted database recovery drill

The repository includes an executed **local recovery drill** using real PostgreSQL 17, `pg_dump`, `pg_restore`, age encryption/decryption, the shipping backup/restore scripts, and a real Java API process. It uses disposable synthetic data and generated test identities. It does not establish production off-host durability or a production RPO/RTO.

## Run the drill

Prerequisites: Docker Engine/Compose-compatible local socket, Python 3.11+, Node 22+ and the repository source. Build the dedicated tools image from the repository root:

```sh
docker --host=unix:///var/run/docker.sock build \
  -f infra/backup/Dockerfile.drill -t web-switcher-backup-drill:local .
```

In a managed cloud environment, keep the session proxy, registry configuration and TLS trust. The Dockerfile accepts the usual optional public CA mount:

```sh
BUILDX_CONFIG=/tmp/web-switcher-backup-buildx \
  docker --host=unix:///var/run/docker.sock build \
  --secret id=proxy_ca,src="$CODEX_PROXY_CERT" \
  -f infra/backup/Dockerfile.drill -t web-switcher-backup-drill:local .
```

The tools image retains PostgreSQL 17 from its base and installs age/Python from signed Debian repositories. It does not fetch additional PostgreSQL packages, disable signatures or disable TLS verification. The optional temporary CA bundle is deleted in the same build layer.

Run the database/encryption drill:

```sh
python3 infra/backup/drill.py
```

For the complete database-to-API recovery check, supply an already built, trusted Web Switcher API image. An image ID from the local demo or CI build is suitable:

```sh
RESTORE_DRILL_API_IMAGE=web-switcher-demo-api:latest \
  python3 infra/backup/drill.py
```

`RESTORE_DRILL_TOOLS_IMAGE` can select a previously built tools image. The script uses uniquely named containers and an internal network, publishes no ports, creates its own source and clean restore databases, and removes its containers, volumes, keys and credentials after execution. It does not inspect, reset or overwrite an existing operator database. Credentials travel through protected files/environment, never literal command arguments or logs.

## What is checked

The full drill has eleven checks:

1. A dedicated dump role can read application tables and cannot alter signed releases.
2. Real `pg_dump --format=custom` output is encrypted by age, lacks known plaintext markers, has private permissions and matches its SHA-256 sidecar.
3. A failed real `pg_dump` leaves neither a successful archive nor checksum artifact.
4. Modified ciphertext with the original checksum is refused before database writes.
5. A different valid age identity cannot decrypt the archive or change the target.
6. Tampered ciphertext still fails age authentication when an attacker recomputes the nonsecret file checksum.
7. A clean restore reproduces every application table, exact signed catalog bytes/digest, audit records and next publication sequence.
8. The restored ES256 catalog independently verifies with the original separately retained public trust anchor and browser-compatible WebCrypto verifier.
9. A repeat restore refuses the now-nonempty target and preserves recovered data.
10. With `RESTORE_DRILL_API_IMAGE`, the real Java API reaches database readiness, serves the exact recovered signed catalog, and that HTTP response verifies with the original trust anchor.
11. Private plaintext restore scratch directories disappear on successful and failed decryption paths.

Without the optional API image, the API readiness check is explicitly recorded as **not run**; the other checks still execute. This is never reported as a full API recovery pass.

Current-run evidence is written to ignored `test-results/backup-restore-drill.json`, including actual tool versions, check outcomes, encrypted size and local elapsed backup, SQL restore and API-readiness times. The tested fixture is deliberately small. These times exclude remote transport, provider outages, operator response and large-database recovery; do not advertise them as production capacity, RPO or RTO measurements.

## Restore safeguards

`restore.sh` requires the adjacent `.sha256` produced by `backup.sh`. Its strict verifier accepts exactly one checksum naming the selected archive's own basename; filenames in a checksum cannot redirect verification to another path. The hash catches accidental damage or wrong files. It is not an authenticity signature: age's authenticated decryption is still required.

A restore confirms the exact target name and refuses an existing user-table schema. It verifies the ciphertext checksum, decrypts/authenticates the entire archive in a mode-0700 temporary directory, checks the custom archive, then runs `pg_restore --single-transaction --exit-on-error`. It never streams unauthenticated trailing plaintext into a database writer. The temporary plaintext is removed on success or failure. Use an encrypted/private temporary filesystem and sufficient free disk space for real sensitive backups; deleting a file is not a secure erase guarantee.

Nine fast hermetic guard checks remain available with:

```sh
bash infra/backup/test.sh
```

Those are failure/control tests; the real drill above is the evidence for actual encryption and PostgreSQL recovery.

## What this cannot recover by itself

A database backup does **not** contain the publisher's private signing key, OIDC client secrets, domain/DNS ownership or the separately provisioned age restore identity. The fixture's original signing private key exists only in the generator process's memory, never in PostgreSQL or the archive. A separately retained public key verifies existing recovered releases; it cannot authorize new releases.

The demo API may generate a separate throwaway demo signing key while reading the recovered database. The drill does not claim publisher-key continuity from that generated key. Production recovery must separately restore the authorized publisher identity and verify its pinned public anchor, OIDC configuration, runtime database grants and private gateway before enabling new publication. The SQL archive omits owner/grant recreation deliberately; reapply the intended least-privilege roles through the reviewed bootstrap process.

Production operators still need to provision an encrypted off-host destination, retention, access control, monitoring, separately protected restore identities/key backups, and a scheduled clean-host restore exercise. A successful same-machine Docker drill does not establish those external controls.
