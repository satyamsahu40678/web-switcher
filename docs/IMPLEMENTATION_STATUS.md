# Implementation status and evidence

Updated 29 October 2026 (Asia/Kolkata). This file supersedes historical prototype statements only where fresh evidence is recorded below. The original [complete plan](WEB_SWITCHER_PLAN.md), [prototype status](PROTOTYPE_STATUS.md), and prototype ADR remain preserved historical documents.

## Internet-discovery implementation — 29 October 2026

A first-time user can investigate an old address without local migration history or a supplied replacement. Archive availability/CDX/root snapshots produce explained unverified suggestions; current candidate checks/opening and optional 24-hour user-configured choices enforce permissions, exact displayed destination, cancellation/generation state and every-origin signed reservations. A separate authenticated service implements the actual Brave/archive adapters, versioned candidate API, durable SQLite leases/quotas/cache/retention and coherent backups. It cannot publish a registry route.

Current local validation: **273 Node/JavaScript tests passed** with zero failures/skips, including **57 service tests** using actual HTTP/SQLite/orchestration and **eight provider-transport tests**. **Eight actual final-container checks passed** with egress disabled, covering non-root/read-only execution, authenticated API, honest unconfigured readiness, no invented result, restart persistence/cache and cancellation. Eight new mocked-Chromium UI checks and six existing continuity UI checks passed. Manifest/syntax/package checks passed.

Hosted browser acceptance for source `ca2560883a705e0fe3bad9b1e8cf359017abc364` passed in both push and PR contexts: **60 native Chromium groups** (19 legacy, six transport, 18 continuity and 17 first-use Internet groups), plus the 14 extension UI contract checks. The initial final-image test exposed completed-result cancellation/cache semantics; that behavior is now corrected with a real HTTP/database regression and the local image test passes. Full exact-source CI evidence for the corrected revision is recorded when available below.

Provider fixtures establish mechanics, not public-provider success or historical identity accuracy. The enforced cloud policy still lacks the archive/search hosts and no Brave key is configured; the saved environment draft is not applied access. The public example is unverified and no public service/Store listing has been deployed.

## Automatic continuity update

The primary extension flow now accepts only an old HTTPS address. It follows explicitly observed HTTP redirects, Refresh headers, inert meta refresh and `rel=web-switcher-successor` declarations, including an advertised same-origin well-known JSON pointer. It retains an origin-only successor graph for seven days, checks the terminal again before opening, and can skip disappeared intermediate domains using valid remembered links. Source-only following routes future visits through a fresh check; manual mappings remain optional advanced settings. See [automatic continuity](AUTOMATIC_CONTINUITY.md) for the algorithm, demonstration, failure cases and limits.

Declarations establish observed continuity, not ownership or safety. Unknown successors are not guessed. Conflicts, loops, expired history, access denials and TLS errors stop routing. Signed aliases retain a public trust barrier after expiry/revocation/removal, including when reached as an intermediate chain hop, so they cannot silently downgrade to source-declared continuity. Correlated response headers are awaited independently of the fetch promise to handle actual Chromium event ordering. Private URL parts never cross to the discovered domain.

Previous continuity baseline: **152 JavaScript tests passed** (zero failures/skips), including 21 graph tests, 15 transport tests, 30 controller tests and 21 background tests. Six mocked-browser UI contract checks also passed. **83 fetcher Java tests passed** (65 existing plus 18 continuation cases). Manifest/syntax/package checks passed. Native automatic-flow acceptance passed for source `76585a0a4d08d5eb0bcbf403ed9e7335771aac6e` in both push and PR platform runs: all 18 automatic-continuity groups, six native transport checks, six mocked-browser UI contract checks and 19 legacy extension groups. The tests use controlled loopback fixtures and pregranted fixture permissions, not public-site ownership verification or native permission-dialog acceptance.

## Recovery and current scope

The bounded Internet-discovery increment is implemented: keyless archive investigation in the extension and an optional separately authenticated Node/SQLite search service. See [delivered scope](INTERNET_DISCOVERY_STATUS.md), [operation/deployment](INTERNET_DISCOVERY_OPERATION.md), and [service documentation](../online-discovery/README.md). The wider design, 80-idea register, 36-task backlog and evaluation documents remain a research/delivery roadmap; general temporal identity inference, public pilots and stronger owner lifecycle are not claimed complete.

The uploaded prototype handoff was checksum-verified and its source restored onto the README-only repository baseline `075bc000eaf203f912c4e610b3f7fbc7746681e9`. The larger implementation described in the recovery checkpoint was unavailable and has been reconstructed rather than represented as recovered source.

The delivered development scope is an automatic successor-discovery extension plus a runnable reviewed registry: packaged gate and settings, strict signed-record verification, Java API/review/publish workflow, React public/admin interface, isolated bounded fetcher and opt-in candidate-only discovery worker. The full multi-stage research plan is not complete merely because these modules exist. [All 134 original task IDs](PLAN_TRACEABILITY.md) are reconciled against current scope; [novelty and evidence](NOVELTY_AND_EVIDENCE.md) explains the proposed contribution, prior art and research claims still requiring evaluation.

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
| Routing/configuration and mocked background/adapter tests | 58 passed (26 core, 21 worker, 11 catalog-adapter); simulated browser APIs are not native browser acceptance |
| Strict catalog/passport security and publisher-key tests | 25 passed, including offline owner CLI and protected publisher key generation/checking; combined JavaScript total 152 including 66 continuity graph/probe/controller tests and three release-evidence checks with zero skips/failures |
| Java API/database/auth/review/discovery tests | 42 passed with zero failures/errors/skips, both in backend verify and the fresh PostgreSQL 17 suite. The H2 lifecycle regression always exercises H2 even in the PostgreSQL suite; protocol fixtures remain controlled loopback services |
| Release source evidence | Three tests pass: completed direct-source push/dispatch checks qualify; PR merge results, different SHAs and incomplete/unsuccessful runs do not. Push and PR concurrency groups are separate so each context can complete |
| Production-mode OIDC protocol | 11 tests use an HTTPS production-profile API and controlled discovery/auth/token/JWKS/userinfo provider. Role separation, secure session rotation, CSRF/logout and invalid identity/token/state cases pass. An external production identity provider is not configured by this test |
| H2 physical connection lifecycle | Real unchanged V1 Flyway migration followed by fresh physical connections: regression fails on 2.4.240 and passes pinned 2.5.252; valid states stay writable and invalid states remain rejected. Upstream [issue 4302](https://github.com/h2database/h2database/issues/4302) is fixed in 2.5.250+. Flyway's newer-than-vendor-verified warning remains visible |
| Bounded discovery and worker boundaries | 19 queue/client/integration/boundary tests pass: durable dedupe/cache/budgets, leases/retries/TTL, bounded authenticated fixed-endpoint replies and API→separate non-web worker→pending candidate. Worker has no listener, Flyway bean, OIDC client or signing key; signed catalog stays byte-identical |
| Java fetcher/SSRF/bounds tests | 83 passed with zero skips/failures, including 18 continuation/resolver cases; authenticated loopback fixtures and injected safe transports, not deployed public egress |
| Java-to-browser signature compatibility | Live Java ES256 catalogs verified with the browser-compatible WebCrypto module; modified signatures rejected; full HTTP demo passed 11 checks including publication/revocation |
| React TypeScript and production build | Passed; actual Chromium mocked API-contract suite and read-only live API/login UI suite passed; desktop screenshots inspected and mobile overflow check passed |
| Current Chromium extension navigation suite | All 43 native hosted Chromium groups passed (19 legacy, six transport and 18 automatic-continuity), including source-only discovery/open/follow, recovery after several earlier origins disappear, later C→D migration, source matching, expiry, POST/iframe exclusion, sensitive-link confirmation, conflicts/loops, restart persistence, origin-only receipts and removal. The fixture uses pregranted required source permissions; native optional permission dialogs remain a separate gate |
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
| Actual Chrome/Edge optional-permission dialogs and Store submission | Not executed |
| Reusable cloud setup script | scripts/setup-cloud.sh executed successfully end to end after correcting the npm cache to a writable directory; install_script and start_skill saved in the environment draft |
| GitHub publication and CI | All 13 jobs passed for automatic-flow source `76585a0a4d08d5eb0bcbf403ed9e7335771aac6e`: six direct-push platform jobs, six PR platform jobs and one legacy routing job. This includes JavaScript, Java, native Chromium, PostgreSQL, live API, full container journeys, encrypted recovery and restricted-worker acceptance. [Direct-source run](https://github.com/satyamsahu40678/web-switcher/actions/runs/40707449294), [PR run](https://github.com/satyamsahu40678/web-switcher/actions/runs/40707461724), [legacy run](https://github.com/satyamsahu40678/web-switcher/actions/runs/40707461717), [recorded exact-source evidence](validation/ci-76585a0.json). Earlier evidence remains in [ci-69d6044.json](validation/ci-69d6044.json) and [ci-27e419b.json](validation/ci-27e419b.json) |

## Outstanding gates

The production account/domain/OIDC configuration, deployed key-isolated publisher/private gateway, host-level database privilege verification, private network/firewall verification, encrypted off-host restore, actual Chrome/Edge optional-permission dialogs and Edge acceptance, store identities/submissions and consenting-owner pilot remain necessary before a production launch. Public discovery providers, owner enrollment/key recovery, temporal graph evaluation and the research dataset/measurements are not completed by the local demo.

The repository's chosen license remains an owner decision. Bundled maintained dependencies have their own licenses; do not claim an unselected project license or copy unreviewed competitor code.

## Delivery sequence

The release workflow is implemented, with protected-main/tag and exact-SHA green-CI gates, digest-pinned image manifests, SBOM/provenance generation, verification of the published candidate images, and an approval-protected staging deployment with strict SSH host-key verification, HTTPS/no-demo/readiness checks and prior-image rollback. It has not published release images or deployed a public host. Follow [the deployment guide](DEPLOYMENT.md) after supplying the required host, owned domain, OIDC identities, private publisher gateway and securely provisioned keys/secrets. Broader automatic discovery, owner enrollment/recovery and research evaluation are still roadmap items.
