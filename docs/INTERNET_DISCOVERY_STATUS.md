# Internet discovery: delivered scope and limits

Updated 29 October 2026 (Asia/Kolkata). This is the current scope note for the Internet-discovery implementation. The [operation guide](INTERNET_DISCOVERY_OPERATION.md) covers usage/deployment; exact executed outcomes belong in [the evidence ledger](IMPLEMENTATION_STATUS.md). The earlier 80-idea register and 36-task backlog remain a wider roadmap, not 80 features claimed complete.

## What the user can do

Enter only the old address, consent to public-source investigation and choose **Search public sources**. No local migration history, manually supplied destination, user account or search key is needed for the default archive mode. It obtains dated public archive evidence and proposes bounded candidate origins; a chosen candidate is checked live in the browser before its homepage opens. It can follow that candidate's current explicit move chain too. An explicit remembered choice creates a reversible, expiring, user-configured mapping without requiring the user to type a replacement.

For broader indexed web search, an operator can deploy the optional authenticated service with its own search credential. A service invitation is entered in the extension's advanced configuration; the commercial search key is never placed in the extension. No public search service is preconfigured or hosted on the user's behalf.

This solves **autonomous investigation from an old address** when supported public sources contain useful evidence. It does not solve guaranteed identity reconstruction when no trace survives. Source availability, true historical identity, current reachability and permission to navigate remain distinct.

## Implemented boundaries

| Area | Delivered behavior | Practical limit |
| --- | --- | --- |
| Public archives | Availability API, CDX redirect index, up to three root snapshots, inert historical redirect/metadata/contextual announcement extraction | Fixed supported providers; their outages, exclusions, coverage and terms can prevent recovery. |
| Browser discovery jobs | Explicit consent/host grants, 30-second archive operation, bounded requests/bytes, ten candidates, one-hour local expiry, cancellation and clear/restart fencing | An interrupted local archive job fails closed; it does not pretend work completed. |
| Candidate explanations | Dated public locators, evidence kinds, common archive provenance groups, strict unverified/confirmation-only schemas | Basic deduplication is not general copied-source clustering or proof of independent authorship. |
| Current check/open | Candidate permissions, fresh live chain, source/generation/job checks, all-origin signed reservations, exact displayed target, homepage-only opening | Reachability does not establish ownership or content safety. |
| Remember a choice | Explicit confirmation, 24-hour expiry and existing user-configured DNR gate | It is an override chosen by the user, not an owner-verified migration or an automatically published registry decision. |
| Optional service | Actual fixed-endpoint Brave adapter, shared archive adapter, authenticated `/v2/discoveries`, owner-scoped references and polling/cancellation | Requires an operated HTTPS endpoint, invitations, provider access and production configuration. |
| Service persistence | Separate SQLite, transactional quotas, leases/fencing, phase progress, crash/deadline handling, short caches and 24-hour retention | No change to the Java registry's V1 migration, PostgreSQL roles or `/v1/lookups`; no shared distributed database architecture is claimed. |
| Optional server observation | Existing private isolated fetcher integration with worst-case child-request/byte reservations | Deployment must enforce egress. Without a fetcher, candidates are marked not checked and the browser performs the opening check. |
| Cost/abuse | Durable request/byte/concurrency/owner/global ceilings before transport; no embedded shared client secret | No currency-denominated billing integration or production spending/traffic measurements. |
| Backup/deployment | Actual SQLite snapshot/integrity/reopen tests, non-root container, documented HTTPS proxy and secret configuration | No public host deployed; off-host encryption/durability, restore operations and production RPO/RTO need operator validation. |

## Backlog interpretation

The following maps the [NET task definitions](INTERNET_DISCOVERY_BACKLOG.md) to delivered code and remaining acceptance. “Controlled” means replay/loopback/native fixture evidence, not a real-world recovery study.

| Tasks | Current interpretation |
| --- | --- |
| NET-001–002 | Existing contracts retained; strict version-2 candidate envelope implemented. Compatibility and malformed/forged reply checks are automated. |
| NET-003 | Concrete Brave and archive adapters exist. Current commercial terms, supplied credentials and live-provider canaries remain external prerequisites. |
| NET-004–006 | Explicit consent, origin-only queries, provider boundaries, evidence fields and first-use fixtures implemented. Full independent real migration dataset remains open. |
| NET-007–008 | Architecture changed deliberately: new service uses its own private SQLite schema and image instead of a Java/PostgreSQL V2 migration. Existing V1 remains unchanged. A public deployment/release process for this separate service is not automatically provided by the registry release workflow. |
| NET-009–010 | Durable phase claims, renewal, recovery, cancellation, request/byte quotas and global/owner limits implemented; monetary metering and measured capacity remain open. |
| NET-011–012 | Process/credential separation, owner-scoped storage, cache/expiry, cancellation and snapshot recovery implemented. Deployed OS/network/backup enforcement still needs validation. |
| NET-013–015 | Real provider interfaces and archive/search implementations with injected-provider, HTTP and persistence tests. Live search success is not claimed without the configured provider. |
| NET-016 | Historical archive announcements supported. General live social/repository/feed discovery is not implemented. |
| NET-017–018 | Bounded normalization/deduplication, browser live checks and optional private fetcher implemented. General public-page crawling and content classification are outside the first slice. |
| NET-019–020 | Basic provenance labels and archive-first deterministic ordering implemented. Full citation/near-duplicate grouping, content fingerprints and measured/calibrated ranking remain open. |
| NET-021 | Separate candidate authority, fresh opening/choice checks and signed-history barriers implemented. No weighted score authorizes a route. |
| NET-022–023 | Multiple suggestions can be explained without selecting a winner; current registry review/publication remains separate. Full temporal epochs/splits/mergers and an integrated Internet-evidence reviewer dossier remain open. |
| NET-024–028 | Optional versioned service, source-only extension consent, candidate display/check/open/choice, privacy and install/deployment instructions implemented. Real native permission dialogs and Store review remain separate acceptance. |
| NET-029 | Evaluation/threat methodology documented; no measured public dataset, scientific accuracy or superiority claim. |
| NET-030–031 | Controlled unit/HTTP/database/UI/native fixtures cover the implementation and negative cases; production red-team/identity effectiveness remains open. Use exact CI outcomes rather than assuming a test file passed. |
| NET-032–035 | Container and operation controls supplied; no live provider/deployed-egress canary, consenting-user pilot or production incident/restore history is claimed. |
| NET-036 | Owner enrollment/key rotation/recovery, additional provider families and the remaining research ideas stay on the roadmap. |

## Current external constraints

The managed environment has GitHub access, but Archive.org, Web Archive and Brave Search are absent from its enforced egress list; no `BRAVE_SEARCH_API_KEY` is configured. A draft for those hosts and a secure optional search-key binding was saved for environment review. A draft is not applied access. Tests use controlled sources rather than bypassing those restrictions.

The supplied public movie-site domain pair has not been independently verified and is not hardcoded in code, seed data or expected public-provider answers. A person can try an old address in their installed browser; whether it returns useful evidence depends on what the public providers contain and permit at that time. Failure is reported rather than replaced with an invented domain.
