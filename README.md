# Web Switcher

**Find the current address from an old website address.**

Web Switcher follows available website-move declarations and remembers the successor chain locally. Enter the **old address only**: the extension can discover A → B → C from HTTP redirects, short refresh declarations and explicit successor metadata. After you choose to follow that site, future visits recheck the chain; a previously learned A → B link can remain useful when A stops resolving. You do not have to type C as a manual mapping.

There is no universal “latest domain” field in a URL. If the last known site disappears without an observed successor, the extension reports unknown. It does not infer ownership from a matching name/logo, execute downloaded page scripts, or claim universal broken-link recovery. The observed destination is labelled **source declared**, not independently owner or registry verified.

Start with [automatic continuity: how it works and how to use it](docs/AUTOMATIC_CONTINUITY.md). For installation and Store submission, use [the complete Chrome guide](docs/CHROME_INSTALL_AND_STORE.md).

## Find and follow a website

1. Install the unpacked extension or a reviewed Store build and open **Find current address** from its popup.
2. Enter the old public HTTPS address. The popup can prefill the current tab's origin. No destination field is required.
3. Click **Find current address** and grant the selected source's access. By default, approve each newly discovered origin with **Allow next check**. The optional **Allow automatic checks across HTTPS domains** checkbox requests broader access once; it is off by default.
4. Inspect the observed chain and choose **Open latest address**. The background checks again before opening it.
5. To handle later moves on visits to that old source, explicitly consent and choose **Follow this website**. Its packaged gate checks available declarations and fresh remembered successors at use time.

This extension flow needs **no account, Java backend, Docker deployment or registry server**. It contacts the selected website/successors from your browser without cookies or a referrer. A live unmoved source can continue on its original URL; cross-domain continuity opens the discovered homepage and does not forward the original query, fragment or private path. Sensitive original links require confirmation.

Manual old→new mappings remain available as secondary explicit overrides. Signed reviewed registry decisions remain a separate, stronger provenance class. Existing manual/signed decisions take precedence for the same exact source. Previously trusted signed aliases remain reserved after catalog expiry, withdrawal or cache deletion, so weaker discovery cannot silently replace that authority.

## Implemented components

- **Automatic MV3 continuity:** source-only discovery, bounded explicit successor parsing, local seven-day edge memory, source-only followed-site enrollment, rechecking on selected-site visits, dead-known-hop recovery, conflict/cycle refusal and origin-only explanations.
- **Local control:** per-origin optional grants, optional broader HTTPS discovery consent, pause, forget, clear data, minimal receipts and bounded tab undo. No account or publisher telemetry is required.
- **Manual mappings:** exact source/destination overrides, expiry, path policy, strict import/export and validation gate.
- **Signed registry:** ES256, closed schemas, expiry, rollback/equivocation protection, reviewed public-path policies and family withdrawal. No production trust root is bundled.
- **Java API / React admin:** PostgreSQL persistence, hostname-only lookups/reports, separate review/publication, CSRF/OIDC, immutable releases and audit. Public reports cannot publish a route.
- **Optional server observation:** isolated authenticated fetcher with HTTP/meta successor resolution, public-DNS/address/socket checks, HTTPS/robots/resource bounds; a separate keyless queue worker still submits unverified candidates for moderation. It is not required for the browser's local discovery.
- **Experimental owner tools:** offline key generation and record signing/verification. Live enrollment, domain-control bootstrap and key recovery are not complete.

This is the reconstructed **0.2.0 development platform**, not a public deployment or approved browser-store release. See [implementation evidence](docs/IMPLEMENTATION_STATUS.md), [all 134 original plan IDs](docs/PLAN_TRACEABILITY.md) and [novelty/prior-art limits](docs/NOVELTY_AND_EVIDENCE.md). The original [research plan](docs/WEB_SWITCHER_PLAN.md) remains a historical roadmap.

## Install or build the extension

The [Chrome installation/Store guide](docs/CHROME_INSTALL_AND_STORE.md) includes a no-toolchain Actions-artifact download path, real reviewer instructions, Store assets, privacy-page hosting and updates.

For an extension-only source build, use Node 24 LTS, npm and Python 3:

~~~sh
npm ci
npm test
npm run check
npm run package
~~~

Load the resulting dist/web-switcher directory at chrome://extensions → Developer mode → Load unpacked. The ZIP is dist/web-switcher-0.2.0.zip; extract it before loading. The normal build has fixture mode disabled and no pregranted source access.

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
