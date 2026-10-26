# Web Switcher

Follow a website when its address changes. The long-term design combines a verified migration history, cached shortcuts, and optional owner-signed updates.

This branch contains the research plan and an **experimental local-mapping extension**. You enter and approve the destination. Automatic discovery, a public registry, owner verification and the Java backend are still planned. A reachable or similar-looking site is not necessarily the same site.

- [Complete research and implementation plan](docs/WEB_SWITCHER_PLAN.md)
- [Prototype scope and trust decision](docs/ADR-001-prototype-scope.md)
- [Progress, tests and remaining release gates](docs/PROTOTYPE_STATUS.md)
- [Research experiment instructions](research/README.md)

## Try the prototype

Use a separate development browser profile. This is not a browser-store release.

1. Clone this branch or download its source ZIP.
2. In Chrome, open `chrome://extensions`; in Edge, open `edge://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the repository's `extension` directory. No build or backend is required.
4. Click Web Switcher in the extensions menu, or open its **Extension options**.
5. Enter the exact old origin and a current HTTPS origin that you have independently checked. Confirm the destination and grant access to the old origin when the browser asks.
6. Open the old origin in a tab. A local gate checks the mapping before opening the destination.

An origin consists of the protocol and hostname, for example `https://old-site.com`; it contains no page path, query, or fragment. `http://old-site.com` and `https://old-site.com` are separate sources. Each source requires its own explicit browser permission. The production package excludes IP addresses, private/reserved hostnames and nonstandard ports.

Only top-level GET navigation is eligible. The default opens the destination homepage. The optional path-preserving mode is for known compatible public paths: private information can occur in path segments, and the built-in sensitive-path filter is not exhaustive. Query parameters and fragments are always removed. Recognized account, payment, download and ambiguous links pause and offer an explicit homepage action.

Mappings expire after 1 hour, 24 hours, or 7 days. Expired mappings must be removed and re-added after checking the destination. There are at most 50 mappings. Connections must point directly to their final destination; chained local mappings are rejected. Multiple old origins may point to the same final destination.

## What is implemented

- Original spider/thread interface with local mapping, pause, remove and activity controls.
- Exact-origin, GET-only, top-level DNR rules for granted source origins.
- A packaged gate that checks generation, expiry, pause state, permissions and URL policy at use time.
- Local configuration reconciliation and a per-tab guard against immediate redirect loops.
- Up to 20 origin-only routing receipts, with a clear action. Receipts record attempts, not successful page loads.
- No account, backend calls, analytics, content scripts, browsing-history access or cookie access.

The gate is web-accessible so links from ordinary pages can reach it. Direct requests are validated; its destination comes from local configuration. The source envelope is removed from the gate's address before asynchronous work.

## Development and tests

Node 22+ and Python 3 are required for the development tools. CI uses Node 24 and Python 3.12. The extension itself uses packaged browser JavaScript without a build dependency; the eventual React/WXT application remains a separate milestone.

```sh
npm ci --ignore-scripts
npm run check
npm test
npx playwright install --with-deps chromium --no-shell
npm run test:research
npm run test:browser
npm run package
```

Playwright 1.56.1 and its Chromium 141 reference build are pinned to reproduce this feasibility exercise. These test dependencies are not shipped in the extension. Run browser tests only against the disposable local fixtures. Passing on this reference build does not establish compatibility with current Chrome/Edge releases.

Browser tests copy the extension into a temporary directory, enable reserved `.test` fixture origins and pregrant those hosts. The package checker prevents fixture mode from entering the distributed ZIP. Native host-permission prompts, revocation behavior and store builds remain separate manual release gates.

The prepared GitHub Actions workflow runs the suites with a read-only repository token and publishes the extension ZIP, raw results and fixture screenshots as a 14-day artifact. It has not run: repository publication was blocked by the connected integration's permissions and no authenticated Git push was available. It does not deploy or publish to either browser store. Successful local packaging produces `dist/web-switcher-prototype.zip`; extract it before choosing **Load unpacked**.

## Research result

Live redirect chains work while the required origins answer. Remembering the verified final destination can survive dead intermediate origins. History cannot reveal an unobserved later move; that requires independent evidence or an authenticated update channel. A signature proves control of a key, not initial ownership, and does not by itself solve a stolen legitimate key.

The linked plan records prior art, proposed novelty experiments, backend/frontend architecture, infrastructure, deployment costs and the full backlog. Product-wide tasks remain open unless their complete acceptance criteria have actually been demonstrated.
