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

The web and API images were built and this stack was exercised in the managed environment. The live API/signature/authentication/review/publication/revocation suite passed through Caddy, static React assets/security headers were served, and published catalog bytes remained identical after an API container restart. Current evidence is in `test-results/container-http-demo.json`; these are loopback synthetic-data checks, without production TLS/OIDC or an egress-isolated public crawler. Caddy listens on unprivileged port 8080 with its upstream binary's unnecessary bind file capability removed, allowing the service to retain `cap_drop: ALL`. The internal `api` hostname is appended to `NO_PROXY` while inherited Internet proxy settings remain intact.

The fetcher is deliberately excluded from the default stack. See `fetcher/README.md` for its independent internal token/serve contract. Do not attach it to a database network, inject application/cloud credentials, or publish its port. An external egress firewall/proxy is required before enabling real crawling; Docker network names alone do not establish that boundary.

In a managed Codex cloud build, retain the session proxy and CA trust as described by the cloud runtime skill. Do not bypass TLS verification, disable artifact checksums, or assume host proxy settings automatically reach build/runtime containers.

Both Dockerfiles accept an optional BuildKit secret named `proxy_ca`. The npm install extends Node's trust only for that step. The Java build makes a temporary combined CA bundle, copies the JDK truststore, imports the session CA, and supplies temporary Maven proxy settings; these files are removed in the same build step and are not copied to runtime images. Ordinary builds without that secret use normal system trust. The Maven ZIP checksum stays enabled; the build installs `unzip` so the wrapper does not select a different tarball artifact.

For this managed cloud session, add the tested secret override and put only Buildx's writable state in `/tmp`, while keeping existing Docker registry configuration intact:

```sh
BUILDX_CONFIG=/tmp/web-switcher-buildx docker --host=unix:///var/run/docker.sock compose \
  -f infra/compose/local.yml -f infra/compose/cloud-build.yml build
docker --host=unix:///var/run/docker.sock compose -f infra/compose/local.yml up -d --no-build
```

The override reads the provided `CODEX_PROXY_CERT` file path without putting its contents in build arguments or image layers. Clear inherited Docker endpoint/context/TLS selectors before these commands if they select another daemon, as instructed by the runtime skill. The local demo has no outbound HTTPS requirement after build; a runtime service that does need HTTPS requires its own read-only CA mount and matching trust configuration.

## Production configuration

Do not use the demo Spring profile. The API requires:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | PostgreSQL connection with least-privilege application role |
| `APP_PUBLIC_ORIGIN` | Owned HTTPS API/admin origin |
| `APP_ROLE` | `api` (default, forbids a private publishing key) or `publisher` (requires one) |
| `ADMIN_ALLOWED_SUBJECTS`, `PUBLISHER_ALLOWED_SUBJECTS` | Explicit comma-separated OIDC subject IDs, separate roles |
| Standard `SPRING_SECURITY_OAUTH2_CLIENT_*` properties | Provider issuer, client ID/secret and `openid,profile` scope |
| `PUBLISHING_PRIVATE_KEY_FILE`, `PUBLISHING_KEY_ID` | Publisher-only PKCS8 DER key file and public key identifier |

For a provider named `web`, configure `SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_WEB_CLIENT_ID`, `..._CLIENT_SECRET`, `..._SCOPE=openid,profile`, and `SPRING_SECURITY_OAUTH2_CLIENT_PROVIDER_WEB_ISSUER_URI`; consult Spring's OIDC configuration documentation for provider registration. Enable secure HTTPS session cookies in production. Store secret values in the deployment's secret manager, not source or frontend environment variables.

The public API process must use `APP_ROLE=api` and omit the signing key; startup rejects a key supplied to that role. Its publication endpoint fails closed with signer unavailable. A separate `APP_ROLE=publisher` process requires a key and must expose publication only to authorized operators and use appropriately separated DB privileges. These startup and endpoint role checks do not by themselves create OS/process isolation or immutable PostgreSQL grants. Complete and verify those controls before public deployment.

Staging and production need distinct databases, keys, origins, browser builds, OIDC clients and audit/backup targets. Production trust anchors must be distributed out of band; `/v1/keys` is demo-only. Do not configure a production extension to trust arbitrary keys fetched from the same untrusted network source as its catalog.

## Backup and restore

`infra/backup/backup.sh` streams a PostgreSQL custom archive through an empty/archive-header check into `age` encryption. `set -euo pipefail` preserves upstream failures. It writes a checksum only after successful encrypted output. Supply normal libpq variables/`PGPASSFILE`, an existing absolute `BACKUP_DIRECTORY`, and public `AGE_RECIPIENT`; the backup process does not need the age private identity.

Move encrypted output and checksums to a restricted off-host destination through the operator's chosen backup service. The script does not configure off-host transfer, retention or monitoring. Keep signing keys and restore identity separately; a DB dump is not a signing-key backup.

`infra/backup/restore.sh /absolute/path/to/backup.dump.age` requires `PGHOST`, `PGUSER`, `PGDATABASE`, a separately protected `AGE_IDENTITY_FILE`, and `RESTORE_CONFIRM_DATABASE` matching the exact target. It refuses nonempty databases and performs a single-transaction restore with errors fatal. Check the backup checksum before decryption, then run migration/API/catalog checks on the restored instance before promotion. Never restore onto a running production database as a routine drill.

No RPO/RTO or successful production restore is claimed until the complete encrypted off-host pipeline has been exercised on a clean target and evidence recorded.

## Verified image delivery and approved staging deployment

The implemented delivery path is **tested source → candidate image digests → exact-image acceptance → approved staging**. `.github/workflows/release.yml` defines this path; adding its definition does not mean a release or deployment has run.

1. Merge the tested implementation into `main` through a reviewed pull request. Require the complete `Web Switcher platform` workflow before merging. Configure GitHub branch protection for `main` and a protected version-tag rule for `v*`.
2. Create a GitHub environment named `release` with required reviewers and permitted protected release refs. The image job has package-write permission; the source verification job only reads code and workflow results.
3. A protected `vMAJOR.MINOR.PATCH` tag triggers image delivery. Its version must match that source's root `package.json`. Alternatively dispatch the release workflow **from protected main** with a full source SHA. The source must be reachable from main, and the complete platform workflow must already have succeeded on that exact SHA. A different successful commit, a subset of green jobs, or a queued run is insufficient.
4. The workflow builds API and web images, publishes them to `ghcr.io/satyamsahu40678/web-switcher-api` and `.../web-switcher-web`, and records their immutable `sha256` digests in `release.json`. SHA tags are convenient labels; deployments use digests rather than assuming tags cannot change. Build provenance and SBOM generation are enabled.
5. The `verify-images` job pulls **those published digests**, starts an isolated loopback demo with `--no-build`, and runs the HTTP/signature suite and real browser report/review/publish/revoke journeys. It also checks catalog bytes across an API restart. Candidate images are not staging-approved until this job passes. Evidence and exact deployment inputs are uploaded as Actions artifacts.
6. The staging job runs only for manual dispatch with `deploy_staging=true`, repository variable `STAGING_DEPLOY_ENABLED=true`, and approval by the protected GitHub environment named `staging`. A version tag alone does not deploy a host.

This path deliberately refuses additional SQL migrations beyond the current `V1__registry.sql`. The staging bootstrap stores its checksum and refuses changed V1 bytes, unknown schema versions, or an unversioned nonempty database. Future schema changes need an explicit forward migration, compatibility window, tested backup/restore and rollback plan before the release guard is changed. Application image rollback is not database rollback.

### Host prerequisites

Use a dedicated staging Linux VM with Docker Engine/Compose, Python 3, Bash, OpenSSL, curl, `flock`, reviewed immutable PostgreSQL 17 image digest, and an operator-managed backup target. Allocate enough memory for PostgreSQL, API, Caddy and an optional private publisher; the original 4 GiB pilot recommendation is a starting point, not a measured production capacity guarantee.

Create a dedicated non-root deployment user and `/srv/web-switcher` owned by that user. Docker access is effectively privileged host access; limit the deployment key and GitHub environment reviewers accordingly. Provision GHCR pull access on the host if the packages are private, using the host's secret manager and a read-only package credential. Do not copy the GitHub Actions publishing credential into the application.

Create `/srv/web-switcher/config` with mode `0700`. Copy `infra/deploy/runtime.env.example` there as `runtime.env` and replace **every** example with actual settings. `RUNTIME_UID`/`RUNTIME_GID` must match the non-root owner of the protected files. The public hostname and `APP_PUBLIC_ORIGIN` must match an owned HTTPS origin; configure DNS and allow inbound ports 80/443 for Caddy's certificate issuance/renewal. Configure the real OIDC issuer, separate public/private clients and exact callback URIs. Register the public callback as `https://PUBLIC_HOST/login/oauth2/code/web`; register the private publisher callback against its separate origin. Reviewer and publisher subject allowlists must be disjoint.

Provision these files securely in the protected directory; do not put values in `runtime.env`, Git, Actions artifacts, shell history, or chat:

| Host file | Consumer |
| --- | --- |
| `owner-database-password` | PostgreSQL bootstrap owner only |
| `api-database-password` | Keyless public API database identity |
| `publisher-database-password` | Separate publisher database identity |
| `api-oidc-client-secret` | Public/admin API OIDC client |
| `publisher-oidc-client-secret` | Private publisher OIDC client |
| `publisher-private.pk8` | Publisher-only PKCS8 DER P-256 signing key |

Use independent database passwords of at least 24 random characters, secret files with mode `0400` or `0600`, and ownership matching `RUNTIME_UID`. Write textual secret exports without an extra newline. The Compose runtime uses that explicit non-root UID/GID so file-backed secrets remain readable without making private keys world-readable. The bootstrap reads credentials through files/environment, not process arguments. It refuses an unexpected credential change for existing database identities rather than silently breaking the previous release; password rotation is a separate coordinated operation.

`infra/compose/staging.yml` provides PostgreSQL persistence, an owner-only one-shot V1 schema bootstrap, a keyless public API, TLS Caddy, and an **optional private publisher profile**. The API role cannot update active families, create releases or advance the publication counter. Runtime roles cannot change schema; release rows are insert-only for the publisher, and audit rows are append-only for both identities. Application Flyway is disabled in this staging topology because the controlled bootstrap owns schema creation. The separate functional development setup continues to use Flyway normally.

There is no database host port. Caddy's public route also refuses publication/revocation writes. The publisher holds its own key and OIDC/database credentials, has **no published port**, and is excluded from normal public startup. Before enabling `--profile publisher`, provision and test an authenticated private TLS/admin gateway or VPN path to the private admin network and serve the admin UI against that publisher origin. Public review and private publication do not share in-memory sessions. A private process name alone is not operator access; without that gateway, actual signed publication is intentionally unavailable. The fetcher is excluded until its independent public-only egress boundary is deployed and verified.

### GitHub staging settings

Configure the following in GitHub settings; none contains an application database/signing secret:

| Kind | Name | Purpose |
| --- | --- | --- |
| Repository variable | `STAGING_DEPLOY_ENABLED` | Set `true` only after host prerequisites and environment approval rules are ready |
| Staging environment variable | `STAGING_HOST`, `STAGING_USER` | Dedicated target hostname and deployment account |
| Staging environment variable | `STAGING_SSH_PORT` | Optional port, default 22 |
| Staging environment variable | `STAGING_DEPLOY_ROOT` | Dedicated absolute path, for example `/srv/web-switcher` |
| Staging environment secret | `STAGING_SSH_PRIVATE_KEY` | Dedicated deployment identity |
| Staging environment secret | `STAGING_SSH_KNOWN_HOSTS` | Independently verified target SSH host key(s) |

Verify the SSH host-key fingerprint through the hosting console or another trusted channel before saving `known_hosts`. The workflow uses `StrictHostKeyChecking=yes`; it never trusts an unauthenticated `ssh-keyscan` result or disables verification. Protect both `release` and `staging` environments with required reviewers and allowed refs. Application/OIDC/database/signing secrets remain on the host rather than being shipped by the deployment workflow.

The approved job copies only versioned deployment inputs and the digest manifest into `/srv/web-switcher/releases/FULL_SHA/`, then invokes:

```sh
bash /srv/web-switcher/releases/FULL_SHA/infra/deploy/deploy-staging.sh \
  /srv/web-switcher/releases/FULL_SHA /srv/web-switcher/config
```

The script validates the immutable image namespace/digests, configuration/secret permissions, private signing-key type, and Compose config before mutations. It serializes deployments with a lock, pulls exact images, validates/bootstrap V1, starts the application, checks real HTTPS database readiness, requires the expected release response header and confirms demo mode is off. State advances only after success. After the first success, the script pins a private fingerprint of the host configuration/secret files and refuses changes during an application-only deployment. Rehearse credential/configuration rotations as separate operator changes; image rollback cannot recover a lost or changed secret. If a previously recorded healthy release exists and the new application fails, it restores prior images and versioned Compose/Caddy configuration using the unchanged protected host settings while preserving database contents; it never runs `down --volumes` or rewinds SQL. Inspect rollback health/logs and handle any database incompatibility manually.

The source and infrastructure helpers were tested locally: seven deployment guard/rollback tests, disposable PostgreSQL grant/idempotency/credential-rotation tests, all-profile Compose validation, and Caddy configuration adaptation. These are not successful public deployment, ACME, real-provider OIDC, private publisher gateway or off-host restore claims. After a first staging deployment, complete those checks plus real signed-catalog refresh and native Chrome/Edge acceptance before considering production promotion.

### Browser extension delivery

Container delivery does not configure or publish a production browser extension. The normal CI extension artifact has fixture mode disabled and no remote trust anchor. Use a separately reviewed production `WS_REGISTRY_KEYS_FILE` and fixed owned HTTPS `WS_REGISTRY_URL` for an approved extension package, verify catalog/rollback/revocation behavior against that deployment, and complete Chrome/Edge native permission/lifecycle and store-review gates. No code or unreviewed registry is downloaded as executable extension logic. Manual local mappings remain useful without an account or deployed registry.
