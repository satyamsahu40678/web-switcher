# Implementation status and evidence

Updated 27 October 2026 (Asia/Kolkata). This file supersedes historical prototype statements only where fresh evidence is recorded below. The original [complete plan](WEB_SWITCHER_PLAN.md), [prototype status](PROTOTYPE_STATUS.md), and prototype ADR remain preserved historical documents.

## Recovery and current scope

The uploaded prototype handoff was checksum-verified and its source restored onto the README-only repository baseline `075bc000eaf203f912c4e610b3f7fbc7746681e9`. The larger implementation described in the recovery checkpoint was unavailable and has been reconstructed rather than represented as recovered source.

The delivered development scope is a useful local extension plus a runnable reviewed registry: packaged gate and settings, strict signed-record verification, Java API/review/publish workflow, React public/admin interface, isolated bounded fetcher and opt-in candidate-only discovery worker. The full multi-stage research plan is not complete merely because these modules exist. [All 134 original task IDs](PLAN_TRACEABILITY.md) are reconciled against current scope; [novelty and evidence](NOVELTY_AND_EVIDENCE.md) explains the proposed contribution, prior art and research claims still requiring evaluation.

## Traceability

| Plan area | Source/evidence location | Interpretation |
| --- | --- | --- |
| P0/P1 local routing and gate | `extension/`, `tests/core.test.mjs`, `tests/browser.mjs` | Current outcomes recorded below; native Chrome/Edge acceptance remains separate |
| UI and manual settings | `extension/options.*`, `extension/popup.*`, `apps/web/` | Product surfaces; accessibility across real devices remains a release gate |
| BE review/publish/auth/persistence | `backend/` migrations, source and tests | Pending decisions separate from published releases; production process/DB role isolation not implied |
| SIG schemas/ES256/freshness/rollback | `packages/security/`, Java signer and compatibility checks | Trust anchor installation and production key lifecycle need operator configuration |
| DISC safe network probes and durable queue | `fetcher/`, `DiscoveryQueue`, `DiscoveryClient`, `DiscoveryWorker`, discovery tests | Optional redirect observations enter pending moderation only; application checks do not prove deployed egress enforcement or universal discovery |
| NOV experimental owner records | `packages/security/owner-cli.mjs` | Signing/verification tools are not completed enrollment, domain-control proof or recovery lifecycle |
| OPS CI/deployment/backup support | `.github/workflows/platform.yml`, `infra/`, deployment/release docs | All six platform CI jobs passed for the linked source revision. Release image publication and approved host deployment remain separate unexecuted operations |
| Research and P4/P5 | Original plan and `research/` | Synthetic prior experiments only; new effectiveness studies, browser ports and stores remain open |

## Fresh validation ledger

The following results belong to the reconstructed source and current validation run. Historical checkpoint counts are not reused. [The local evidence snapshot](validation/local-continuity-2026-10-27.json) records the added recovery, restricted-worker and catalog checks; hosted outcomes below identify exact source revisions.

| Check | Current outcome |
| --- | --- |
| Prototype source archive checksums | Verified before restoration |
| Routing/configuration and mocked background/adapter tests | 56 passed (26 core, 19 worker, 11 catalog-adapter); simulated browser APIs are not native browser acceptance |
| Strict catalog/passport security and publisher-key tests | 25 passed, including offline owner CLI and protected publisher key generation/checking; combined JavaScript total 84 including three release-evidence checks with zero skips/failures |
| Java API/database/auth/review/discovery tests | 42 passed with zero failures/errors/skips, both in backend verify and the fresh PostgreSQL 17 suite. The H2 lifecycle regression always exercises H2 even in the PostgreSQL suite; protocol fixtures remain controlled loopback services |
| Release source evidence | Three tests pass: completed direct-source push/dispatch checks qualify; PR merge results, different SHAs and incomplete/unsuccessful runs do not. Push and PR concurrency groups are separate so each context can complete |
| Production-mode OIDC protocol | 11 tests use an HTTPS production-profile API and controlled discovery/auth/token/JWKS/userinfo provider. Role separation, secure session rotation, CSRF/logout and invalid identity/token/state cases pass. An external production identity provider is not configured by this test |
| H2 physical connection lifecycle | Real unchanged V1 Flyway migration followed by fresh physical connections: regression fails on 2.4.240 and passes pinned 2.5.252; valid states stay writable and invalid states remain rejected. Upstream [issue 4302](https://github.com/h2database/h2database/issues/4302) is fixed in 2.5.250+. Flyway's newer-than-vendor-verified warning remains visible |
| Bounded discovery and worker boundaries | 19 queue/client/integration/boundary tests pass: durable dedupe/cache/budgets, leases/retries/TTL, bounded authenticated fixed-endpoint replies and API→separate non-web worker→pending candidate. Worker has no listener, Flyway bean, OIDC client or signing key; signed catalog stays byte-identical |
| Java fetcher/SSRF/bounds tests | 65 passed with zero skips/failures; authenticated loopback fixtures and injected safe transports, not deployed public egress |
| Java-to-browser signature compatibility | Live Java ES256 catalogs verified with the browser-compatible WebCrypto module; modified signatures rejected; full HTTP demo passed 11 checks including publication/revocation |
| React TypeScript and production build | Passed; actual Chromium mocked API-contract suite and read-only live API/login UI suite passed; desktop screenshots inspected and mobile overflow check passed |
| Current Chromium extension navigation suite | All 19 hosted Chromium checks passed, including source matching, expiry, POST/iframe exclusion, sensitive-link confirmation, loops, restart persistence, origin-only receipts and removal. The fixture uses pregranted required source permissions; native optional permission dialogs remain a separate gate |
| Manifest/syntax/package inspection | Passed; dist/web-switcher-0.2.0.zip built with fixture mode disabled, no embedded private keys or default remote trust |
| Real web browser end-to-end | Eight checks passed without response mocks against the actual Compose stack: report, review, independent publication, Java/WebCrypto verification, lookup, revocation and abstention |
| Staging deployment safety | Seven controlled deployment/rollback/configuration checks and eight PostgreSQL role/bootstrap checks passed; public host/OIDC/TLS deployment remains unexecuted |
| Backup/restore failure guards | Nine hermetic producer/encryption/target/checksum guard checks passed |
| Real encrypted recovery | Eleven checks passed using PostgreSQL 17, actual pg_dump/pg_restore and age, including wrong-key/tamper refusals, all table contents, exact signed bytes/audit/sequence, original-anchor WebCrypto verification and recovered final-image API readiness/serving. [Drill scope](BACKUP_RESTORE_DRILL.md) excludes off-host durability, production RPO/RTO and private publisher-key recovery |
| Catalog/cache concurrency sample | 128/128 loopback requests with eight clients passed: 64 exact 200 bodies and 64 ETag 304 responses, unchanged signed bytes/ETag and independent signature verification. This bounded synthetic sample is not a production load/SLO claim |
| Local Compose syntax | `docker compose -f infra/compose/local.yml config --quiet` passed |
| Container build/runtime | Web/API images built with verified TLS/artifacts and optional session CA secret; loopback Caddy static/security-header checks and 11 live API checks passed, plus immutable catalog persistence after API restart (`test-results/container-http-demo.json`) |
| PostgreSQL staging privileges and restore | Eight real PostgreSQL bootstrap/grant checks passed locally and in CI: API cannot publish or advance the release sequence, releases/audit are immutable to runtime roles, schema changes are denied, repeated bootstrap preserves state, credential rotation/drift is refused. Hosted-role validation and encrypted off-host restore remain unexecuted |
| Opt-in discovery database identity | Seventeen actual PostgreSQL grant/RLS/bootstrap/backup checks plus two final-image worker checks passed. Restricted worker boots without migrations/OIDC/signing credentials, performs a controlled internal probe and creates only pending candidate/audit; active families, release bytes and counter stay unchanged. Per-address budget hashes remain inaccessible to the worker; a separate SELECT-only BYPASSRLS backup identity preserves all rows in a real dump/restore. [Scope and provisioning](DISCOVERY_DATABASE.md) |
| Actual Chrome/Edge native permissions and stores | Not executed |
| Reusable cloud setup script | scripts/setup-cloud.sh executed successfully end to end after correcting the npm cache to a writable directory; install_script and start_skill saved in the environment draft |
| GitHub publication and CI | Feature branch published. All six jobs passed for source `69d60442ca515ed0e30f52f74934688a0f0d2904`: JavaScript, Java, native Chromium browser, PostgreSQL, live API and full container stack, including the added recovery and restricted-worker image acceptance. [Verified run](https://github.com/satyamsahu40678/web-switcher/actions/runs/40534796041); [recorded evidence](validation/ci-69d6044.json). Earlier native/full-stack evidence is preserved in [ci-27e419b.json](validation/ci-27e419b.json) |

## Outstanding gates

The production account/domain/OIDC configuration, deployed key-isolated publisher/private gateway, host-level database privilege verification, private network/firewall verification, encrypted off-host restore, actual Chrome/Edge native optional-permission/lifecycle tests, store identities/submissions and consenting-owner pilot remain necessary before a production launch. Public discovery providers, owner enrollment/key recovery, temporal graph evaluation and the research dataset/measurements are not completed by the local demo.

The repository's chosen license remains an owner decision. Bundled maintained dependencies have their own licenses; do not claim an unselected project license or copy unreviewed competitor code.

## Delivery sequence

The release workflow is implemented, with protected-main/tag and exact-SHA green-CI gates, digest-pinned image manifests, SBOM/provenance generation, verification of the published candidate images, and an approval-protected staging deployment with strict SSH host-key verification, HTTPS/no-demo/readiness checks and prior-image rollback. It has not published release images or deployed a public host. Follow [the deployment guide](DEPLOYMENT.md) after supplying the required host, owned domain, OIDC identities, private publisher gateway and securely provisioned keys/secrets. Broader automatic discovery, owner enrollment/recovery and research evaluation are still roadmap items.
