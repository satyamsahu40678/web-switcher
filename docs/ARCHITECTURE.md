# Web Switcher architecture

Web Switcher's primary browser flow discovers a current destination from an old address and explicit successor evidence. The user supplies the old source only, inspects the chain and can enroll that source for automatic future following. Manual mappings and signed reviewed registry decisions remain separate policies with precedence for their exact sources. Reachability, historical identity and deep-page compatibility are distinct questions.

## Components and authority

| Path | Responsibility | Boundary |
| --- | --- | --- |
| extension/continuity-probe.js | Scoped browser requests and bounded non-executing HTTP/meta successor extraction | Source-declared observations; no browser DNS/connect-IP pinning claim |
| extension/continuity.js | Validated origin-only graph, edge freshness, bounded resolution and remembered-successor recovery | Does not create registry/owner trust or invent unseen domains |
| extension/continuity-worker.js and continuity-gate.* | Source-only enrollment, DNR gate, current discovery, permission/confirmation controls | Only selected followed sources; packaged code; manual/signed overrides take precedence |
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

## Proposed Internet discovery increment

The [Internet discovery design](INTERNET_DISCOVERY_PLAN.md) proposes an optional hybrid service: hostname-only, consented asynchronous search/archive investigation; isolated bounded candidate observations; provenance-aware ranking; and separately enforced navigation authority. It targets a fresh installation with no successor history or typed destination. The [idea register](INTERNET_DISCOVERY_IDEAS.md), [36-task backlog](INTERNET_DISCOVERY_BACKLOG.md), and [evaluation/threat model](INTERNET_DISCOVERY_EVALUATION.md) document alternatives and delivery gates. No online provider adapter, new `/v2` API, owner lifecycle or multi-source queue is implemented by those documents; existing contracts above remain the runtime behavior.
