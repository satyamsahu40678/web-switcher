# Internet discovery idea register

**Implementation update, 29 October 2026:** The archive/search candidate path is implemented as described in [current scope](INTERNET_DISCOVERY_STATUS.md). This register remains the catalogue of considered approaches; Recommended, Experiment and Later are dispositions rather than completion claims.

Planning revision: 28 October 2026 (Asia/Kolkata). **This is a design register, not an implementation or provider-availability claim.** It complements the [Internet discovery plan](INTERNET_DISCOVERY_PLAN.md). The implemented browser baseline is described in [automatic continuity](AUTOMATIC_CONTINUITY.md); its executed evidence remains in [the implementation ledger](IMPLEMENTATION_STATUS.md).

The target is: **given an old public HTTPS address, investigate public Internet evidence and find a plausible current successor without asking the user to supply the new address or a history file.** Discovery can be automatic while navigation authority remains separately controlled. A new search result does not inherit the authority of a signed registry decision or a previously pinned owner key.

This register records the ideas considered for this version of the plan. It is deliberately open to additions: “every idea” means an explicit, maintainable record of considered approaches and their dispositions, not a claim that every possible future algorithm has been enumerated. IDs are stable; superseded entries should be marked rather than renumbered or deleted.

## Decision and evidence vocabulary

| Term | Meaning |
| --- | --- |
| Recommended | Include in the proposed implementation path, subject to the named prerequisite and evaluation. This does not mean the feature already exists. |
| Experiment | Measure usefulness, risk and cost before enabling it in the product. |
| Later | Useful under narrower conditions or after a prerequisite is established; keep outside the first delivery. |
| Rejected | Do not use as the proposed product behavior. The reason is recorded so the shortcut is not rediscovered accidentally. |
| Candidate hint | Helps identify a URL worth bounded investigation; cannot authorize automatic migration by itself. |
| Continuity evidence | A dated observation relevant to an old→new relationship; its authority and independence still need assessment. |
| Established authority | A currently valid decision or key binding accepted through the product's separate trust policy. A new self-signature is not established authority. |

All costs below are relative operational categories, not vendor prices. Provider access, license, retention, redistribution, caching, query quotas, archive coverage, regional availability and current API support must be checked against current first-party terms before implementation. A free-looking public endpoint is not a production entitlement. The plan must continue to return a bounded unknown result when a provider is unavailable.

## Decision overview

| Area | Recommended first | Measure or defer | Exclude as authority |
| --- | --- | --- | --- |
| Source observations | Existing live declarations; bounded archived redirects and announcements | Sparse archives and crawl-index discovery | Reachability, canonical tags or archive age alone |
| Internet search | A contracted provider adapter, hostname-first queries, bounded candidate lists | Multilingual reformulation and independent backlink retrieval | Top result, snippet or duplicated mentions alone |
| Identity | Explicit dated relationships, established registry/key policy, temporal contradiction checks | Content similarity and infrastructure hints | Similar logo/name, valid TLS or shared hosting alone |
| Product | Source-only search after explicit online-search consent, explained candidates, abstention | Narrow policy-authorized automatic continuation after evaluation | Silent all-history upload or unconfirmed search-based automatic hopping |
| Deployment | Browser-local fast path plus isolated server discovery with explicit privacy boundaries | Optional bring-your-own provider and privacy-relay modes | Provider secrets embedded in a published extension |
| Research | Family/time-separated ground truth, adversarial negatives, ablations and cost accounting | Learned ranking, graph embeddings and sandboxed rendering | Uncalibrated “95% certain” labels or universal recovery claims |

## A. Live and historical source mechanisms

### ID-001 — Reuse live redirect and explicit metadata traversal — Recommended; baseline exists

- **Mechanism/output:** Start with the existing browser root probe and explicitly advertised HTTP/Refresh/meta/successor chain. It produces source-declared continuity evidence, not independent historical-owner proof.
- **Value/cost/privacy:** Often the cheapest first attempt; no search provider is needed. The selected sites see connection metadata; browser probes omit credentials/referrers.
- **Failure:** A dead source cannot make a new declaration. A compromised or re-registered live source can declare a malicious successor.
- **Next check:** Preserve the current bounds, trust labels and signed-alias reservations while adding Internet fallback; test that a successful local result does not accidentally trigger remote search.

### ID-002 — Archived HTTP redirect headers — Recommended

- **Mechanism/output:** Request a bounded set of historical captures for the exact source root and extract actually recorded Location relationships, recording capture time and archive provenance. The result is a dated candidate edge.
- **Value/cost/privacy:** Can recover A→B even if A disappeared before this browser ever saw it. Archive queries expose the source hostname; old captures can be incomplete or expensive to retrieve.
- **Failure:** Archive replay rewrites, archive-internal redirects and historical malware must not become current-site pointers. A capture is not a signed ownership statement.
- **Next check:** Build fixtures for genuine captured headers, replay-service redirects, stale links, missing captures and hostile archived targets; measure coverage and live successor confirmation.

### ID-003 — Archived HTML move announcements — Recommended

- **Mechanism/output:** Inspect a small number of bounded archived source pages for explicit “we moved” announcements or supported successor declarations. Keep original URL, capture time, extracted relationship and evidence digest.
- **Value/cost/privacy:** Finds public migration announcements that are no longer hosted. More retrieval and parsing work than a header; send only the public source root to the archive.
- **Failure:** A later capture can belong to a different owner; an archive can capture advertising or user comments. Historical wording can refer to a temporary mirror rather than a replacement.
- **Next check:** Label announcement location and temporal relationship; test parked/re-registered pages and injected comments rather than counting any mention of a new URL.

### ID-004 — Memento-style archive discovery — Experiment

- **Mechanism/output:** Use an archive adapter that can locate dated captures across supported archives, rather than assuming a single archive has every domain.
- **Value/cost/privacy:** Potentially improves historical coverage. Multiple providers add latency, terms, failure modes and disclosure of the same hostname.
- **Failure:** Multiple replay services may expose the same underlying capture; they are not independent identity witnesses. An archive datetime does not establish authorship or the date of the original announcement.
- **Next check:** Compare incremental unique coverage against one archive at a fixed request budget; retain capture origin so duplicated captures do not increase confidence.

### ID-005 — Common Crawl index and selected WARC records — Experiment

- **Mechanism/output:** Query a crawl index for selected exact source/announcement URLs, then retrieve bounded records when the index indicates relevant captures. Produce historical page/header candidates.
- **Value/cost/privacy:** Offers an additional public historical corpus. Index access can be cheap while bulk record access and parsing are substantial; licensing and redistribution rules require review.
- **Failure:** Coverage is uneven; an index hit does not prove an archived redirect or current destination. A broad crawl scan can turn one lookup into uncontrolled data processing.
- **Next check:** Cap index pages and bytes, use selected records only, validate WARC record target/date/digest, and measure useful unique candidates per retrieval.

### ID-006 — Discover an old source's authoritative public links from archives — Recommended

- **Mechanism/output:** Recover links that the historical source itself advertised to its public profile, project repository, contact/about page or announcement feed, then inspect those locations for dated move statements.
- **Value/cost/privacy:** Builds a historical anchor when the old site is dead. It takes several requests and can expose interest in both the source and profile; fetch no private profile/account content.
- **Failure:** An arbitrary current profile saying “official” is not historically linked authority. Archived links can be compromised later, sold or renamed.
- **Next check:** Require provenance for the old-source→profile relationship; retain historical identifiers, ownership-change warnings and each dated edge separately.

### ID-007 — Archived robots, sitemap and feed references — Experiment

- **Mechanism/output:** Inspect narrowly selected historical robots/sitemap/feed metadata for cross-domain references or an explicit transition. These are candidate hints unless the document makes a specific move declaration.
- **Value/cost/privacy:** May expose a replacement missed on the homepage. Retrieval can expand rapidly; no full site crawl is permitted by this idea.
- **Failure:** CDN assets, syndication, external sitemaps and alternate-language URLs are often unrelated to ownership or replacement.
- **Next check:** Measure true-move yield against a negative corpus of ordinary external references; keep a strict fetch/document cap.

## B. Search and public reference discovery

### ID-008 — Contracted web search API adapter — Recommended

- **Mechanism/output:** Search the exact old hostname through a currently supported, operator-approved API. Normalize its returned URLs into a bounded candidate set; store provider/query/evidence provenance separately.
- **Value/cost/privacy:** Directly addresses first-time dead-source discovery without local history. The provider learns the public hostname and request timing; requests incur provider cost and quotas.
- **Failure:** Search ranking can favor clones, ads, stale mirrors or poisoned pages. Availability, result rights and geographic coverage change over time.
- **Next check:** Select providers through current first-party contract/availability checks, define a provider-neutral closed schema, and test timeout/quota/empty/poisoned responses before enabling it.

### ID-009 — Hostname-first query ladder — Recommended

- **Mechanism/output:** Begin with the exact public hostname, then a capped sequence of old-hostname plus migration terms; derive a brand/name only from bounded public evidence when necessary.
- **Value/cost/privacy:** Limits irrelevant broad-brand results and keeps cost predictable. Only public hostname/approved public terms leave the device; no original path/query/fragment is sent.
- **Failure:** A distinctive hostname can still reveal sensitive interests. Broad brand terms can match unrelated organizations and invite SEO manipulation.
- **Next check:** Log query templates by ID without raw private URLs; compare precision/yield and request counts for each rung, and stop when the budget expires.

### ID-010 — Multilingual and transliteration query expansion — Experiment

- **Mechanism/output:** Search a few language-specific equivalents of “new domain”, “moved” or the historically observed site name, using declared page language rather than inferring sensitive user characteristics.
- **Value/cost/privacy:** Could improve non-English coverage. Each expansion increases provider disclosure and cost; translation is not identity verification.
- **Failure:** Transliterations can collide with unrelated brands, and automatically inferred language may be wrong.
- **Next check:** Evaluate per language and family with held-out data; add only expansions with measurable incremental value at a fixed request budget.

### ID-011 — Two search providers for coverage — Experiment

- **Mechanism/output:** Query a secondary approved provider only when the first provider is unavailable or leaves important evidence gaps.
- **Value/cost/privacy:** Improves provider resilience and potentially coverage while doubling disclosure/cost if used indiscriminately.
- **Failure:** Two providers indexing the same page are one underlying witness, not two independent continuity claims. Their ranks and opaque scores are incomparable.
- **Next check:** Deduplicate by underlying document/claim lineage; measure unique useful evidence and failure recovery rather than agreement counts.

### ID-012 — Retrieve and verify the search result document — Recommended

- **Mechanism/output:** Retrieve bounded public announcement pages through the isolated fetcher; validate that the cited relationship actually exists in the source text. Keep a dated minimal excerpt or digest according to retention policy.
- **Value/cost/privacy:** Turns a snippet into inspectable evidence and rejects fabricated/cached summaries. Additional origins see the resolver's IP and timing.
- **Failure:** The live result page may have changed, be inaccessible, or contain the claim only in a comment/ad. Retrieval alone does not establish authority.
- **Next check:** Test missing text, altered pages, malicious links, snippets that invert a move, and expiration; separate “search reported” from “document observed”.

### ID-013 — Independent inbound links and announcement references — Recommended

- **Mechanism/output:** Find independently authored public documents that identify both old and new domains and explain the transition. Record authorship, date, quoted relationship and source lineage.
- **Value/cost/privacy:** Provides corroboration beyond the proposed new site. Retrieval and independence analysis add work; public evidence can still reveal lookup interests.
- **Failure:** Aggregators, copied press releases, affiliate pages and generated SEO sites can repeat one false source. Popularity is not historical control.
- **Next check:** Cluster copied/near-duplicate text and citation roots; compare one claim's twenty copies against genuinely independent witnesses in adversarial fixtures.

### ID-014 — Historically linked official social/profile announcements — Recommended

- **Mechanism/output:** Inspect public announcements from a profile linked by the old site before the migration, retaining the profile's stable identifier where available.
- **Value/cost/privacy:** Can preserve an operator's communication channel after domain loss. Provider access/robots/terms and public-only retrieval are prerequisites; do not require reading the user's private social account.
- **Failure:** Accounts can be compromised, sold or renamed; a badge or current “official” label is insufficient. A move announcement can also be stale.
- **Next check:** Require historical linkage, inspect conflicting changes, and evaluate old-account compromise and new-account impersonation cases.

### ID-015 — Public project repositories and release documentation — Recommended for applicable sites

- **Mechanism/output:** Examine historically linked project homepages, README changes, release notes and public issue announcements for domain changes. Preserve repository identity and dated document revision.
- **Value/cost/privacy:** Strong practical channel for software/documentation projects. Uses provider APIs and quotas; no private repositories or access tokens belonging to site visitors are needed.
- **Failure:** A fork, abandoned repository, compromised maintainer or unrelated renamed project can appear authoritative.
- **Next check:** Confirm the old source's historical repository link, distinguish forks, and test changed ownership and conflicting release branches.

### ID-016 — Public app-store publisher/project profiles — Experiment

- **Mechanism/output:** For sites associated with an app, inspect public publisher/support URLs and dated public announcements.
- **Value/cost/privacy:** Adds a channel outside the old domain. Coverage is limited and some platforms do not offer permitted bulk APIs.
- **Failure:** Listings can be transferred; support/privacy links can point to a service provider rather than the website successor.
- **Next check:** Verify the historical old-domain association and current permitted access; treat the URL as a candidate until relationship and authority are established.

### ID-017 — Public RSS/Atom/newsletter archives — Experiment

- **Mechanism/output:** Read a historically linked public feed or public newsletter archive for explicit domain-change statements.
- **Value/cost/privacy:** Useful for small publishers without a project repository. Only publicly accessible archives qualify; no mailbox access or automatic subscriptions.
- **Failure:** Feeds may be syndicated, attacker-controlled after expiry or silently modified without original publication provenance.
- **Next check:** Preserve canonical feed identity and capture/observed times; test syndicated copies and missing historical timestamps.

### ID-018 — Curated directories and community-maintained lists — Experiment

- **Mechanism/output:** Query allowed public directories or maintained repositories that record old/current domains with dated supporting sources.
- **Value/cost/privacy:** Can offer practical coverage where operators do not cooperate. Requires a clear license, maintenance policy, moderation and audit trail.
- **Failure:** A list entry may be copied, maliciously edited or outdated. An unreviewed list is not equivalent to this project's signed reviewed catalog.
- **Next check:** Evaluate update latency, removals, source quality and poisoning resistance; import candidate evidence without upgrading its trust class.

### ID-019 — Public user reports and discussion threads — Later

- **Mechanism/output:** Search permitted public reports that cite an old domain and proposed successor; use them to generate investigation candidates.
- **Value/cost/privacy:** Broadens coverage of poorly documented migrations. Moderation, platform access and possible sensitive-interest leakage are substantial.
- **Failure:** Coordinated spam, deleted context, usernames that impersonate staff and “working mirror” posts do not establish genuine successor identity.
- **Next check:** Keep user claims explicitly unverified, require corroborating evidence, and measure report poisoning; do not message authors automatically.

## C. DNS, registration and infrastructure clues

### ID-020 — Public Suffix List and IDNA-aware normalization — Recommended

- **Mechanism/output:** Normalize ASCII/Unicode hostnames and identify registrable-domain boundaries correctly, including multi-label public suffixes and hosted-platform suffixes.
- **Value/cost/privacy:** Prevents grouping unrelated tenants or confusing example.co.uk with a naive final-two-label rule. Local computation is inexpensive; the list needs controlled updates.
- **Failure:** Registrable-domain sameness does not imply a migration, and Unicode similarity does not establish identity.
- **Next check:** Version the suffix/IDNA policy; test hosted tenants, IDNs, mixed-script confusables, Unicode/fullwidth dots and deceptive subdomains.

### ID-021 — Bounded domain/subdomain variants as hypotheses — Experiment

- **Mechanism/output:** Generate a small candidate set from a historically supported brand or observed next-domain pattern, then subject it to the same independent evidence checks.
- **Value/cost/privacy:** Could help when announcements use an obvious numbered subdomain or suffix change. Each probe has disclosure and traffic cost.
- **Failure:** Guessing a matching name is easy for attackers and can contact unrelated sites. Exhaustive domain scanning is excluded.
- **Next check:** Keep a hard candidate cap, require public-source justification for each variant, and compare false positives against search-only discovery.

### ID-022 — Current DNS CNAME/DNAME and alias observations — Experiment

- **Mechanism/output:** Collect bounded public DNS alias evidence as a candidate hint when a source still has useful DNS but no usable web response.
- **Value/cost/privacy:** Can reveal an operator-declared alias or hosting transition; DNS resolvers learn the queried names.
- **Failure:** CNAMEs often identify a shared CDN/host rather than a public successor. The DNS target may not serve the original website or support direct navigation.
- **Next check:** Distinguish infrastructure targets from website addresses and validate all resolved addresses before network requests; never rewrite a browser URL solely to a CNAME target.

### ID-023 — DNSSEC-authenticated records — Later

- **Mechanism/output:** Retain whether a DNS observation was authenticated by DNSSEC where supported, as provenance for current DNS publication.
- **Value/cost/privacy:** Can protect a DNS lookup from certain tampering. Requires a validated resolver path and operational expertise.
- **Failure:** DNSSEC authenticates the current zone's data; it does not establish historical brand ownership after re-registration or prove that a target is a successor.
- **Next check:** Define exactly which claim is authenticated and test insecure/bogus/changed-owner zones; do not label the website owner verified solely because DNSSEC validates.

### ID-024 — RDAP registration/change information — Recommended as a caution signal

- **Mechanism/output:** Use permitted RDAP metadata to identify suspiciously recent registration, expiry or possible continuity breaks; retain source and observation time.
- **Value/cost/privacy:** Helps challenge an apparently continuous old-domain claim. Registry/registrar coverage, redaction, rate limits and licensing vary.
- **Failure:** Registration fields can be incomplete or ambiguous, and dates do not conclusively prove a sale, deletion or owner change. Old domains can also be malicious.
- **Next check:** Treat missing metadata as unknown rather than benign; evaluate legitimate new domains and known re-registration cases without turning domain age into a positive identity certificate.

### ID-025 — Certificate Transparency candidate discovery — Experiment

- **Mechanism/output:** Search an approved CT data source for certificate names related to a historically supported domain/name or already evidenced candidate.
- **Value/cost/privacy:** May expose new subdomains or names not yet well indexed by search. Public log data can be large; aggregator access and terms require review.
- **Failure:** Certificate issuance demonstrates a validation event, not operator continuity, content safety or current reachability. Attackers can obtain valid certificates and duplicate brand strings.
- **Next check:** Measure unique candidate yield under a strict result cap; retain log/certificate provenance and never authorize navigation from CT inclusion alone.

### ID-026 — Shared certificate keys or infrastructure fingerprints — Experiment

- **Mechanism/output:** Compare public certificate SPKI, server headers or infrastructure features across historically observed and candidate domains as weak corroborating hints.
- **Value/cost/privacy:** May reveal a continuity pattern for a narrow operator. Collection can require extra network requests and historical data access.
- **Failure:** Shared hosting/CDNs reuse infrastructure across unrelated customers, while legitimate operators rotate keys and providers. A copied header is trivial to forge.
- **Next check:** Evaluate false matches on large shared-CDN negatives and genuine hosting changes; heavily downweight these features and make them ineligible as sole identity evidence.

### ID-027 — Passive DNS history — Later

- **Mechanism/output:** Query an appropriately licensed historical DNS provider for previously related names/IPs when public evidence is sparse.
- **Value/cost/privacy:** May add historical context beyond current DNS. Provider cost, access rights, sensitive-interest disclosure and redistribution limits can be substantial.
- **Failure:** Shared IPs, address reassignment and collection gaps create many false relationships. Public resolver history is not a complete ownership ledger.
- **Next check:** Procure access only after a measured benefit study; use relationship hints rather than direct routing authority and retain provider/capture lineage.

## D. Content and identity comparison

### ID-028 — Historical-to-current textual fingerprints — Experiment

- **Mechanism/output:** Compare bounded extracted main text from an old public capture with candidate pages using exact/fuzzy fingerprints.
- **Value/cost/privacy:** Helps rank candidates when a dead source cannot respond. Fetching archived/current pages increases bytes and retained-content obligations.
- **Failure:** Mirrors, copied content, templates and attackers can match perfectly; genuine redesigns can differ completely. Similarity is not control continuity.
- **Next check:** Evaluate copied-site negatives and redesign positives; keep text features separate from explicit migration claims and never let similarity alone authorize automatic switching.

### ID-029 — Stable public identifiers — Experiment

- **Mechanism/output:** Compare historically observed public organization/project identifiers, repository IDs or other relevant durable references on candidate pages.
- **Value/cost/privacy:** May be more selective than names or layout. Only intentionally public identifiers qualify; do not gather private account IDs or send contact information broadly.
- **Failure:** An identifier can be copied, a legal entity can sell a service, and a shared agency can appear on many unrelated sites.
- **Next check:** Record exactly which identity the identifier represents; evaluate copy attacks and business transfers rather than interpreting identifier equality as a cryptographic proof.

### ID-030 — Logos, favicons, screenshots and perceptual hashes — Experiment

- **Mechanism/output:** Use visual similarity only to prioritize investigation of otherwise supported candidates.
- **Value/cost/privacy:** Can recover continuity across language or text changes. Image bytes, rendering and licensed content add costs.
- **Failure:** Logos and favicons are easy to copy; shared templates and blank pages are common. Rendering can accidentally load tracking/subresources.
- **Next check:** Prefer static bounded image extraction, isolate any rendering, evaluate clone negatives, and prohibit visual resemblance as automatic navigation authority.

### ID-031 — Canonical, Open Graph, hreflang and reciprocal links — Experiment as hints only

- **Mechanism/output:** Read relationships that may reveal an alternate location or candidate family, then investigate whether a genuine migration is documented.
- **Value/cost/privacy:** Broadly available, inexpensive metadata. Additional targets must still pass URL/network policy before contact.
- **Failure:** Canonicalization can describe syndicated articles, language variants or SEO preferences. Two attacker-controlled sites can link to each other.
- **Next check:** Keep the existing rule that these tags do not automatically create continuity edges; test syndication, multilingual alternatives and attacker reciprocal links.

### ID-032 — Public brand/entity disambiguation — Recommended

- **Mechanism/output:** Distinguish organizations/services with similar names using dated topic, language, historical identifiers and explicit old/new relationships.
- **Value/cost/privacy:** Reduces obvious name-collision errors. The model must not infer a user's sensitive attributes from the lookup.
- **Failure:** A brand can legitimately fork, merge or license its name; “same topic” is a broad similarity signal.
- **Next check:** Include same-name unrelated organizations and language/region splits in the evaluation set; allow multiple candidates and unknown rather than forcing a single entity match.

### ID-033 — Deterministic extraction before statistical ranking — Recommended

- **Mechanism/output:** Use bounded parsers to extract URLs, explicit transition phrases, source locations, dates and provenance into a closed schema before ranking.
- **Value/cost/privacy:** Easier to inspect, test and constrain than free-form automated browsing; no paid language-model call is required for the first implementation.
- **Failure:** Limited patterns miss nuanced announcements; extracted page dates can be misleading or attacker supplied.
- **Next check:** Measure extraction precision/coverage by language, preserve “asserted date” versus “observed/capture time”, and reject unsupported fields instead of inventing evidence.

### ID-034 — Language-model-assisted extraction and explanations — Experiment

- **Mechanism/output:** Optionally summarize bounded public evidence or propose structured candidates; deterministic validators must verify every URL and cited observation.
- **Value/cost/privacy:** Could handle varied wording and produce clearer explanations. It adds model cost, data-processing contracts and another disclosure destination.
- **Failure:** Hallucinations, prompt injection from pages, hidden model priors and unverifiable confidence can produce plausible false successors. Page text must never grant tool or navigation authority.
- **Next check:** Use a tool-free, schema-constrained extraction role, bounded public snippets, provenance-linked citations and adversarial prompt-injection tests; compare against deterministic extraction before enabling it.

## E. Stronger continuity authorities

### ID-035 — Existing signed reviewed registry — Recommended; baseline exists

- **Mechanism/output:** Consult currently valid, pinned-key registry decisions through the existing verification and publication policy. Keep discovery candidates outside active releases until review/publication completes.
- **Value/cost/privacy:** A reviewable distribution path can serve users with no local history. Operation needs moderation, public-key distribution, retention and revocation governance.
- **Failure:** A valid trusted signer/reviewer can be wrong or compromised. A search service must not silently mint registry-reviewed results.
- **Next check:** Preserve every-hop signed-alias reservations and withdrawal behavior; test that Internet fallback cannot bypass a revoked/expired signed decision.

### ID-036 — Previously pinned owner-key successor records — Later

- **Mechanism/output:** Verify a current successor statement against a site key whose old-domain binding was established before the outage through a separate enrollment policy.
- **Value/cost/privacy:** Allows a portable statement to outlive the original domain. Requires genuine enrollment, freshness, sequence/equivocation rules, revocation and key custody.
- **Failure:** A key fetched for the first time from the proposed new domain cannot prove its relationship to the old one. Compromised pinned keys can sign malicious moves.
- **Next check:** Build enrollment and compromise/recovery drills; do not promote the existing offline owner CLI into an implemented owner lifecycle.

### ID-037 — Dual-domain control challenges during a move — Later

- **Mechanism/output:** An enrolling operator demonstrates contemporaneous control of both old and new domains using separate well-known/DNS challenges and signs a specific transition.
- **Value/cost/privacy:** Stronger planned bootstrap for cooperating operators before a domain dies. Requires public challenge publication, replay protection and auditable validation.
- **Failure:** It cannot recover an already dead old domain without an earlier anchor; domain control is still not necessarily the historical brand owner's identity.
- **Next check:** Specify challenge scope, expiry, nonce, delegations and anti-replay; test re-registered old domains and prove the policy does not assert historical ownership from current control alone.

### ID-038 — Stable project identifiers, DIDs or IPNS-style pointers — Later

- **Mechanism/output:** Bind a durable identifier/key to a site while authority can be established, then resolve its signed current location under that system's rules.
- **Value/cost/privacy:** Reuses established identity/location-separation approaches. Deployment, resolver availability and user/operator adoption are prerequisites.
- **Failure:** A new DID, IPNS name or blockchain entry does not bootstrap a vanished legacy site's identity. Ledger permanence does not make a false initial binding true.
- **Next check:** Compare an established mechanism against a project-specific protocol and document trust bootstrap, key rotation, resolver privacy and recovery limits.

### ID-039 — Key rotation, revocation and recovery policy — Recommended prerequisite for owner authority

- **Mechanism/output:** Plan bounded sequence/freshness checks, signed delegation/rotation, compromise revocation, recovery quorum and transparent handling of contradictory owner claims.
- **Value/cost/privacy:** Avoids turning a lost or stolen key into indefinite routing authority. Requires operator support and a recovery process independent of the failed website.
- **Failure:** Recovery channels and quorum members can be compromised or collude; an emergency reset can erase the original trust guarantee.
- **Next check:** Treat this as an explicit protocol/review workstream with adversarial drills and rollback rules, not a hidden administrative override.

### ID-040 — Transparency log and independent witnesses — Later

- **Mechanism/output:** Publish accepted migration statements and their sequence in an auditable append-only log; independent witnesses can detect equivocation or unexplained changes.
- **Value/cost/privacy:** Makes public signed claims inspectable and can help distribute history. It adds operational cost and can expose a public record of domain relationships.
- **Failure:** A log records a statement; it does not prove the statement true. Witnesses that copy one another are correlated, and private user lookup activity must not be logged publicly.
- **Next check:** Evaluate split-view detection, inclusion/consistency proofs, deletion/privacy obligations and public-statement-only logging before adoption.

### ID-041 — Community observations with reputation and review — Later

- **Mechanism/output:** Let users voluntarily submit a specific observed old→new relationship with minimal evidence, then deduplicate, investigate and moderate it before any registry publication.
- **Value/cost/privacy:** Can extend coverage beyond what one browser has seen. The submitted pair and timing can reveal interests; explicit contribution consent is mandatory.
- **Failure:** Sybil identities, coordinated reports, forged screenshots and compromised high-reputation reporters can manufacture agreement. Device signatures prove a device key, not independent human truth.
- **Next check:** Separate observations from authority, rate-limit abuse, evaluate poisoning and false consensus, and provide deletion/appeal/reporting policies; no silent background upload of browsing history.

## F. Temporal graph and decision mechanics

### ID-042 — Dated evidence graph with claim lineage — Recommended

- **Mechanism/output:** Store explicit old/new relationships, observation/capture/asserted times, evidence type, underlying source identity, retrieval provenance and validity separately from a ranked result.
- **Value/cost/privacy:** Supports first-time recovery from public history and explains why a candidate was considered. Retain only bounded public evidence under a documented policy; never store original private navigation URLs.
- **Failure:** More graph edges can reflect copied false claims, not more knowledge. A single “last seen” timestamp can hide contradictory historical states.
- **Next check:** Make claim lineage and temporal intervals first-class; test stale announcements, late indexing, copied witnesses and evidence removed after a decision.

### ID-043 — Temporal contradiction and re-registration detection — Recommended

- **Mechanism/output:** Detect incompatible live successors, historical ownership breaks, materially changed content and announcements that predate or contradict the claimed move.
- **Value/cost/privacy:** Protects against trusting a recycled old domain or stale mirror. Requires dated evidence and a carefully scoped negative-signal policy.
- **Failure:** Sparse archives and ambiguous registration data can create false alarms. Absence of a contradiction is not positive proof.
- **Next check:** Return a conflict/uncertain explanation with evidence dates; evaluate false refusals as well as wrong switches on known takeover/legitimate-move cases.

### ID-044 — Mirrors, multi-home sites, splits and mergers — Recommended model support

- **Mechanism/output:** Represent “mirror”, “regional alternative”, “partial migration”, “successor” and “merged into” separately rather than forcing every edge into one linked list.
- **Value/cost/privacy:** Avoids sending users to the wrong service/language/path when several addresses are live. User preferences can remain local.
- **Failure:** The newest timestamp or fastest mirror is not necessarily the primary successor. A service split can make a homepage-level answer inherently ambiguous.
- **Next check:** Use relation-aware outcomes and explicit selection for unresolved alternatives; evaluate split/merger fixtures and do not silently infer a user's region or desired service.

### ID-045 — Calibrated ranking with hard authority gates — Recommended

- **Mechanism/output:** Rank candidates for investigation/display using explicit features, while a separate deterministic policy determines whether any result is eligible for automatic navigation.
- **Value/cost/privacy:** Makes search useful without turning a large relevance score into a certificate. Calibration requires an appropriate labeled dataset and cost/risk accounting.
- **Failure:** Scores can be overconfident, drift or double-count correlated evidence. Adding many weak hints must not outweigh a revocation, conflict or missing authority.
- **Next check:** Define hard vetoes and authority eligibility first, calibrate only on held-out families/time periods, and initially show confirmed-by-user candidates rather than silently auto-hopping search results.

### ID-046 — Candidate list with evidence and explicit abstention — Recommended

- **Mechanism/output:** Show a bounded set of candidates, dates, explanation and uncertainty when discovery finds leads without sufficient authority; unknown remains a valid final result.
- **Value/cost/privacy:** Meets automatic investigation without asking the user to already know the new domain. Explanations should identify concrete provenance, not an invented certainty percentage.
- **Failure:** An overwhelming list or misleading “verified” badge can cause users to trust clones. User confirmation does not upgrade a candidate to shared owner/registry authority.
- **Next check:** Test comprehension, IDN display, source/date visibility, stale choices and changed destination on click; retain homepage-only and fresh-check navigation safeguards.

### ID-047 — Revalidation, freshness and bounded chain compression — Recommended

- **Mechanism/output:** Recheck terminal reachability and evidence validity before navigation; cache evidence and optionally derive a current endpoint while preserving the A→B→C provenance.
- **Value/cost/privacy:** Reduces latency on repeat lookups without requiring user-supplied history. Scheduled checks can reveal interests, so make them selected-site, bounded and separately disclosed.
- **Failure:** A compressed A→D shortcut can conceal that an intermediate authority was withdrawn. Cache freshness is not current reachability; clock changes and revoked policy must invalidate results.
- **Next check:** Keep intermediate reservations/conflicts visible, use explicit expiration and negative caching, and test expiry/revocation between ranking, display and click.

## G. Architecture, privacy and deployment choices

### ID-048 — Hybrid local fast path and isolated server investigation — Recommended

- **Mechanism/output:** Reuse direct browser continuity first; run explicitly consented Internet search/archive work through a separate server service with bounded provider/fetcher adapters.
- **Value/cost/privacy:** Keeps the simple path backend-free while centralizing provider secrets, quotas and hardened outbound retrieval. The server/providers learn the public source hostname; consent must make that visible.
- **Failure:** Server failure must not break local continuity, create a new navigation authority or silently broaden host permissions. Server-side SSRF boundaries still need deployed validation.
- **Next check:** Keep search results separate from published catalog routes, isolate keys/process/database permissions and test unavailable/disabled providers and no-server local operation.

### ID-049 — Browser-only direct provider mode — Experiment

- **Mechanism/output:** Contact a permitted search/archive API directly from the extension when its API, CORS/host-permission rules and terms explicitly support that use.
- **Value/cost/privacy:** Avoids a central operator seeing the hostname but exposes the user's IP to providers and adds extension grants. An extension cannot conceal an embedded provider secret from its recipient.
- **Failure:** Cross-origin limitations, key extraction, quota abuse and browser suspension can make this unsuitable as the default novice-user product.
- **Next check:** Verify currently supported client use and no shared secret exposure; compare total consent, privacy, latency and cost against the hybrid mode.

### ID-050 — Optional bring-your-own provider account — Later

- **Mechanism/output:** Let advanced users configure a supported provider for their own account under clearly described storage and quota behavior.
- **Value/cost/privacy:** Can reduce operator billing and allow provider choice. It creates setup burden and does not meet the novice “works without technical setup” goal by itself.
- **Failure:** Client-side storage is not a secure vault against a compromised device/extension; users can accidentally expose or over-spend their keys.
- **Next check:** Prefer a local/server broker where appropriate, offer deletion/rotation controls, and ensure a key is never committed, logged, exported with mappings or uploaded to another provider.

### ID-051 — Explicit online-search consent and minimum query data — Recommended

- **Mechanism/output:** Keep local-chain checks and Internet investigation distinguishable; disclose the server/provider recipients, send only a normalized public source origin/hostname and required public evidence terms.
- **Value/cost/privacy:** Preserves the source-only user experience without silently exporting browsing history. Domain names themselves can still reveal sensitive interests.
- **Failure:** A one-time broad checkbox can be misunderstood as permission for continuous all-site tracking. Hashing a hostname does not hide it from a small-dictionary lookup service.
- **Next check:** Test no-network-before-consent, denial, cancellation, per-source requests, private URL stripping, data deletion and understandable purpose/recipient text.

### ID-052 — Oblivious relay or split-trust lookup — Later

- **Mechanism/output:** Evaluate a relay/provider arrangement that separates client IP from the plaintext hostname, with an explicit protocol and non-collusion assumptions.
- **Value/cost/privacy:** Could reduce the direct association between visitor identity and lookup subject. It adds infrastructure, abuse handling and latency.
- **Failure:** One ordinary proxy is not anonymity; timing, logs, colluding parties and resolver traffic can reconnect identity and subject. Origin hashing is not an equivalent solution.
- **Next check:** Perform a concrete privacy/threat assessment and latency/cost study before claiming improved anonymity; retain deletion and minimal-logging policy.

### ID-053 — Isolated, public-only bounded document retrieval — Recommended

- **Mechanism/output:** Reuse/extend the hardened server fetcher for candidate documents under DNS/all-address/peer-IP/redirect/robots/body/time/hop constraints; do not let a search-result URL become an arbitrary server fetch.
- **Value/cost/privacy:** Investigates candidates without executing their content or forwarding visitor credentials. Requires a genuinely verified deployed egress boundary and network isolation.
- **Failure:** DNS rebinding, IPv6/private ranges, redirects, archive replay URLs, decompression bombs and external resources can defeat superficial URL filtering. Browser checks do not offer the same peer-IP guarantee.
- **Next check:** Keep per-hop network validation and internal authentication; add adversarial search/archive URL fixtures, cross-process tests and deployed egress verification before public enablement.

### ID-054 — Sandboxed JavaScript rendering for otherwise opaque sites — Later, research-only first

- **Mechanism/output:** Investigate whether a tightly isolated disposable browser can observe a public site's script-only move when static evidence is unavailable.
- **Value/cost/privacy:** May recover some real moves but is much more costly and exposes an active attack surface. It must never use the visitor's cookies, credentials, browser profile or private-network access.
- **Failure:** Arbitrary scripts can fingerprint, loop, download, scan reachable networks or fabricate plausible destinations. CAPTCHA/access controls are not permission to bypass them.
- **Next check:** Require a separate approved threat model, constrained egress/subresources/downloads, resource limits and measurable benefit. Do not make rendering the first product implementation or current navigation authority.

### ID-055 — Liveness and threat-reputation checks kept separate from identity — Recommended

- **Mechanism/output:** Check whether an eligible candidate responds now, and optionally consult properly licensed threat/reputation signals as negative gates.
- **Value/cost/privacy:** Avoids presenting a dead or known harmful destination as a working result. Threat providers receive domain lookups; costs/licenses and false positives must be disclosed.
- **Failure:** A healthy HTTP 200, valid certificate or absence from a threat list does not prove identity or safety. Honeypots and soft-error/parking pages can respond successfully.
- **Next check:** Report reachability, continuity and reputation as separate fields; test parked/soft-error/malicious-but-unlisted pages and avoid a blanket “safe website” badge.

## H. Operations, learning and research

### ID-056 — Per-lookup, per-host, per-provider and global budgets — Recommended

- **Mechanism/output:** Cap queries, candidates, document bytes, wall time, concurrency, retries and provider spend; reserve work before network execution and share durable quotas across workers.
- **Value/cost/privacy:** Prevents one lookup or abuse campaign from causing unbounded external requests/bills. Operational metrics should avoid raw hostname/user-query logging by default.
- **Failure:** Process-local counters reset on restart; retries can multiply cost, and an alternate provider must not become a quota-evasion path.
- **Next check:** Define prototype budget defaults in the plan, validate their usefulness experimentally, and test concurrent workers, crashes, quota responses and partial completion.

### ID-057 — Positive/negative caches and provider circuit breakers — Recommended

- **Mechanism/output:** Cache bounded evidence/results with their provider rights, validity and source times; temporarily stop failing providers with transparent unavailable reasons.
- **Value/cost/privacy:** Saves latency and request cost and limits repeated interest disclosure. Shared caches can themselves reveal a lookup pattern if publicly enumerable.
- **Failure:** Stale or poisoned cache data can spread a bad guess, and negative caching can hide a newly announced move. Cache hits do not extend evidence authority or expiry.
- **Next check:** Use exact normalized keys, unguessable job references where appropriate, rights-aware retention and independent freshness checks; test new evidence after negative results and revoked authority after cache hits.

### ID-058 — Cooperative voluntary observation sharing — Later

- **Mechanism/output:** Share only explicitly contributed public transition observations, rather than whole browsing history, so other first-time users can benefit after the original source disappears.
- **Value/cost/privacy:** Addresses the gap between one browser's memory and public evidence. It needs a contribution policy, minimum data, anti-abuse handling, retention and appeals.
- **Failure:** A distributed memory network can become a tracking service or poisoned mapping database. An observation signature does not prove historical website control.
- **Next check:** Keep contributions opt-in and unverified until reviewed, evaluate Sybil/collusion attacks, and compare coverage gain with the extra privacy/operational cost.

### ID-059 — Human review and appeals for consequential ambiguous cases — Recommended

- **Mechanism/output:** Send a bounded evidence dossier to the existing review/publication lane when the relationship matters or claims conflict; provide corrections/removal/appeal paths.
- **Value/cost/privacy:** Reuses a controlled stronger-authority lane and helps resolve ambiguous splits/transfers. Reviewer time and response latency are real product costs.
- **Failure:** Reviewers can be fooled, biased, mistaken or collusive. A slow queue must not be presented as instantaneous autonomous resolution.
- **Next check:** Define evidence requirements and role separation, evaluate reviewer agreement/error, and keep pending investigations separate from active browser routes.

### ID-060 — Family-separated and time-separated benchmark — Recommended

- **Mechanism/output:** Evaluate cases with no local history and no supplied destination, using dated independent ground truth and only evidence available by each test cutoff.
- **Value/cost/privacy:** Measures the actual requested goal and distinguishes candidate discovery from correct automatic switching. Dataset collection, licenses and consent take work.
- **Failure:** Reusing known mappings as hidden seeds, training/test family leakage, future announcements and hand-picked easy examples produce misleading success rates.
- **Next check:** Include dead sources, unseen successors, clones, re-registrations, mirrors/splits, region/language cases and no-successor negatives; report precision/coverage/abstention, harmful switches, latency, provider cost and uncertainty separately.

### ID-061 — Ablations and matched-risk baselines — Recommended

- **Mechanism/output:** Compare live-only, archive-only, search-only, current remembered chain, hybrid and stronger-authority variants under comparable request budgets and wrong-switch constraints.
- **Value/cost/privacy:** Shows which ideas provide useful recovery rather than merely adding complexity. The same consent/collection boundaries apply to every variant.
- **Failure:** Comparing a candidate suggestion system against an automatic navigation system without matching risk/outcome definitions is invalid.
- **Next check:** Report incremental candidate recall separately from eligible-navigation precision; reproduce feasible prior-art methods with disclosed adaptations before claiming improvement or academic novelty.

### ID-062 — Learned ranking, embeddings and link-graph inference — Later

- **Mechanism/output:** Explore learned ranking/graph features after an adequate labeled temporal dataset exists; use them to prioritize investigations, not to mint trust.
- **Value/cost/privacy:** Could improve recall or cost efficiency across diverse evidence. Training/inference require resources, data rights and model/version governance.
- **Failure:** Embeddings can match clones; models can memorize private/leaked ground truth, become stale or amplify correlated evidence.
- **Next check:** Compare against a transparent deterministic ranker, audit leakage and calibration, and keep hard authority/negative gates outside the learned score.

### ID-063 — Operator health and evidence-quality dashboards — Recommended

- **Mechanism/output:** Track provider health, quota/spend, latency, evidence-type yield, age, abstention and review outcomes in aggregate with bounded retention.
- **Value/cost/privacy:** Makes outages and ineffective providers visible without promising a live match. Aggregate small cohorts can still identify rare lookups; avoid raw-domain dashboards by default.
- **Failure:** A global “success” metric can count candidate display as correct recovery and hide wrong automatic navigation.
- **Next check:** Specify metric definitions, access control, redaction/minimum aggregation, deletion and alert thresholds; inspect actual captured logs for private URL/provider-key leakage.

### ID-064 — Public documentation and third-party interoperability — Recommended

- **Mechanism/output:** Publish evidence schemas, relation semantics, provider-adapter contracts and operator declaration examples while marking project conventions accurately.
- **Value/cost/privacy:** Enables reproducible experiments and cooperating operators without requiring every site to adopt a new protocol. Public examples should be owned controlled fixtures.
- **Failure:** Calling a project field a universal standard misleads users; publishing sensitive evidence or provider-restricted content violates the intended data boundary.
- **Next check:** Version schemas and examples, verify redistribution rights and distinguish implemented, proposed, experimental and external prerequisites throughout the docs.

## I. Shortcuts explicitly rejected

| ID | Rejected behavior | Why it is excluded | Permitted alternative |
| --- | --- | --- | --- |
| ID-065 | Automatically open the first/top search result | Ranking is relevance/advertising machinery, not continuity authority; poisoned clones can rank highly. | Bounded candidate discovery, evidence retrieval, explicit authority policy and uncertain-result selection. |
| ID-066 | Brute-force every TLD, spelling and numbered subdomain | Unbounded traffic, many unrelated hosts, predictable attacker targets and poor correctness. | Small justified candidate hypotheses under ID-021 and the ordinary investigation budgets. |
| ID-067 | Treat a matching name/logo/page as proof | A clone can copy all three; a genuine site can redesign. | Weak ranking features plus dated relationship and independent authority checks. |
| ID-068 | Upload all browsing history or scrape browser history silently | It is unnecessary for a specific source-only lookup and exposes unrelated private activity. | Explicit public-hostname lookup consent and optional separately consented contribution of a particular public transition. |
| ID-069 | Embed a shared commercial provider key in the extension | Distributed client code cannot hide a shared secret; extraction creates abuse and billing exposure. | Isolated server secret handling or explicitly advanced user-owned account configuration. |
| ID-070 | Bypass CAPTCHAs, authentication, robots/access policy or provider quotas | An unavailable document is not permission to circumvent its controls or move the abuse to another endpoint. | Respect the boundary, record unavailable evidence and use permitted independent sources or abstain. |
| ID-071 | Execute every candidate page's JavaScript in the user's browser profile | Exposes visitor credentials, trackers and active content while granting arbitrary code a role in discovery. | Inert bounded parsing; separately evaluated disposable server rendering only under ID-054. |
| ID-072 | Ask an LLM to invent the current domain and trust its answer | It can hallucinate, use stale undisclosed priors or follow injected page instructions without verifiable evidence. | Tool-free structured extraction/ranking with explicit observed citations, deterministic validation and hard authority gates. |
| ID-073 | Count copied mentions or multiple search providers as independent votes | Ten mirrors of one false announcement remain one underlying claim. | Provenance/citation/near-duplicate clustering and explicit independence analysis. |
| ID-074 | Let many weak hints outweigh a signed revocation, conflict or missing authority | Numeric scores can launder an unsafe weaker path around established policy. | Hard vetoes and every-hop signed reservations outside ranking. |
| ID-075 | Treat TLS, DNSSEC, CT, RDAP or shared IPs as historical-owner proof | Each authenticates or describes a narrower fact; none independently answers who operated the old website. | Record the precise claim and use it only within that scope. |
| ID-076 | Silently publish search candidates into signed registry routes | Candidate discovery is not independent review/publication; it would erase the existing authority separation. | Pending evidence dossiers and independent controlled publication. |
| ID-077 | Rewrite arbitrary private paths/query strings onto a guessed new domain | Risks disclosing tokens/account data and usually does not preserve resource semantics. | Discovered-homepage navigation, sensitive-link confirmation and any future path mapping only under separately reviewed public-prefix policy. |
| ID-078 | Present archive content as the current live website | Historical access and current identity/reachability are different outcomes. | Label archive recovery separately and live-check any proposed current endpoint. |
| ID-079 | Automatically send email/DMs to claimed owners or discussion authors | It discloses lookup interests, creates spam/impersonation risks and acts beyond an ordinary lookup request. | Public-only evidence retrieval; any human contact requires a separate deliberate workflow and explicit authorization. |
| ID-080 | Promise every dead URL has a discoverable current domain | Some sites close, split, leave no public trace or publish conflicting evidence; a correct algorithm must sometimes abstain. | Define coverage honestly, retain unknown/conflict/unavailable states and show exactly what evidence was found. |

## Combined approaches worth testing

1. **Historical public pointer:** Old A is dead; an archived A→B redirect or historical A-linked public profile announces B; live B declares C. Investigate the provenance, temporal gaps and current endpoint separately. No local history is required, but historical public evidence is.
2. **Search-assisted dossier:** Search the old hostname, retrieve a specific independent move announcement, discover B, obtain current B evidence and show the candidate with its dated basis. Search rank alone contributes no navigation authority.
3. **Previously established authority:** A valid reviewed registry decision or previously enrolled owner record says A→C; verify it under its existing policy, check live C and explain the record. Searching for the record is separate from trusting the signer.
4. **Temporal takeover refusal:** A now redirects to a clone, but historical evidence shows an expiry/ownership break and a separate established channel identifies another candidate. Surface the contradiction; do not let reachability, age, repeated snippets or a large ranker score force an automatic choice.
5. **Multiple legitimate destinations:** A service splits into B and C or maintains two mirrors. Represent that relationship and ask for the intended service/alternative when evidence cannot establish a unique primary successor. Do not relabel a mirror as “the latest domain”.
6. **No discoverable trace:** A is dead, all archives/providers are missing/unavailable, no prior anchor exists and candidates are uncorroborated. Stop at unknown with a bounded explanation. Choosing a similar domain would manufacture knowledge the system does not have.

The recommended staged path includes ID-001/002/003/006/008/009/012/013/014/015 plus the normalization, explicit evidence, privacy, fetcher, budget and evaluation foundations. The first enabled online delivery should start with one approved search adapter and one archive adapter, adding further recommended source channels only when access rights, budget and measured benefit justify them. Experimental sources should be admitted one at a time; they must not become a substitute for the authority policy.

## Reference starting points and unresolved checks

These are first-party design-reference entry points, not a statement that this task tested public endpoint access, provider coverage or current production terms:

- [Internet Archive Wayback API overview](https://archive.org/help/wayback_api.php) and [Memento, RFC 7089](https://www.rfc-editor.org/rfc/rfc7089).
- [Common Crawl index entry point](https://index.commoncrawl.org/) and [Common Crawl](https://commoncrawl.org/) for index/record formats, usage guidance and current availability.
- [Public Suffix List](https://publicsuffix.org/) for registrable-domain boundaries; normalization still needs an explicit IDNA/Unicode display policy.
- [RDAP overview from ICANN](https://www.icann.org/rdap) and [RDAP query format, RFC 9082](https://www.rfc-editor.org/rfc/rfc9082) for registration-data semantics and discovery.
- [Certificate Transparency v2, RFC 9162](https://www.rfc-editor.org/rfc/rfc9162) for the scope of logged certificate claims.
- [W3C DID Core](https://www.w3.org/TR/did-core/) and [IPNS](https://docs.ipfs.tech/concepts/ipns/) for established identity/location-separation mechanisms and their bootstrap assumptions.
- [FABLE artifact](https://github.com/JingyZhu/FABLE) and the existing [prior-art discussion](NOVELTY_AND_EVIDENCE.md) for comparison work; reproduction or superiority is not claimed.

Before coding a provider integration, resolve: permitted client/server access; availability in intended regions; quota/billing; cache and result redistribution rights; data-processing/retention terms; supported response formats; exact failure semantics; and a disabled/unavailable fallback. Before enabling automatic navigation from a new authority class, resolve: trust bootstrap, temporal contradiction rules, revocation and recovery, independent evaluation, user explanation and an explicit rollback decision. None of these checks requires the visitor to supply the new domain or upload their browsing history.
