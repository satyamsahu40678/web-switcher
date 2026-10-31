# Web Switcher

**Find the current address from an old website address.**

Web Switcher follows available website-move declarations and remembers the successor chain locally. Enter the **old address only**: the extension can discover A → B → C from HTTP redirects, short refresh declarations and explicit successor metadata. After you choose to follow that site, future visits recheck the chain; a previously learned A → B link can remain useful when A stops resolving. You do not have to type C as a manual mapping.

If direct signals and local memory run out, choose **Search public sources**. The extension investigates public archive indexes and historical move announcements even on a first installation with no saved history. An optional authenticated search service adds broader web search. Results are explained, unverified suggestions: check a candidate live before opening it, or explicitly remember a user-configured choice for 24 hours.

There is no universal “latest domain” field in a URL. If available public evidence supplies no supported successor, the extension reports unknown or unavailable. It does not infer ownership from a matching name/logo or execute downloaded page scripts. Live declarations remain **source declared**; Internet suggestions remain **unverified candidates**, with no automatic trust upgrade.

Start with [automatic continuity: how it works and how to use it](docs/AUTOMATIC_CONTINUITY.md). For installation and Store submission, use [the complete Chrome guide](docs/CHROME_INSTALL_AND_STORE.md).

Use the [Internet discovery operation guide](docs/INTERNET_DISCOVERY_OPERATION.md) for the working archive flow and optional search service. The [implementation status](docs/INTERNET_DISCOVERY_STATUS.md) distinguishes delivered code from the wider [design](docs/INTERNET_DISCOVERY_PLAN.md), [80 ideas](docs/INTERNET_DISCOVERY_IDEAS.md), [36-task backlog](docs/INTERNET_DISCOVERY_BACKLOG.md) and [evaluation plan](docs/INTERNET_DISCOVERY_EVALUATION.md). Real-provider availability and identity accuracy are separate from controlled engineering tests.

## Find and follow a website

1. Install the unpacked extension or a reviewed Store build and open **Find current address** from its popup.
2. Enter the old public HTTPS address. The popup can prefill the current tab's origin. No destination field is required.
3. Click **Find current address** and grant the selected source's access. By default, approve each newly discovered origin with **Allow next check**. The optional **Allow automatic checks across HTTPS domains** checkbox requests broader access once; it is off by default.
4. Inspect the observed chain and choose **Open latest address**. The background checks again before opening it.
5. To handle later moves on visits to that old source, explicitly consent and choose **Follow this website**. Its packaged gate checks available declarations and fresh remembered successors at use time.
6. If the direct chain is unresolved, leave only the old address in the input, consent to online investigation and choose **Search public sources**. Default archive discovery needs no account, search key, history file or backend. Inspect each suggestion's historical evidence, choose **Check this address**, allow its origin if requested, then open the freshly checked homepage. **Remember this choice for 24 hours** is an explicit unverified override, not an ownership certificate.

The default extension flow needs **no account, Java backend, Docker deployment or registry server**. Direct checks contact selected websites; explicitly requested archive discovery also sends the selected origin to Archive.org/Web Archive. Requests omit cookies and referrers. A live unmoved source can continue on its original URL; cross-domain continuity opens the discovered homepage and does not forward the original query, fragment or private path. Sensitive original links require confirmation. Broader web search uses the optional separately deployed service and its provider credentials; it is not a preconfigured public service.

Manual old→new mappings remain available as secondary explicit overrides. Signed reviewed registry decisions remain a separate, stronger provenance class. Existing manual/signed decisions take precedence for the same exact source. Previously trusted signed aliases remain reserved after catalog expiry, withdrawal or cache deletion, including when reached through another source’s chain, so weaker discovery cannot silently replace that authority.

## Implemented components

- **Automatic MV3 continuity:** source-only discovery, bounded explicit successor parsing, local seven-day edge memory, source-only followed-site enrollment, rechecking on selected-site visits, dead-known-hop recovery, conflict/cycle refusal and origin-only explanations.
- **First-use Internet discovery:** keyless public archive availability/CDX/snapshot investigation, inert historical redirect/metadata/announcement extraction, explained candidates, cancellation, expiring local jobs and fresh browser checks. No local history or typed destination is required.
- **Optional Internet search service:** separate dependency-free Node 24/SQLite service with a real Brave API adapter, shared archive adapter, authenticated owner-scoped jobs, durable phase leases/quotas/bytes, cancellation, caching and coherent backups. Missing credentials or providers produce explicit partial/unavailable results. Search cannot publish a signed route.
- **Local control:** per-origin optional grants, optional broader HTTPS discovery consent, pause, forget, clear data, minimal receipts and bounded tab undo. No account or publisher telemetry is required.
- **Manual mappings:** exact source/destination overrides, expiry, page-path preservation by default for new manual choices, an existing-mapping path/homepage control, strict import/export and validation gate.
- **Signed registry:** ES256, closed schemas, expiry, rollback/equivocation protection, reviewed public-path policies and family withdrawal. No production trust root is bundled.
- **Java API / React admin:** PostgreSQL persistence, hostname-only lookups/reports, separate review/publication, CSRF/OIDC, immutable releases and audit. Public reports cannot publish a route.
- **Optional server observation:** isolated authenticated fetcher with HTTP/meta successor resolution, public-DNS/address/socket checks, HTTPS/robots/resource bounds; a separate keyless queue worker still submits unverified candidates for moderation. It is not required for the browser's local discovery.
- **Experimental owner tools:** offline key generation and record signing/verification. Live enrollment, domain-control bootstrap and key recovery are not complete.

This is the reconstructed development platform with extension version **0.2.2**, not a public deployment or approved browser-store release. See [implementation evidence](docs/IMPLEMENTATION_STATUS.md), [all 134 original plan IDs](docs/PLAN_TRACEABILITY.md) and [novelty/prior-art limits](docs/NOVELTY_AND_EVIDENCE.md). The original [research plan](docs/WEB_SWITCHER_PLAN.md) remains a historical roadmap.

## Install or build the extension

The [Chrome installation/Store guide](docs/CHROME_INSTALL_AND_STORE.md) includes a no-toolchain Actions-artifact download path, real reviewer instructions, Store assets, privacy-page hosting and updates.

For a source build, use Node 24.5 or newer in the Node 24 LTS line, npm and Python 3:

~~~sh
npm ci
npm test
npm run check
npm run package
~~~

Load the resulting dist/web-switcher directory at chrome://extensions → Developer mode → Load unpacked. The ZIP is dist/web-switcher-0.2.2.zip; extract it before loading. The normal build has fixture mode disabled and no pregranted source access. For an existing installation, follow the guide's same-folder update steps and click **Reload** at chrome://extensions. Version 0.2.2 uses the browser's `webNavigation` metadata for its own local gates to distinguish ordinary new visits from redirect returns; Chrome may show a browsing-history permission warning, but the extension does not read the history database or retain unrelated browsing history.

For a known domain change with matching public page paths, choose **Keep its page path** when creating a manual mapping. For an existing homepage mapping, choose **Keep page paths** on its saved card. A link such as `https://old-site.com/download-invincible-hindi-dubbed-series/` then opens that same path on the mapped domain. Ordinary eligible visits proceed automatically. Queries/fragments are removed, sensitive links still require review, and a page can still be missing on the destination. Existing path choices and expiry are preserved unless you explicitly change them; inferred discoveries remain homepage-only by default. A remaining loop warning offers **Open mapped page once** when current policy permits that public path, while retaining redirect-loop protection.

A custom signed-registry build additionally needs both WS_REGISTRY_KEYS_FILE (a reviewed kid→public ES256 JWK map) and WS_REGISTRY_URL (an owned fixed HTTPS catalog endpoint) when packaging. Private signing material and demo roots never belong in a distributed extension. Local continuity works without that configuration.

## Optional backend and web application

Use JDK 21 plus the locked Node dependencies:

~~~sh
npm --prefix apps/web ci
./backend/mvnw -f backend/pom.xml verify
./backend/mvnw -f fetcher/pom.xml verify
npm --prefix apps/web run build
~~~

Start a copied API JAR in its own working directory so generated demo state stays outside source:

~~~sh
mkdir -p /tmp/web-switcher-demo
cp /absolute/path/to/web-switcher/backend/target/web-switcher-api-0.2.0.jar /tmp/web-switcher-demo/api.jar
cd /tmp/web-switcher-demo
java -jar api.jar --spring.profiles.active=demo
~~~

From the repository in another terminal run npm run dev:web. Vite uses port 5173 and proxies the API on 8080. The explicit demo profile has demo-reviewer and demo-publisher with the intentionally public demo-password; those accounts do not exist in production. Alternatively, docker compose -f infra/compose/local.yml up --build serves the loopback demo on port 8088.

In the managed cloud environment, bash scripts/setup-cloud.sh prepares the repository workflow with proxy/TLS verification retained. Existing checkouts are isolated; a worktree is unnecessary. See [deployment](docs/DEPLOYMENT.md) for the optional server topology.

## Validation and limitations

~~~sh
npm test                              # routing, graph, probe, crypto and mocked-worker checks
npm run check                         # manifest, fixture exclusion, syntax and CSP
npm run package                       # inspectable extension ZIP
npm run test:browser                   # current manual/signed native extension suite
node tests/continuity-probe-browser.mjs # real manual-redirect/header-capture proof
node tests/continuity-browser.mjs       # source-only discovery and remembered-chain browser journey
node tests/continuity-ui.mjs            # UI contract with mocked background, not native acceptance
node tests/internet-browser.mjs         # native first-use archives and search-service connector
node tests/internet-ui.mjs              # Internet candidate UI contract in Chromium
npm --prefix apps/web run test:browser  # website UI contract; API mocked
npm --prefix apps/web run test:e2e-browser # actual loopback UI/API/database
npm run test:http                      # live Java/WebCrypto contract
bash infra/backup/test.sh
python3 infra/deploy/test-deploy.py
python3 infra/deploy/test-db-grants.py
python3 infra/deploy/test-worker-grants.py
npm run test:catalog-concurrency
~~~

The live web/API suites mutate synthetic demo data and need their documented fresh demo instance. The catalog sample is loopback-only and is not a production SLO. Native unpacked-extension tests need a browser policy that permits them; a managed-policy block is not a pass. Actual Chrome/Edge optional-permission dialogs, store installation and broader lifecycle acceptance remain release checks.

Current test outcomes belong to the exact revisions in [the evidence ledger](docs/IMPLEMENTATION_STATUS.md) and linked CI runs. The presence of new tests does not mean an unexecuted revision passed. Public host/domain/OIDC/signing setup, independently enforced server egress, off-host recovery, owner pilots and effectiveness studies remain separate gates. Browser-side literal-URL validation does not provide the server fetcher's DNS/connect-IP pinning guarantee.

## Further documentation

- [Automatic continuity and linked-successor memory](docs/AUTOMATIC_CONTINUITY.md)
- [Internet discovery usage, provider setup and deployment](docs/INTERNET_DISCOVERY_OPERATION.md)
- [Delivered Internet discovery scope and remaining roadmap](docs/INTERNET_DISCOVERY_STATUS.md)
- [Autonomous Internet discovery plan](docs/INTERNET_DISCOVERY_PLAN.md)
- [Internet discovery idea register](docs/INTERNET_DISCOVERY_IDEAS.md)
- [Internet discovery implementation backlog](docs/INTERNET_DISCOVERY_BACKLOG.md)
- [Internet discovery evaluation and threats](docs/INTERNET_DISCOVERY_EVALUATION.md)
- [Chrome installation and Store publishing](docs/CHROME_INSTALL_AND_STORE.md)
- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [API contract](docs/API.md)
- [Security and privacy](docs/SECURITY.md)
- [Deployment and backup setup](docs/DEPLOYMENT.md)
- [Release/incident checklist](docs/RELEASE.md)
- [Server discovery queue](docs/DISCOVERY.md)
- [Restricted worker database identity](docs/DISCOVERY_DATABASE.md)
- [Encrypted restore drill](docs/BACKUP_RESTORE_DRILL.md)
- [Fetcher contract](fetcher/README.md)
- [Publisher key handling](docs/SIGNING_KEYS.md)
- [Owner signing tools](packages/security/README.md)
- [Novelty, prior art and evidence](docs/NOVELTY_AND_EVIDENCE.md)
- [Original plan traceability](docs/PLAN_TRACEABILITY.md)
