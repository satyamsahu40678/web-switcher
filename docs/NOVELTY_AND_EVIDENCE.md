# Continuity design, novelty and evidence

Updated 27 October 2026 (Asia/Kolkata).

Web Switcher's proposed contribution is a website-continuity workflow: preserve a reviewed relationship between an old hostname and a current destination, distribute a short-lived signed decision, and recheck that decision locally before navigation. Unknown relationships remain unknown while bounded discovery collects observations for review. The implementation combines these mechanisms in a runnable browser/API/worker system. Academic novelty and improved recovery effectiveness have **not** been established.

The [complete research plan](WEB_SWITCHER_PLAN.md), especially sections 3–4 and 16, contains the original research question and dated source review. This document describes the current implementation and the evidence needed for stronger claims. The [validation ledger](IMPLEMENTATION_STATUS.md) records executed outcomes and exact tested revisions; the presence of a test below does not imply that every future revision has passed it.

## What is distinctive in this implementation

The useful design unit is the complete decision chain, rather than any one cryptographic or browser primitive:

1. A hostname-only lookup returns an existing reviewed decision or abstains. Optional discovery creates a durable, bounded job.
2. A separate keyless worker asks an isolated authenticated fetcher for redirect observations. A cross-origin observation becomes a pending, explicitly unverified candidate.
3. A reviewer records a reason. A different actor must publish the pending decision before it can affect the signed catalog. Public reports, live responses and successful probes have no direct activation path.
4. The publisher produces immutable ES256 JWS bytes with a monotonically increasing sequence, expiry, exact aliases, terminal destinations, reason codes and a closed path policy. The client verifies a pinned public key and retains its sequence/digest checkpoint separately from disposable cache data.
5. The extension uses selected source permissions and a packaged local gate. At use time the gate rechecks current state, generation, validity, permissions, path handling and the tab's family loop guard. A catalog download does not grant permanent authority to navigate.
6. The user can pause switching, inspect origin-only receipts, remove mappings and request a narrowly scoped undo. Local overrides retain local-user provenance and cannot acquire registry or owner trust by import.

This composition is an engineering contribution and a candidate for evaluation. Signatures, mutable pointers, redirect rules, independent approvals, leases and abstention all have established precedents. No new cryptographic primitive, general replacement-domain discovery algorithm or proof of domain ownership is claimed.

### A concrete example

Suppose an operator moves public documentation from `old.example` to `current.example`. A live HTTP redirect is useful evidence, but a compromised or re-registered old domain could also redirect to an attacker. The discovery worker therefore queues a candidate and leaves public lookup at `unknown`. A reviewer checks independent continuity evidence; a separate publisher releases a bounded decision. Only then can a client with the intended trust anchor and source grant offer the reviewed destination.

For an approved `/docs/` path policy, a public documentation path can survive the switch while query and fragment data are dropped. An account/reset link or ambiguous encoded path stops for confirmation. A subsequent signed revocation or expiry removes routing authority. A client that remains offline can learn no new revocation until refresh; the existing decision's validity window is its upper bound.

This example is illustrative. The repository's tests use controlled `.test`/`.example` fixtures and do not establish the ownership or safety of any public site named in the historical plan.

## Implemented controls and executable evidence

| Claim supported by the implementation | Source and checks | Limit of the evidence |
| --- | --- | --- |
| Only exact, currently authorized source navigation is eligible | [core routing](../extension/core.js), [worker](../extension/background.js), [core tests](../tests/core.test.mjs), [background tests](../tests/background.test.mjs); native browser B02–B17 in [browser suite](../tests/browser.mjs) | Native fixture source grants are pregranted. Actual optional permission prompts, branded Chrome/Edge and store installs need separate acceptance. |
| Browser actions can use short-lived data without treating stale DNR rules as authority | Gate checks expiry, clock reversal, pause and generation; core tests and native B08–B10 | The machine clock is not an independent time authority. An expired rule can still open a gate which must refuse navigation. |
| A signed alias cannot bypass privacy/path checks or manufacture trust for a local override | [catalog adapter](../extension/catalog-adapter.js), [adapter tests](../tests/catalog-adapter.test.mjs); native B12–B13 and B18 | Query/fragment removal and origin-only receipts are checked in controlled flows. This does not substitute for a full release network-capture/privacy review. |
| A family with several aliases shares tab-local loop protection | Background tests `signed aliases share a per-family loop guard` and `manual and confirmation previews...`; native B14 exercises a destination return | This bounds a tested browser loop; it is not general cycle detection across the internet. |
| A forged, stale or conflicting catalog is refused before installation | [shared verifier](../packages/security/catalog.mjs), [security tests](../packages/security/catalog.test.mjs), background atomic-install/high-water tests | Public trust anchors must be installed through a trusted distribution channel. A compromised trusted signer can issue authentic malicious records. |
| A candidate/review does not activate a route | [registry](../backend/src/main/java/dev/webswitcher/api/Registry.java), [API integration tests](../backend/src/test/java/dev/webswitcher/api/ApiIntegrationTest.java), [real browser end-to-end](../apps/web/tests/e2e-browser.mjs) | Separation of application actors needs matching deployed identities, private publisher ingress and DB grants. Human review can still be wrong or collusive. |
| Discovery output stays unverified, including after successful work | [queue](../backend/src/main/java/dev/webswitcher/api/DiscoveryQueue.java), [client](../backend/src/main/java/dev/webswitcher/api/DiscoveryClient.java), [queue tests](../backend/src/test/java/dev/webswitcher/api/DiscoveryQueueTest.java), [integration test](../backend/src/test/java/dev/webswitcher/api/DiscoveryIntegrationTest.java) | Integration uses a real HTTP internal-contract fixture. It asserts a pending candidate, no public destination and byte-identical catalog; it does not contact a real migrated site. |
| Queue work has durable cost/concurrency bounds | Queue tests cover deduplication, negative cache, pre-dispatch hourly/daily/host budgets, leases, stale owners, retries and TTL; client tests cover fixed endpoint/no internal redirect and bounded closed-schema responses | These are configured ceilings and correctness checks, not measurements of production capacity, cost or availability. |
| Public API, discovery worker, fetcher and signer can have different authority | [worker boundary tests](../backend/src/test/java/dev/webswitcher/api/DiscoveryWorkerBoundaryTest.java), [production boundary test](../backend/src/test/java/dev/webswitcher/api/ProductionBoundaryTest.java), [deployment role tests](../infra/deploy/test-db-grants.py), opt-in [worker grants](DISCOVERY_DATABASE.md) | Docker/process configuration alone does not establish host isolation. Operators must provision distinct secrets, grants and network boundaries. |
| A malicious redirect cannot become an unrestricted fetch request | [fetcher source/tests](../fetcher/src/), including public-address/mixed-DNS/rebinding/redirect/actual-socket checks | Tests use injected safe transports and loopback internal API fixtures. Deployed direct public DNS/TLS and network/firewall enforcement remain required. Ordinary CONNECT proxy egress fails closed. |
| Experimental owner records bind a pinned key's ordered history | [owner CLI](../packages/security/owner-cli.mjs), [CLI tests](../packages/security/owner-cli.test.mjs), verifier owner-context/genesis/previous-hash tests | A self-signed record does not enroll an owner or prove control of old/new domains. Rotation, transfer, loss and recovery are not implemented. |

Run results and fixture artifacts belong to a specific source revision. CI artifacts include reports under `test-results/`; they are not a dataset of real website migrations. See [backup drill evidence](BACKUP_RESTORE_DRILL.md) and [publisher key handling](SIGNING_KEYS.md) for operational controls that support reproducibility but do not establish discovery novelty.

## Threat model and remaining trust

| Adversary or failure | Implemented response | Remaining exposure |
| --- | --- | --- |
| Clone, parked domain, misleading redirect or malicious report | Observation/report stays unverified; independent review and publication precede routing | There is no implemented general clone/parked-site classifier, threat feed or automated historical identity proof. |
| Old catalog replay, same-sequence replacement or expired mapping | Pinned signature verification, sequence/digest memory, closed schemas and use-time expiry | New-profile bootstrap, trusted-key distribution, device clock error and signer compromise still need operational policy. |
| Configuration update races or stale gate | Serialized writes, generation check, atomic catalog activation and confirmation bound to exact current destination | Actual browser suspension/races outside the tested matrix remain release work. |
| Sensitive URL passed to a different origin | Hostname-only explicit lookups; bounded local envelopes; query/fragment removal; sensitive/ambiguous path confirmation | The destination sees the selected cleaned URL. Origin receipts, IP-based abuse controls and user-entered reports can still reveal information. |
| SSRF, DNS rebinding or internal credential forwarding | Separate fetcher, public-address and connected-socket checks at each hop, TLS hostname verification, bounded responses, fixed internal client endpoint | Production firewall and actual egress tests are prerequisites. The internal bearer authenticates a service, not its evidence's truth. |
| Stalled/crashed worker or resource exhaustion | Durable budgets, expiring lease, stale-owner exclusion, retry ceiling, TTL and bounded response/time limits | Queue service and operations need monitoring; no production SLO follows from local tests. |
| Compromised publisher/owner key or dishonest authorized reviewer | Role separation, immutable releases/audit, expiry and signed withdrawal; offline key tooling | An authorized malicious statement can verify correctly. Independent witnesses, key recovery and an incident drill remain needed. A single audit log is not consensus. |

The registry's `registry_reviewed` class means a recorded review was published by the configured registry. It is not a claim of malware freedom, legal authorization, owner-signed continuity or future content safety. The schema can represent `owner_verified`, but the current publisher does not create that class from the offline CLI or discovery output.

## Relationship to prior work

The following comparisons reuse the first-party sources recorded on 25 October 2026 in the [original source register](WEB_SWITCHER_PLAN.md#24-source-register). They are scoped descriptions, not a new exhaustive literature search or an installed-product benchmark.

| Prior work or established mechanism | Overlap | What this project is investigating |
| --- | --- | --- |
| HTTP redirects and manually edited bookmarks | A known old address points to a known new address | A separately distributed reviewed pointer can remain usable after the original redirect disappears. It cannot discover an unseen successor from no evidence. Bookmarks themselves are not rewritten by the extension. |
| [Redirector](https://github.com/einaregilsson/Redirector) and [Dynamic Domain Redirector](https://addons.mozilla.org/en-US/firefox/addon/dynamic-domain-redirector/) | Configured URL/domain rewrite rules | Integrate expiry, trust provenance, reviewed publication and local navigation checks. Simple configured redirects are prior art. |
| [LibRedirect](https://github.com/libredirect/browser_extension) and its [instance registry](https://github.com/libredirect/instances) | Browser extension plus maintained endpoint data | Represent continuity of one site family across domains. Alternative frontends and mirrors are not automatically the same identity relationship. |
| [FABLE, IMC 2023](https://conferences.sigcomm.org/imc/2023/program/) and its [artifact](https://github.com/JingyZhu/FABLE) | Automatic relocation of broken links using learned URL transformations | Evaluate cross-domain continuity, temporal trust and controlled abstention alongside a browser deployment. FABLE has not been reproduced or outperformed here. |
| [Memento (RFC 7089)](https://www.rfc-editor.org/info/rfc7089/) and [Wayback recovery](https://blog.archive.org/2017/01/13/wayback-machine-chrome-extension-now-available/) | Recover historical resource states after a link fails | A live current endpoint needs separate identity evidence; archived content does not prove the current operator. Archive integration is not implemented. |
| [IPNS](https://docs.ipfs.tech/concepts/ipns/), [DID Core](https://www.w3.org/TR/did-core/) and [AT Protocol identity](https://atproto.com/specs/handle) | Stable identities, keys and changing service locations | Apply established identity lessons to ordinary legacy HTTP links. The experimental Site Passport is a project-specific record, not a new standard or trust bootstrap. |

The spider/thread theme is product presentation. ES256/JWS, hashes and the relational job queue are established techniques. A patentability, freedom-to-operate or globally first-product conclusion would require a separate review.

## What would establish a research contribution

The original hypothesis asks whether a dated migration graph, optional owner proofs and local navigation safeguards recover more correct live destinations at a fixed harmful-switch rate than simpler methods. The current implementation supplies parts of the experimental apparatus; it has no comparative result yet.

1. Build a versioned, consented/appropriately sourced migration dataset with dated evidence and independently reviewed identity ground truth. Include true moves, same-site mirrors, name collisions, dead sites without successors, domain re-registration and hostile copies.
2. Hold out entire families and future time periods. Historical recovery must not use announcements, archives or owner keys unavailable at the evaluation cutoff.
3. Compare manual/static mappings, live redirect chains, remembered-next pointers and compressed approved histories; reproduce a feasible search/similarity or FABLE-inspired baseline with disclosed adaptations.
4. Ablate temporal evidence, previously enrolled owner proofs, abstention and scheduling separately. Compare at matched risk/coverage and account for evidence/review/probe cost.
5. Report raw wrong/harmful switch counts, precision, coverage, abstention, recovery delay, request cost and uncertainty intervals. Report unsupported cases and failed hypotheses, including compromised-key scenarios.
6. Evaluate explanation comprehension and privacy with informed participants and captured network behavior. Obtain consent and define retention before collecting real browsing data.

The historical local HTTP experiment demonstrates why remembered shortcuts and a separately delivered trusted update can help under controlled failures. Its 19 expected outcomes include refusals, unsuccessful recovery and acceptance of a compromised legitimate key. Those outcomes are not a 100% recovery or safety rate. There is no published dataset, owner pilot, matched baseline study or measured improvement in this repository.

## Reproduce the implemented checks

Use the versions and prerequisites in the [root guide](../README.md) and [cloud setup script](../scripts/setup-cloud.sh). From the repository root:

```sh
npm ci
npm test
npm --prefix apps/web ci
npm --prefix apps/web run build
npm --prefix apps/web run test:browser
./backend/mvnw -f backend/pom.xml verify
./backend/mvnw -f fetcher/pom.xml verify
```

For native extension navigation, install the locked Playwright Chromium as described in the repository guide, then run `npm run test:browser`. This needs a runner that allows unpacked extensions; do not change a managed browser's policy to force it. The website contract suite uses mocked responses; it differs from the real stack browser suite run by the `stack-e2e` CI job.

For deployment-role and recovery checks, use [deployment instructions](DEPLOYMENT.md), [discovery instructions](DISCOVERY.md), [worker database instructions](DISCOVERY_DATABASE.md) and the [encrypted recovery drill](BACKUP_RESTORE_DRILL.md). Enabling a worker requires a deliberately provisioned fetcher network and identities. Default local API behavior leaves discovery disabled.

The accurate current project claim is: **an implemented and testable reviewed-continuity workflow with signed distribution, local navigation safeguards and bounded candidate-only redirect observation.** Broad dead-link discovery, owner enrollment/recovery, temporal graph inference, demonstrated comparative novelty and production release remain separate work.
