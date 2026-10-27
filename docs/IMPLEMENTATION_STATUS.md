# Implementation status and evidence

Updated 27 October 2026 (Asia/Kolkata). This file supersedes historical prototype statements only where fresh evidence is recorded below. The original [complete plan](WEB_SWITCHER_PLAN.md), [prototype status](PROTOTYPE_STATUS.md), and prototype ADR remain preserved historical documents.

## Recovery and current scope

The uploaded prototype handoff was checksum-verified and its source restored onto the README-only repository baseline `075bc000eaf203f912c4e610b3f7fbc7746681e9`. The larger implementation described in the recovery checkpoint was unavailable and has been reconstructed rather than represented as recovered source.

The current target is a useful local extension plus a runnable reviewed-registry demonstration: packaged gate and settings, strict signed-record verification, Java API/review/publish workflow, React public/admin interface and isolated bounded fetcher. The full multi-stage research plan is not complete merely because these modules exist.

## Traceability

| Plan area | Source/evidence location | Interpretation |
| --- | --- | --- |
| P0/P1 local routing and gate | `extension/`, `tests/core.test.mjs`, `tests/browser.mjs` | Current outcomes recorded below; native Chrome/Edge acceptance remains separate |
| UI and manual settings | `extension/options.*`, `extension/popup.*`, `apps/web/` | Product surfaces; accessibility across real devices remains a release gate |
| BE review/publish/auth/persistence | `backend/` migrations, source and tests | Pending decisions separate from published releases; production process/DB role isolation not implied |
| SIG schemas/ES256/freshness/rollback | `packages/security/`, Java signer and compatibility checks | Trust anchor installation and production key lifecycle need operator configuration |
| DISC safe network probes | `fetcher/` source/tests | Application checks do not prove deployed egress enforcement; no universal discovery claim |
| NOV experimental owner records | `packages/security/owner-cli.mjs` | Signing/verification tools are not completed enrollment, domain-control proof or recovery lifecycle |
| OPS CI/deployment/backup support | `.github/workflows/platform.yml`, `infra/`, deployment/release docs | Definitions are not evidence of cloud execution, public deployment or a successful restore |
| Research and P4/P5 | Original plan and `research/` | Synthetic prior experiments only; new effectiveness studies, browser ports and stores remain open |

## Fresh validation ledger

The following results belong to the reconstructed source and current validation run. Historical checkpoint counts are not reused.

| Check | Current outcome |
| --- | --- |
| Prototype source archive checksums | Verified before restoration |
| Routing/configuration and mocked background/adapter tests | 56 passed (26 core, 19 worker, 11 catalog-adapter); simulated browser APIs are not native browser acceptance |
| Strict catalog/passport security tests | 23 passed, including offline owner CLI; combined JavaScript total 79 with zero skips/failures |
| Java API/database/auth/review tests | 11 passed against H2 and the same 11 passed against fresh PostgreSQL 17; final parser hardening and setup verification passed |
| Java fetcher/SSRF/bounds tests | 65 passed with zero skips/failures; authenticated loopback fixtures and injected safe transports, not deployed public egress |
| Java-to-browser signature compatibility | Live Java ES256 catalogs verified with the browser-compatible WebCrypto module; modified signatures rejected; full HTTP demo passed 11 checks including publication/revocation |
| React TypeScript and production build | Passed; actual Chromium mocked API-contract suite and read-only live API/login UI suite passed; desktop screenshots inspected and mobile overflow check passed |
| Current Chromium extension navigation suite | Managed local browser blocks development extensions. Hosted CI exposed and fixed a fixture-module startup error; a subsequent browser failure remains under diagnosis. No native extension pass claimed |
| Manifest/syntax/package inspection | Passed; dist/web-switcher-0.2.0.zip built with fixture mode disabled, no embedded private keys or default remote trust |
| Real web browser end-to-end | Eight checks passed without response mocks against the actual Compose stack: report, review, independent publication, Java/WebCrypto verification, lookup, revocation and abstention |
| Staging deployment safety | Seven controlled deployment/rollback/configuration checks and eight PostgreSQL role/bootstrap checks passed; public host/OIDC/TLS deployment remains unexecuted |
| Backup/restore failure guards | Six hermetic producer/encryption/target guard checks passed; no live database or cryptographic restore claim |
| Local Compose syntax | `docker compose -f infra/compose/local.yml config --quiet` passed |
| Container build/runtime | Web/API images built with verified TLS/artifacts and optional session CA secret; loopback Caddy static/security-header checks and 11 live API checks passed, plus immutable catalog persistence after API restart (`test-results/container-http-demo.json`) |
| PostgreSQL production privileges/restore | Not executed; the functional PostgreSQL test uses a disposable development role and does not establish privilege separation or encrypted restore |
| Actual Chrome/Edge native permissions and stores | Not executed |
| Reusable cloud setup script | scripts/setup-cloud.sh executed successfully end to end after correcting the npm cache to a writable directory; install_script and start_skill saved in the environment draft |
| GitHub publication and CI | Feature branch published. JavaScript, Java and live API jobs passed; hosted extension-browser acceptance still failed and is under diagnosis. Expanded PostgreSQL/full-stack/deployment CI is being added; see the actual GitHub run before claiming complete CI success |

## Outstanding gates

The production account/domain/OIDC configuration, key-isolated publisher, database grants, private network/firewall verification, encrypted off-host restore, real-browser native permission/lifecycle tests, store identities/submissions and consenting-owner pilot remain necessary before a production launch. Public discovery providers, owner enrollment/key recovery, temporal graph evaluation and the research dataset/measurements are not completed by the local demo.

The repository's chosen license remains an owner decision. Bundled maintained dependencies have their own licenses; do not claim an unselected project license or copy unreviewed competitor code.
