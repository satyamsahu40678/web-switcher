# Web Switcher: all features, examples and real-world practice

**Version covered:** extension 0.3.0. **Updated:** 31 October 2026, Asia/Kolkata.

This guide explains what we designed, what currently works, how to try it, and what still needs development or an external service. The main purpose is to reach a website's current address from an old address. Manual mappings are one available route; they are not required for every discovery flow.

The implementation baseline is commit `cc2f80bed30f2746be432b957e06c56c0a1552d0`: 358 Node/JavaScript tests, 82 native Chromium groups, and all 15 CI jobs passed. These are controlled engineering tests, not a measured success rate for arbitrary public websites. See [implementation evidence](IMPLEMENTATION_STATUS.md).

> Examples use illustrative domains. Replace `your-domain.tld` with a domain you own when running the HTTPS lab. No real movie-site domain supplied in the conversation is a verified seed or promised working destination.

## Contents

1. [Choose the right feature](#1-choose-the-right-feature)
2. [Install or update](#2-install-or-update)
3. [Browser features, with examples](#3-browser-features-with-examples)
4. [A real HTTPS lab you can reproduce](#4-a-real-https-lab-you-can-reproduce)
5. [Internet investigation without saved history](#5-internet-investigation-without-saved-history)
6. [Optional broader-search service](#6-optional-broader-search-service)
7. [Optional reviewed registry and website](#7-optional-reviewed-registry-and-website)
8. [Experimental owner identity](#8-experimental-owner-identity)
9. [Privacy, safeguards and limits](#9-privacy-safeguards-and-limits)
10. [Testing and CI/CD](#10-testing-and-cicd)
11. [Chrome Web Store deployment](#11-chrome-web-store-deployment)
12. [Troubleshooting and acceptance checklist](#12-troubleshooting-and-acceptance-checklist)
13. [The distinctive engineering idea](#13-the-distinctive-engineering-idea)
14. [Every research idea and its current status](#14-every-research-idea-and-its-current-status)

## 1. Choose the right feature

Status meanings: **Implemented** means code exists and its stated mechanics have controlled tests. **Operator setup** means code exists but you must supply hosting, credentials or trusted configuration. **Experimental** means isolated tools exist without a complete product lifecycle. **Planned** means a design or proposed experiment. **Rejected** means an approach we intentionally do not use.

| Your situation | Feature | Status | Example outcome |
| --- | --- | --- | --- |
| You know only an old URL and it still exposes a move | Find current address | Implemented, no server required | A declares B, B declares C; discover C without typing it. |
| Earlier domains disappeared after you previously checked them | Remembered continuity chain | Implemented, bounded local history | A is gone; its fresh remembered A→B edge can still lead to a freshly checked C. |
| You already know the new domain and need the same article | Manual mapping with page paths | Implemented | `old/articles/42?q=x#part` becomes `new/articles/42`. |
| Several old domains must share the latest address | Shared destination following | Implemented, explicit opt-in | A/B→C; later C→D updates A/B/C→D together. |
| The old site is dead and this browser has no history | Search public sources: archives | Implemented, provider coverage required | Historical evidence suggests B; you check B before choosing it. |
| You want broader indexed web search | Optional Internet discovery service | Operator setup | A server queries its configured search provider and returns unverified candidates. |
| Your organization wants reviewed, signed routing decisions | Java registry + React review desk | Operator setup | A public report is reviewed and independently published before clients accept it. |
| You want an owner-signed stable identity | Offline Site Passport tooling | Experimental | Generate/sign/verify a record; this alone does not enroll an owner or activate routing. |
| You want universal recovery from no surviving evidence | General identity reconstruction | Planned research; no guaranteed solution | The correct outcome can be unknown or unavailable. |

Two distinctions matter throughout this guide:

- **Finding an origin is different from finding an article.** Direct discovery and archive candidate opening normally use a homepage. An explicit manual/shared mapping can preserve a compatible public article path.
- **Reachable is different from authentic.** A working HTTPS website, familiar name, search rank or redirect does not prove historical ownership or safe content.

## 2. Install or update

### 2.1 Install without development tools

1. Sign in to GitHub and open the repository's [platform Actions](https://github.com/satyamsahu40678/web-switcher/actions/workflows/platform.yml).
2. Choose a successful run containing extension **0.3.0 or later**. A failed or running build is not the package to distribute.
3. Download **web-switcher-development-packages** from Artifacts.
4. Extract the outer artifact, then extract `dist/web-switcher-0.3.0.zip` inside it.
5. Keep the extracted extension in a permanent folder. Its top level must contain `manifest.json`, `background.js`, `options.html` and `icons/`.
6. In desktop Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select that folder. Edge uses `edge://extensions`.
7. Pin Web Switcher from the browser's Extensions menu and open its popup.

No Java server, Docker deployment, account or paid search key is required for the ordinary extension, direct continuity, manual/shared mappings or keyless archive mode. Ordinary mobile Chrome does not support this desktop extension installation method. Managed browsers may prohibit unpacked extensions; use an allowed profile/device.

### 2.2 Build from source

Requirements: Git, Node 24.5+ in the Node 24 LTS line, npm, and Python 3.

```sh
git clone --branch feat/web-switcher-platform https://github.com/satyamsahu40678/web-switcher.git
cd web-switcher
npm ci
npm test
npm run check
npm run package
```

Load `dist/web-switcher/`. Packaging names the inner ZIP using the manifest version. If the feature branch has been merged and removed, clone `main` and confirm that its manifest includes the desired version.

### 2.3 Update an existing installation

1. Choose **Export settings** first if you need a manual-mapping backup.
2. Replace files in the **same installed extension folder** with the new package contents.
3. Click **Reload** on its card at `chrome://extensions`; approve any browser permission request you intend to grant.
4. Close old Web Switcher gate/options pages and reopen the original website URL. A gate strips the original request from its visible address; refreshing bare `route.html` cannot reconstruct it.
5. Keep one active copy. Store and unpacked installations normally have different storage/IDs; duplicate copies can compete.

Exports do not include followed-source enrollment or learned continuity history. Removing the extension can delete its local data. Full installation and update details: [Chrome guide](CHROME_INSTALL_AND_STORE.md).

## 3. Browser features, with examples

### 3.1 Find a destination from only the old address

**Use:** popup **Find current address →**, enter **Old website address**, then **Find current address**. The popup can prefill an ordinary current tab's origin.

**Example:** enter `https://a.lab.your-domain.tld/articles/42?public=yes#part`. Investigation starts at `https://a.lab.your-domain.tld/`; the private URL parts are not sent as the discovery query. A→B→C declarations can reveal C without a manually supplied replacement.

**Expected:** an explained chain, or a reason it could not establish one. Checking a source does not automatically enroll it for future interception.

### 3.2 Recognize explicit website move mechanisms

An operator can publish one of these signals on a domain they control. Use your own publicly trusted HTTPS domains; the normal build excludes localhost, IP literals, custom ports and reserved test hosts.

| Mechanism | Concrete operator example | Extension behavior |
| --- | --- | --- |
| HTTP redirect | `302` with `Location: https://c.lab.your-domain.tld/` | Inspects the next URL and permission before a separate request. Supports 301/302/303/307/308. |
| HTTP Refresh | `Refresh: 0; url=https://c.lab.your-domain.tld/` | Accepts supported short delays, at most 10 seconds. |
| HTML meta refresh | `<meta http-equiv="refresh" content="0;url=https://c.lab.your-domain.tld/">` | Parses bounded HTML without running its scripts. |
| Explicit successor link | `<link rel="web-switcher-successor" href="https://c.lab.your-domain.tld/">` | Treats this project convention as a source declaration. |
| Advertised JSON pointer | HTML links to `/.well-known/web-switcher.json` with `rel="web-switcher-successor"` | Reads that same-origin document only after advertisement. |

The pointer body must be served as `application/json` and use this closed shape:

```json
{"schemaVersion":1,"successorOrigin":"https://c.lab.your-domain.tld"}
```

Advertising it in the root page:

```html
<link rel="web-switcher-successor" href="/.well-known/web-switcher.json">
```

A file merely existing at that path is insufficient. This is a project convention, not a universal identity standard or an owner signature. Canonical tags, ordinary links, advertisements, logos and arbitrary JavaScript are not automatic move authority.

### 3.3 Explain, recheck and open a discovered chain

**Use:** inspect A→B→C and select **Open latest address**.

**Example:** A redirects to B and B's explicit metadata declares C. The extension rechecks before opening C's homepage. It does not simply reuse an old successful result forever.

**Expected:** C must be reachable now. If the target changes between preview and opening, the old choice does not authorize the new target.

### 3.4 Follow a source without typing its replacement

**Use:** after a direct result, select the following-consent checkbox and **Follow this website**.

**Example:** enroll A after finding A→B→C. A later eligible top-level GET visit to A runs a fresh continuity check. If C now declares D, the chain can continue to D.

**Expected:** a supported result continues automatically; unresolved permissions, conflicts or failures remain visible. Direct cross-domain following opens the homepage. To keep an article path deliberately, use a manual/shared path policy.

### 3.5 Recover through remembered dead intermediate domains

**How:** a local origin graph retains observed successor edges for up to seven days. A unique unexpired edge can bridge a qualifying DNS/connection failure, timeout, or explicit 404/410.

**Practice:** first learn A→B→C. Then make A return 410 and check A again. Next make B return 410 too. The remembered edges can still reach C, which must be checked live. See the HTTPS lab below.

**Limit:** an unseen C→D edge cannot be invented after C disappears. Expired history, TLS errors, access denial and generic server errors do not justify the same fallback.

### 3.6 Resume a healthy source that has not moved

**Example:** a followed A serves a healthy page and has no move evidence or contradictory remembered successor.

**Expected:** the extension can resume the original URL on A through a short tab-scoped bypass. It does not call this a migration or send the page to a different domain.

### 3.7 Map a known old domain to a known current one

**Use:** manual **Old origin**, **Current origin**, the destination-confirmation checkbox, then **Connect these addresses**.

**Example:** map `https://old.lab.your-domain.tld` to `https://current.lab.your-domain.tld`. Multiple old sources may point to the same current destination.

**Expected:** only that exact source origin matches. `www.old...`, another protocol, and suffix lookalikes are different origins. Navigation rules cover top-level GETs, not POSTs, iframes or subresources.

**Quick mechanism-only exercise without hosting:** temporarily map `https://example.com` to `https://example.org` in homepage mode after inspecting the destination and granting source access. Visit `https://example.com/hello?demo=1#part`; expect `https://example.org/`. Remove the mapping afterward. This is a user-selected rewrite test, not a claim that those sites migrated or share an identity.

### 3.8 Keep the article path

**Use:** **When opening a link → Keep its page path**; this is the default for new manual mappings. On an existing homepage mapping choose **Keep page paths**.

```text
Before: https://old.lab.your-domain.tld/download-invincible-hindi-dubbed-series/?public=yes#part
After:  https://current.lab.your-domain.tld/download-invincible-hindi-dubbed-series/
```

The original query and fragment are removed. The destination must actually serve the same public path. This mechanism changes the domain; it does not search for an equivalent article with an unrelated slug.

### 3.9 Choose homepage-only behavior

**Use:** **Open the homepage** in the manual form, or **Open homepage only** on a saved card.

**Example:** `old/articles/42` opens `current/`. This is useful when the site's structure changed and transferring an old path is inappropriate.

Direct discoveries and remembered archive choices are homepage-oriented by default. You can later explicitly change a saved manual choice's path behavior.

### 3.10 Handle sensitive and ambiguous links

**Practice:** in your lab open `/account/login?token=synthetic`, `/download/file.zip`, or an ambiguously encoded separator such as `/path/%2Fencoded` through a mapping.

**Expected:** the gate requires a safe homepage choice instead of transferring those private/ambiguous parts. A public hyphenated article slug such as `/download-invincible-hindi-dubbed-series/` is different from a `/download/` endpoint and can retain its path under preserve mode.

### 3.11 Group several old domains around one current pointer

**Use:** create A→C and B→C, then **Follow destination moves** on one card. Alternatively select **Follow future moves for all mappings to this destination** when saving a new mapping. That checkbox is off by default.

**Scope:** the explicit action joins all local mappings currently pointing at the same destination. A group has a stable local seed and one shared current address; it is not a signed registry family.

```text
Initially:       A, B       → C
Observe C → D:   A, B, C    → D
Observe D → E:   A, B, C, D → E
```

The former current address becomes another old alias. Pointer changes are committed together, so the group cannot be half-updated. The settings page refreshes when the pointer changes.

### 3.12 Start future checks from the latest known current address

**Example:** after C→D was learned, C disappears. D later declares E. Visiting A or B checks D, learns D→E and updates the whole group. It does not need to contact A, B or dead C first.

**Use:** visit any group alias or choose **Check shared destination now**. Checks run while the browser is open, on a visit or explicit check. There is no periodic polling or update while the browser is closed.

If you browse the current domain's own ordinary redirect, the browser may follow it normally; the shared pointer refreshes on the next group visit/check.

### 3.13 Preserve individual group settings and stop following

**Practice:** let A keep page paths, set B to homepage mode, and pause another member. Cause C→D.

**Expected:** all destinations advance, but each member keeps its ID, enabled state, path policy, creation time and expiry. Automatic movement never renews consent or re-enables a paused alias.

**Stop:** **Stop following destination moves** stops the whole group's automatic updates. Its latest saved static mappings remain. Details: [shared destination guide](SHARED_DESTINATION_GROUPS.md).

### 3.14 Choose narrow or broad website permission

| Choice | Use it when | Example |
| --- | --- | --- |
| Default per-origin access | You want to inspect each new domain before allowing its check | A declares B; choose **Allow next check**. Shared routing offers **Allow next destination check**. |
| **Allow automatic checks across HTTPS domains** | You want selected direct continuity chains to continue across future HTTPS origins | Approve the optional broad grant before **Find current address**. |
| **Allow future destination checks across HTTPS websites** | You want an opted-in mapping group to follow future HTTPS moves without another per-domain prompt | Select it before enabling shared following or saving an opted-in mapping. |

Both broad options are unchecked by default. Broad access does not enroll every website or start general browsing-history collection. Unchecking a box does not revoke an earlier browser grant; review site access in the browser's extension Details.

### 3.15 Keep loop protection without pausing ordinary repeat visits

Fresh typed/link visits use browser-owned metadata bound to the exact local gate document. Automatic returns and unknown/stale metadata retain conservative protection. A separate burst guard pauses automatic routing after six accepted switches per 15 seconds per tab and mapping/local group/signed family; a deliberately authorized one-time recovery can still proceed beyond that automatic limit.

**Practice:** let a mapped destination return to an old alias. A real bounce should stop. Open another ordinary public article link deliberately; an eligible fresh visit should proceed without the old false pause.

**Recovery:** **Open mapped page once** or **Open destination homepage once** rechecks the exact current policy and target. Its authorization is document/tab-bound, single-use and valid for at most two minutes. It does not disable protection. An actual return redirect can pause again.

### 3.16 Pause, expire, forget and remove

| Control | What happens | Practice |
| --- | --- | --- |
| Mapping **Pause** / **Enable** | Changes that mapping's enabled state | Pause A and confirm A cannot use its mapping. |
| **Pause all switching** / **Resume switching** | Stops/restores extension routing under current policy | Pause globally before testing the old website directly. |
| **Verify again after** | Manual mappings last 1 hour, 24 hours or 7 days | Inspect the displayed expiry; a group move must not change it. |
| **Pause following** / **Resume following** | Controls a source-only followed subscription | Pause A's following without creating a manual replacement. |
| **Forget this website** | Removes that subscription and connected remembered history | Rechecking may need to learn its chain again; related sources can be affected. |
| Mapping **Remove** | Removes the local rule and attempts to release its source grant | A required/managed browser grant may remain and be reported separately. |

Expired manual mappings need deliberate rechecking/renewal; they are not silently renewed by successful checks or group movement.

### 3.17 Activity and Undo

Recent activity records origin pairs and times, not persistent original page URLs. It represents a switching attempt, not proof the destination finished loading. Up to 20 receipts are kept for at most 24 hours.

**Practice:** switch a lab URL, open the popup while still at the exact resulting address, and use **Undo latest switch** within two minutes. It checks the same tab/exact destination and opens the old origin's homepage with a temporary extension bypass. The website can still redirect itself.

**Clear activity** removes the recent list. Temporary Undo/retry session references can retain the selected destination URL, including an allowed public path, for up to two minutes of authorization validity; they are not exported.

### 3.18 Backup/import, appearance and complete local reset

| Feature | How to reproduce | Expected result |
| --- | --- | --- |
| **Export settings** | Save your mapping backup | Includes manual mappings and local `followOrigin` group choices. |
| **Import settings** and preview | Select that JSON and inspect before **Replace settings** | Replaces local manual settings; it cannot create grants or signed/owner authority. |
| **Appearance** | Choose **Follow device setting**, **Light** or **Dark** | Local UI preference, no account required. |
| **Delete all local data** | Use in a disposable test profile after exporting anything needed | Removes mappings/groups, followed sources, local graph, online jobs/service settings and activity/catalog cache. |

Exports do not include learned history, followed-source enrollment, archive jobs, provider secrets or service invitations. Complete reset deliberately retains public signed rollback/alias-reservation metadata; deleting a cache must not downgrade a formerly signed source to unverified routing.

## 4. A real HTTPS lab you can reproduce

Use a separate test browser profile. This is a real deployment recipe for domains you own, not a claim that the example DNS names already exist. You need a host, public DNS, HTTPS certificates trusted by Chrome, and an installed Caddy server or equivalent. No feature-mode changes to the shipped extension are needed.

### 4.1 Prepare five origins

Create public DNS records for A, B, C, D and E pointing at your server. Replace every `lab.your-domain.tld` below with your actual owned DNS zone. Allow normal inbound HTTPS; Caddy certificate issuance also needs the appropriate HTTP/TLS or configured DNS challenge access.

Start with this Caddyfile:

```caddyfile
a.lab.your-domain.tld, b.lab.your-domain.tld {
    respond "Retired lab address" 410
}
c.lab.your-domain.tld {
    respond "Current C: article fixture" 200
}
d.lab.your-domain.tld {
    respond "Current D: article fixture" 200
}
e.lab.your-domain.tld {
    respond "Current E: article fixture" 200
}
```

`respond` here intentionally serves the fixture text at all paths, so `/articles/42` exists on each active origin. Validate and reload using your server's installed Caddy configuration path:

```sh
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

These commands assume a Linux systemd Caddy installation and the stated path; adapt them to your hosting platform. Confirm all active lab origins load with valid HTTPS before testing the extension.

### 4.2 Reproduce shared A/B→C→D→E updates

1. Create A→C and B→C manual mappings with **Keep its page path**.
2. Select the optional broad-HTTPS checkbox if you want future checks without another prompt, then **Follow destination moves** on one card.
3. Open `https://a.lab.your-domain.tld/articles/42?public=yes#section`. Expect `https://c.lab.your-domain.tld/articles/42`. A's own 410 response is not needed: group discovery starts at C.
4. Replace only C's block with:

```caddyfile
c.lab.your-domain.tld {
    @root path /
    redir @root https://d.lab.your-domain.tld/ 302
    respond "Former C article fixture" 200
}
```

5. Validate/reload Caddy. Open B `/articles/42`. Expect D `/articles/42`; settings should show A/B/C→D.
6. Make C return 410. Change D's block to the same root-only redirect pattern, targeting E.
7. Open A `/articles/42`. Expect E `/articles/42`; A/B/C/D should now point to E.
8. Visit old C `/articles/42`. It should also route to E while its mapping/grant is valid.
9. Restart Chrome and repeat. The saved pointer/aliases should persist. Compare original expiry dates: they must not renew.
10. Inspect the server access logs. Group checks should start at the saved current address, not contact every old source. Probe requests omit cookies/referrers; ordinary destination navigation follows normal browser behavior.

### 4.3 Reproduce old-address-only discovery separately

Use a fresh test profile or clear the previous lab state. A manual override has precedence for its source and would hide this source-only demonstration.

1. Restore C, D and E as healthy terminals on the server as well. A fresh browser profile does not remove the previous D→E server redirect.
2. Make A return an HTTP redirect to B.
3. Serve B's root as HTML with a meta refresh or successor link to C, for example:

```html
<!doctype html>
<title>Lab move</title>
<link rel="web-switcher-successor" href="https://c.lab.your-domain.tld/">
<p>This controlled lab site moved to C.</p>
```

For example, these complete A/B Caddy blocks provide a redirect and a correctly typed HTML response:

```caddyfile
a.lab.your-domain.tld {
    redir https://b.lab.your-domain.tld/ 302
}
b.lab.your-domain.tld {
    header Content-Type "text/html; charset=utf-8"
    respond `<!doctype html><html><head><link rel="web-switcher-successor" href="https://c.lab.your-domain.tld/"></head><body>Lab move to C</body></html>` 200
}
```

4. Enter A only in **Find current address**. Approve required checks and inspect A→B→C.
5. Choose **Follow this website** after reviewing the chain.
6. Make A return 410. Check A again: its remembered edge can bridge to live B→C.
7. Make B return 410 too, within the graph's validity period. Known A→B→C can still reach freshly checked C.
8. Give C a supported move to D and check A again. This demonstrates extending the last known node without typing D.

### 4.4 Reproduce refusals deliberately

Run independent negative experiments in a fresh profile/reset lab; retained contradictory evidence is intentionally not silently overwritten.

| Change in your lab | Expected result |
| --- | --- |
| C declares two different successors | Conflict; no automatic winner. |
| A group current redirects to one of its old aliases | Loop refusal before following that old alias as a new current destination. |
| The terminal does not respond | Unavailable; stored success is insufficient. |
| Remove a required browser grant | Permission gate/refusal; no unchecked hop. |
| Pause globally or expire a mapping | No authorized mapping navigation. |
| Change settings while a bounded check is outstanding | The stale check cannot overwrite the new policy or open its old target. |
| Remove a previously observed move declaration | Can produce `MIGRATION_EVIDENCE_CHANGED`; review/reset the lab rather than expecting history to vanish silently. |
| Add an unrelated static mapping that creates a derived-alias chain, or exceed 50 local entries | Atomic group update stops; reconcile those settings first. |

The normal package rejects `.test`, localhost, private literals and arbitrary custom ports. The automated suites create disposable fixture-only builds; never distribute those as the production extension.

## 5. Internet investigation without saved history

### 5.1 Keyless public archives

**Use:** enter the old address, open **No known chain? Search beyond this device.**, choose **Public archives · no account or server needed**, consent, and **Search public sources**.

**How:** a bounded Archive.org availability/CDX/root-snapshot adapter extracts historical redirects, successor metadata and contextual move announcements. It does not contact the old source or proposed candidate merely to generate suggestions, and it does not execute archived scripts.

**Example:** an archived A page says it moved to B. The result shows B as an unverified suggestion with dated public evidence. It does not label B an independently verified owner.

**Practice:** choose an old origin whose archive contains a known move announcement. Verify the archive independently before expecting a particular answer. Archive omissions/exclusions/outages are valid reasons to get no candidates; creating an owned test site today does not guarantee immediate historical indexing.

For deterministic mechanics, run `node tests/internet-browser.mjs` in a permitted native test browser. It supplies controlled archive responses and proves the no-local-history flow; it does not prove public-provider coverage.

### 5.2 Check, open and remember a candidate

1. Inspect its evidence and uncertainty.
2. Select **Check this address**, approving that candidate origin if needed.
3. The browser can follow its currently supported successor chain too.
4. Choose **Open checked address**. The worker checks again and binds the displayed target before opening its homepage.
5. If intended, select **Remember this choice for 24 hours (unverified)** and **Remember checked choice**.

Remembering creates a user-configured homepage mapping without requiring you to type the candidate. It is not a registry publication or a newly observed original A→B edge. Later path/shared-follow changes require explicit mapping choices.

### 5.3 Cancel and handle interruption honestly

**Cancel search** invalidates the local reference and fences late callbacks. There are at most ten browser jobs with one-hour local validity. An interrupted local archive job can fail closed after a worker restart. Remote service references can resume polling their existing job instead of starting another paid POST.

Cancellation cannot undo a request already sent or refund an external provider charge. A completed remote reference can also be cancelled so its cached reference is not reused.

## 6. Optional broader-search service

This is the implemented **Node 24 + private SQLite `/v2/discoveries` service**, separate from the Java registry. It is optional; the extension's keyless archive mode does not need it.

| Feature | How it works | Example you can reproduce |
| --- | --- | --- |
| Exact-hostname search | Fixed official Brave Search adapter, server-only key | Investigate one old hostname; a missing key yields `SEARCH_NOT_CONFIGURED`, not invented results. |
| Shared archive adapter | Fixed archive providers and bounded snapshots | Run archive-enabled service without a paid search key. |
| Individual invitations | Bearer token identifies a job owner/quota namespace | A job created under invitation A cannot be read under B; another owner gets 404. |
| Async jobs | POST creates/reuses work; GET reports progress; DELETE cancels | Create a job, retain `jobId`, poll at roughly one-second intervals and stop at terminal status. |
| Durable quotas/leases | SQLite reservations happen before dispatch; fenced renewable claims | Restart/cancel a job and confirm budgets do not reset or late results revive it. |
| Bounded cache/retention | Short result caches, 24-hour job expiry | Repeat an eligible lookup and reuse its reference/cache rather than spend a new query. |
| Optional isolated observation | Internal fetcher can check candidates under reserved budgets | Without it, availability can remain `not_checked`; the browser still checks before opening. |
| Health endpoints | Liveness is a process check; readiness checks local prerequisites | Disabled service: live can be 200 while ready is 503. Readiness is not an upstream canary. |
| SQLite backup | Coherent snapshot, integrity verification, private output | Use the backup CLI and reopen a snapshot in an isolated instance. |

### 6.1 Local process and configuration exercise

From the repository root, this starts a disabled loopback service:

```sh
node online-discovery/server.mjs
```

In another terminal:

```sh
curl http://127.0.0.1:8082/health/live
curl http://127.0.0.1:8082/health/ready
```

To enable investigation, copy `online-discovery/.env.example` into a protected, uncommitted configuration location and set these actual variables:

| Setting | What you supply |
| --- | --- |
| `ONLINE_DISCOVERY_ENABLED=true` | Explicit admission/runner enablement. |
| `ONLINE_DATABASE_PATH` | A database inside a dedicated mode-0700 directory; the DB uses mode 0600. |
| `ONLINE_ACCESS_TOKENS` | Distinct random base64url invitations, 32–256 characters; provision securely. |
| `ONLINE_ARCHIVE_ENABLED=true` | Keyless archive path, subject to provider access/coverage. |
| `BRAVE_SEARCH_API_KEY` | Optional real provider credential, server only. |
| `ONLINE_ALLOWED_ORIGINS` | Exact approved HTTPS or extension origins for CORS, where applicable. |
| `FETCHER_URL` and `FETCHER_INTERNAL_TOKEN` | Optional matching internal fetcher configuration, both or neither. |

Node 24 can load that environment file with `node --env-file=/absolute/private/service.env online-discovery/server.mjs`. Use a secret manager for production. Never put provider keys into extension source, chat, Git, image layers or public URLs.

The API accepts hostname-only JSON, for example:

```json
{"hostname":"a.lab.your-domain.tld","clientVersion":"0.3.0"}
```

Send it to `POST /v2/discoveries` with the owner's bearer invitation; use `GET` or `DELETE /v2/discoveries/{jobId}` afterward. Do not add a full URL, original path/query, suggested destination or provider endpoint. Every candidate remains `unverified_candidate` and `confirm_only`.

### 6.2 Connect the extension and deploy

1. Operate the service behind an owned, valid HTTPS origin. Its default HTTP loopback listener is for private/local diagnostics, not the production extension service field.
2. In **Optional discovery service**, enter **Discovery service origin** and that user's **Service access token**; choose **Save service settings**.
3. Select the service discovery mode, consent and search the old address.
4. Keep `BRAVE_SEARCH_API_KEY` on the server. The browser receives only its individual invitation, held in session storage and excluded from exports/readback.

Build from the repository root if using the provided image:

```sh
docker build -f online-discovery/Dockerfile -t web-switcher-discovery:local .
```

The run/deploy must provide a private writable data volume, non-root/read-only isolation, service-only secrets, HTTPS proxy, approved provider egress and a matching privacy policy. This service is not automatically published by the Java registry release workflow.

Snapshot command:

```sh
node online-discovery/backup.mjs /private/data/state.sqlite /private/backups/new-state.sqlite
```

The output must not already exist. The command does not encrypt, schedule or upload it. Stop the service for a controlled restore; preserve its current DB/WAL/SHM as rollback material, restore the verified snapshot with private ownership, and test in isolation. Full settings, limits and restore procedure: [service README](../online-discovery/README.md) and [operation guide](INTERNET_DISCOVERY_OPERATION.md).

## 7. Optional reviewed registry and website

This is a different implemented system: **Java 21 + PostgreSQL `/v1` registry**, a React public site/admin desk, an optional keyless discovery worker and an isolated Java fetcher. Its purpose is reviewed signed publication, not automatic approval of search results.

### 7.1 Run the local demonstration

Requires Java 21 and Node/npm. From the repository root:

```sh
npm ci
npm --prefix apps/web ci
```

Terminal 1:

```sh
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=demo
```

Terminal 2, from the repository root:

```sh
npm --prefix apps/web run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`; use `#admin` for the registry desk. The explicit demo profile has separate `demo-reviewer` and `demo-publisher` accounts, both using the intentionally public `demo-password`. Never expose this demo profile as production authentication. Synthetic `.test` API seeds are not public DNS sites and do not enable fixture mode in the distributed extension.

Alternatively, the local container stack is:

```sh
docker compose -f infra/compose/local.yml up --build
```

It serves the demo on loopback `http://127.0.0.1:8088` with synthetic H2 persistence. It is not a production PostgreSQL hosting configuration. Preserve managed environment proxy/CA settings if applicable; do not bypass policy or disable TLS verification.

### 7.2 Public lookup and moderated reports

| Feature | Practice in the demo | Expected behavior |
| --- | --- | --- |
| Public hostname lookup | Look up synthetic `old.web-switcher.test` | A current reviewed result or explicit unknown; submit only a hostname, not a page URL. |
| Public report | Report an owned old/current hostname pair with a reason | Creates a pending candidate; cannot publish a route. |
| Optional queued lookup | Enable the documented Java queue in a controlled setup and look up an unknown host | An opaque pending reference, then unknown/candidate-queued outcome, never an unreviewed public route. |
| Versioned API/errors | Try a full URL in the hostname field or a stale review version | Rejects invalid input; optimistic review conflicts return 409. |

The Java queue's redirect observation is not the Node service's broader search API. Its configuration and worker are separately operated. See [API contract](API.md) and [Java discovery operations](DISCOVERY.md).

### 7.3 Review, publication, withdrawal and audit

1. Submit a synthetic report through the public form.
2. Sign in as the demo reviewer. Inspect evidence and choose an approve/reject/quarantine decision with a reason and current candidate version.
3. Confirm that approval alone does not activate a new published catalog.
4. Sign out and use the independent publisher account. Publish a release.
5. Inspect its sequence and immutable catalog bytes/ETag; a stale sequence must not be accepted as a new policy.
6. Withdrawal is an authenticated publisher API operation: `POST /v1/admin/families/{id}/revoke` with a `{ "reason": "Controlled withdrawal test" }` body, session cookies and the current CSRF header. It publishes the higher-sequence withdrawal in the same transaction; there is no separate React withdrawal button or second publication step.
7. Read the audit trail and verify the decision/publication/withdrawal actions are distinct.

The submitter cannot review their own report; the reviewer cannot publish that same pending decision. Sessions use HttpOnly cookies and CSRF protection. Production uses configured OIDC and explicit role subject allowlists, not demo passwords. Exact administrative routes and CSRF/session handling: [API contract](API.md).

On a fresh disposable demo with the API and Vite already running, the real browser/API journey can submit, review, publish and withdraw synthetic data for you:

```sh
npm --prefix apps/web run test:e2e-browser
```

This test mutates its demo database and refuses a non-demo backend. The ordinary web `test:browser` uses mocked API replies; it is a different check.

### 7.4 Signed catalog routing and trust

The extension verifier checks pinned ES256 keys, closed data schemas, time validity, policy/client compatibility, monotonic sequence/digest, replay/equivocation and withdrawal. Signed data cannot contain downloaded executable policy code.

**Example:** catalog sequence 10 points A at C; sequence 11 withdraws it. Replaying sequence 10 or clearing the disposable cache must not restore routing. A signed alias also remains reserved against silent fallback into weaker discovery, including as an intermediate hop.

The verifier/adapter supports homepage, bounded reviewed public-prefix preservation, and prefix replacement. The normal Java publishing UI does not expose an arbitrary path-rewrite editor: newly reviewed families normally publish homepage policy and require confirmation; synthetic documentation fixtures have narrower reviewed policies.

Generate/check a publisher identity on your intended protected host using a new directory:

```sh
node scripts/registry-key.mjs generate --directory /absolute/protected/publisher-keys --kid registry-2026-01
node scripts/registry-key.mjs check --private /absolute/protected/publisher-keys/publisher-private.pk8 --trust /absolute/protected/publisher-keys/registry-trust-anchors.json --kid registry-2026-01
```

The publisher alone receives the private PKCS8 file and matching `PUBLISHING_KEY_ID`. The extension receives only the public trust map; the API/discovery worker remain keyless. Replace example paths with a protected host location, preserve the printed public fingerprint independently, and do not commit private material.

To try extension registry UI, build with independently reviewed **public** keys and an owned fixed HTTPS endpoint:

```sh
WS_REGISTRY_KEYS_FILE=/absolute/protected/registry-trust-anchors.json \
WS_REGISTRY_URL=https://registry.your-domain.tld/v1/catalog/current \
npm run package
```

Then use **Verify & import catalog** or **Refresh catalog**, with the required source grants. The default extension bundles no production registry root/endpoint. Importing a key from the same untrusted page as its record is not an independent trust bootstrap. Keep private keys out of the extension. See [key provisioning](SIGNING_KEYS.md) and [shared verifier](../packages/security/README.md).

### 7.5 Optional hardened fetcher and queue worker

The internal fetcher implements bounded `/probe` and `/resolve` observations with a separate bearer credential, HTTPS/robots checks, public-address DNS validation and connected-peer checks. The queue worker has no signing key and can create only pending candidates.

**Replication:** use the documented fetcher tests and controlled worker setup before enabling real crawling:

```sh
./backend/mvnw -f fetcher/pom.xml verify
./backend/mvnw -f backend/pom.xml verify
```

Keep the fetcher private and independently isolated from databases, publisher keys and cloud credentials. It is not a public arbitrary-URL proxy. Browser checks cannot promise the same DNS/socket pinning. A managed CONNECT proxy that cannot preserve pinning yields `PINNED_EGRESS_UNAVAILABLE`; unsetting the proxy is not the remedy. Deployment must supply an approved egress design. See [fetcher guide](../fetcher/README.md) and [worker database roles](DISCOVERY_DATABASE.md).

After provisioning that isolation and the matching private `FETCHER_INTERNAL_TOKEN`, its actual startup command is:

```sh
java -jar fetcher/target/web-switcher-fetcher-0.2.0.jar
```

It binds loopback port 8081 by default. A separate worker, with a bootstrapped restricted PostgreSQL datasource, fixed internal `FETCHER_URL` and the same fetcher token, starts from its own deployment working directory:

```sh
java -jar /absolute/path/to/copied-api.jar --spring.profiles.active=worker
```

The worker starts no HTTP listener, runs no schema migrations and receives no publisher key. Those commands do not create the required database roles or approved egress by themselves.

### 7.6 Production operations and recovery

Implemented operational pieces include PostgreSQL migrations, restricted API/publisher/worker roles, durable fenced discovery jobs, immutable signed releases, OIDC/CSRF handling, private publisher key provisioning, container/deployment scripts, backup drills and release evidence gates.

To deploy, you still supply real host/domain/TLS, database, OIDC identities, reviewed immutable images, key custody, egress enforcement, monitoring and tested recovery. CI success does not provision those accounts or submit a browser Store item.

Java artifacts still use their own `0.2.0` application artifact version; extension 0.3.0 does not rename them to 0.3.0. Follow [deployment](DEPLOYMENT.md), [release](RELEASE.md), [publisher keys](SIGNING_KEYS.md), and [encrypted PostgreSQL recovery](BACKUP_RESTORE_DRILL.md). The registry PostgreSQL backup and optional service SQLite snapshot are separate backups; neither recovers signing keys/OIDC secrets by itself.

For the encrypted PostgreSQL scripts, first provision the documented libpq connection settings, existing private `BACKUP_DIRECTORY`, public `AGE_RECIPIENT`, and separately protected restore identity. Then:

```sh
bash infra/backup/backup.sh
bash infra/backup/restore.sh /absolute/path/to/backup.dump.age
```

Restore additionally requires the exact `RESTORE_CONFIRM_DATABASE` and a clean intended target; it refuses a nonempty database. Practise recovery in a disposable environment with the provided drill instead of overwriting a live database:

```sh
docker build -f infra/backup/Dockerfile.drill -t web-switcher-backup-drill:local .
python3 infra/backup/drill.py
```

## 8. Experimental owner identity

Implemented offline tooling can generate a protected owner key file, sign a Site Passport record and verify its sequence/hash continuity. This is **experimental**, not an owner enrollment portal or production ownership proof.

The exact CLI operations, after preparing a valid passport payload and protected paths, are:

```sh
node packages/security/owner-cli.mjs keygen /secure/owner.private.json owner.public.json
node packages/security/owner-cli.mjs sign passport.json /secure/owner.private.json owner-key-1 passport.jws
node packages/security/owner-cli.mjs verify passport.jws owner.public.json owner-key-1 > checkpoint.json
```

For a deterministic demonstration that constructs valid payloads and tests rejection cases:

```sh
node --test packages/security/owner-cli.test.mjs
```

To create your own disposable genesis example, run the following from the repository root. Use a new protected directory; these files do not enroll a real owner or perform any website requests.

```sh
mkdir -p data
mkdir data/owner-guide
chmod 700 data/owner-guide
node packages/security/owner-cli.mjs keygen data/owner-guide/private.json data/owner-guide/public.json
```

Generate a valid payload using only its public key:

```sh
node --input-type=module <<'JS'
import {readFile, writeFile} from 'node:fs/promises';
import {ownerSiteId} from './packages/security/owner-cli.mjs';
const publicJwk = JSON.parse(await readFile('data/owner-guide/public.json', 'utf8'));
const now = Date.now();
const passport = {
  schemaVersion: 1,
  siteId: await ownerSiteId(publicJwk),
  sequence: 1,
  previousRecordHash: null,
  issuedAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
  currentOrigins: ['https://c.lab.your-domain.tld'],
  retiredOrigins: ['https://a.lab.your-domain.tld'],
  pathPolicy: {type: 'homepage'},
  queryPolicy: {type: 'drop'},
  fragmentPolicy: 'drop',
  keyId: 'owner-guide-1'
};
await writeFile('data/owner-guide/passport.json', JSON.stringify(passport, null, 2), {flag: 'wx', mode: 0o600});
JS
node packages/security/owner-cli.mjs sign data/owner-guide/passport.json data/owner-guide/private.json owner-guide-1 data/owner-guide/passport.jws
node packages/security/owner-cli.mjs verify data/owner-guide/passport.jws data/owner-guide/public.json owner-guide-1 > data/owner-guide/checkpoint.json
```

Expected: a sequence-1 verification checkpoint for the generated site ID. Outputs are created exclusively; use a new directory for a fresh run. The `data/` tree is ignored by Git, but private files still need protected/encrypted storage. This example's records expire after 15 minutes.

A genesis site ID derives from its public key thumbprint; later records advance exactly one sequence and bind the previous compact-record hash. Record validity is bounded. Private JWKs are unencrypted files and need protected/encrypted storage.

**Not implemented:** automatic DNS/HTTPS enrollment challenges, independent historical owner binding, production key rotation/recovery/transfer, witness consensus or an extension enrollment workflow. Signing a self-chosen key does not make a local mapping `owner_verified`. The separate `web-switcher-passport+jws` type cannot be passed off as a registry catalog. See [owner tools](../packages/security/README.md).

## 9. Privacy, safeguards and limits

### 9.1 What leaves the device

| Operation | Data sent | Data not automatically sent |
| --- | --- | --- |
| Direct/root or shared-current check | Selected site/current origin and normal connection metadata | Original private path/query/fragment as the initial discovery input; browser cookies/HTTP credentials/referrer. |
| Archive investigation | Selected public hostname/origin in provider-specific queries | Unrelated browsing history or the original entered private URL parts. |
| Optional search service | Selected hostname, bounded API metadata, service-only invitation | Brave key from the extension, private page URLs, or publisher signing keys. |
| Normal destination navigation | The current policy's destination URL and browser's ordinary site behavior | Cross-domain migration of old cookies/login sessions. |
| Registry lookup/report | Hostname fields and user-entered reason | Permission to publish a signed route. |

Contacted sites/providers still see connection information such as IP and timing. Public evidence locators can contain public archive paths. Original private URL parts and provider query syntax are different things: provider adapters necessarily use their own bounded query parameters.

### 9.2 Important bounds

| Area | Current limits |
| --- | --- |
| Manual mappings | 50 local entries, including shared-derived aliases; consent 1–168 hours. |
| Direct continuity | 50 followed sources; 250 origin edges; seven-day edges; eight cross-origin hops; 12 graph steps; 25-second operation. |
| Browser probe | Eight seconds and 128 KiB body per probe. |
| Browser archives | Two index requests + up to three captures; ten candidate origins; 30 seconds; 128 KiB/response and 512 KiB total adapter body budget. |
| Browser Internet jobs | Ten local jobs, one-hour validity. |
| Loop/retry | Automatic routing pauses after six accepted switches/15 seconds per tab/routing identity; explicit single-use recovery can exceed that automatic limit and is valid at most two minutes. |
| Persistent recent activity | Origin pairs/times only, 20 receipts, 24-hour retention. |
| Optional service | 120-second absolute job deadline, 60 active seconds, bounded leases/retries/bytes/calls/owner-global quotas; jobs expire after 24 hours. See its README for all ceilings. |

A closed browser cannot perform maintenance until it runs again. Expired authority is rejected before use even when cleanup has not physically removed its record.

### 9.3 Trust labels and precedence

| Label | Meaning |
| --- | --- |
| User configured | You explicitly supplied or remembered a routing choice; imports/groups cannot upgrade its authority. |
| Source declared | A current source exposed supported continuity signals; it can still be wrong or compromised. |
| Unverified candidate | Archive/search evidence suggests a possible origin; explicit fresh checking and choice are required. |
| Registry reviewed | A separately authorized signed publication passed the configured review flow. |
| Owner verified | Requires an independently established owner lifecycle; the offline CLI does not create it. |

Manual/signed decisions reserve their exact source ahead of ordinary automatic following. Previously signed aliases retain downgrade barriers after expiry/revocation/cache deletion. Shared unverified groups also check signed reservations at aliases, seed, current and every observed hop. A valid signature authenticates its issuer, not the truth of every assertion or future content safety.

### 9.4 What is intentionally not done

No arbitrary page-script execution to chase obfuscated links, no TLS-warning suppression, no CAPTCHA/access-control bypass, no transfer of credentials across domains, no silent all-history upload, no provider secret in the extension, no search-rank auto-open, and no guaranteed latest domain when evidence is missing. The final appendix records the rejected alternatives explicitly.

## 10. Testing and CI/CD

### 10.1 Reproduce the checks

From the repository root:

```sh
npm ci
npm test
npm run check
npm run package
npm --prefix apps/web ci
npm --prefix apps/web run build
./backend/mvnw -f backend/pom.xml verify
./backend/mvnw -f fetcher/pom.xml verify
```

For native extension acceptance, use the pinned Playwright browser in a profile/environment permitting unpacked extensions:

```sh
npx playwright install chromium --no-shell
npm run test:browser
node tests/continuity-probe-browser.mjs
node tests/continuity-browser.mjs
node tests/internet-browser.mjs
node tests/shared-follow-browser.mjs
```

Linux may need Playwright's documented OS dependencies. Do not alter managed browser policy to force an extension to load. Fixture suites generate their own disposable `.test` builds; ordinary distribution keeps fixture flags off.

| Test lane | What it demonstrates | What it does not establish |
| --- | --- | --- |
| 358 Node/JavaScript tests at the implementation baseline | Contracts, parsers, controllers, quotas, SQLite and negative cases | Public identity accuracy or live provider availability. |
| 82 native Chromium groups | Actual extension routing/transport, history, candidates and shared-pointer journeys on controlled sites | Native permission-dialog acceptance, current public ownership or Store approval. |
| UI contracts | Real Chromium rendering with intentionally mocked browser/API responses | Native extension orchestration or production authorization. |
| Java/PostgreSQL/stack/recovery jobs | Actual API/DB/signature/auth/container/recovery behavior under controlled setup | Your production host's network, key custody, OIDC or off-host durability. |

### 10.2 CI and deployment flow

The platform workflow runs JavaScript/package, Java, PostgreSQL, browser, live API, optional service-image and full-stack checks. A legacy routing workflow is also retained. The implementation baseline had seven push platform jobs, seven PR platform jobs and one legacy job passing.

The release process uses exact successful direct-source evidence and immutable image provenance; a PR merge-context check cannot authorize an untested release tree. A PR being green does not deploy a public service, merge itself or publish to Google. Follow the release/deployment guides for a reviewed rollout to your own target.

For browser-only use, download a successful package and reload the extension; deploying Java/Node services is unnecessary unless you choose their features.

## 11. Chrome Web Store deployment

The package, icons, source privacy page and publishing instructions are prepared. The repository has not automatically created a Store listing or obtained Google approval.

1. Build/test the intended package with fixture mode off and inspect its manifest version.
2. Host `docs/privacy.html` at a publicly accessible HTTPS URL, using your real developer contact and practices.
3. Create/verify your Chrome Web Store developer account and complete the account's required registration/payment process.
4. Upload the **inner extension ZIP**, not the repository or outer Actions artifact.
5. Supply description, icons/screenshots, single-purpose explanation, accurate data disclosures and reviewer instructions for every requested permission.
6. Explain `webRequest` correlation and `webNavigation` use for the extension's own gates. Chrome may describe the latter with a browsing-history warning; the code does not read the history database or retain unrelated navigation logs.
7. Test on a clean permitted Chrome profile, including denied/revoked permissions, ordinary article links, a real loop, source-only discovery and shared-pointer advancement.
8. Select visibility and submit for Google's review. After approval, install and verify the actual Store build.
9. For updates, increment the manifest version, rebuild/test and upload a new package to the same Store item.

All screen-by-screen steps, assets, permission justifications and update details are in [the Store guide](CHROME_INSTALL_AND_STORE.md). Edge unpacked loading is supported as an installation approach; actual commercial-browser Store acceptance is separate.

## 12. Troubleshooting and acceptance checklist

| Symptom | Check / next action |
| --- | --- |
| An article opens only the homepage | Inspect its saved mapping. Choose **Keep page paths** if the destination serves compatible public paths. Direct/archived discovery is homepage-oriented by default. |
| The exact old link is not intercepted | Match protocol, hostname and subdomain exactly; check grant, enabled state, expiry, global pause and installed version. |
| A normal repeat gets an old loop screen | Update/reload the same extension folder to 0.3.0+, close old gate pages and reopen the original URL. A genuine bounce or burst limit can still pause. |
| Shared aliases still show an old current | Enable shared following; a static mapping alone never opts into future moves. Visit an alias or **Check shared destination now** and inspect evidence/permissions. |
| A new domain needs a click | Approve that displayed origin, or deliberately grant the optional broad HTTPS access for future selected checks. |
| Current domain died and no successor is found | Use **Search public sources** for candidates. No surviving fresh/remembered evidence can mean no reliable automatic answer. |
| Archive lookup has no candidates | Coverage/exclusion/outage or absent evidence is possible. A successful fixture test cannot guarantee an archive contains that site. |
| Search-service mode fails | Verify HTTPS deployment, invitation, provider configuration, quotas and actual egress. Local readiness alone does not prove provider availability. |
| An expired mapping no longer follows moves | Recheck/recreate it with deliberate consent. Automatic movement never extends expiry. |
| A signed alias refuses weaker discovery after reset | This retained downgrade barrier is intentional; review the signed policy rather than trying to clear its security history. |
| A managed browser blocks loading | Use a permitted personal/test profile or ask its administrator; do not change managed security policy. |

Before relying on your own setup, reproduce: one public article path; A/B→C→D→E; one dead remembered intermediate; one unresolved first-use source; one missing permission; one sensitive link; one real loop; pause/expiry; restart; export/import; and the exact package you intend to distribute.

## 13. The distinctive engineering idea

The proposed contribution is the combination of origin-only successor memory, current terminal checking, explicit user-controlled following, shared mutable destination pointers, careful abstention and a separate stronger reviewed publication lane. A linked chain can help after earlier hosts vanish; a flattened local group lets many aliases follow its latest checked endpoint together.

Redirects, URL rewriting, archives, signatures and mutable identities are established techniques. This repository does not prove scientific novelty, patentability, superior recovery accuracy or universal historical ownership. Real evidence would require dated ground truth, time/family-separated evaluation, adversarial negatives, reproducible baselines and measured harmful-switch/abstention/cost outcomes. See [novelty and evidence](NOVELTY_AND_EVIDENCE.md) and [evaluation design](INTERNET_DISCOVERY_EVALUATION.md).

The original plan's 134 task IDs are reconciled in [plan traceability](PLAN_TRACEABILITY.md). That file contains historical checkpoints; use the current implementation/status guides for later archive/service/shared-group additions.

## 14. Every research idea and its current status

The design register contains **64 candidate mechanisms and 16 rejected shortcuts**, not 80 finished features. The appendix below gives each idea an example or evaluation recipe. A planned item's recipe describes work you can investigate; it is not a button already available in the extension.

### 14.1 All 80 Internet-discovery ideas

This reconciles all 80 stable IDs in the [idea register](INTERNET_DISCOVERY_IDEAS.md). The register contains **64 considered mechanisms and 16 explicitly rejected shortcuts**, not 80 implemented features. “Planned” rows are research/development recipes, not steps already available in the extension. Rejected rows describe controlled negative checks and must not be enabled as product behavior. Current 0.3.0 code and the latest implementation ledger take precedence over older planning completion statements.

| ID | Considered feature | Current scope | Example or way to reproduce/evaluate |
| --- | --- | --- | --- |
| ID-001 | Reuse live redirect and explicit metadata traversal | Implemented | On owned A, return an HTTPS redirect to B; Find current address observes the chain. Shared groups can then follow later declared moves. |
| ID-002 | Archived HTTP redirect headers | Implemented, bounded | Choose Search public sources for an old hostname with an archived redirect; inspect capture date and live-check its proposed successor. |
| ID-003 | Archived HTML move announcements | Implemented, bounded | An archived root page says “we moved to B”; inspect the dated candidate, then Check this address before opening. |
| ID-004 | Memento-style archive discovery | Planned experiment | Compare two permitted archive providers at the same five-request budget; count unique useful captures rather than duplicate copies. |
| ID-005 | Common Crawl index and selected WARC records | Planned experiment | For an owned old hostname, select one relevant crawl-index record and validate its WARC target/date before treating it as a hint. |
| ID-006 | Discover an old source's authoritative public links from archives | Planned | Recover an old site's historical link to its public project profile, then inspect that profile's dated move announcement. |
| ID-007 | Archived robots, sitemap and feed references | Planned experiment | Compare a historical sitemap pointing at B with a negative sitemap that only references an unrelated CDN. |
| ID-008 | Contracted web search API adapter | Implemented, optional service | Deploy the Node discovery service with a server-side Brave key; use service mode to investigate only the old hostname. |
| ID-009 | Hostname-first query ladder | Partial | The implemented adapter makes an exact quoted-hostname query. A multi-step migration-term query ladder is not implemented; compare such templates offline first. |
| ID-010 | Multilingual and transliteration query expansion | Planned experiment | Evaluate a fixed set of translated “moved/new domain” queries on independent language-specific cases and disclose added request cost. |
| ID-011 | Two search providers for coverage | Planned experiment | Evaluate a second permitted search API only on first-provider gaps, deduplicating both providers' copies of one document. |
| ID-012 | Retrieve and verify the search result document | Partial | Browser live checks and optional fetcher observations exist. A general search-result announcement-document retriever/claim verifier remains planned. |
| ID-013 | Independent inbound links and announcement references | Planned | Collect two independently authored old-to-new announcements; compare them against ten copied versions of one announcement. |
| ID-014 | Historically linked official social/profile announcements | Planned | Establish an old site's historical link to a stable public profile, then verify its dated move post; current “official” wording alone is insufficient. |
| ID-015 | Public project repositories and release documentation | Planned | Use a historically linked repository's dated README/release-note change from A to B; distinguish forks and changed maintainers. |
| ID-016 | Public app-store publisher/project profiles | Planned experiment | Compare an app listing's historical support-domain change against an unrelated privacy-policy hosting URL. |
| ID-017 | Public RSS/Atom/newsletter archives | Planned experiment | Read a historically linked public RSS/Atom archive for an explicit move; distinguish an original feed from syndicated copies. |
| ID-018 | Curated directories and community-maintained lists | Planned experiment | Import a licensed directory entry as unverified candidate evidence, with its dated sources; do not equate it to a signed reviewed catalog. |
| ID-019 | Public user reports and discussion threads | Planned | Treat a public discussion's “new domain” claim as an investigation lead; test spam and impersonation without contacting authors. |
| ID-020 | Public Suffix List and IDNA-aware normalization | Partial | Exact origin/IDNA-aware URL normalization exists. A versioned Public Suffix List and broad registrable-domain grouping are not implemented; add multi-tenant and confusable-domain fixtures before relying on them. |
| ID-021 | Bounded domain/subdomain variants as hypotheses | Planned experiment | Generate at most a few publicly justified variants, then independently investigate them; do not scan every suffix or number. |
| ID-022 | Current DNS CNAME/DNAME and alias observations | Planned experiment | Compare a site's DNS alias pointing at a shared CDN with a real web migration; keep DNS as a hint, never an automatic browser URL rewrite. |
| ID-023 | DNSSEC-authenticated records | Planned | Evaluate validated DNSSEC responses as current-zone provenance, including a legitimately re-registered old domain; do not call that owner continuity. |
| ID-024 | RDAP registration/change information | Planned | Use permitted RDAP dates as warning context for a recently re-registered domain; missing or old metadata remains inconclusive. |
| ID-025 | Certificate Transparency candidate discovery | Planned experiment | Query an approved CT source for a bounded set of names and measure new useful candidates; valid certificates do not authorize routing. |
| ID-026 | Shared certificate keys or infrastructure fingerprints | Planned experiment | Compare certificate/server similarities across a genuine move and unrelated shared-CDN tenants; measure false matches. |
| ID-027 | Passive DNS history | Planned | Evaluate appropriately licensed passive-DNS history on known migrations; account for shared IPs and address reassignment. |
| ID-028 | Historical-to-current textual fingerprints | Planned experiment | Compare historical text with genuine successor and copied clone pages; report candidate ranking performance separately from identity authority. |
| ID-029 | Stable public identifiers | Planned experiment | Track a public stable project identifier across A and B, including a copied identifier negative case. |
| ID-030 | Logos, favicons, screenshots and perceptual hashes | Planned experiment | Compare logo/favicon/screenshot matches across a legitimate redesign and a visual clone; keep results as weak hints. |
| ID-031 | Canonical, Open Graph, hreflang and reciprocal links | Planned experiment | Test ordinary canonical/og/hreflang links versus explicit project successor metadata; generic SEO relationships do not establish migration. |
| ID-032 | Public brand/entity disambiguation | Partial | Strict hostname/source binding prevents simple mismatch. A public brand/entity disambiguation system is not implemented; evaluate two unrelated same-name organizations. |
| ID-033 | Deterministic extraction before statistical ranking | Partial | Deterministic bounded redirect/metadata/archive extraction exists. General statistical ranking and learned extraction remain unimplemented. |
| ID-034 | Language-model-assisted extraction and explanations | Planned experiment | Run a tool-free structured extractor on an owned announcement and prompt-injection fixture, then deterministically validate all cited relationships. |
| ID-035 | Existing signed reviewed registry | Implemented, configured registry | Operate the demo review/publish flow and a separately configured pinned-key extension build; only a valid approved catalog supplies registry authority. |
| ID-036 | Previously pinned owner-key successor records | Experimental offline tools | Generate/sign/verify an owner record using owner-cli; live owner enrollment, historical key pinning and automatic owner routing are not implemented. |
| ID-037 | Dual-domain control challenges during a move | Planned | On two domains you control, prototype one-use HTTPS/DNS control challenges; this still needs trusted historical family-to-key enrollment. |
| ID-038 | Stable project identifiers, DIDs or IPNS-style pointers | Planned | Evaluate a stable identifier/pointer across two owned endpoints; a new DID/IPNS string alone does not prove the old site's identity. |
| ID-039 | Key rotation, revocation and recovery policy | Partial | Publisher key-handling docs and offline checks exist. Complete owner-key rotation, revocation, recovery and transfer services remain planned. |
| ID-040 | Transparency log and independent witnesses | Planned | Prototype append-only publication witnesses and conflicting-statement detection on a test log; no independent deployed witness service exists. |
| ID-041 | Community observations with reputation and review | Planned | Evaluate explicitly contributed public observations with anti-Sybil review; do not turn ordinary browsing into crowdsourced tracking. |
| ID-042 | Dated evidence graph with claim lineage | Partial | Local dated origin edges and candidate provenance fields exist. Full citation lineage, independent-source clustering and temporal identity epochs remain planned. |
| ID-043 | Temporal contradiction and re-registration detection | Partial | Fresh conflicting explicit successors stop local resolution. General ownership-change/re-registration inference remains planned; test a sold-domain case separately. |
| ID-044 | Mirrors, multi-home sites, splits and mergers | Planned | Create one site splitting into B and C and require an explicit service choice; the current product does not infer a unique winner or mirror identity. |
| ID-045 | Calibrated ranking with hard authority gates | Partial | Hard signed-history/permission/expiry gates exist. A calibrated probabilistic ranker is not implemented; report suggestion quality without invented certainty scores. |
| ID-046 | Candidate list with evidence and explicit abstention | Implemented | Return two archive/search candidates, inspect dated evidence, choose one explicitly, and verify that neither is opened automatically. |
| ID-047 | Revalidation, freshness and bounded chain compression | Partial | Rechecked remembered chains and shared current pointers exist. Full provenance-preserving temporal graph compression is not implemented; test A/B to C to D with controlled hosts. |
| ID-048 | Hybrid local fast path and isolated server investigation | Implemented, optional service | Use direct browser checks first, then explicitly start archive or operated-service investigation; service suggestions remain unverified. |
| ID-049 | Browser-only direct provider mode | Partial | Keyless archive APIs run directly in the browser. Direct commercial search-provider client mode is not delivered; do not embed a shared key. |
| ID-050 | Optional bring-your-own provider account | Planned | Advanced operator-owned provider keys can be configured on a service; a browser bring-your-own-provider account/setup product is not implemented. |
| ID-051 | Explicit online-search consent and minimum query data | Implemented | Enter a full old URL containing a synthetic query, start public-source lookup explicitly, and verify that only the normalized public hostname/origin is sent. |
| ID-052 | Oblivious relay or split-trust lookup | Planned | Evaluate a split-trust relay protocol with timing/logging assumptions; an ordinary single proxy or hostname hash is not an anonymity claim. |
| ID-053 | Isolated, public-only bounded document retrieval | Partial, optional service | Run the private isolated fetcher's hostile-address/redirect tests. General evidence-document retrieval and production egress acceptance remain additional work. |
| ID-054 | Sandboxed JavaScript rendering for otherwise opaque sites | Planned research | Study a disposable profile-free rendering sandbox on owned script-only fixtures; current probes deliberately do not execute downloaded scripts. |
| ID-055 | Liveness and threat-reputation checks kept separate from identity | Partial | Current reachability is checked separately from trust. A licensed threat-reputation integration and general parked/soft-404 classifier are not implemented. |
| ID-056 | Per-lookup, per-host, per-provider and global budgets | Partial, core controls implemented | Exercise durable service request/byte/lease/concurrency budgets and cancellation under fixture load. Currency spending meters and all registrable-domain accounting remain planned. |
| ID-057 | Positive/negative caches and provider circuit breakers | Partial | Service positive/negative TTL caches exist. Test a failed lookup, expiry and later new evidence; general provider circuit breakers remain planned. |
| ID-058 | Cooperative voluntary observation sharing | Planned | Contribute one specifically consented public transition to a candidate-only collection; broad automatic observation sharing is not implemented. |
| ID-059 | Human review and appeals for consequential ambiguous cases | Partial, registry lane | Use separate reviewer and publisher demo roles to reject/approve a candidate. A complete Internet-evidence dossier, appeals and production review operation remain planned. |
| ID-060 | Family-separated and time-separated benchmark | Planned evaluation | Build independently labelled migration families and hold out both whole families and future periods; no completed public accuracy benchmark exists. |
| ID-061 | Ablations and matched-risk baselines | Planned evaluation | Compare live-only, memory-only, archive-only and hybrid recovery at equal wrong-switch risk and request budgets; do not reuse test labels as hints. |
| ID-062 | Learned ranking, embeddings and link-graph inference | Planned research | Train/evaluate ranking only after suitable temporal labels exist; compare against the deterministic baseline and keep hard authority gates outside the model. |
| ID-063 | Operator health and evidence-quality dashboards | Partial | Readiness/liveness endpoints and operational runbooks exist. Provider spend, quality and public incident dashboards are not a completed product. |
| ID-064 | Public documentation and third-party interoperability | Partial | Publish current schemas, supported project declarations and reproducible fixtures. Standards registration and independent third-party interoperability remain external work. |
| ID-065 | Automatically open the first/top search result | Rejected | Negative test: a fake clone ranks first; the UI must retain it as an unverified candidate and never open it automatically. |
| ID-066 | Brute-force every TLD, spelling and numbered subdomain | Rejected | Negative test: a lookup budget expires before a broad variant scan; expected behavior is bounded unknown, not exhaustive probing. |
| ID-067 | Treat a matching name/logo/page as proof | Rejected | Negative test: clone a logo/name on an owned fixture; similarity must not produce owner or registry trust. |
| ID-068 | Upload all browsing history or scrape browser history silently | Rejected | Verify that an unrelated browsing visit produces no history upload; only an explicitly selected public lookup is sent. |
| ID-069 | Embed a shared commercial provider key in the extension | Rejected | Inspect the shipping ZIP and mapping export for commercial provider secrets; provider keys belong only in an operated service. |
| ID-070 | Bypass CAPTCHAs, authentication, robots/access policy or provider quotas | Rejected | Simulate quota/authentication/access refusal and confirm unavailable/abstain; do not evade the refusal through another endpoint. |
| ID-071 | Execute every candidate page's JavaScript in the user's browser profile | Rejected | Place JavaScript in a controlled candidate response and confirm inert discovery does not execute it in the visitor's profile. |
| ID-072 | Ask an LLM to invent the current domain and trust its answer | Rejected | Provide an uncited fabricated domain from a model and confirm deterministic validation cannot convert it into navigation authority. |
| ID-073 | Count copied mentions or multiple search providers as independent votes | Rejected | Give twenty copies of one claim to a future ranker and require one provenance group rather than twenty independent votes. |
| ID-074 | Let many weak hints outweigh a signed revocation, conflict or missing authority | Rejected | Make weak hints point at a revoked signed alias; the every-origin reservation must stop weaker routing. |
| ID-075 | Treat TLS, DNSSEC, CT, RDAP or shared IPs as historical-owner proof | Rejected | Use a valid certificate or DNSSEC response for an unrelated owned fixture; it must not become historical-owner proof. |
| ID-076 | Silently publish search candidates into signed registry routes | Rejected | Submit an unverified observation and confirm the active signed catalog bytes do not change without independent review/publication. |
| ID-077 | Rewrite arbitrary private paths/query strings onto a guessed new domain | Rejected | Visit a controlled account URL with a synthetic token; require sensitive confirmation and omit private path/query/fragment from a guessed-domain hop. |
| ID-078 | Present archive content as the current live website | Rejected | Display an old archive capture as historical evidence, then separately check the candidate now; do not label the capture itself current live content. |
| ID-079 | Automatically send email/DMs to claimed owners or discussion authors | Rejected | Run source investigation and verify no email/DM is sent. Human outreach requires a separate explicit workflow. |
| ID-080 | Promise every dead URL has a discoverable current domain | Rejected | Use an old domain with no surviving trace and confirm unknown/unavailable rather than inventing a latest address. |

### 14.2 Original product requirements and deferred features

The original 134 implementation task IDs remain in [plan traceability](PLAN_TRACEABILITY.md). The user-facing requirements below are the original F01–F18 catalogue, reconciled with version 0.3.0; old unchecked planning boxes are not release-status evidence.

| Requirement | Designed feature | Current scope | Example or next experiment |
| --- | --- | --- | --- |
| F01 | Add a local mapping | Implemented | Save old A → current C in the manual form and inspect its exact-origin preview. |
| F02 | Open a known old bookmark | Implemented navigation; no bookmark editing | Open an existing A bookmark. A valid permitted mapping routes the visit; the saved bookmark itself stays unchanged. |
| F03 | Follow repeated migrations | Implemented, bounded | Learn A → B → C, or advance a shared pointer C → D. Later group aliases use the latest pointer without revisiting retired earlier origins. |
| F04 | Explain a decision | Implemented for current lanes | Inspect source, target, source-declared or user-configured provenance, evidence/capture times, and expiry; no ownership proof is implied by reachability. |
| F05 | Preserve supported page paths | Implemented with explicit policy | Choose Keep page paths: A/articles/42 opens C/articles/42, assuming C serves that path. |
| F06 | Protect sensitive URL data | Implemented safeguards | Use synthetic A/account?token=fixture; observe confirmation and homepage-only opening, not token transfer. |
| F07 | Pause, undo and bypass | Implemented, scoped | Pause a mapping or all switching; use a still-valid popup Undo for the recorded tab. This is not a general all-sites ignore-list product. |
| F08 | Work without an account | Implemented core | Install the default extension and use direct continuity, archive lookup or manual mapping without a backend account. |
| F09 | Handle unknown links | Implemented, bounded | An unknown source can remain unknown; explicitly request public-source investigation or submit a report to an operated registry. |
| F10 | Scheduled family health monitoring | Partial/design remaining | Current shared groups recheck on visits or Check now. A periodic all-family liveness monitor is not implemented; evaluate a future scheduler against request/consent budgets. |
| F11 | Review suggestions | Implemented optional registry | Create a pending candidate in the demo, review under a separate role and publish independently; candidate submission alone must not change active catalog bytes. |
| F12 | Expire and revoke data | Implemented, scoped | Expire a mapping or withdraw a signed family; a stale gate must abstain. Offline clients cannot learn a new revocation before reconnecting. |
| F13 | Handle permission denial | Implemented flow; native acceptance external | Deny a next-origin request and verify no unchecked hop occurs; later grant the displayed origin deliberately. |
| F14 | Chrome and Edge distribution | Chromium tested; Store/Edge acceptance external | Load unpacked in a permitted desktop Chrome/Edge profile. Independently exercise real permission dialogs and Store review before claiming release acceptance. |
| F15 | Export/import local settings | Implemented manual decisions | Export mappings/groups, inspect the import preview, and restore in another installation; grants, learned graph and authority are not manufactured by the file. |
| F16 | Owner-assisted continuity | Experimental offline tools only | Use the owner CLI on disposable keys to sign/verify a record. Live enrollment, two-domain proof, owner rotation/recovery and an owner portal remain planned. |
| F17 | Repair bookmark records | Planned | A future implementation must scan only with consent, preview a diff, make a backup, apply explicitly and support rollback. No current bookmark-repair menu/API is delivered. |
| F18 | Firefox build | Planned | Port background/DNR/permission behavior and run a separate Firefox acceptance suite before submitting to its store. |

#### Original FUT backlog

| ID | Designed future feature | Current scope | Reproduction/evaluation approach |
| --- | --- | --- | --- |
| FUT-01 | Bookmark scan/preview/backup/apply/rollback | Planned | Use an exported synthetic bookmark tree to design a dry-run diff and inverse patch; do not modify real bookmarks until implemented/reviewed. |
| FUT-02 | Firefox port | Planned | Create a Firefox-specific manifest/background adapter and independently test routing, permissions and store packaging. |
| FUT-03 | Safari/mobile feasibility | Planned research | Check supported extension APIs and run a small routing/permission feasibility spike on the target platform before promising compatibility. |
| FUT-04 | HTTP-status/error assistance | Partial known-source handling; general assistance planned | Current selected-source gates/probes can handle supported failures; arbitrary browser error-page injection/repair is not delivered. |
| FUT-05 | Archives, Common Crawl and passive DNS | Archives implemented; other adapters planned | Use current keyless archive mode now; compare licensed crawl/DNS adapters later against the same dated owned-domain cases. |
| FUT-06 | Opt-in community observations | Planned | Contribute one public transition under explicit consent to a future candidate-only system; do not upload ordinary browsing history or count votes as proof. |
| FUT-07 | Privacy-preserving catalog sharding/relay | Planned | Measure an explicit split-trust protocol against the current hostname-disclosure boundary; a single proxy is not anonymity. |
| FUT-08 | Learned deep-page recovery | Planned research | Use a separate corpus where both domain and path changed, return suggestions and score article correctness independently from domain continuity. |
| FUT-09 | Independent probe regions | Planned | Compare owned endpoints from permitted regions only after a measured need; do not rotate region to evade an access restriction. |
| FUT-10 | Queue/graph technology changes at scale | Planned, evidence-driven | Load-test the current relational/SQLite implementations, identify a real bottleneck, then compare a proposed queue/graph system rather than adding it by assumption. |

Other original targets still require measurement or external acceptance: full WCAG 2.2 AA/screen-reader/device testing; cold/warm gate-overhead and proposed p95 latency targets; production API availability/capacity/spend; complete production alerts/off-host recovery; actual Chrome/Edge Store approval; consenting-owner and usability pilots; generated schemas/clients; comprehensive settings migration/repair; an owner enrollment/rotation/recovery service; temporal splits/mergers and independent publication witnesses. Cross-device accounts, enterprise policy management and mobile/Safari distribution are deferred. Test fixtures and implemented runbooks do not establish those outcomes.
