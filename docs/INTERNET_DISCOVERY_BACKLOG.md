# Internet discovery implementation backlog

**Implementation update, 29 October 2026:** See [the task-to-delivery matrix](INTERNET_DISCOVERY_STATUS.md#backlog-interpretation) for current code and outstanding acceptance. The numbered definitions below preserve the original plan and dependencies; they are not a statement that every task is still wholly unimplemented or that all 36 are complete.

Planning revision: 28 October 2026 (Asia/Kolkata). **NET task definitions describe proposed work and acceptance; consult the linked current status for delivery.** This document is an execution plan, not a record of completed provider integration or new passing tests.

Read the [design plan](INTERNET_DISCOVERY_PLAN.md), [idea register](INTERNET_DISCOVERY_IDEAS.md), and [evaluation and threat plan](INTERNET_DISCOVERY_EVALUATION.md) together. The existing [implementation ledger](IMPLEMENTATION_STATUS.md) remains the source for what actually runs. The earlier [research plan](WEB_SWITCHER_PLAN.md) and [traceability matrix](PLAN_TRACEABILITY.md) retain their original IDs; NET IDs identify this concrete next increment rather than silently marking earlier work complete.

## Product contract for this increment

The user enters an old public HTTPS address, or chooses the old address from the current tab. The extension may use its current direct-chain engine first, but **neither local successor history nor a manually entered replacement is a prerequisite for Internet candidate discovery**. With explicit online-lookup consent, the service investigates public sources, explains candidates and stops when evidence is insufficient. No backend search key belongs in the extension.

Candidate generation, same-identity evidence, reachability and navigation authority remain separate. A high search rank, copied logo, matching content, fresh certificate or a set of repeating announcements cannot independently turn a discovered origin into an automatic route. A candidate can be useful before it is eligible for automatic following.

The first shipping online increment should return explainable, confirmation-only candidates. Later automatic navigation requires the stronger authority gates in the design and evaluation documents; it is not activated merely because candidate ranking performs well offline.

## Compatibility constraints

| Existing contract or boundary | Required treatment |
| --- | --- |
| `POST /v1/lookups` and its optional queue | Preserve known signed decisions, existing pending shapes and terminal unknown responses. Never put unverified public destinations into the existing verified response. |
| Existing discovery worker | Preserve its candidate-only authority and disabled-by-default admission. Its 30-second lease and three-attempt behavior are not an adequate implementation of a new 120-second multi-source job. |
| `V1__registry.sql` | Never edit the accepted migration or its checksum. Use reviewed additive migrations for new records. |
| Current deployment scripts | They deliberately refuse future/unreviewed schemas. Migration, compatibility and rollback support must be completed before deploying the new schema; adding a SQL file alone is insufficient. |
| Worker/API/publisher identities | Retain separation. New discovery workers cannot approve candidates, change active bindings, publish releases, advance catalog counters or read signing credentials. |
| Local extension continuity | Keep functioning when online discovery is disabled, unconfigured, budget-exhausted or unavailable. Internet suggestions do not silently become locally observed successor edges. |
| Signed reservations | Apply to source, intermediate and terminal origins. Withdrawing, expiring or deleting a signed cache must not enable a weaker Internet-derived automatic route. |
| Public user example | Treat it as an unverified product scenario, not a seed mapping or a known-good accuracy label. No live outcome is implied by this backlog. |

## Planning budgets and proposed controls

These are starting hypotheses for implementation and measurement, not current configuration defaults or calibrated service promises. The main design may tighten them before code is written.

| Control | Initial proposed ceiling and interpretation |
| --- | --- |
| Search | Two provider calls per logical uncached job, including retries that might be billable; all attempts share the same counter. |
| Archive index | Two index API calls per logical job, including retries; index metadata does not authorize an unbounded archive crawl. |
| Candidate fan-out | Ten unique candidate origins per job. Search result count, canonical variants and redirects cannot bypass this limit. |
| Web requests and paths | Thirty website HTTP requests across the job, including robots, redirect and metadata requests; at most three public sample paths per origin, still subject to the global cap. Provider/index API calls have their own caps above. |
| Concurrency | Four website observations globally and one in flight per registrable-domain budget group; this grouping does not establish shared identity. |
| Response bytes | One MiB decompressed per server-side website response and eight MiB total response data across the discovery job. Define compressed/decompressed accounting and provider-response caps in the executable contract. |
| Observation window | At most 60 seconds of active investigation wall time across search/provider, archive and web-observation phases within a 120-second total job deadline from creation; queue waiting consumes the absolute deadline. Overlapping phases count once; active-time consumption is durable across retries, lease replacement and restarts. Use bounded per-request deadlines and a shared abort budget. Concurrency cannot extend either deadline. |
| Retry | At most three logical job attempts; each phase resumes from durable progress and remaining budgets rather than repeating the full search. |
| Queue claim | Initial proposed phase lease: 15 seconds, renewal every five seconds, fencing tokens and an absolute deadline. Tune only after crash/recovery tests; renewal cannot extend the job deadline. |
| Cost accounting | Reserve durable request, byte and monetary/token allowances before dispatch. An uncertain provider timeout is not assumed to be free. |
| Per-site work | Apply exact-origin and registrable-domain limits, robots/terms restrictions and backoff. Never rotate vantage, hostname spelling or credentials to evade a refusal. |
| Retention | Define bounded job/evidence/cache TTLs by data class before collection; preserve only the public security metadata necessary to avoid trust downgrade. |

The existing extension's 25-second/12-probe browser operation and per-response browser limits remain unchanged by these server planning values. Online discovery runs asynchronously and the extension polls a job reference. When an existing fetcher call can perform robots checks, metadata work or redirect hops internally, reserve its worst-case child request/byte budget before dispatch or extend the internal protocol for enforceable shared accounting. One parent request must never conceal uncharged external work.

Proposed feature controls are `ONLINE_DISCOVERY_ENABLED`, `ONLINE_DISCOVERY_CANDIDATES_ENABLED`, `ONLINE_DISCOVERY_SHADOW_ONLY`, and `ONLINE_DISCOVERY_AUTO_ELIGIBLE_ENABLED`. **These names do not exist in the application today.** The first three would independently control admission, candidate presentation and shadow operation. The last would remain false through the initial candidate-only pilot. Limits, a provider allowlist, provider credential bindings and a kill switch also require explicit implementation; do not confuse this list with a working runtime contract.

## Delivery order and ownership

The sequence below is a dependency graph, not a fixed calendar estimate. Provider availability, licensing and verified deployed egress may change the schedule. One person can develop multiple components, but review/publishing authority and independent evaluation must not be represented as independent when the same person performs both roles.

| Stage | Tasks | Deliverable | Exit gate |
| --- | --- | --- | --- |
| 0 — Contracts and fixtures | NET-001–006 | Reviewable policy, data shapes, privacy boundary and replay corpus | Old-address-only, first-time-dead-source behavior is specified without implying a verified match |
| 1 — Durable service foundations | NET-007–012 | Additive schema, compatible rollout, bounded queue, roles and deletion | Restart/cancellation/timeout cannot reset spend or commit stale results |
| 2 — Bounded public-source adapters | NET-013–017 | Replay-first search/archive/source adapters and safe candidate probes | No arbitrary public fetch proxy; no provider credentials in client/fetcher |
| 3 — Evidence and decisions | NET-018–023 | Normalized candidates, provenance graph, ranker and authority gates | Repeated weak evidence cannot cross an automatic-navigation gate |
| 4 — User-facing candidate flow | NET-024–028 | Separate versioned API, opt-in extension flow and updated disclosures | The user supplies no replacement/history; ambiguity is explained |
| 5 — Evaluation and deployment checks | NET-029–032 | Frozen evaluation, native journeys, failure/security tests and deployed isolation | Predeclared release criteria pass, with limits and unrun gates recorded |
| 6 — Restricted pilot and operation | NET-033–036 | Shadow outcomes, candidate-only pilot, rollback and research followups | Promotion requires measured evidence and accountable operator review |

### Stage 0 — Establish the executable contract

**NET-001 — Inventory current behavior and preserve baseline.** Dependencies: none. Deliver a baseline note tied to a commit and a compatibility checklist covering current local continuity, signed routing, `/v1/lookups`, worker authority and release gates. Likely files: existing extension/browser tests, `docs/API.md`, `docs/DISCOVERY.md`, and `docs/IMPLEMENTATION_STATUS.md`. Acceptance: a new feature-disabled build retains existing response shapes and local behavior; no historical test count is reused as evidence for future Internet discovery.

**NET-002 — Specify new discovery and decision schemas.** Depends on NET-001. Define proposed `/v2/discoveries` hostname-only submission, opaque expiring lookup references, polling/cancellation semantics and closed versioned result/evidence envelopes. Keep candidate ranking, identity class, reachability vantage/time and navigation eligibility in separate fields; define unknown, conflict, unavailable, budget-exhausted and revoked cases. Likely files: a new contract/schema package plus `docs/API.md`. Acceptance: example positive/negative envelopes validate offline, old v1 clients retain abstention, and no field can manufacture `owner_verified` or `registry_reviewed` provenance.

**NET-003 — Select provider access and source licensing.** Depends on NET-001. Compare a small number of official search/archive options for query scope, availability, terms, retention, quotas, regional behavior, commercial use and credential isolation. Record the chosen API/version and verified current documentation during implementation. Acceptance: one permitted search route and one permitted archive-index route are selected or explicitly unavailable; no guessed API path, unverified price or scraped search page substitutes for an approved integration.

**NET-004 — Define consent, query minimization and abuse controls.** Depends on NET-002 and NET-003. Specify how the old URL becomes an origin/hostname, which provider receives it, how optional brand terms may be derived from public records, what is retained, and how online lookup can be disabled. Prohibit private URL parts, cookies, browsing-history uploads and a shared client-side API secret. Acceptance: data-flow review accounts for every recipient, API and poll admission have enforceable budgets, and opening the popup alone cannot dispatch a paid query.

**NET-005 — Define provenance and temporal evidence records.** Depends on NET-002. Specify candidate origins, evidence observations, original upstream attribution, capture time versus claimed publication time, relation validity, authority class, hashes and source availability. An archive replay date must not become a live observation date. Likely files: proposed schema definitions and evidence-model design. Acceptance: an archived announcement echoed by five search results still forms one upstream provenance group; evidence can express conflict, a mirror or a later re-registration without overwriting history.

**NET-006 — Build a replay corpus and first-time-dead-source fixture.** Depends on NET-002 and NET-005. Define licensed/synthetic search results, archive-index replies, source announcements, hostile copies, dead-source conditions and independent expected labels. Include an empty local graph and no manually supplied destination. Likely files: a new Internet-discovery fixture/test area; do not modify production seed data. Acceptance: fixtures reproduce all result classes offline, contain no live provider key and keep expected destinations out of actual lookup input/query construction.

### Stage 1 — Add durable and isolated service foundations

**NET-007 — Add discovery schema with forward migrations.** Depends on NET-005 and NET-006. Add narrowly scoped tables or equivalent records for jobs, phase progress, candidates, evidence, provenance groups, cost reservations, cancellations and retention timestamps. Likely files: a new reviewed `backend/src/main/resources/db/migration/V2__...sql` and database tests. Acceptance: V1 remains byte-identical; upgrades preserve signed bytes/counters and old data; H2 and real PostgreSQL constraints reject impossible states. File naming is proposed until the migration sequence is confirmed.

**NET-008 — Extend deployment/migration compatibility and rollback.** Depends on NET-007. Replace the current V1-only release assumption with an explicitly reviewed supported-schema matrix and protected owner-run upgrade procedure. Define expand/contract sequencing, old-client behavior, backup-before-upgrade checks and image rollback limits when schema cannot be reversed. Likely files: `infra/deploy/`, deployment/restore guides and acceptance tests. Acceptance: unknown or partial migrations still block deployment; an application image rollback never pretends to reverse SQL; worker/API startups remain unable to manage schema.

**NET-009 — Implement a phase-leased multi-source queue.** Depends on NET-007. Create separate Internet-discovery claim/resume semantics with absolute deadlines, renewal, fencing, cancellation and deduplication; reuse existing patterns rather than stretching a 30-second lease across 120 seconds. Likely files: new Java queue/coordinator classes and integration tests. Acceptance: crashed workers resume only unfinished bounded phases; expired owners cannot append evidence or complete results; concurrent workers cannot double-commit; cancellation wins against a late completion.

**NET-010 — Implement durable spend and fan-out admission.** Depends on NET-009 and NET-003. Reserve provider calls, unique-origin fan-out, bytes, model tokens if enabled, and estimated monetary allowance before each dispatch. Share counters across retries, workers, restarts and cache misses; define reconciliation for uncertain billing. Acceptance: an API failure, retry or provider timeout cannot reset the two-search/ten-origin job ceiling or exceed global operator budgets; exhausted work returns an explicit bounded result, not an invented match.

**NET-011 — Provision least-privilege identities and secret isolation.** Depends on NET-007 and NET-010. Extend owner-operated grants and tests for the new tables while keeping query dispatch/provider credentials separate from generic page fetching and publication. Likely files: database bootstrap/grant tests, worker profile configuration and deployment examples. Acceptance: a compromised discovery worker can submit only unverified evidence within its scope; family/decision/release/sequence writes and private signing keys remain inaccessible; fetcher has no search, database, OIDC or cloud credentials.

**NET-012 — Implement cache, expiry, cancellation and deletion.** Depends on NET-009 and NET-010. Define positive candidate caches, negative caches, per-origin/provider freshness, job reference expiry, redaction/deletion and terminal cancellation cleanup. Avoid infinite negative caching after a provider outage. Acceptance: expiry physically removes eligible records during maintenance, cancellation prevents further network dispatch and late result presentation, source/provider policy versions invalidate incompatible cache entries, and public anti-downgrade security metadata retains its documented separate semantics.

### Stage 2 — Implement source adapters and safe observations

**NET-013 — Create a constrained provider adapter interface.** Depends on NET-003, NET-005, NET-006 and NET-010. Define typed search, archive-index and announcement observations with request IDs, attribution, timestamps, parser version, bounded bytes and structured failures. Start with deterministic replay adapters. Acceptance: malformed/oversized/duplicate/trailing data is rejected, URLs are normalized before use, cancellation propagates, and an adapter cannot return a trusted routing decision or choose an arbitrary backend endpoint.

**NET-014 — Integrate one official search provider.** Depends on NET-013, NET-004 and NET-011. Implement hostname-focused query templates, a bounded optional second query derived from public evidence, result normalization, quota accounting, retry classification and provider circuit breaking. Use the implementation-time verified official API and a server-only secret binding. Acceptance: a first-time dead source can yield candidates in replay and a permitted canary; search rank/snippets remain untrusted hints; no full URL or secret appears in queries, logs, extension storage or source.

**NET-015 — Integrate an archive-index adapter.** Depends on NET-013 and NET-004. Query permitted historical index metadata first, then retrieve only a tightly bounded relevant snapshot when required and allowed. Keep archive URL, captured origin, archived redirect and capture timestamp distinct; do not follow arbitrary archived links recursively. Acceptance: stale archived destinations are live-checked before presentation, missing or blocked captures remain inconclusive, old tracking/token paths are excluded, and provider throttling/terms limitations are respected.

**NET-016 — Add bounded public announcement retrieval.** Depends on NET-013, NET-014 or NET-015, and NET-017. Extract move statements from known historical organization channels, public project repositories, feeds or independently indexed links. Establish why a channel was associated with the old site before using its current claim; cross-linked newly created accounts do not bootstrap one another. Acceptance: attribution and upstream identity anchors are visible, lookalike/reposted/social account takeover fixtures fail to acquire stronger authority, and announcement pages cannot issue tool/publisher instructions.

**NET-017 — Extend the isolated fetcher for candidate inspection.** Depends on NET-010 and NET-011; can proceed alongside NET-014/015. Reuse validated DNS/all-address/connect-IP/TLS/robots/body bounds and the internal authenticated boundary for a closed candidate-observation contract, including parked/soft-404/challenge classifications where feasible. Acceptance: private/reserved/rebinding/redirect targets are refused before inappropriate connections; decompression and total job budgets hold across candidates; 403/429/TLS/challenges stay inconclusive; HTML scripts and arbitrary browser sessions are not executed by default. A managed CONNECT proxy that cannot demonstrate pinned egress remains unavailable rather than bypassed.

### Stage 3 — Rank evidence without manufacturing identity authority

**NET-018 — Normalize candidates and domain identity boundaries.** Depends on NET-013 and NET-005. Deduplicate exact HTTPS origins, IDNA forms and default-port variants while preserving the distinction between sibling sites on shared hosting and a registrable-domain budget group. Use a pinned/updateable Public Suffix List policy with private-suffix treatment documented. Acceptance: suffix/homograph lookalikes and candidate fan-out tricks are bounded, public-suffix names do not become trusted family identities, and a shared CDN/IP/certificate never merges two families.

**NET-019 — Build independent provenance groups.** Depends on NET-005, NET-014–016 and NET-018. Trace copied search snippets, mirrored announcements, reused content and circular citations to their upstream assertions where available. Record uncertainty when independence cannot be established. Acceptance: ten echoes of one claim cannot outweigh one conflicting authoritative record; two providers indexing the same source are not counted as two identity witnesses; source deletion does not erase original observation time or revocation history.

**NET-020 — Implement an explainable candidate ranker.** Depends on NET-017–019 and NET-006. Start with transparent ranking features such as explicit historical redirects, relevant announcements, content/structure similarity and contradictory evidence. Use optional language/model assistance only behind independent budgets and an untrusted-data boundary. Acceptance: a returned rank has cited feature/evidence reasons, uncertainty is explicit, raw scores are not presented as calibrated probabilities, and weak-signal accumulation cannot produce automatic navigation.

**NET-021 — Implement independent authority and navigation gates.** Depends on NET-019 and NET-020. Evaluate signed registry history/reservations, pre-established owner continuity if available, expiry, revocation, target reachability, consent and sensitive-link policy separately from ranking. Recheck every encountered chain origin and current generation at use time. Acceptance: copied content/top search rank/valid TLS alone yield candidate-only output; withdrawn or expired signed aliases cannot route through a weaker predecessor; live reservation/permission changes while probing or confirming withhold navigation.

**NET-022 — Represent mirrors, splits, transfers and temporal conflicts.** Depends on NET-005, NET-019 and NET-021. Preserve relations such as migration, simultaneous mirror, archived resource and different current operator; do not compress all of them into one timeless successor pointer. Acceptance: a re-registered old domain cannot rewrite earlier identity history, a split can produce multiple choices without an arbitrary winner, and geographic unavailability does not authorize switching to an unrelated mirror or bypassing a regional refusal.

**NET-023 — Connect unverified observations to independent review.** Depends on NET-021, NET-022 and NET-011. Add a reviewable evidence bundle to existing candidate moderation or a carefully versioned adjacent flow. Keep lookup suggestions separate from a published registry decision; display source attribution, conflicts and evidence expiry. Acceptance: user selection/report cannot approve itself, discovery cannot publish, review and independent publication remain separately authorized, and archived or unsigned evidence never receives owner provenance through a database conversion.

### Stage 4 — Deliver the old-address-only Internet lookup flow

**NET-024 — Implement the proposed versioned discovery API.** Depends on NET-002, NET-009–012 and NET-020–022. Implement separate `/v2/discoveries` submission/status/cancellation semantics only after schemas are agreed; exact routes are proposed until this task lands. Bound input/output, polling, references, candidate count and cache exposure; keep lookup data out of public catalog publication. Acceptance: no arbitrary URL fetch endpoint, no hidden paid-search proxy, no cross-user private-job leakage, no unverified candidate inside a v1 verified response, and provider outages produce structured unavailable/budget states.

**NET-025 — Add explicit extension online-lookup consent.** Depends on NET-004 and NET-024. Add an online fallback from an old-address-only flow after direct evidence is absent or unavailable, with a clear first-use disclosure of which origin/hostname leaves the device. Default to explicit user action, with separately reviewed persistent preference if desired. Likely files: `extension/options.*`, `popup.*`, controller modules and tests. Acceptance: empty local history is sufficient to start lookup, no new-domain input is required, no online request occurs merely on ordinary unrelated browsing, and disabling online lookup leaves current local continuity working.

**NET-026 — Render candidate explanations and one-time choices.** Depends on NET-025 and NET-020–022. Show candidate origin, observed availability/time/vantage, identity evidence class, source links, contradictions and why an automatic route is unavailable. Render remote text inertly and allow cancellation/retry within policy. Acceptance: candidates are visibly unverified when appropriate, archived success is not displayed as current reachability, ambiguity does not auto-open the top item, and no model/provider text can inject markup, commands or privileged extension messages.

**NET-027 — Bind navigation and explicit following to fresh policy.** Depends on NET-026 and NET-021. Recheck the selected origin and current consent/permissions/catalog reservations immediately before a one-time homepage opening; bind confirmation to the displayed candidate and generation. If a user chooses an explicit override, label it user-configured rather than falsely recording a provider suggestion as an observed or owner-verified edge. Acceptance: paths/query/fragments/credentials never cross to the candidate, tab movement/pause/withdrawal cancels stale navigation, and no candidate result silently enrolls automatic following.

**NET-028 — Update install, Store and privacy documentation.** Depends on NET-025–027 and NET-004. Document the optional hosted service, query recipients, retention, provider attribution, permission differences, operator contacts, package configuration and reviewer fixtures. Existing network-free account/backend claims must remain scoped to local continuity. Acceptance: runtime behavior, privacy policy, listing, supported-browser behavior and bundled endpoint permissions agree; no provider secret or unverified public sample is shipped as a default mapping.

### Stage 5 — Establish evidence before promotion

**NET-029 — Run the frozen offline evaluation and ablations.** Depends on NET-006 and NET-018–022. Execute the [evaluation plan](INTERNET_DISCOVERY_EVALUATION.md) with family/time separation, first-time-dead-source cases, independent labels and a frozen holdout. Measure candidate recall, identity precision, wrong-hop risks, abstention, latency, spend and uncertainty separately. Acceptance: baseline comparisons include current direct chains and a deliberately naive search-only control; confidence intervals and failed subgroups are published; held-out labels never influence query formulation, thresholds or model prompts.

**NET-030 — Add native browser and real service journeys.** Depends on NET-024–028 and NET-017. Exercise a fresh extension with empty history against the actual API/queue/provider replay/fetcher stack, alongside native Chromium navigation and permissions tests; add Edge/manual-dialog acceptance as separately recorded checks. Acceptance: source-only first-time-dead-source lookup produces explainable candidates without a manual destination; selection is freshly checked; unrelated navigation stays unaffected; provider timeouts, browser restart and cancellation do not resurrect stale work. Mocked UI tests remain labelled as mocks.

**NET-031 — Run hostile-source, isolation and failure injection tests.** Depends on NET-009–012 and NET-017–027. Cover search poisoning, cloned pages, prompt injection, circular evidence, forged provider replies, signed revocation races, SSRF/rebinding, blocked robots, outages, malformed encodings, job crashes, budget exhaustion and time/clock faults. Acceptance: failures preserve abstention and accounting; a compromised worker cannot publish; no secrets/private URL parts appear in captured network/log/storage paths; retries and multiple vantages cannot evade a block. Preserve meaningful failures rather than disabling tests.

**NET-032 — Verify deployed egress, migrations, backups and provider canaries.** Depends on NET-008, NET-011, NET-028, NET-030 and NET-031. In an operator-approved staging topology, verify public-only fetcher networking, isolated identities/secret mounts, schema upgrade, complete-row encrypted restore, provider credentials/terms and a tiny budgeted live canary. Acceptance: actual connected-IP restrictions are demonstrated; new tables are in full backups with RLS-compatible identities; image rollback and service-disabled fallback work. CI fixtures alone cannot close this gate.

### Stage 6 — Release incrementally and keep uncertainty visible

**NET-033 — Run a shadow evaluation and consenting candidate-only pilot.** Depends on NET-029–032. Collect minimal consented outcomes without automatic Internet-derived navigation; review errors independently and compare to frozen offline results. Acceptance: exposure, provider spend, data retention, cancellation and false-candidate handling stay within predeclared limits; no local browsing history is silently uploaded; the reported pilot sample supports only the measured population, not universal recovery.

**NET-034 — Authorize limited rollout and any later automatic eligibility.** Depends on NET-033 and NET-021. Keep candidate-only presentation as the first release. A later separate decision may enable automatic navigation for an authority-qualified subset after measured error/risk criteria, native permission acceptance and operator review pass. Acceptance: ranking confidence alone cannot flip the flag, signed review/owner-continuity provenance stays intact, a global/provider/family kill switch works, and unqualified cases remain choices or unknown.

**NET-035 — Operate source health, alerts, incident response and rollback.** Depends on NET-032–034. Track aggregate provider health, queue age, cached evidence age, spend, conflicts, rejected signatures and error categories without per-user browsing dashboards. Define credential rotation, provider shutdown, wrong-successor response, evidence invalidation and signed revocation propagation. Acceptance: an incident disables affected work without weakening trusted routing or deleting anti-downgrade history; expired evidence is not extended because a provider is down; a drill proves safe degraded operation.

**NET-036 — Schedule research followups from measured gaps.** Depends on NET-029 and NET-033; each subfeature has its own decision. Revisit the [idea register](INTERNET_DISCOVERY_IDEAS.md): additional providers, larger crawl indexes, passive DNS/CT/RDAP hints, multilingual extraction, owner enrollment/key rotation, opt-in community observations, graph/path compression and privacy-preserving lookup techniques. Acceptance: each selected idea has an explicit hypothesis, dependency, budget, threat model and evaluation slice; deferred or rejected ideas remain recorded rather than being represented as implemented.

## The next implementation slice

The immediately actionable slice is NET-001, NET-002, NET-004–006 and the replay-only part of NET-013, followed by the minimum queue/schema/isolation work needed to expose NET-024–026 against fixtures. Provider selection NET-003 proceeds independently. This yields a concrete contract and a reproducible first-time-dead-source demonstration without needing a paid account or asserting that live Internet search already works.

A replay/UI prototype does not complete NET-024–026 or waive their listed evidence/policy dependencies. Track partial deliverables explicitly; those tasks remain open until their full contracts and acceptance criteria pass.

The first live slice then requires NET-003, NET-007–017, the candidate-only subset of NET-018–024 and NET-025–032. It uses one approved official search adapter plus one archive-index adapter; the rest of the idea register remains optional. A deployable live feature needs real provider access, a budget, allowed source use and verified staging egress. Those are explicit implementation prerequisites, not requests to paste secrets into a conversation.

Do not build the entire idea register before testing the product hypothesis. The central experiment is whether bounded online investigation adds useful **first-time-dead-source candidate recovery** beyond the existing chain engine while keeping false identity suggestions, expense and disclosure within the agreed limits.

## Requirement-to-task checklist

| User or engineering requirement | Tasks that must demonstrate it |
| --- | --- |
| Enter the old address only | NET-002, NET-025–027, NET-030 |
| Do not ask the user to provide domain history | NET-006, NET-014–016, NET-025, NET-029–030 |
| Investigate the Internet for previously unseen replacements | NET-003, NET-013–017, NET-024, NET-032; replay-only work is not completion of this requirement |
| Explain why a candidate is likely related | NET-005, NET-019–020, NET-022, NET-026 |
| Find further moves and preserve useful learned evidence | NET-005, NET-012, NET-021–022, NET-027; preserve current local-chain behavior under NET-001 |
| Avoid treating copies or search popularity as identity proof | NET-019–023, NET-029, NET-031 |
| Keep manual mappings optional and distinct | NET-025–027; candidate discovery never requires a typed replacement |
| Protect signed withdrawals and intermediate chain origins | NET-021, NET-027, NET-031, NET-035 |
| Bound provider cost, network work and abuse | NET-004, NET-009–010, NET-012–017, NET-024, NET-031, NET-035 |
| Preserve existing clients, schemas and trust boundaries | NET-001–002, NET-007–011, NET-023–024, NET-030–032 |
| Document deployment and browser/Store changes | NET-008, NET-028, NET-032–035 |
| Distinguish implemented results from proposed research | All tasks; NET-029, NET-033 and NET-036 own the evidence/reporting gate |

## Relation to the original plan

| Earlier areas | This increment adds or clarifies |
| --- | --- |
| DISC-01, DISC-03, DISC-04 | Constrained adapter framework and actual search/archive/announcement integration, NET-003 and NET-013–016 |
| DISC-05, DISC-14; BE-06, BE-08 | Multi-source admission, durable phase leases, spend, cache/deletion and versioned public candidate results, NET-009–012 and NET-024 |
| DISC-06–13, DISC-16 | Reuse and extend safe fetch boundaries with real deployed checks; add candidate classification and evidence separation, NET-017–021 and NET-031–032 |
| DISC-15; BE-14 | Candidate suggestions remain separate from review, independent publication and trusted navigation, NET-021 and NET-023 |
| NOV-01–04; NOV-06 onward | Temporal evidence and special relation semantics now; owner bootstrap/rotation remains a separately gated followup, NET-005, NET-022 and NET-036 |
| TEST-01–14 | Reproducible first-time-dead-source evaluation, privacy/security/native journeys and pilot evidence, NET-006 and NET-029–033 |
| OPS-07–10, OPS-12–17 | Migration compatibility, deployed isolation, monitoring, disclosures and restricted rollout, NET-008, NET-028 and NET-032–035 |

This mapping describes planned work. It does not change any earlier task's completion status merely because it now has a more detailed implementation path.
