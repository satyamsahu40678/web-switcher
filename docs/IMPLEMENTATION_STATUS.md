# Implementation status and evidence

Updated 26 October 2026 (Asia/Kolkata). This file supersedes historical prototype statements only where fresh evidence is recorded below. The original [complete plan](WEB_SWITCHER_PLAN.md), [prototype status](PROTOTYPE_STATUS.md), and prototype ADR remain preserved historical documents.

## Recovery and current scope

The uploaded prototype handoff was checksum-verified and its source restored onto the README-only repository baseline `075bc000eaf203f912c4e610b3f7fbc7746681e9`. The larger implementation described in the recovery checkpoint was unavailable and has been reconstructed rather than represented as recovered source.

The current target is a useful local extension plus a runnable reviewed-registry demonstration: packaged gate and settings, strict signed-record verification, Java API/review/publish workflow, React public/admin interface and isolated bounded fetcher. The full multi-stage research plan is not complete merely because these modules exist.

## Traceability

| Plan area | Source/evidence location | Interpretation |
| --- | --- | --- |
| P0/P1 local routing and gate | `extension/`, `tests/core.test.mjs`, `tests/browser.mjs` | Current test outcomes must be recorded below; native Chrome/Edge acceptance remains separate |
| UI and manual settings | `extension/options.*`, `extension/popup.*`, `apps/web/` | Product surfaces; accessibility across real devices remains a release gate |
| BE review/publish/auth/persistence | `backend/` migrations, source and tests | Pending decisions separate from published releases; production process/DB role isolation not implied |
| SIG schemas/ES256/freshness/rollback | `packages/security/`, Java signer and compatibility checks | Trust anchor installation and production key lifecycle need operator configuration |
| DISC safe network probes | `fetcher/` source/tests | Application checks do not prove deployed egress enforcement; no universal discovery claim |
| NOV experimental owner records | `packages/security/owner-cli.mjs` | Signing/verification tools are not completed enrollment, domain-control proof or recovery lifecycle |
| OPS CI/deployment/backup support | `.github/workflows/platform.yml`, `infra/`, deployment/release docs | Definitions are not evidence of cloud execution, public deployment or a successful restore |
| Research and P4/P5 | Original plan and `research/` | Synthetic prior experiments only; new effectiveness studies, browser ports and stores remain open |

## Fresh validation ledger

Final integration must replace the pending entries with actual current-run results; the older checkpoint's counts do not apply to reconstructed code.

| Check | Current outcome |
| --- | --- |
| Prototype source archive checksums | Verified before restoration |
| Pure routing/configuration tests | Pending final integration result |
| Strict catalog/passport security tests | Pending final integration result |
| Java API/database/auth/review tests | Pending final integration result |
| Java fetcher/SSRF/bounds tests | Pending final integration result |
| Java-to-browser signature compatibility | Pending final integration result |
| React TypeScript and production build | Pending final integration result |
| Current Chromium navigation suite | Pending final integration result |
| Manifest/syntax/package inspection | Pending final integration result |
| Backup/restore failure guards | Six hermetic producer/encryption/target guard checks passed; no live database or cryptographic restore claim |
| Local Compose syntax | `docker compose -f infra/compose/local.yml config --quiet` passed |
| Container build/runtime | Not yet executed |
| PostgreSQL privileges/restore | Not yet executed |
| Actual Chrome/Edge native permissions and stores | Not executed |
| GitHub publication and CI | Push check currently returns HTTP 403 despite the configured token; no remote/CI success claimed |

## Outstanding gates

The production account/domain/OIDC configuration, key-isolated publisher, database grants, private network/firewall verification, encrypted off-host restore, real-browser native permission/lifecycle tests, store identities/submissions and consenting-owner pilot remain necessary before a production launch. Public discovery providers, owner enrollment/key recovery, temporal graph evaluation and the research dataset/measurements are not completed by the local demo.

The repository's chosen license remains an owner decision. Bundled maintained dependencies have their own licenses; do not claim an unselected project license or copy unreviewed competitor code.
