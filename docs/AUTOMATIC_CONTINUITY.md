# Find the current domain from the old domain

Updated 28 October 2026 (Asia/Kolkata).

The main extension flow starts with the **old website address only**. Web Switcher inspects explicit move signals, follows a bounded chain and remembers observed successors. A manually typed old→new pair is an optional override, not the prerequisite for this flow.

## What the linked-list idea can do

~~~text
First observation:       old A ──HTTP redirect──> B ──meta refresh──> current C
Later, A is dead:         old A ──remembered─────> B ──observed──────> current C
Later, A and B are dead:  old A ──remembered─────> B ──remembered────> C ──move──> D
~~~

On a later check the extension can skip a known hop with a qualifying DNS/connection failure, a bounded timeout, or an explicit HTTP 404/410 response, and try its unique unexpired recorded successor. The last address must respond successfully before the result says **A reachable address was found**. A previously reachable address is not presented as working merely because it is in storage.

If C disappears before anyone observes C→D, this chain cannot reveal D. There is no universal website identity/next-domain database encoded in an ordinary old URL. A first-time dead source with no remembered link and no separate trusted registry record remains unknown. The system never fills that gap by choosing a similar name or logo.

The extension now also offers a separate **Search public sources** flow: it can investigate public archive indexes and historical announcements without local history. A separately configured optional service adds web search. See [the operation guide](INTERNET_DISCOVERY_OPERATION.md) and [delivered scope](INTERNET_DISCOVERY_STATUS.md). These produce unverified suggestions requiring a fresh check and explicit choice; they do not pretend the live/local graph knew an unseen edge. The wider [design](INTERNET_DISCOVERY_PLAN.md), [idea register](INTERNET_DISCOVERY_IDEAS.md), [backlog](INTERNET_DISCOVERY_BACKLOG.md) and [evaluation plan](INTERNET_DISCOVERY_EVALUATION.md) include further research not yet implemented.

Normal browsers already follow live HTTP redirects. The extension's additional value is inspecting supported non-executing metadata, explaining the chain, retaining selected continuity history, and reusing known successors after earlier hosts stop resolving.

## Use it in your browser

1. Follow [the installation guide](CHROME_INSTALL_AND_STORE.md) and load the current build in desktop Chrome/Edge.
2. Open the extension popup and click **Find current address**. A normal current tab supplies its origin automatically; otherwise enter the old public HTTPS address in **Old website address**.
3. Click **Find current address**. The input's path, query and fragment are discarded before the initial root probe; the new domain is not requested from you.
4. Grant access to the selected origin. By default, if it points to another origin, the UI shows **Allow next check**. Clicking it requests that discovered origin's permission and continues from the same old source.
5. Optionally select **Allow automatic checks across HTTPS domains** before starting. Chrome then asks for broader HTTPS access once, allowing the extension to check future origins of chains you explicitly request/follow without a permission dialog for each hop. This is off by default; it does not opt every visited website into following.
6. Read the origin-by-origin chain, evidence labels and any remembered steps. Choose **Open latest address** to recheck the result and open its homepage. The destination is discovered; you do not type it into a mapping field.
7. To reuse this behavior on later visits, check the explicit following-consent box and choose **Follow this website**. The source is enrolled without a destination input.
8. The next top-level GET visit to that selected old source opens a packaged continuity gate. It checks current source declarations and valid memory again, and automatically continues when a supported current chain is established. An unresolved permission, conflict, loop or unavailable endpoint is explained instead.

Opening a sensitive original link requires confirmation before crossing origins. Cross-domain continuity opens the discovered homepage rather than attempting arbitrary deep-page reconstruction. Queries, fragments, credentials and logged-in sessions are not transferred. If a followed source is live and has no move evidence or outgoing memory, it can resume the original same-origin URL through a short tab-scoped bypass; that is not reported as a discovered migration.

Use **Pause following**, **Resume following** and **Forget this website** in the saved-following section. Forget removes that source's enrollment and connected remembered history; other selected sources in the same component may need to relearn links. **Delete all local data** removes local mappings, followed websites, continuity history, routing activity and the downloaded catalog cache. Public catalog rollback/security metadata is retained: previously trusted signed aliases stay reserved so clearing data, expiry or withdrawal cannot silently downgrade them to unverified continuity. The barrier applies to every reached chain origin, including intermediates, and is checked again before opening a result. Existing manual/signed policy takes precedence for its exact source. Remove an unwanted manual override before expecting source-only following to control that source; a signed alias reservation is not removed by deleting its cache.

## Supported move signals

| Signal | Browser behavior | Meaning |
| --- | --- | --- |
| HTTP 301/302/303/307/308 Location | Read the response header, validate the next URL, then check its permission before a separate request | A declaration by the responding source, not proof of historical ownership |
| HTTP Refresh with a supported short delay and URL | Validate and inspect the declared next address | Same unverified source-declared class |
| HTML meta http-equiv=refresh | Parse bounded HTML without executing it; follow a unique supported URL | Same unverified source-declared class |
| HTML link rel=web-switcher-successor | Follow an explicit, unique project-convention successor link | A project convention, not an interoperable identity standard |
| Explicit link to same-origin /.well-known/web-switcher.json | Read its closed schemaVersion/successorOrigin document only after the link advertises it | An unverified project-convention pointer; not Site Passport enrollment or an owner signature |

Canonical tags, Open Graph values, arbitrary page links, advertisements, logo similarity and matching names do not automatically become successor edges. The browser probe ignores scripts and inert markup instead of executing site JavaScript. Script-generated/obfuscated moves without a supported declaration may remain unknown. HTTPS is required for normal continuity probes; HTTP custom-port .test hosts exist only in isolated test builds.

Examples of explicit declarations an operator can provide are:

~~~html
<meta http-equiv="refresh" content="0;url=https://current.example.org/">
<link rel="web-switcher-successor" href="https://current.example.org/">
~~~

To advertise the same-origin JSON pointer, the source page can include:

~~~html
<link rel="web-switcher-successor" href="/.well-known/web-switcher.json">
~~~

That document uses:

~~~json
{"schemaVersion":1,"successorOrigin":"https://current.example.org"}
~~~

A source can make a false or malicious declaration. These examples are mechanisms, not ownership certificates or a recommendation to trust an unknown site.

## What is stored and bounded

The local graph contains origins, evidence types, first/last observation times and validity times. It does not retain fetched HTML, original page paths, queries, fragments or credentials. Followed-source enrollment is separate from graph edges, so checking a chain does not silently turn on future navigation interception.

Current limits are 50 followed sources, 250 stored edges, a seven-day edge validity window, eight cross-origin successor hops, twelve graph probe steps and a 25-second graph operation budget. Each browser probe additionally has an eight-second limit and a 128 KiB body cap. An explicitly advertised same-origin metadata document consumes another probe step within the same overall graph budget; each individual request has its own eight-second cap. Expired graph edges are pruned on graph reads, including periodic maintenance; a closed browser cannot perform background deletion while it is not running.

DNS/connection failures, bounded timeouts and explicit HTTP 404/410 responses can use a unique fresh remembered successor. Without such a recorded successor, those responses do not reveal a destination. HTTP 401/403/429/5xx, TLS errors, generic fetch/CORS failures, unsafe addresses, conflicting declarations, loops, expired memory and clock anomalies do not authorize that recovery path. The browser is not a CAPTCHA bypass or a certificate-warning suppressor.

If an origin announces a different successor while a contradictory unexpired edge is stored, the graph reports a conflict rather than silently replacing history. Inspect the change before forgetting the relevant chain and starting a fresh check. A new final-node C→D declaration extends the chain normally; the implementation is not a general graph-inference or ownership-transfer engine.

## Trust classes and network privacy

| Class | Authority |
| --- | --- |
| Source declared | Observed HTTP/metadata continuity plus local memory. The user chooses whether to open/follow it. It remains unverified. |
| User configured | The user explicitly supplied an old→new manual override. Import cannot upgrade its provenance. |
| Registry reviewed | A separately signed, closed and current catalog decision passed the registry review/publication policy. It is not a content-safety warranty. |
| Owner verified | Reserved for an independently established owner lifecycle. The offline signing CLI and source declarations do not create this authority. |

Direct discovery contacts the selected origin and successors from your browser, so those servers can see your IP and normal request metadata. Probes omit cookies/HTTP credentials and referrers and do not execute downloaded scripts. The required webRequest permission reads the Location/Refresh response headers of actively correlated extension-initiated probes. The probe awaits that matching callback within its existing deadline even if the fetch promise settles first; it is not used to record ordinary browsing requests. The extension's optional broad HTTPS grant is a broader capability and should be chosen knowingly.

Browser-side validation rejects private literal/reserved addresses and unsafe URL forms. It cannot pin the browser's resolved DNS/connect IP. It therefore does not make the isolated server fetcher's SSRF/egress guarantee. The optional server resolver has separate DNS/all-address/socket/robots checks and still needs a verified deployed public-only egress boundary. No server is required to use this browser feature.

## The supplied public example

The user described https://vegamovies.rs/ as an old address and https://new1.vegamovies.lease/ as its current successor. Those URLs illustrate the requested behavior; they are **not** production seeds or hardcoded mappings. Current ownership, availability and their actual move mechanism have not been independently verified in this managed environment.

To try any such public case, enter only the old HTTPS address in **Find current address**. The result depends on the declarations returned now, browser permissions and any history already learned. A successful controlled A→B→C test does not establish that an unrelated real-world example has the same mechanism or remains correct tomorrow.

## Validation and reproduction

Relevant source modules are [the graph](../extension/continuity.js), [bounded probe/parser](../extension/continuity-probe.js), [worker controller](../extension/continuity-worker.js) and [navigation gate](../extension/continuity-gate.js). Relevant checks are [graph tests](../tests/continuity.test.mjs), [probe tests](../tests/continuity-probe.test.mjs), [native probe proof](../tests/continuity-probe-browser.mjs), [native continuity journey](../tests/continuity-browser.mjs) and [UI contract test](../tests/continuity-ui.mjs). File presence is not an executed test result; use [the validation ledger](IMPLEMENTATION_STATUS.md) and exact-source CI links for outcomes.

The [fetcher guide](../fetcher/README.md) describes an optional authenticated internal /resolve endpoint for server-side HTTP/meta successor observation. It leaves the existing /probe contract and candidate-only public review queue intact; it neither enrolls a browser source nor automatically publishes a registry route.
