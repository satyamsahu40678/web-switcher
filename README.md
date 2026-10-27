# Web Switcher

**Follow the website, even when its address changes.**

Web Switcher is a browser extension and reviewed website-migration registry. It follows exact, explicitly supported old origins to approved destinations, explains the decision, and stops when a mapping is expired, paused, ambiguous, or untrusted. It does not guess a new domain from a website's name or claim to recover every broken link.

This repository contains the reconstructed **0.2.0 development platform**. It is not a production or browser-store release. See [current implementation and evidence](docs/IMPLEMENTATION_STATUS.md) for tested capabilities and remaining gates, and the preserved [research plan](docs/WEB_SWITCHER_PLAN.md) for the wider roadmap.

## What is implemented

- **Local MV3 extension:** selected-source permissions, expiring manual mappings, packaged validation gate, pause, strict import/export, local receipts, and a short-lived tab-scoped undo. No account or backend is needed for local mode.
- **Signed registry support:** ES256 verification, closed schemas, duplicate-key rejection, expiry, rollback/equivocation protection, reviewed-path policies, and family revocations. A production trust anchor is deliberately not supplied.
- **Java 21 / Spring Boot API:** persistent Flyway/JDBC data, bounded hostname-only lookups/reports, independent review/publishing roles, CSRF-protected sessions, immutable signed releases, and audit records. H2 is available for local demonstration; PostgreSQL 17 is tested.
- **React public/admin app:** explicit hostname lookup, reports, review queue, publication, audit and privacy/help information.
- **Isolated Java fetcher:** bounded authenticated probes, DNS/address validation, pinned connection addresses, TLS hostname verification and robots handling. It abstains when the managed proxy cannot establish safe connect-IP pinning.
- **Optional bounded discovery:** durable hostname jobs, leases, retry limits and probe budgets; a separate keyless worker submits observed redirects as unverified moderation candidates. Public responses never disclose an unapproved destination.
- **Experimental owner tools:** offline key generation and passport signing/verification. Owner enrollment, automated domain-control proofs and recovery remain future work.

The [novelty and evidence report](docs/NOVELTY_AND_EVIDENCE.md) explains the proposed continuity-system contribution, its established building blocks, the implemented safeguards and the research claims still requiring evaluation. The [plan traceability map](docs/PLAN_TRACEABILITY.md) reconciles the larger roadmap with the delivered scope.

A registry signature authenticates a reviewed catalog. It is not proof that every listed website is safe. Reports and search candidates never directly enable browser routing. Demonstrations use reserved synthetic domains, not the example websites mentioned in the research plan.

## Run locally

Use Node 24 LTS, npm, a JDK 21 and Python 3 for packaging. The Maven wrapper pins its distribution and checksum.

```sh
npm ci
npm --prefix apps/web ci
./backend/mvnw -f backend/pom.xml verify
./backend/mvnw -f fetcher/pom.xml verify
npm test
npm run check
npm run build:web
npm run package
```

In the managed cloud environment, `bash scripts/setup-cloud.sh` installs and validates the same workflow with proxy/TLS trust preserved. Existing checkouts are already isolated; a Git worktree is unnecessary.

Start the backend in a dedicated working directory so its generated demo key and database remain outside source:

```sh
mkdir -p /tmp/web-switcher-demo
cp /absolute/path/to/web-switcher/backend/target/web-switcher-api-0.2.0.jar /tmp/web-switcher-demo/api.jar
cd /tmp/web-switcher-demo
java -jar api.jar --spring.profiles.active=demo
```

In another terminal, from this repository:

```sh
npm run dev:web
```

The web app runs on port 5173 and proxies API requests to port 8080. The explicit demo profile provides `demo-reviewer` and `demo-publisher`, both with the intentionally public password `demo-password`. These accounts do not exist in production. Demo data persists in the backend process's `data/` working directory.

Alternatively use `docker compose -f infra/compose/local.yml up --build` for the loopback-only demo stack on port 8088. See [deployment instructions](docs/DEPLOYMENT.md), including managed proxy/CA builds.

## Try the extension

**Start here:** [Install in your browser or publish to the Chrome Web Store](docs/CHROME_INSTALL_AND_STORE.md). Includes the no-build download path, a working manual test, supplied Store assets, privacy-page hosting, listing copy, permission justifications, reviewer instructions and updates. Manual mode needs no backend.

`npm run package` creates `dist/web-switcher/` and `dist/web-switcher-0.2.0.zip`. In a browser profile that permits development extensions, enable Developer mode in Chrome/Edge's extensions page and load the unpacked directory. The ZIP must be extracted before loading.

Add an old origin and an independently checked current HTTPS origin. Access is requested for that source only. Homepage routing is the default; preserve a path only where you know the structures are compatible. Queries and fragments are removed; sensitive links require a fresh confirmation. Cookies, sessions and credentials never migrate between domains.

A default build trusts no remote registry. To package a reviewed registry, provide a file containing a `kid -> public ES256 JWK` map through `WS_REGISTRY_KEYS_FILE`, plus an owned fixed HTTPS endpoint through `WS_REGISTRY_URL`, when running `npm run package`. The packaging step validates public keys, rejects private key material and adds only the endpoint's exact host permission. Never ship demo trust anchors as production identities.

## Validation

```sh
npm test                              # policy, schema, crypto and mocked worker tests
npm run check                         # manifest, fixture exclusion, syntax and CSP
npm --prefix apps/web run test:browser # Chromium UI contract test; API mocked
npm --prefix apps/web run test:e2e-browser # actual loopback demo UI/API/database; no mocks
npm run test:http                      # live demo API + Java/WebCrypto interoperability
npm run test:browser                   # real unpacked-extension navigation harness
bash infra/backup/test.sh              # backup failure/restore guard tests
python3 infra/deploy/test-deploy.py     # protected deployment/rollback guards
python3 infra/deploy/test-db-grants.py  # disposable PostgreSQL role/bootstrap checks (Docker)
python3 infra/deploy/test-worker-grants.py # opt-in worker database isolation (Docker)
npm run test:catalog-concurrency        # bounded catalog/cache sample; loopback demo required
```

The real browser E2E test requires the demo app running on loopback; set `LIVE_WEB_BASE` to its origin (for example, the container demo on port 8088). It creates and revokes its own unique synthetic family and refuses non-demo servers.

The HTTP demo test mutates **synthetic demo data**, including a revocation; use a fresh isolated demo working directory for each full run. Set `CHROMIUM_PATH` for an installed browser where required. The real extension navigation harness requires a browser/environment that allows unpacked extensions. A managed-browser policy block is a failed readiness gate, not a passing test.

## Further documentation

- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [API contract](docs/API.md)
- [Security, privacy and reporting](docs/SECURITY.md)
- [Deployment, configuration and backups](docs/DEPLOYMENT.md)
- [Release checklist](docs/RELEASE.md)
- [Recovery checkpoint](docs/RECOVERY_CHECKPOINT.md)
- [Fetcher contract and limits](fetcher/README.md)
- [Owner signing tools](packages/security/README.md)
- [Publisher key provisioning](docs/SIGNING_KEYS.md)
- [Bounded discovery and abstention](docs/DISCOVERY.md)
- [Opt-in discovery database isolation](docs/DISCOVERY_DATABASE.md)
- [Executed encrypted recovery drill](docs/BACKUP_RESTORE_DRILL.md)
- [Novelty, prior art and evidence](docs/NOVELTY_AND_EVIDENCE.md)
- [Original plan traceability](docs/PLAN_TRACEABILITY.md)

Public deployment, production identities/keys, deployed egress and database privilege verification, native Chrome/Edge acceptance, browser stores, owner pilots and research effectiveness measurements remain explicit release gates. GitHub workflow definitions do not establish that CI has run.

The platform pipeline has passed all six hosted CI jobs, including the 19-check native Chromium extension suite and the real container/browser journey. [Recorded validation](docs/IMPLEMENTATION_STATUS.md) identifies the exact tested revision. The separate [release pipeline](.github/workflows/release.yml) requires a protected main/tag and successful CI for the exact source SHA, verifies published digest-pinned candidate images, and permits staging deployment only through a configured approval-protected environment. See [deployment setup](docs/DEPLOYMENT.md) before enabling it.
