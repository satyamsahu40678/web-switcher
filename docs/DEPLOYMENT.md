# Development and deployment

The repository can be developed locally without paid accounts. Deployment to a public host, domain registration and browser-store submission require separate operator configuration; none is completed by a successful local build.

## Local commands

Prerequisites: Node 24 LTS, npm, Java 21, Git and a Chromium browser for browser tests. The backend Maven wrapper pins its distribution/checksum. Frozen installs use each application's checked-in npm lockfile.

From the repository root:

```sh
npm ci
npm --prefix apps/web ci
npm test
node --test packages/security/*.test.mjs
npm run check
./backend/mvnw -f backend/pom.xml verify
./backend/mvnw -f fetcher/pom.xml verify
npm --prefix apps/web run build
npm run package
```

Run the API from its own working directory so its local durable state has one location:

```sh
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=demo
```

In a second terminal, from the repository root:

```sh
npm --prefix apps/web run dev -- --host 127.0.0.1
```

The Vite development server forwards `/v1` and `/health` to the loopback API on port 8080. Demo login accounts are `demo-reviewer` and `demo-publisher`, both with `demo-password`; their roles remain separate. This password is intentionally public and valid only in the explicit demo profile. Demo state and generated signing keys live in `backend/data/` when launched from `backend/`. Do not commit them.

For the extension, load the packaged directory from `dist/` with Developer mode in a separate Chromium profile. The distributed build has fixture mode disabled and begins without granted source hosts. Add only destinations you have independently checked. For automated fixtures, run `npm run test:browser`; the harness creates a disposable test-only extension/profile. Native permission dialogs and commercial browser distribution require separate checks.

## Optional local containers

```sh
docker compose -f infra/compose/local.yml up --build
```

The demo web port is bound to host loopback port 8088. The API has no published port and its synthetic H2 state is retained in a named volume. The internal application network denies ordinary external egress. This Compose stack is a development example, not production infrastructure. Container image tags must be resolved/pinned to reviewed immutable digests for a release.

The fetcher is deliberately excluded from the default stack. See `fetcher/README.md` for its independent internal token/serve contract. Do not attach it to a database network, inject application/cloud credentials, or publish its port. An external egress firewall/proxy is required before enabling real crawling; Docker network names alone do not establish that boundary.

In a managed Codex cloud build, retain the session proxy and CA trust as described by the cloud runtime skill. Do not bypass TLS verification, disable artifact checksums, or assume host proxy settings automatically reach build/runtime containers.

## Production configuration

Do not use the demo Spring profile. The API requires:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | PostgreSQL connection with least-privilege application role |
| `APP_PUBLIC_ORIGIN` | Owned HTTPS API/admin origin |
| `ADMIN_ALLOWED_SUBJECTS`, `PUBLISHER_ALLOWED_SUBJECTS` | Explicit comma-separated OIDC subject IDs, separate roles |
| Standard `SPRING_SECURITY_OAUTH2_CLIENT_*` properties | Provider issuer, client ID/secret and `openid,profile` scope |
| `PUBLISHING_PRIVATE_KEY_FILE`, `PUBLISHING_KEY_ID` | Publisher-only PKCS8 DER key file and public key identifier |

For a provider named `web`, configure `SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_WEB_CLIENT_ID`, `..._CLIENT_SECRET`, `..._SCOPE=openid,profile`, and `SPRING_SECURITY_OAUTH2_CLIENT_PROVIDER_WEB_ISSUER_URI`; consult Spring's OIDC configuration documentation for provider registration. Enable secure HTTPS session cookies in production. Store secret values in the deployment's secret manager, not source or frontend environment variables.

The public API process should omit the signing key. Its publication endpoint then fails closed with signer unavailable. A separate key-holding deployment must expose publication only to authorized operators and use appropriately separated DB privileges. This codebase provides endpoint role checks but does not by itself create OS/process isolation or immutable PostgreSQL grants. Complete and verify those controls before public deployment.

Staging and production need distinct databases, keys, origins, browser builds, OIDC clients and audit/backup targets. Production trust anchors must be distributed out of band; `/v1/keys` is demo-only. Do not configure a production extension to trust arbitrary keys fetched from the same untrusted network source as its catalog.

## Backup and restore

`infra/backup/backup.sh` streams a PostgreSQL custom archive through an empty/archive-header check into `age` encryption. `set -euo pipefail` preserves upstream failures. It writes a checksum only after successful encrypted output. Supply normal libpq variables/`PGPASSFILE`, an existing absolute `BACKUP_DIRECTORY`, and public `AGE_RECIPIENT`; the backup process does not need the age private identity.

Move encrypted output and checksums to a restricted off-host destination through the operator's chosen backup service. The script does not configure off-host transfer, retention or monitoring. Keep signing keys and restore identity separately; a DB dump is not a signing-key backup.

`infra/backup/restore.sh /absolute/path/to/backup.dump.age` requires `PGHOST`, `PGUSER`, `PGDATABASE`, a separately protected `AGE_IDENTITY_FILE`, and `RESTORE_CONFIRM_DATABASE` matching the exact target. It refuses nonempty databases and performs a single-transaction restore with errors fatal. Check the backup checksum before decryption, then run migration/API/catalog checks on the restored instance before promotion. Never restore onto a running production database as a routine drill.

No RPO/RTO or successful production restore is claimed until the complete encrypted off-host pipeline has been exercised on a clean target and evidence recorded.
