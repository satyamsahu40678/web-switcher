# Plan-to-implementation traceability

Updated 27 October 2026 (Asia/Kolkata). This is the current interpretation of the stable task IDs in [the original plan, section 22](WEB_SWITCHER_PLAN.md#22-complete-implementation-backlog). The plan and recovery checkpoint remain historical records; their unchecked boxes are not silently converted into completed production gates.

**Covered** means the described development behavior exists with relevant executable checks, within the stated scope. **Partial** means a material part of the original task is missing or broader than the tested implementation. **External** needs an operator, real account/domain, deployment or consenting participant. **Deferred** means no implementation or completed study is claimed. These labels are task traceability, not an independent security review or launch approval. Exact executed test counts and CI revisions belong in [the validation ledger](IMPLEMENTATION_STATUS.md).

The implemented product is a local MV3 extension plus a reviewed, signed registry and optional bounded redirect-observation queue. It is not universal dead-link recovery. The extension remains packaged plain JavaScript with npm lockfiles; React/TypeScript is used for the web app. WXT and pnpm were proposed technology choices, not tools that were implemented under different names. The owner CLI is experimental offline signing/verification; it does not complete owner enrollment or the temporal-graph research program. See [the novelty and evidence discussion](NOVELTY_AND_EVIDENCE.md).

## P0: feasibility and scope

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| P0-01, P0-02, P0-14 | Covered | Baseline/recovery recorded in `IMPLEMENTATION_STATUS.md`; prototype scope ADR and current trust/threat model in `ADR-001-prototype-scope.md`, `ARCHITECTURE.md`, `SECURITY.md`. Historical ADR limitations are superseded only by recorded current evidence. |
| P0-03 | Partial | Dated prior-art/source register exists in the plan. No competitor code is reused; FABLE dependency/license reproduction has not been completed. |
| P0-04 | Partial | Java21, Maven distribution/checksum, Spring dependencies, Node requirement, npm lockfiles and Playwright pin exist. WXT/pnpm adoption is not implemented. |
| P0-05 | Covered | `tests/browser.mjs` executes the real unpacked-extension gate in hosted Chromium. This is not a managed-browser-policy bypass or a Chrome/Edge store installation. |
| P0-06, P0-09 | External | Actual Chrome/Edge installation and native optional-permission grant/deny/revoke remain open. The automated fixture pregrants its synthetic source hosts; mocked worker checks do not replace native permission dialogs. |
| P0-07, P0-08, P0-11 | Covered within fixture | `tests/core.test.mjs` and native `tests/browser.mjs` exercise encoded/Unicode paths, query/fragment removal, exact hosts, GET/main-frame boundaries and forged/stale gate invocation. This does not assert every possible browser serialization edge case. |
| P0-10, P0-12 | Partial | Browser restart persistence, persisted stale/expired rules, target-return loop and mocked state/race guards are checked. Full sleep/resume, background-termination, back/forward and source-service-worker coverage remains open. |
| P0-13 | Deferred | No controlled cold/warm gate-overhead study or G0 performance acceptance claim. |

## P1: repository and extension

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| P1-01 | Partial | Maven wrapper, npm installs, syntax/manifest checks, React typecheck/build and reproducible setup documentation exist. This is not the proposed pnpm/WXT workspace or a complete formatter/linter suite. |
| P1-02 | Partial / External | `SECURITY.md` and release documentation cover reporting and dependency/license cautions. The owner has not selected a project license; no license choice is inferred. |
| P1-03 | Partial | Closed portable signed-data verifier and cross-language live signature checks exist in `packages/security/`, `tests/http-demo.mjs` and Java tests. A fully generated shared schema/type/client and comprehensive cross-language URL corpus are absent. |
| P1-04 | Partial | MV3 manifest, optional selected-source permissions and fixture-free packaging are implemented in `extension/manifest.json` and `scripts/package.mjs`. No multi-browser adapter/manifest generator or Firefox port is claimed. |
| P1-05 | Partial | Versioned validated settings, corrupt-state fail-closed behavior and interrupted-generation reconciliation exist in `extension/core.js` and `background.js`. General multi-version migration/repair UX is not complete. |
| P1-06, P1-07, P1-08 | Covered | Bounded exact-origin manual mappings, destination/matching preview and current-policy gate checks are implemented and tested. A local mapping represents user intent, not verified shared ownership. |
| P1-09, P1-10 | Covered | DNR compilation bounds, batch rule replacement and staged/committed generation reconciliation are covered by pure/mocked worker checks and native stale-generation cases. |
| P1-11, P1-12 | Covered within supported navigation | Homepage/preserve/public-prefix policies, dropped queries/fragments, fresh destination-bound sensitive confirmation, per-tab loop/navigation guards and tab cleanup exist. Broader lifecycle acceptance remains under P0-10/P0-12. |
| P1-13, P1-14, P1-15 | Covered | Pause/disable, bounded tab undo, physically pruned origin-only receipts, immediate clearing and strict local-only import/export preview are implemented. Imports cannot grant registry/owner trust. |
| P1-16 | Partial | Account-free, backend-free local mapping operation is covered in Chromium. The plan's complete cross-browser/native-permission P1 acceptance gate remains open. |

## Product UI

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| UI-01 | Covered for current surfaces | Original spider SVG and thread/theme styles are in `extension/spider.svg`, `theme.css`, `styles.css` and `apps/web/src/styles.css`. Store-specific artwork and device palette acceptance remain separate. |
| UI-02, UI-03, UI-04, UI-05 | Partial | Popup, options, manual preview, selected registry access, pause/privacy controls, public lookup/report and moderation screens exist. They are plain extension UI plus React web components, not a complete shared accessible component library or every proposed onboarding/status flow. |
| UI-06 | Partial | Local receipts, current reviewed reasons and family/publication/audit summaries are visible. A complete dated migration graph/history explorer and owner-proof explanation UI are absent. |
| UI-07 | Covered within gate | The packaged route screen explains abstention and permits a separately confirmed homepage action. It does not inject into browser error pages or repair arbitrary dead domains. |
| UI-08, UI-09 | Partial / External | Automated mobile overflow/escaped-text checks, theme/reduced-motion styles and Unicode policy cases exist. Screen-reader, zoom, full contrast and Windows/macOS/Linux acceptance have not been completed. |
| UI-10 | Covered for current claims | Current UI/help explicitly separate registry review, user configuration, reachability, unverified discovery and content safety; `SECURITY.md` and `API.md` explain disclosure boundaries. A user-comprehension study remains TEST-12. |

## P2: API, database and moderation

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| BE-01, BE-02 | Covered for schema V1 | Java/Spring runtime roles, PostgreSQL/H2 JDBC/Flyway schema and tests exist under `backend/`. Release deployment intentionally refuses future migrations until a separate reviewed migration/rollback path exists. |
| BE-03 | Partial | Families, pending candidates/decisions, immutable signed releases and audit records exist. The schema is not a full endpoint/binding/temporal-edge graph. |
| BE-04 | Partial | Executable `Api.java` plus `docs/API.md`, request limits, problem responses and bounded admin lists exist. No generated OpenAPI/client contract or general cursor-pagination system is claimed. |
| BE-05 | Partial | Current/historical signed releases, ETag/304 and active/revoked family summaries exist. A full historical-binding/migration evidence endpoint is absent. |
| BE-06 | Covered for optional redirect discovery | Explicit hostname-only lookups, durable dedupe, random expiring references, poll budgets and pending/unknown responses are in `DiscoveryQueue.java`, `Api.java` and discovery tests. No unverified destination is returned as verified. |
| BE-07 | Partial | Bounded/rate-limited reports, escaped evidence and review state transitions exist. A complete report-retention/deletion operator workflow is not implemented. |
| BE-08 | Partial | Discovery leases, stale-owner rejection, durable attempt/probe budgets, bounded retry/backoff and terminal failure states are tested. There is no separate dead-letter administration/replay product. |
| BE-09 | Partial | `Registry.java` serializes release-sequence advancement and activation with immutable release bytes. There is no remote message bus/outbox consumer; publication is the database transaction itself. |
| BE-10, BE-11, BE-12, BE-13 | Covered for current roles | Production-mode OIDC code-flow/negative/session/CSRF tests, optimistic independent review/publish, escaped React admin evidence and audit are implemented. PostgreSQL grants enforce append-only runtime release/audit behavior; actual production identities remain external. |
| BE-14 | Partial / External | Self-review and same-reviewer publication are denied. Code cannot establish that two configured OIDC subjects are independent humans; an independent operator and solo-operation fallback policy remain operational decisions. |
| BE-15 | Covered for demo seeds | Only reserved synthetic `.test` fixtures are seeded. No user-supplied example site is claimed as a verified production family. Real enrollment needs ground truth and consent. |

## P2: signed data and synchronization

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| SIG-01, SIG-02 | Covered | Closed catalog/passport schemas, record-type-separated ES256/JOSE checks, strict parsing and Java/WebCrypto positive/negative interoperability are implemented in `packages/security/` and backend signer/tests. |
| SIG-03 | Partial / External | Pinned public trust maps, offline publisher key generation/checking and documented rotation/incident limits exist (`scripts/registry-key.mjs`, `SIGNING_KEYS.md`). Automated delegated-root transition/recovery is absent; real identities must be provisioned securely. |
| SIG-04, SIG-05, SIG-06, SIG-07 | Covered for supported schema | Snapshot validation, immutable monotonic sequence/digest, verify-before-use, rollback/equivocation, current expiry/clock checks and revocation behavior exist. Schema/policy versions other than supported V1 fail closed; no transparent upgrade is promised. |
| SIG-08 | Partial | Configured fixed-endpoint manual/maintenance refresh, ETags and startup reconciliation exist in `extension/background.js`. Full install/startup fetch scheduling with jitter and adaptive backoff is not implemented. |
| SIG-09 | Covered in deterministic checks | Valid cached records remain usable only within their validity; expired/corrupt records abstain. This cannot provide immediate revocation to an offline device. |
| SIG-10 | Partial | Higher-sequence correction/publication and family withdrawal are implemented; live API/browser suites test revocation and abstention. A complete real key/host incident rehearsal remains TEST-13. |

## P3: discovery and crawler defenses

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| DISC-01 | Partial | A fixed internal fetcher client validates bounded typed redirect observations and records unverified provenance. A general provider/plugin/source-adapter framework is absent. |
| DISC-02 | Covered for candidate hints | `fetcher/` bounds methods, hops/cycles and HTTPS behavior; the separate worker queues observed cross-origin redirects only. It never treats redirect reachability as ownership evidence. |
| DISC-03, DISC-04 | Deferred | No announcement/canonical/sitemap extraction, search-provider integration, paid-provider account or general web search. |
| DISC-05 | Partial | Hostname/outcome and candidate dedupe, global/hour/day/host durable budgets and bounded fetcher per-host concurrency exist. Registrable-domain/per-family budget semantics are not complete. |
| DISC-06, DISC-07, DISC-09 | Covered in application tests | Isolated fetcher scheme/port/public-address restrictions, all-address validation, connect-address pinning, TLS hostname verification and hostile redirect/response/decompression/time tests exist. Test transports do not prove a deployed firewall or public DNS path. |
| DISC-08, DISC-16 | External | No public-crawl deployment/egress acceptance claim. The managed CONNECT proxy cannot demonstrate pinned destination IPs; the fetcher returns `PINNED_EGRESS_UNAVAILABLE` there. |
| DISC-10 | Covered within bounded policy | Robots handling, explicit crawler identity, per-host spacing and bounded retained host budgets exist. No robots cache or arbitrary crawling schedule is implied. |
| DISC-11, DISC-12 | Partial / Deferred | Transport/reachable/error/unavailable results and explicit `UNVERIFIED`/`UNKNOWN` are supported. No parked/soft-404/challenge classifier or threat-provider lookup is implemented. Unknown is not a clean/safe result. |
| DISC-13 | Partial | Bounded body SHA-256 is retained as unverified candidate evidence. No similarity/identity ranker or auto-promotion is implemented. |
| DISC-14 | Partial | Durable queue leases/retry, outcome TTL/negative cache, expired-row pruning and finite probe budgets exist. Adaptive monitoring, signal-triggered reevaluation and evidence freshness decay remain deferred. |
| DISC-15 | Covered | API→separate worker→pending candidate tests preserve exact active catalog bytes and public abstention. DB worker grants deny family/decision/release/sequence mutation; deployment role/egress acceptance is a separate gate. |

## P4: owner continuity and graph novelty

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| NOV-01 | Partial | Catalog family IDs, dated alias/decision validity and revocation are defined. Full temporal migration/mirror/ownership-transfer graph semantics are not implemented. |
| NOV-02, NOV-03 | Partial | Catalog validation requires terminal approved destinations and rejects conflicting/invalid bindings; the local gate abstains on unsupported/stale state. No provenance-preserving multi-edge graph compression, split-site or re-registration inference exists. |
| NOV-04 | Partial | The plan describes experimental `/.well-known/web-switcher.json` and standards-registration cautions. No registered well-known URI or hosted owner endpoint is claimed. |
| NOV-05 | Covered for offline tooling | `packages/security/owner-cli.mjs` generates/signs/verifies owner records with private-file safeguards; tests exercise the closed record type. This is an experimental standalone tool. |
| NOV-06 | Deferred | No live single-use HTTPS/DNS enrollment challenge or independently established family-to-key binding. |
| NOV-07 | Partial | Signature, pinned-key, sequence/previous-hash and validity checks exist offline. Live destination-control verification and server passport intake are absent. |
| NOV-08, NOV-09 | Deferred / External | No completed owner key rotation/recovery/transfer service, owner portal or consenting-owner pilot. Domain-control proof and participants cannot be manufactured by the demo. |
| NOV-10 | Covered for present scope | CLI/docs warn that arbitrary self-signatures establish neither ownership nor historical identity. UI does not promote CLI output or unverified observations into enrolled owner trust. |
| NOV-11, NOV-12 | Deferred | No independent publication witnesses or measured differentiation report. Prior-art discussion and implementation evidence do not prove academic/patent novelty or superiority. |

## Meaningful validation and research

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| TEST-01 | Partial | Controlled HTTP browser hosts, internal fetcher contract fixtures and a real trusted-loopback HTTPS OIDC fixture exist. No complete versioned real-domain/TLS migration dataset/fixture platform. |
| TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07 | Deferred | Historical synthetic feasibility labs are preserved in `research/`. No independently reviewed migration ground truth, family/time holdouts, FABLE/search baseline, ablation or real harmful-switch precision/coverage result is claimed. |
| TEST-08 | Partial | Hostname-only input contracts, dropped URL components, origin-only receipts and native fixture request/referrer observations are checked. Complete all-flow network capture/privacy acceptance remains open. |
| TEST-09 | Covered for current contracts | Java ES256 catalogs verify through the shared browser-compatible module in live API/full-stack checks; strict parser/negative-signature tests are present. Not a generated TypeScript policy engine. |
| TEST-10 | Partial / External | Hosted Chromium restart, loop, sensitive-path and ungranted-source cases plus mocked race/undo checks exist. Native optional-permission and full Chrome/Edge lifecycle acceptance remain open. |
| TEST-11 | Partial | `tests/catalog-load.mjs` supplies a bounded loopback immutable-catalog/ETag concurrency check. It does not establish production API/queue capacity, proposed-hardware memory/egress or an SLO. |
| TEST-12 | External | No consenting usability participants or measured comprehension study. |
| TEST-13 | Partial | Real local age/PostgreSQL/API restore drill and synthetic malicious-mapping revocation are available; separate production signing-key recovery and off-host clean-host incident rehearsal remain open. |
| TEST-14 | Partial | Current evidence/claim limits are documented and tests are linked; no independent pre-launch scientific/security review is implied. |

## Infrastructure and delivery

| Plan IDs | Status | Current evidence and remaining boundary |
| --- | --- | --- |
| OPS-01 | External | Hosting provider/region, owned domain, budget and accountable operators are not chosen by code. |
| OPS-02 | Partial | Local demo and guarded staging Compose/build/deploy files exist. No applied production infrastructure or independently verified production topology. |
| OPS-03, OPS-04 | Partial / External | Config checks, separate keyless API/publisher/worker roles, protected file-based secrets, no DB host port and private publisher profile are implemented. Public TLS/DNS/OIDC/private gateway and real runtime identity/egress controls still require provisioning and deployed tests. |
| OPS-05, OPS-06 | Partial / External | Shipping encrypted backup, checksum/authenticated restore, clean PostgreSQL recovery and recovered API/signature checks are implemented/tested locally (`BACKUP_RESTORE_DRILL.md`). Off-host transport/retention, restore identity custody and achieved production RPO/RTO are not established. |
| OPS-07 | Partial | Bounded audit/events, readiness and incident/deployment runbooks exist. No complete metrics/spend/backup alert service or external status operation. |
| OPS-08 | Partial | Six-job CI, locked dependencies/pinned Actions, fixture-free packages, exact-source/digest release gates and SBOM/provenance settings exist. Image publication and license/permission-diff release review are distinct unexecuted controls. |
| OPS-09 | Partial / External | Workflow and Compose credential boundaries are defined and validated. Real release/staging environment approvals and production/store credentials must be configured by an authorized operator. |
| OPS-10 | Partial | Deployment restricted to verified V1, immutable-image rollback and schema-drift refusal are tested. A future multi-migration compatibility/SQL rollback strategy and old-client upgrade matrix are not complete. |
| OPS-11 | External | No Chrome/Edge store account/recovery configuration. |
| OPS-12 | Partial | Current product/help/privacy/security explanations exist in UI and repository docs. No publicly hosted support/privacy operation or finalized support contact is claimed. |
| OPS-13 | Partial | Original SVG/theme assets and development screenshots exist. Final store artwork, screenshots and submission disclosures need reviewed release-specific production settings. |
| OPS-14 | Partial | Fixture-free development ZIP packaging/inspection is implemented. A production package with owned endpoint/pinned production trust roots and Chrome/Edge acceptance remains open. |
| OPS-15, OPS-16, OPS-17 | External | No actual store acceptance, operator pilot, production availability/cost measurements or full G0–G6 launch approval. Green CI does not complete these gates. |

## Explicitly deferred extensions

| Plan IDs | Status | Boundary |
| --- | --- | --- |
| FUT-01 | Deferred | No bookmark scanning, mutation, backup/apply or rollback workflow. Existing bookmarks are not rewritten. |
| FUT-02, FUT-03 | Deferred | No tested Firefox port or Safari/mobile support claim. |
| FUT-04 | Deferred | No broad browser error/status interception; the current gate explains only supported routing decisions. |
| FUT-05, FUT-06 | Deferred | No archive/Common Crawl/passive-DNS adapters or community telemetry/voting identity system. |
| FUT-07, FUT-08 | Deferred | No privacy relay/sharding study or learned deep-page recovery result. |
| FUT-09, FUT-10 | Deferred | No multi-region probing or specialized queue/graph service; no measured bottleneck justifies claiming those systems. |

## How to assess a later completion claim

Use the stable ID, inspect the linked executable behavior, and record the exact tested revision/run in `IMPLEMENTATION_STATUS.md`. A changed status must identify both the completed behavior and the remaining original acceptance boundary. Synthetic fixtures establish deterministic engineering properties; they cannot supply historical site ownership, an independent human reviewer, research ground truth, account authorization or production durability.
