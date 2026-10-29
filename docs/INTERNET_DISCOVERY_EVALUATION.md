# Internet discovery: evaluation, threats and release evidence

**Implementation update, 29 October 2026:** Controlled engineering tests now cover the archive/search implementation; [the status matrix](INTERNET_DISCOVERY_STATUS.md) and [evidence ledger](IMPLEMENTATION_STATUS.md) record their scope. This evaluation proposal still reports no live migration dataset, calibrated recovery accuracy, consenting-user pilot or scientific novelty result.

Planning document, 28 October 2026 (Asia/Kolkata). **The Internet search layer described here is proposed work. This document does not report new executed tests, a live website dataset, measured accuracy or a deployed service.** Current implementation results remain in [the validation ledger](IMPLEMENTATION_STATUS.md).

Use this with the [implementation plan](INTERNET_DISCOVERY_PLAN.md) and [idea register](INTERNET_DISCOVERY_IDEAS.md). The existing [local chain](AUTOMATIC_CONTINUITY.md), [server candidate queue](DISCOVERY.md), [architecture](ARCHITECTURE.md) and [novelty report](NOVELTY_AND_EVIDENCE.md) define the starting boundaries.

## 1. Question to test

The primary experiment is: **given only an old website origin, with no destination supplied and no local continuity history, can Internet evidence identify its current successor with useful coverage while refusing unsupported identity claims?**

Three different outcomes must be measured separately:

1. **Discovery:** was the true successor included in a bounded candidate set?
2. **Identity decision:** does the available evidence support that relationship at the requested time?
3. **Availability and navigation:** is that exact destination reachable now, and does current browser policy permit opening it?

An HTTP 200, a similar logo, shared certificate, common host, matching content or high search rank does not answer the identity question. An archive can recover historical content without identifying a live successor. A reachable successor can subsequently become unavailable. The evaluation must retain those distinctions.

### Required journeys

| ID | Starting condition | Expected behavior to evaluate |
| --- | --- | --- |
| J01 | First installation; old A is dead; public evidence identifies current D | Discover candidates without local history or manual destination entry; explain dated evidence; apply the appropriate navigation authority |
| J02 | A→B→C history exists; C later announces D | Reuse the implemented chain lane; Internet search should add value only when needed |
| J03 | A/B/C are dead; a dated independent announcement identifies D | Retrieve public evidence and distinguish historical C from current D |
| J04 | A is temporarily unavailable and has not moved | Abstain from asserting migration; a failure alone supplies no successor |
| J05 | A is re-registered and now points to an attacker | Do not treat the new controller's claim as proof of the old site's continuity |
| J06 | Two live mirrors or a split into multiple successor organizations | Explain multiple relationships; do not manufacture a single latest destination |
| J07 | Only archived content can be found | Offer clearly labelled archive recovery if supported; do not label it a current live site |
| J08 | No evidence survives anywhere available to the configured providers | Return unknown after bounded work, without asking the user to know a replacement |
| J09 | A signed alias is revoked, expired or reserved anywhere in a discovered chain | Preserve existing stronger-authority barriers; web search cannot bypass them |
| J10 | Evidence appears while a job is running, or disappears before the user opens a result | Version the result, recheck authority and reachability at use time, and refuse stale confirmation |

J01 and J03 are the missing Internet-discovery capability. Passing J02 alone must never be reported as completing that capability.

## 2. Ground truth and data collection

### 2.1 Record the relation, time and availability separately

Each labelled case needs a family identifier, old origin, relevant dates and one of these relationship labels:

| Relationship label | Meaning |
| --- | --- |
| `successor` | A reviewed continuation of the same site/operator relationship at the evaluation time |
| `mirror` | A simultaneous alternate endpoint; not necessarily a later replacement |
| `split` / `merge` | A non-linear relationship requiring an explicit explanation |
| `archive_only` | Historical content exists, with no established current live endpoint |
| `unrelated` | Similarity or links do not establish continuity |
| `takeover` | Current control/content differs from the historical identity |
| `unknown` | Available evidence cannot support a reliable label |

Store current availability separately: `reachable`, `unreachable`, `access_denied`, `challenge`, `parked`, `soft_404` or `unknown`. Also record assessment time and evidence limitations. A CAPTCHA or parked advertising page is not a successfully checked content destination merely because it returns 200. A genuine successor behind a challenge remains an identity candidate with unconfirmed availability.

Do not force unresolved cases into positive/negative labels to improve a score. Unknown truth is a separate stratum and must remain visible in reports.

### 2.2 Build the first dataset deliberately

1. Start with controlled fixture families and consenting operators. Give the evaluator dated old/new domain-control and migration records; give the discovery system only the old origin and permitted public inputs.
2. Add a documented sample of public migrations only where collection, retention and redistribution are permitted. Record selection criteria so successful, popular or well-indexed migrations are not the only examples.
3. Include temporarily down sites, permanent closures without successors, non-Latin names, IDNs, unrelated same-name sites, cross-brand migrations, changes in both brand and domain, registrable-domain/subdomain moves and moves through multiple operators.
4. Add hostile and ambiguous negatives deliberately: copied pages, parked/re-registered domains, typosquats, Unicode confusables, fake migration announcements, stale official profiles, mirrors, mergers, splits and shared hosting/certificates.
5. Keep synthetic, consented live and observational public cases as separate cohorts. Synthetic success validates mechanics, not Internet recovery effectiveness.
6. Record source licensing, collection permission, terms/robots requirements, any allowed archive redistribution and deletion requests. If full content cannot be retained, keep permitted identifiers/digests and a reproducible access description; do not silently copy restricted material.

The public-domain example supplied by the user is **not established ground truth**, an approved pilot subject or a production seed. It can enter a study only after the same independent evidence and collection review as any other case.

### 2.3 Review without teaching the resolver the answer

Use two independent reviewers who inspect dated authoritative material and record their reasoning before seeing the system's ranking. A third reviewer adjudicates disagreements; preserve unresolved disputes instead of silently resolving them in the system's favor. Report reviewer agreement and exclusion counts.

Prefer time-bounded operator records, previously established keys/control relationships and independently attributable announcements. Current ownership of the old domain, a fresh self-signed key or a matching TLS certificate cannot establish historical ownership by themselves. A redirect is a source declaration; it is not automatically a gold ownership label.

Keep the private answer manifest outside provider queries, candidate indexes, model prompts, fixtures visible to the resolver and public training material. Reviewers may know D; the J01 resolver must receive only A. Labels and inaccessible operator evidence support evaluation, not hidden product functionality.

### 2.4 Prevent temporal and family leakage

- Record at least `claimEffectiveAt`, `sourcePublishedAt` when reliable, `archivedAt`/`indexedAt`, `retrievedAt` and `assessedAt`. Unknown dates stay unknown; an archive capture timestamp is not automatically the publication date.
- Define a decision cutoff `T`. An offline reconstruction of what could be known at T may use only evidence available by T. A snapshot captured later cannot be presented as a historical success at T.
- For a separate present-day recovery experiment, use today's available evidence and label the evaluation date honestly. Do not compare it with historical baselines restricted to older indexes.
- Split development, calibration and final holdout data chronologically. Also group all aliases, mirrors, related operators and chain nodes from one family into one partition. A→B in training and B→C in testing leaks identity information.
- Keep an additional unseen-family holdout to test generalization. Do not tune thresholds, source weights or query templates against its results.
- If an external model or index may already contain the answer, record that exposure limit. A public benchmark can measure a deployed system's utility, but cannot prove learning without answer memorization.

## 3. Provenance and independent evidence

An evidence ledger should retain a bounded source identifier, observed claim, source/controller attribution where known, date fields, extraction method/version, permitted digest/excerpt, candidate relation and reasons for acceptance or rejection. Treat provider responses and fetched pages as untrusted input.

Multiple URLs do not necessarily mean multiple independent witnesses:

| Apparent corroboration | Required treatment |
| --- | --- |
| Two search engines index the same announcement | One underlying claim; record two retrieval channels |
| Ten scraped pages repeat a source's migration text | Cluster as one copied claim, not ten votes |
| Search snippets cite each other or cite the proposed new site | Detect circular support; no independent historical anchor |
| Several certificates share an issuer, CDN or SAN hosting configuration | Infrastructure correlation, not operator identity |
| Multiple profiles are controlled through one compromised account | Correlated authority; document the shared failure domain |
| New site copies content, analytics IDs, favicons and footer links | Similarity features only; copying does not supply independent control |
| Old and new domains sign with an established pinned key | Potential authority evidence, subject to bootstrap, time, rotation, revocation and compromise policy |

Evaluate an evidence-dependence graph, not only a count of supporting pages. Report how ranking and coverage change when duplicate/correlated claims collapse. A high rank from duplicated evidence must not become an ownership assertion.

## 4. Navigation policy under evaluation

Preserve the distinction between the existing explicitly opted-in `source_declared` chain behavior, user-configured overrides, signed registry decisions and any future owner-verification lifecycle. This plan does not silently change existing trust semantics or make search results signed decisions.

For the **new open-web discovery lane**, the recommended initial policy is:

- Search and similarity may generate and rank candidates. They do not authorize automatic cross-domain navigation.
- Explain candidate evidence and allow an explicit user choice. Record that choice as local user intent, without upgrading it to owner/registry verification or shared publication.
- Automatic navigation requires a separately defined, current authority condition: for example, a valid reviewed catalog decision or a properly enrolled, historically anchored owner-continuity proof. Complete bootstrap/rotation/recovery semantics before claiming the latter exists.
- A statistical confidence score can help decide which suggestions to show or when to abstain. A score such as 0.9 is not a permission to navigate and must not be advertised as a verified 90% chance of ownership without calibration evidence.
- Apply signature/reservation policy to **every encountered origin**, including intermediate candidates and terminals, before/after external work and immediately before navigation. Search cannot route around withdrawal, expiry, stale confirmation, current permission changes or a user forgetting a source.
- Continue the existing homepage-only cross-origin policy and sensitive-link confirmation. A candidate's deep-page URL does not authorize transferring a private original path, query or fragment.

An eventual research pilot of automatic search-derived decisions needs a separately approved, measurable authority policy and loss budget. Do not enable it merely because candidate recall is high.

## 5. Metrics that cannot hide wrong hops

Publish counts and denominators for each cohort, evidence class, language, domain type and failure class. Include unavailable/provider-limited cases; do not quietly remove them from the primary user-success denominator.

| Metric | Definition and purpose |
| --- | --- |
| Candidate recall@K | Share of eligible cases with a known true successor in the first K candidates. Report K, provider budgets and cases where the true successor was discoverable under the evidence cutoff |
| End-to-end correct suggestion coverage | All submitted cases that yield an identity-correct, sufficiently explained suggestion divided by all submitted cases; report truth-unknown cases separately |
| Suggestion precision | Identity-correct suggestions divided by suggestions judged against known truth; unrelated/takeover/incorrect-mirror choices are errors |
| Automatic-route precision | Identity-correct routes divided by all automatically authorized routes. Keep this separate from suggestions and user-selected manual choices |
| Wrong-hop rate | Cross-identity automatic routes divided by all automatic routes; also report wrong hops per submitted lookup and their severity |
| Abstention/ambiguity rate | Unknown, insufficient evidence, contradictory evidence and multiple valid relationships, each with its own count |
| Risk–coverage curve | Error rate as the system accepts more decisions; disclose how stricter abstention changes usefulness |
| Availability accuracy | Whether a claimed reachable terminal actually serves the checked endpoint; separate challenge/parked/soft-404 and later outages |
| Freshness and recovery delay | Time between supported migration evidence becoming available and a correct result; measure stale-suggestion persistence and withdrawal delay |
| Provenance quality | Fraction of suggestions with inspectable dated claims, non-circular support and correct attribution; audit samples for copied-source inflation |
| Latency | p50/p95 and tail timeout rate for complete jobs, including queued/provider work; report warm/cold and cached/uncached separately |
| Resource/cost | Queries, fetched origins/bytes, tokens if used, retries and measured cost per lookup/correct suggestion. Record provider pricing/configuration at measurement time |
| Privacy exposure | Number and identity of third parties receiving a hostname; emitted query fields; retained identifiers/content; opt-in and deletion behavior |
| Stability | Ranking/result changes for repeated equivalent inputs and after provider order, locale or outage changes |

Do not describe every abstention as a correct recovery. Do not call candidate recall navigation accuracy. Do not use HTTP success as the identity label.

### Confidence intervals and release thresholds

Choose the acceptable wrong-hop loss budget and operating cohort **before** evaluating the holdout. Report confidence intervals, not only point estimates. Use an appropriate one-sided binomial bound for route errors and family-cluster resampling or another justified dependence-aware analysis when observations share families/sources.

Zero observed errors do not prove zero risk. As an illustration only, the rough “rule of three” gives an upper 95% error bound of about 3/n after n independent zero-error trials; a target below 0.1% would need roughly 3,000 independent decisions even under those assumptions. Correlated cases reduce effective evidence. These numbers are not this project's selected release threshold, a claim of collected samples or a substitute for authority checks.

Freeze the operating policy after calibration. If the final holdout changes the policy, treat that holdout as development data and obtain a new untouched evaluation set.

## 6. Experiment matrix and reproducibility

| Experiment | Baseline/comparison | Required observation |
| --- | --- | --- |
| E01: first-time dead source | Current local-chain build with empty storage vs proposed discovery | Incremental correctly identified suggestions; unknown stays unknown when no evidence survives |
| E02: known-chain recovery | Current chain vs search-enabled hybrid | No regression in current recovery, policy or privacy; measure unnecessary external queries |
| E03: simple live move | Browser's normal redirect handling vs current chain vs hybrid | Distinguish work ordinary navigation already performs from added value |
| E04: top search result | Naive top-result selection in an offline harness only vs evidence policy | Quantify wrong identities/SEO poisoning; never enable this unsafe baseline as public auto-navigation |
| E05: manual supplied destination | Human/user-known mapping as a labelled reference | Report the extra information supplied; do not call this a source-only baseline |
| E06: search/archive/link-source ablations | Each provider family alone, combinations and leave-one-source-out | Candidate recall, independence, marginal cost and failure sensitivity |
| E07: similarity/LLM ablations | Lexical/content features vs optional model extraction/ranking | Hallucinated domains, injection susceptibility, calibration, dependency on copied content and measured cost |
| E08: temporal graph | Current single-successor memory vs proposed dated multi-source evidence | Stale current-domain errors, takeover detection, mirror/split handling and date uncertainty |
| E09: authority policy | Suggestions only vs separately eligible current authority | Wrong-hop bounds and coverage; a model score alone never crosses the authority boundary |
| E10: hostile and outage cohorts | Normal evidence vs duplicates, poisoning, provider failure and quota exhaustion | Bounded work, explainable abstention and no trust downgrade under pressure |
| E11: privacy modes | Local chain only vs configured online lookup consent | Query exposure, usable coverage, deletion and cost differences |
| E12: time-to-use change | Result at lookup vs new withdrawal/permissions/destination state before open | Revalidation stops stale or unauthorized navigation |

Archive each run's immutable code/configuration hashes, dataset and split version, decision cutoff, source-policy version, query templates, provider/adapter versions, locale, budgets, raw-to-normalized evidence IDs, ranking model/version, random seed where relevant and evaluation script version. Save allowed response replays so offline tests can run without unstable live-provider results. Redact credentials and sensitive user data before retaining artifacts.

For **origin continuity**, full original URLs must not be sent to providers. Use the normalized old origin/hostname and permitted public identity terms; benchmark inputs with path/query/fragment must verify their removal. When studying deep-page relocation as a future separate project, use an approved public-page dataset with masked/synthetic sensitive parameters and explicit scope. Do not compare masked-input results with a baseline given unmasked private URLs.

## 7. Threat model and required failure behavior

| Threat | Attack or failure | Required control and test |
| --- | --- | --- |
| SEO poisoning and copied evidence | Attacker dominates results with mutually copied “new official domain” claims | De-duplicate provenance, retain historical anchors, show uncertainty; never equate rank/vote count with authority |
| Re-registration/takeover | Current old-domain controller differs from historical operator | Temporal identity/control checks; takeover cohort; historical source declaration cannot become a timeless owner proof |
| Mirror/brand confusion | Shared branding, common names, franchises, merger/split or regional site | Explicit relationship labels and multiple-result states; no forced unique successor |
| Certificate/DNS correlation abuse | Shared CDN, registrar, IP, SAN or public suffix creates false matches | Weak features only; negative controls with shared infrastructure and unrelated operators |
| Search/archive freshness | Stale indexes point to another retired or compromised hop | Preserve capture/claim/retrieval times, chain bounds and current terminal checks; do not rewrite dates |
| Circular/colluding witnesses | Several provider pages originate in one compromised statement | Attribution/dependence clusters, cross-source audit and a no-self-corroboration rule |
| Parser/model prompt injection | Retrieved text instructs tools to ignore policy or send secrets | Treat text as data; bounded inert parsing/closed model output; no retrieved instructions controlling network/tools; do not put provider keys/private URLs in prompts |
| Malicious candidate URL | Credentials, alternate encodings, non-HTTPS, custom ports, downloads or sensitive paths | Normalize before any request; reuse and extend URL-policy tests; reject unsupported forms |
| SSRF/DNS rebinding | Search results, archive metadata or redirects target metadata/private/application networks | Revalidate every hop and all DNS answers, pin allowed peers on the server, maintain TLS hostname checks and independent public-only egress. Test TOCTOU and mixed public/private answers |
| Browser network limitations | A public-looking name resolves to a private address | Preserve the documented inability to pin browser peers; no server-grade claim. Prefer isolated server probing for untrusted candidate expansion |
| Origin/history disclosure | Search operators or service logs learn sensitive interests | Explicit online-mode disclosure/consent, origin-only inputs, minimum providers, no browsing-history upload and bounded retention |
| Stored content exposure | Snippets, fingerprints or logs contain personal/copyright-restricted content | Minimize retained data, honor collection rights, access-control evidence, bound excerpts and test deletion/export behavior |
| Job/reference abuse | Enumeration, polling, bot traffic or intentionally expensive queries | Unguessable scoped job references, authorization/isolation, durable per-client/global budgets, fair queues, TTL and poll backoff |
| Provider quota/cost exhaustion | Outage or hostile input fans out to many providers/candidates | Charge before work, hard fanout/bytes/time/cost caps, bounded retries and circuit breakers; return partial/unknown with reasons |
| robots/terms/access controls | CAPTCHA, authentication or provider restrictions prevent a crawl | Refuse or use an approved supported API; no credential scraping, CAPTCHA bypass, hidden full-browser execution or proxy evasion |
| Trust downgrade/race | A reserved intermediate alias becomes revoked while another hop is probed | Recheck every chain origin, signature/current policy, permission/enrollment and confirmation generation immediately before release |
| Candidate-to-publication escalation | A worker result or user click becomes an active signed mapping | Preserve candidate-only worker privileges, review/publication separation and immutable audit; test byte-identical active catalog after discovery |
| Compromised provider/model/operator | Credible-looking results or valid authorized statements are false | Source-specific blast-radius limits, revocation/kill switches, independent review and explicit residual risk; signatures are not a content-safety warranty |

Privacy tests must recognize that deterministic hostname hashes are dictionary-reversible for common domains. If pseudonymous budget keys are needed, specify keyed hashing and key rotation/access controls; do not advertise anonymity. A server proxy can hide a browser IP from a search provider while the service itself still observes the lookup. State both disclosures.

## 8. Test layers to implement

| Layer | Proposed executable coverage | Evidence it cannot supply |
| --- | --- | --- |
| Unit/schema | Closed provider replies, duplicate/trailing JSON, Unicode/IDN and origin normalization, date/freshness uncertainty, correlation clustering, scoring/abstention, budgets, permission/trust barriers | Real-provider availability or real ownership accuracy |
| Property/fuzz | URL/parser adversarial forms, graph cycles/conflicts, bounded fanout, ambiguous claims, deterministic output and no score-based authority escalation | An exhaustive proof that all hostile websites are safe |
| Replayed provider contract | Recorded permitted successes/empty results, errors, malformed payloads, pagination, schema drift, quota headers, missing timestamps and response limits | Today's search indexes, quotas or provider terms |
| Isolated server integration | Real queue→adapter→fetcher→candidate flow; auth, DNS/peer pinning, redirect/robots/body/time caps; API and worker still cannot publish | Deployed firewall enforcement or production capacity |
| Native browser integration | Source-only search invocation, progress/cancel, permission denial/revocation, candidate explanations, explicit choice, stale result prevention, homepage/privacy routing and no hidden history upload | Optional-permission UX in every Chrome/Edge version or public Store approval |
| Full-stack acceptance | New-install empty storage + dead source + provider evidence discovers D; restart/retry/cancel; separate lookup job ownership; unchanged signed catalog without publication | Recovery of arbitrary websites from no surviving evidence |
| Fault injection | Provider timeout/429/5xx, worker crash/lease takeover, clock changes, stale cache, partial writes, DNS rebinding, revoked key or forgotten site mid-job | All possible production failures |
| Red-team corpus | Clones, fake announcements, circular citations, prompt injection, parked/re-registered domains, misleading live terminals and compromised sources | A universal phishing/malware guarantee |
| Provider canary | Small fixed consented fixtures, schema/latency/quota/freshness checks under a hard budget | System-wide identity precision or unbiased Internet coverage |
| Consented pilot | Real user journeys with separate opt-in, incident reporting, bounded cohorts and independent adjudication | Broad deployment readiness without the release criteria below |

Budget tests must consume the implementation plan's versioned proposed limits, rather than duplicate a second configuration: search/archive calls, candidate origins, all robots/redirect/metadata requests, per-origin paths, global/per-registrable-domain concurrency, decompressed per-response/whole-job bytes, active/job deadlines and renewable fenced leases. Check exact-boundary refusal, reservations before work, compressed expansion, cancellation, retries and restarted workers; exhausted budgets may reduce coverage but never relax authority. These defaults are proposals to measure, not validated production capacity.

Each test artifact must identify source SHA, target configuration, number of intended/executed cases, passes/failures/skips and scope. Failure collection should retain bounded diagnostics without credentials. Existing native header-ordering, source-state race, reserved-intermediate and private-URL regressions remain required; adding Internet discovery must not replace or weaken them.

## 9. Release gates, rollout and rollback

| Gate | Required reviewable evidence |
| --- | --- |
| G0: specification | Source contracts, evidence/decision schemas, allowed relationships, authority rules, privacy data flow, budgets and provider-dependent assumptions approved and versioned |
| G1: mechanics | Unit/replay/fault tests and full-stack J01/J03 pass; no manual destination or hidden seeded answer; existing behavior remains green |
| G2: network boundary | Independently verified deployed public-only egress, peer/DNS/TLS checks, credential separation, access-control/robots behavior and bounded external cost |
| G3: evidence quality | Independent labels, date/family-safe splits, provenance-dependence audit and frozen holdout policy; measured coverage/precision/abstention with uncertainty |
| G4: suggestions pilot | Opt-in limited cohort, explicit candidate labels and user choice, current permission/privacy disclosures, support/incident process and tested kill switch |
| G5: any stronger automatic mode | Complete authority/bootstrap/rotation/revocation rules; predeclared wrong-hop budget and adequate independent evidence; independent review. A high similarity score or successful G4 is insufficient |
| G6: broader distribution | Provider contracts/quotas/costs validated, desktop Chrome/Edge permission acceptance, policy/Store disclosures, deployment/recovery drill and accountable operational ownership |

Start in offline replay, then controlled live fixtures, then shadow/suggestions-only mode for consenting users. Keep open-web adapters and any automatic decision mode separately switchable. Turning off a failed provider must not widen acceptance, ignore signed reservations or silently substitute a weaker source. Negative caches and withdrawals need defined expiry and priority.

Specify rollback behavior before rollout: stop new external jobs, cancel or safely expire leases, invalidate search-derived result versions, refuse stale opens, retain required public signature high-water/reservation metadata, preserve permitted incident evidence, and leave unrelated manual/current-chain features usable where their own policy permits. Never solve an outage by copying unreviewed candidates into the signed catalog.

Incident triggers include a confirmed wrong automatic hop, credential/private URL leakage, private-network request, unauthorized publication, a broken signed reservation or cost-cap breach. Disable the affected capability promptly, investigate and disclose to affected pilot users under the agreed process. Re-enable only after a concrete fix and targeted regression/holdout re-evaluation; do not merely adjust a score until the failed example passes.

## 10. Evidence to publish before making research claims

Publish an allowed dataset/case manifest, relationship and temporal label policy, reviewer/adjudication protocol, split hashes, source/query budgets, actual provider/adapter availability, baseline and ablation definitions, exact runnable evaluation configuration, uncertainty intervals, negative/unknown outcomes and known exclusions. Redact or withhold material that cannot lawfully or safely be shared, and explain the resulting reproduction limits.

Compare against prior broken-link relocation and archive recovery work using compatible tasks and information budgets; [the prior-art report](NOVELTY_AND_EVIDENCE.md) is a starting bibliography, not a completed systematic review. A useful deployed composition can be an engineering contribution without a new cryptographic primitive or a statistically demonstrated research advance.

Until those studies exist, the honest future claim is: **Internet evidence can propose successors from an old origin, with dated provenance, bounded probing and explicit abstention; correctness and navigation authority require separate evaluation and policy.** It is not a guarantee that every dead domain has a recoverable or safely identifiable current replacement.
