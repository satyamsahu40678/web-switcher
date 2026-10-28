# Automatic continuity, novelty and evidence

Updated 28 October 2026 (Asia/Kolkata).

Web Switcher's primary engineering goal is to find a current address **from an old address without asking the user to supply its replacement**. The browser follows explicit HTTP/metadata successor declarations, remembers their origin-only chain and can reuse a fresh successor after an earlier known host stops resolving. Manual mappings remain an override. The reviewed signed-registry system remains a separate authority rather than a prerequisite for this local browser flow.

This addresses the linked-list idea directly: observe A→B→C, preserve the edges, then check B/C when A is unavailable and learn C→D when that declaration later appears. It does not create a universal latest-domain service. An unseen D cannot be inferred when every known source is dead. Academic novelty and improved real-world recovery effectiveness have **not** been established.

The [complete plan](WEB_SWITCHER_PLAN.md), especially sections 3–4 and 16, records the original research question and dated source review. This report supersedes earlier descriptions that made the manual/reviewed mapping workflow the only delivered browser behavior. [Automatic continuity](AUTOMATIC_CONTINUITY.md) documents current mechanisms and limits. The [validation ledger](IMPLEMENTATION_STATUS.md) and exact-source CI runs record executed outcomes; test source alone is not a passing run.

## Implemented contribution and distinct authority lanes

The useful unit is a bounded continuity decision chain assembled from established techniques:

1. A user supplies an old HTTPS address or starts from the popup's current-origin prefill. No new-domain field is required.
2. A scoped browser probe inspects HTTP Location/Refresh, short HTML meta-refresh and explicit project successor metadata without executing the page's scripts. Manual fetch handling plus correlated webRequest headers exposes the proposed next hop before a separate permission-checked request.
3. A bounded local graph stores origin-only edges, evidence kinds and freshness. A qualifying failure of A can follow its unique fresh remembered A→B edge, then recheck B and later nodes. The result claims a reachable terminal only after checking it now.
4. The user can inspect the chain and open the found homepage, or explicitly enroll the old source for automatic following. On later selected-site visits, a packaged gate rechecks current enrollment, pause, permissions, the chain, sensitive-link policy and tab loop controls.
5. Manual source→destination choices and signed reviewed catalogs keep their separate provenance and precedence. Previously trusted signed aliases remain reserved after expiry, withdrawal or cache deletion, preventing fallback to weaker continuity authority. A source-declared observation never silently gains registry_reviewed or owner_verified status.
6. The optional backend can collect candidate observations under stronger server-side network isolation, independent review/publication and signed distribution. Its candidate-only output does not alter the local graph's trust class or automatically publish a route.

This composition and its recoverability/abstention behavior are the candidate engineering contribution. HTTP redirects, persistent links, graphs, signatures, approvals and leases all have prior art. No new cryptographic primitive, general domain-search algorithm or ownership proof is claimed.

### Concrete sequence and failure boundary

Suppose public documentation moves A→B→C. The extension initially discovers both explicit links and records their origins and times. A later DNS failure at A does not erase that knowledge: it can try the previously learned B link and continue until it checks C. If C later declares D, the chain can extend to D without the user entering D manually.

If C dies before C→D was observed, local memory supplies no D. A fresh conflicting A→attacker claim does not silently overwrite an unexpired A→B relationship. Unknown, stale, conflicting, looping or unsupported evidence produces a refusal/explanation. A live 200 page with no move declaration is not treated as proof that the old family moved, and a generic canonical link or similar logo is not a replacement-domain certificate.

A compromised old source can itself issue a plausible redirect. The source-declared lane remains unverified even when it is reachable and internally consistent. Users explicitly choose whether to open/follow it; independent review and pinned owner proofs remain different capabilities. Real public examples supplied in the conversation are not hardcoded production seeds or verified ground truth.

## Controls and executable evidence

| Implemented property | Source and executable checks | Evidence boundary |
| --- | --- | --- |
| The user supplies only the old address | [options UI](../extension/options.js), [popup](../extension/popup.js), [UI contract](../tests/continuity-ui.mjs), [native continuity journey](../tests/continuity-browser.mjs) | A mocked UI contract is not native permission acceptance. Final outcomes belong to the ledger/CI revision. |
| Every next network hop is inspected before a separate request | [probe](../extension/continuity-probe.js), [probe tests](../tests/continuity-probe.test.mjs), [native header-capture proof](../tests/continuity-probe-browser.mjs) | Browser literal URL checks are not DNS/connect-IP pinning. Scoped access and omitted credentials reduce authority; they do not prove historical identity. |
| Explicit metadata is bounded and non-executing | Probe parser/response bounds; hostile/inert/ambiguous metadata cases in probe tests | Arbitrary JavaScript, canonical/og guesses, ads and general web search are not supported migration authority. |
| Known old-host failures can reuse observed successor history | [graph](../extension/continuity.js), [graph tests](../tests/continuity.test.mjs), native continuity journey | Requires a unique unexpired link and a qualifying failure. It cannot invent a successor never observed. A stored terminal is rechecked before being presented as reachable. |
| A later last-node declaration extends a chain | Graph A→B→C then C→D cases and native journey | A time-bounded observational graph is not a complete ownership-transfer/mirror/split-site inference model. Conflicting successor claims stop resolution. |
| Selection and current policy govern automatic navigation | [controller](../extension/continuity-worker.js), [continuity gate](../extension/continuity-gate.js), graph/native journey, existing [worker tests](../tests/background.test.mjs) | Only enrolled sources receive continuity rules. Optional broad HTTPS access is explicit and off by default. Actual Chrome/Edge permission UX remains separate release acceptance. |
| No raw original path/query/fragment is transferred through a cross-domain continuity switch | Source normalization, homepage gate policy and sensitive confirmation; native continuity/legacy core checks | Continuing an unmoved original on its own origin can preserve its original URL. No complete all-flow privacy-capture claim follows from a few fixtures. |
| Manual imports cannot manufacture shared identity trust | [core](../extension/core.js), [core tests](../tests/core.test.mjs), [background tests](../tests/background.test.mjs) | Local intent is not website ownership. Manual/signed policy takes precedence for its exact source. |
| Signed catalogs reject forged/stale/conflicting data | [shared verifier](../packages/security/catalog.mjs), [security tests](../packages/security/catalog.test.mjs), [adapter tests](../tests/catalog-adapter.test.mjs) and native signed-routing suite | Trust anchors need trusted distribution; a compromised trusted signer can sign malicious data. |
| Reports/server observations do not activate signed routes | [registry](../backend/src/main/java/dev/webswitcher/api/Registry.java), [API tests](../backend/src/test/java/dev/webswitcher/api/ApiIntegrationTest.java), [real web journey](../apps/web/tests/e2e-browser.mjs), server discovery tests | Role separation requires genuine deployed identities/grants and a private publisher. Human review can be wrong or collusive. |
| Hardened server resolution remains separate | [fetcher](../fetcher/README.md), injected transport and authenticated internal endpoint tests | Internal /resolve supports HTTP/meta chains; /probe stays compatible. Deployed DNS/TLS/firewall controls are not established by mocked transports. Ordinary CONNECT proxy egress fails closed. |
| Owner records can be signed/checked offline | [owner CLI](../packages/security/owner-cli.mjs), [CLI tests](../packages/security/owner-cli.test.mjs) | Self-signatures do not enroll an owner, prove old/new domain control, or supply rotation/recovery/transfer. |

Fixture artifacts are deterministic engineering evidence, not a real website migration dataset or recovery-accuracy measurement. [Backup recovery](BACKUP_RESTORE_DRILL.md), [restricted worker identity](DISCOVERY_DATABASE.md) and [publisher keys](SIGNING_KEYS.md) support operational reproducibility; they do not establish research novelty.

## Threat model and remaining trust

| Failure/adversary | Implemented response | Remaining exposure |
| --- | --- | --- |
| Misleading page link, clone, parked source or changed ownership | Explicit supported signals only; source-declared label; bounded memory/conflict refusal; stronger reviewed lane remains separate | There is no general clone/parked-site classifier, threat feed or automatic historical owner proof. A compromised source can make a consistent malicious declaration. |
| Dead intermediate origin | Try a unique fresh remembered successor only for qualifying DNS/connection/timeout failure or explicit HTTP 404/410; check the next node now | Missing/expired history, TLS/CORS failure, HTTP denial/throttling or unseen final moves remain unresolved. |
| Hostile metadata or executable page | Inert bounded parsing, no arbitrary JavaScript execution, closed project JSON, separate manual-hop requests | Supported syntax is deliberately limited; obfuscated/script-only moves may not be discovered. |
| Credential/private URL exposure | Root-only initial probe, omitted cookies/HTTP credentials/referrer, origin-only stored graph and cross-domain homepage routing | Checked sites see IP/timing. The destination sees a normal navigation. User-entered reports and local origins can reveal interests. |
| DNS rebinding or private-network destination | Literal/reserved URL exclusions in browser; independent pinned-address/egress controls in the server lane | The browser does not offer the server's peer-IP pinning guarantee. Grant broader host access knowingly and verify server deployment separately. |
| Loop, stale history or resource exhaustion | Origin/URL visit sets, validity/time checks, request/hop/body/time/storage bounds, tab attempt guard | A device clock is not an independent time authority; production availability/capacity is unmeasured. |
| Catalog replay or signer compromise | Pinned ES256, high-water sequence/digest, expiry and withdrawal | New-profile trust bootstrap, key custody/recovery and offline revocation latency require operator policy. |
| Colluding reviewer/publisher or compromised owner key | Separate recorded roles, immutable release/audit mechanics and explicit trust labels | A valid authorized statement can still be false; independent witnesses and complete recovery remain unimplemented. |

The browser's source_declared class is an observation plus user opt-in. The registry_reviewed class is a published registry decision. Neither is a malware warranty or an owner signature. The schema's owner_verified class is not created by browser discovery or the standalone signing CLI.

## Relationship to prior work

The following comparisons reuse the first-party sources recorded on 25 October 2026 in the [original source register](WEB_SWITCHER_PLAN.md#24-source-register). They are scoped descriptions, not a new exhaustive literature search or an installed-product benchmark.

| Prior work or established mechanism | Overlap | What this project is investigating |
| --- | --- | --- |
| HTTP redirects and manually edited bookmarks | A known old address points to a known new address | Remembered successor edges or a separately distributed reviewed pointer can remain usable after an earlier redirect source disappears. Neither can discover an unseen successor from no evidence. Bookmarks themselves are not rewritten by the extension. |
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

Use the [root guide](../README.md), pinned dependencies and [cloud setup script](../scripts/setup-cloud.sh). From the repository root:

~~~sh
npm ci
npm test
npm run check
npm run package
node tests/continuity-probe-browser.mjs
node tests/continuity-browser.mjs
node tests/continuity-ui.mjs
npm --prefix apps/web ci
npm --prefix apps/web run build
./backend/mvnw -f backend/pom.xml verify
./backend/mvnw -f fetcher/pom.xml verify
~~~

Native extension tests require the locked Playwright browser and a policy that permits unpacked extensions; do not change a managed policy to force a pass. The regular UI contract uses mocked background responses and is labelled accordingly. The real browser chain tests exercise controlled sites, not current ownership of the public example.

The accurate project claim is: **source-only browser continuity discovery with explicit successor signals, bounded local linked memory, selected-site automatic rechecking, and a separate reviewed signed-registry lane.** General web search, universal dead-domain recovery, complete owner enrollment/rotation, full temporal identity inference, comparative scientific novelty and production release remain distinct work.

## Planned autonomous Internet discovery

The next proposed increment addresses first-time dead sources with no local migration history: public search/archive retrieval, historically anchored public references, bounded candidate observation, provenance grouping and independent authority checks. The [design](INTERNET_DISCOVERY_PLAN.md), [80-idea register](INTERNET_DISCOVERY_IDEAS.md), [36-task backlog](INTERNET_DISCOVERY_BACKLOG.md) and [evaluation/threat plan](INTERNET_DISCOVERY_EVALUATION.md) record the alternatives, next experiments and release gates. These are planning artifacts; this addition does not deliver live providers or establish recovery accuracy. The evaluation must compare the new lane with the existing chain engine and relevant relocation prior art before claiming scientific novelty or improved effectiveness.
