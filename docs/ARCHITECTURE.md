# Web Switcher architecture

Web Switcher's primary browser flow discovers a current destination from an old address and explicit successor evidence. The user supplies the old source only, inspects the chain and can enroll that source for automatic future following. Manual mappings and signed reviewed registry decisions remain separate policies with precedence for their exact sources. Reachability, historical identity and deep-page compatibility are distinct questions.

## Components and authority

| Path | Responsibility | Boundary |
| --- | --- | --- |
| extension/continuity-probe.js | Scoped browser requests and bounded non-executing HTTP/meta successor extraction | Source-declared observations; no browser DNS/connect-IP pinning claim |
| extension/continuity.js | Validated origin-only graph, edge freshness, bounded resolution and remembered-successor recovery | Does not create registry/owner trust or invent unseen domains |
| extension/continuity-worker.js and continuity-gate.* | Source-only enrollment, DNR gate, current discovery, permission/confirmation controls | Only selected followed sources; packaged code; manual/signed overrides take precedence |
| extension/internet-*.js | Explicit source-only archive investigation, strict candidate envelope, scoped provider transport, asynchronous job controller and candidate UI | Public historical/search hints are unverified; separate from observed continuity edges; session-only service invitations |
| online-discovery/ | Optional Node 24 service, fixed search/archive adapters, SQLite job/lease/budget storage and backups | Per-owner authentication; no registry/publishing key or PostgreSQL access; client still verifies signed policy and checks selected destinations |
| extension/mapping-follow.js | Opt-in local shared-destination checks, validated group advancement and final-use rechecks | Uses current destination roots and supported continuity; never creates signed family authority or renews user consent |
| Remaining extension modules | Manual mappings, signed catalog adapter, local receipts/undo and settings | Current generation, expiry, permissions and loop checks run at use time |
| packages/security/ | Closed catalog/passport records, ES256 verification and sequence/digest memory | Signatures authenticate a pinned key, not website safety or historical ownership by themselves |
| apps/web/ and backend/ | Public lookup/report UI, JDBC/Flyway records, review/publication/auth/audit | Public submissions never directly activate a signed route |
| Separate worker profile | Durable leased server discovery jobs | No listener, OIDC client or publishing key; pending candidate output only |
| fetcher/ | Internal authenticated /probe and /resolve observation service | DNS/address/socket checks, HTTPS/robots/resource bounds; deployed egress enforcement required |
| research/ and infra/ | Historical experiments, reproducible checks and deployment/recovery support | Synthetic checks and configuration are not production effectiveness/isolation evidence |

The extension remains packaged plain JavaScript; React/TypeScript is used for the web application. WXT migration is not represented as complete. The direct browser continuity flow needs neither the Java API nor a deployed server fetcher.

## Source-only discovery and linked memory

~~~mermaid
flowchart LR
    A[Old address only] --> P[Selected source permission]
    P --> O[Read explicit HTTP or metadata successor]
    O --> V{Unique supported next address?}
    V -->|Yes| N[Validate URL and next-origin access]
    N --> O
    V -->|Terminal responds| R[Explain source-declared chain]
    R --> U[User opens or follows the source]
    V -->|No evidence or conflict| X[Explain unknown or refusal]
    M[Fresh remembered edges] --> O
~~~

The probe requests one validated URL at a time using manual redirect handling. Chrome fetch does not expose Location from an opaque redirect response, so webRequest captures headers only for the extension's correlated active requests. The engine validates the announced next URL and checks its permission before a separate request; it does not let fetch automatically follow an unvalidated redirect. Cookies/HTTP credentials and referrers are omitted, and downloaded scripts are not evaluated.

HTTP Location, short Refresh declarations, HTML meta-refresh and the project's explicit successor link convention can supply edges. A same-origin project JSON pointer is fetched only when advertised. Ordinary links, canonical/og values and name/logo matches are not automatic identity evidence.

The graph stores origin-only edges and timestamps for a seven-day validity window. If A→B→C was previously observed, a qualifying DNS/connection failure, timeout or explicit HTTP 404/410 at A can use its unique known B successor and continue checking. A later explicit C→D can extend the chain. The terminal address must be checked now. No stored edge to an unseen D exists merely because C is dead. Conflicting successors, loops, stale history, HTTP authorization/throttling responses, TLS/CORS failures and unsafe inputs stop automatic resolution. Bounds and exact behavior are in [automatic continuity](AUTOMATIC_CONTINUITY.md).

## Following on navigation

~~~mermaid
flowchart LR
    A[Visit selected followed source] --> B[GET main-frame DNR rule]
    B --> C[Packaged continuity gate]
    C --> D{Current enrollment, pause and permission valid?}
    D -->|Yes| E[Resolve live and remembered successor chain]
    E --> F{Reachable supported terminal?}
    F -->|Yes| G[Discovered homepage]
    F -->|Needs permission or sensitive confirmation| H[Explain and wait]
    F -->|Unknown, conflict or unavailable| I[Stop and explain]
    E -->|Live original with no move or history| J[Tab-scoped original navigation bypass]
    D -->|No| I
~~~

Following requires explicit source-only enrollment and consent to unverified source-declared moves. Checking a source does not itself enable interception. By default new origins require user permission; an optional off-by-default HTTPS-wide grant allows further chain checks without repeated permission prompts. It does not enroll all websites.

The gate rejects forged/stale envelopes and reads current enrollment/configuration, permissions and global pause again. It rechecks the discovered terminal before routing and binds confirmation to the displayed destination. Cross-domain continuity uses a homepage policy, drops original query/fragment/path information, and confirms sensitive original links. Session attempt guards stop repeated switching in a tab. A live unmoved original can resume its own original URL via a bounded tab-scoped bypass without being called a migration. Source URL data is removed from the gate's visible history entry before asynchronous work.

DNR interception covers only top-level GETs for selected granted origins. POSTs, iframes, subresources, unlisted hosts and suffix lookalikes are outside those rules. Manual or signed registry policy reserves its source ahead of the unverified continuity lane. Previously trusted signed aliases remain reserved after catalog expiry, withdrawal or cache deletion; a corrupt/incomplete signed reservation history blocks the weaker lane rather than silently re-enabling it. This public security metadata inhibits unverified routing and does not restore expired signed authority.

## Shared manual destination groups

An optional local mapping field, `followOrigin`, identifies a shared destination group by its canonical HTTPS seed origin. All mappings with that seed must have the same `destinationOrigin`; it remains a local user-configured policy, separate from signed registry `familyId`. Each alias retains its own enabled state, expiry and path policy. New mappings remain fixed unless the user checks **Follow future moves for all mappings to this destination** or enables **Follow destination moves** on an existing card. Enabling groups every local mapping currently sharing that current destination.

On a group alias visit or explicit settings check, the mapping follower starts discovery at the **current destination's root**, not at any retired alias. A healthy unmoved current origin can remain current. A supported, freshly checked C → D chain can atomically change all aliases' destination to D and introduce C as another old alias. Later D → E advances the same group without requiring A/B to be probed or remapped individually. Valid origin-only continuity memory can bridge qualifying vanished known hops; it cannot supply an unseen successor. There is no periodic background polling or update while the browser is closed. The separate unchecked **Allow future destination checks across HTTPS websites** option requests the existing optional HTTPS-wide grant only at the save/enable gesture; individual-origin permission remains the default.

`advanceMappingGroup` validates the local group, flattens its aliases directly to the new terminal and preserves timestamps, pause states and per-alias path decisions. Its derived former-current alias uses existing group consent rather than extending it. A generation-guarded configuration commit replaces DNR rules once for the shared change. Checks revalidate local configuration, current expiry, source/checked-origin permissions and signed reservations before and after network work and before final navigation. Every group member source, seed, current, attempted, intermediate and terminal origin remains subject to signed-history barriers. A local group identifier shares its loop guard across aliases without pretending to be a signed website family.

Conflicting successors, return cycles, an unchecked terminal, missing permission, revoked grants, stale configuration, global pause and expired consent stop routing rather than fall back to an unchecked static target. The 50-local-mapping cap and existing no-chain invariant also apply: a fixed mapping outside the group that still depends on the former current address can block its conversion into a derived alias. No automatic update changes that separate fixed decision. **Stop following destination moves** removes automatic-follow membership for the entire local group and retains the latest explicit destination mappings.

Settings exports include local `followOrigin` membership. Imports remain user decisions needing review and browser grants; exports do not include provider/service secrets, learned continuity edges or followed-source enrollment. Operational steps and a worked A/B → C → D → E example are in [shared destination groups](SHARED_DESTINATION_GROUPS.md).

## Manual page paths, fresh navigation and loop recovery

New explicit manual mappings default to preserving a compatible public page path while changing its domain. Existing saved policies are not silently converted. A saved card's **Keep page paths** / **Open homepage only** control changes that policy after checking the current configuration generation; it does not renew the mapping's expiry or change its destination or provenance. Queries and fragments are never forwarded. Sensitive or ambiguous source URLs still require the current homepage-only confirmation. Inferred continuity and newly remembered Internet choices remain homepage-only until an explicit manual policy change.

The manual/signed mapping gate (`route.html`) retains a 15-second session guard keyed by tab and fixed local mapping, local shared-follow group, or signed website family. These identities are kept separate. Version 0.2.2 additionally consumes browser-owned `webNavigation.onCommitted` metadata for its own top-level packaged gates. A fresh typed or ordinary link navigation can proceed without a pause solely because an earlier switch happened recently. The authorization is tied to the exact gate document, expires within two minutes and is consumed once. Its session record contains a document identifier, gate path, time and fresh-navigation classification; it excludes the raw source envelope, remote page paths and unrelated browsing history. Browser metadata is not proof of a physical user gesture, so an independent ceiling permits at most six accepted automatic switches per fixed mapping, local shared group or signed family and tab in 15 seconds. Returned server/client redirect chains remain guarded, and missing or unsupported metadata falls back to the conservative guard.

The `webNavigation` permission may cause Chrome to display a browsing-history warning. The implementation handles only its own packaged gate commits and ignores unrelated navigation; it does not use the `history` API or persist general URL history. This permission and its limited processing are disclosed in the [privacy policy](privacy.html) and [Store guide](CHROME_INSTALL_AND_STORE.md).

If switching is still paused, the loop screen displays the exact current-policy target. It offers **Open mapped page once** when the policy safely preserves that public path, or **Open destination homepage once** for homepage-only policy. Sensitive/ambiguous or registry-confirmed routes keep their existing confirmation restrictions. Recovery requires an explicit click and a worker-issued single-use token bound to the gate document, mapping/family, source and exact displayed target. The worker revalidates current mapping, permission, configuration generation, expiry and target before consuming that choice and renewing the normal guard. Like the existing Undo reference, its browser-session binding can temporarily retain the exact selected destination URL, including a permitted public page path, for a two-minute authorization window; it is not a persistent browsing log or a settings export. It never forwards query/fragment data, upgrades trust or disables protection against a subsequent automatic bounce. No timed or automatic recovery retry is introduced.

The user should review the current destination if the warning returns immediately. Controlled browser cases test repeated deliberate visits, page-path and homepage policies, real redirect returns and policy changes while a gate is open; exact-source outcomes belong to CI and the validation ledger. They do not establish the reported public domains' live behavior. Installation and same-folder reload steps are in [the Chrome guide](CHROME_INSTALL_AND_STORE.md).

## Separate reviewed registry lane

~~~mermaid
flowchart LR
    A[Untrusted report or server observation] --> B[Pending candidate]
    B --> C[Reviewer decision]
    C --> D[Different authorized publisher]
    D --> E[Immutable signed catalog]
    E --> F[Client signature/schema/freshness/high-water checks]
    F --> G[Current local gate]
~~~

The direct browser's source_declared result never becomes registry_reviewed or owner_verified automatically. Server queue discovery still leaves public results unknown while candidates await independent review/publication. A registry signature, monotonic sequence/digest and expiry authenticate published decisions separately from the browser's local observation graph. The [server queue guide](DISCOVERY.md) and [restricted worker grants](DISCOVERY_DATABASE.md) describe that deployment, which is disabled in the default public topology.

The public API role refuses a private publishing key. A separate publisher role requires one, and its deployed private ingress, OS identities and immutable PostgreSQL grants must be verified. Demo keys/accounts are synthetic and are not production trust anchors. The offline owner CLI does not complete enrollment, domain-control proof, transfer or key recovery.

## Privacy and network limits

Browser continuity stores selected origins, evidence kinds and observation times locally. It discloses the requester's IP/request timing to sites it directly checks. Broad optional HTTPS access is a capability that users must deliberately choose; it is not ordinary browsing-history collection. Clearing local data includes followed sources, their graph and routing activity. Public catalog high-water/alias-reservation metadata is retained to prevent signature replay and trust downgrade. See the [extension privacy page](privacy.html).

The browser validates literal URLs/private/reserved host forms but cannot pin the browser's DNS answer or connected peer. Do not claim server-grade SSRF protection for this lane. The optional server fetcher separately validates all DNS answers, pins connected addresses, preserves TLS hostname checks and bounds redirects, bytes, robots and time. An actual firewall/egress boundary must independently deny private/metadata/application networks; an ordinary managed CONNECT proxy cannot prove its connect IP, so the fetcher refuses that mode. Building its JAR does not deploy public crawling.

The [novelty and evidence report](NOVELTY_AND_EVIDENCE.md) separates implemented chain recovery from untested owner/temporal-graph research and established prior art.

## Internet discovery increment and wider roadmap

The implemented increment provides browser-local archive investigation and a separate optional authenticated `/v2/discoveries` service. It targets a fresh installation with no successor history or typed destination. The service uses a private SQLite database instead of adding a Java/PostgreSQL schema: this keeps the existing V1 migration, registry roles and `/v1/lookups` abstention contract unchanged. The worker/fetcher remain separate from provider credentials; an optional existing internal fetcher can add availability observations.

Internet candidates carry bounded dated public evidence and `unverified_candidate` / `confirm_only` labels. They cannot enter the existing observed-edge graph under a forged evidence kind, become a signed decision or silently install rules. Opening rechecks current job/source settings, every encountered signed reservation, browser permission and the displayed destination. An explicit 24-hour choice creates only a normal `user_configured` homepage mapping. A later explicit **Keep page paths** change on that saved mapping does not verify the inferred relationship or extend its expiry.

Client jobs expire after one hour and cancellation invalidates completed suggestions too. Local clear aborts jobs and removes service configuration/session credentials; late callbacks cannot restore cleared work. Interrupted archive work fails closed after worker restart. Remote jobs use opaque authenticated references and resume by polling rather than redispatching paid work. The service independently enforces short fenced phase leases, durable quotas/deadlines, owner isolation and its own retention. Browser and server availability vantages remain distinct.

The [operation guide](INTERNET_DISCOVERY_OPERATION.md) and [scope/status matrix](INTERNET_DISCOVERY_STATUS.md) document actual deployment and limits. The wider [design](INTERNET_DISCOVERY_PLAN.md), [80 ideas](INTERNET_DISCOVERY_IDEAS.md), [36-task backlog](INTERNET_DISCOVERY_BACKLOG.md), and [evaluation plan](INTERNET_DISCOVERY_EVALUATION.md) remain the roadmap for general provenance clustering, temporal identity inference, owner enrollment and measured effectiveness. Those research capabilities and public deployment are not implied by a working provider adapter.
