# Install Web Switcher in Chrome or publish it to the Chrome Web Store

**Fastest option: install the unpacked extension in desktop Chrome. No backend, Java, Docker, payment or Store account is needed for browser-side continuity checks or manual overrides. You do need an old public HTTPS address to investigate; a successor must be declared or already remembered, not invented.** Store publication is a separate Google account/review process; pushing this repository does not submit an extension to Google.

## 1. Get the extension without installing development tools

1. Sign in to GitHub and open [this repository's Actions](https://github.com/satyamsahu40678/web-switcher/actions/workflows/platform.yml).
2. Select the latest **successful** `Web Switcher platform` run for branch `feat/web-switcher-platform`. Choose a run containing the automatic-continuity change or a later one; older local-mapping-only packages do not contain the primary discovery flow described here. A running/failed run is not the release artifact to use.
3. Scroll to **Artifacts** and download **web-switcher-development-packages**. GitHub may require you to sign in before downloading artifacts.
4. Extract that downloaded artifact ZIP. Inside it find `dist/web-switcher-0.2.0.zip`. The artifact also contains web application files; those are not the browser extension.
5. Extract **that inner extension ZIP** into a permanent folder on your computer, such as `Documents/WebSwitcher`. Its top level must contain `manifest.json`, `background.js`, `options.html` and `icons/`.
6. Keep this folder in place while using an unpacked installation. Do not select the repository root, `apps/web`, the outer artifact ZIP or an unextracted ZIP in Chrome.

If Actions is still building, the source method below avoids waiting. Artifacts expire after 14 days; build again if an older download has expired.

### Alternative: build from source

Install Git, Node.js 24 LTS/npm and Python 3. On macOS/Linux, from a terminal:

```sh
git clone --branch feat/web-switcher-platform https://github.com/satyamsahu40678/web-switcher.git
cd web-switcher
npm ci
npm test
npm run check
npm run package
```

Load `dist/web-switcher/`. The upload ZIP is `dist/web-switcher-0.2.0.zip`.

On Windows, the artifact download is the easiest method. For source builds, use WSL with the commands above, or ensure the command `python3 --version` works in your terminal: the packaging script invokes `python3`, not `py`. Java and the React application are unnecessary for extension-only builds. The checked-in PNG assets require no regeneration; optional regeneration is `CHROMIUM_PATH=/path/to/chromium node scripts/store-assets.mjs` with the locked Playwright dependency/browser available.

## 2. Install in your own desktop browser

1. Open desktop Google Chrome and enter `chrome://extensions` in the address bar.
2. Turn on **Developer mode** using the switch at the top right.
3. Click **Load unpacked**.
4. Select the extracted folder that **directly contains `manifest.json`**. If building from source, select `dist/web-switcher`.
5. Confirm the **Web Switcher** card appears and is enabled. Check that Chrome shows no extension errors.
6. Click Chrome's puzzle-piece **Extensions** menu and pin Web Switcher.
7. Click its icon, then **Find current address**. The options page can prefill the current tab's origin. Alternatively use the extension card's **Details → Extension options**.
8. In **Old website address**, enter only the old address you know. A full URL is accepted, but its path/query/fragment are discarded before the root check. **Do not enter a new destination.**
9. Leave **Allow automatic checks across HTTPS domains** unchecked for selected-origin permission prompts. Check it only if you want to grant optional access across HTTPS origins so chosen chains can continue without a new permission prompt at every origin.
10. Click **Find current address** and approve Chrome's request. If a later step says **Allow next check**, approve that displayed origin to continue. Denial stops the check; it does not grant broad access silently.
11. Inspect the displayed chain and result. A reachable address discovered through explicit move signals is **source-declared**, not registry-reviewed, owner-verified or a content-safety guarantee. **Open latest address** rechecks the observed target before opening its homepage.
12. To use automatic following on future visits, select the explicit follow-consent checkbox and click **Follow this website**. Later top-level GET visits to that selected old origin pass through the continuity gate, which rechecks its chain and remembered successors. You still never type its current domain.
13. Use **Pause following**, **Resume following**, **Check current address** and **Forget this website** under followed sites. Global pause also stops automatic switching. Manual mappings remain available separately when you already know a target; manual/signed registry decisions take precedence for the same source. Previously trusted signed aliases remain reserved after expiry, withdrawal or cache deletion to prevent weaker continuity from silently replacing that policy.

Use desktop Chrome 120 or later, preferably current stable. Microsoft Edge supports the same unpacked approach at `edge://extensions`. Ordinary Chrome on Android/iPhone does not support installing this desktop extension. A work/school browser may prohibit Developer mode or unpacked extensions; use an allowed personal profile/device or ask its administrator rather than changing managed security policy.

### Test automatic discovery before publishing

Use a public HTTPS old origin with a real explicit move, or prepare a small controlled chain on origins you own:

1. Origin A declares B using an HTTP `Location` redirect, an HTTP `Refresh` header, a short HTML meta-refresh, or an explicit `rel="web-switcher-successor"` link.
2. B similarly declares C; C serves an ordinary reachable page without another move. Each origin must have valid HTTPS, no custom port, and a public hostname. For a static meta-refresh fixture, A's root HTML can contain `<meta http-equiv="refresh" content="0;url=https://YOUR-B-ORIGIN/">`; B's root points to your C origin. Replace placeholders with your actual controlled hosts.
3. Enter **only A** in **Old website address**. Grant selected origins as prompted (or explicitly choose the optional broad HTTPS grant). Expect a displayed A→B→C chain and reachable C, without a target field.
4. Choose **Open latest address**, then consent to **Follow this website**. Navigate to A in a fresh tab and check that the continuity gate opens C's homepage.
5. To exercise another move, make C explicitly point to a new controlled reachable D. Navigate to A again; expect the extended A→B→C→D chain and D, still without editing a destination mapping.
6. Learned origin links can skip confirmed DNS/connection failures, bounded request timeouts or explicit HTTP 404/410 responses on retired origins while a unique valid remembered successor remains. Without that history, none reveals an unknown target. HTTP 401/403/429/5xx, certificate errors and generic fetch/CORS errors stop; they are not permission to bypass failure checks. The native fixture suite exercises real connection failure separately.
7. Pause following and verify automatic routing stops. Forget the website when finished. Use only these controlled sample addresses in Store screenshots/reviewer instructions.

If A is already dead, has never been seen before and supplies no usable successor evidence, an unknown result is correct. No extension can infer an unseen new domain from that dead URL alone. An ordinary canonical tag, familiar name/logo or arbitrary link does not authorize an automatic hop. This package does not execute a site's arbitrary JavaScript to discover redirects. See [automatic continuity behavior and limits](AUTOMATIC_CONTINUITY.md).

The user-supplied `vegamovies.rs` → `new1.vegamovies.lease` pair is an illustrative requested case, not a verified current relationship or a built-in mapping. Use it only if the actual available evidence supports the chain; do not present it as the Store's reviewed demonstration.

### Optional manual-override smoke test

For a quick check of the secondary manual feature, temporarily map `https://example.com` to `https://example.org` in the manual form, using homepage mode/24-hour validity after inspecting the destination and granting source access. Visiting `https://example.com/hello?demo=1#section` should open `https://example.org/`. This is a user-selected test, **not a claim these sites migrated**, and it does not demonstrate automatic discovery. Remove it afterwards so it cannot override an automatic continuity check for the same source.

The distributed build intentionally rejects localhost, IP literals, custom ports and reserved fixture hosts such as `.test`. Never enable fixture mode for ordinary use or a Store package. Unknown sites are not silently guessed or switched.

### Everyday controls and updates

- Pause/resume individual followed sites or global switching. Learned links have a seven-day validity window from their latest observation; an expired edge cannot rescue an unreachable host. Manual mappings have their own explicit expiry and require rechecking/re-adding.
- `www` and other subdomains are distinct sources. Automatic continuity starts with public HTTPS origins; HTTP and custom ports are fixture-only for this discovery flow. Manual source mappings have their separately documented HTTP/HTTPS policy.
- Discovered cross-domain moves open the current homepage; original query/fragment data is never transferred. Sensitive/ambiguous original links can require confirmation. Path preservation belongs to explicit manual/reviewed policy, not an inferred move. Cookies and logged-in sessions never transfer.
- **Delete all local data** removes mappings, followed sites, learned history, activity and the catalog cache. It retains public catalog rollback/alias-reservation security metadata so reset, expiry or withdrawal cannot silently enable a weaker route.
- Export manual settings before replacing/moving an unpacked folder. The current export/import format backs up manual mappings, not learned continuity history or followed-site enrollment. Imports require review/source permissions and cannot acquire registry/owner trust.
- After editing/rebuilding an unpacked extension, click its **Reload** button at `chrome://extensions`. Merely rebuilding files does not reload the running worker. Retest the mapping.
- Keep the same installation/folder for updates where possible. Removing an extension can delete its local settings; export first. Store and unpacked copies usually have different IDs/storage—export/import when switching, and disable the other copy to prevent competing rules.
- Incognito is off by default. If intentionally testing it, grant **Allow in incognito** under Details and review the privacy implications.

## 3. Choose what to publish

**Recommended first Store version: the default browser-side continuity extension.** Its main flow takes an old address, follows explicit move signals and remembers successor links locally; no backend hosting or remote registry trust anchor is required. Manual mappings are secondary overrides. Use the truthful listing copy below: universal internet-wide discovery, arbitrary JavaScript execution and owner verification are not delivered by this package.

An optional registry build additionally needs a real HTTPS catalog endpoint, reviewed production public keys, a key-isolated publisher and the infrastructure in [DEPLOYMENT.md](DEPLOYMENT.md). Configure both `WS_REGISTRY_KEYS_FILE` and `WS_REGISTRY_URL` when packaging; include **public JWKs only**, never private keys. Never upload demo roots or fixture-enabled builds. Registry builds add a fixed network permission and require matching server/privacy disclosures; finish that deployment before submitting such a build.

## 4. Files already prepared for the Store

| Item | Location / action |
| --- | --- |
| Upload package | `dist/web-switcher-0.2.0.zip` from a successful new build. `manifest.json` is at its root. Upload this inner ZIP, not the entire repository/artifact. |
| Extension icons | `extension/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`; manifest references included. Packaged ZIP contains them. |
| Store icon | Upload the supplied `extension/icons/icon-128.png` if the dashboard asks for it separately. |
| Required small promotional tile | [440×280 PNG](store-assets/small-promo-440x280.png). In GitHub use the image's **Download raw file** button; do not save the surrounding GitHub HTML. |
| Required screenshot | Capture at least one actual installed UI screenshot, 1280×800 or 640×400. Up to five are supported. Do not upload the promotional tile as a product screenshot. |
| Privacy policy | [Ready-to-host privacy page](privacy.html), scoped to the default browser-side continuity build, including its direct website probes. Publish it as below; verify your actual distribution matches it. |
| Optional store artwork regeneration | `scripts/store-assets.mjs` exports the existing original vector brand. Assets are already committed. |

### Take the required real screenshot

1. Install the extension and open its settings. Use only a controlled continuity-chain sample or the clearly labelled temporary manual test; remove personal URLs/data from view.
2. Open DevTools (`F12` or `Ctrl+Shift+I`; macOS `Cmd+Option+I`). Toggle the device toolbar (`Ctrl+Shift+M`, or macOS `Cmd+Shift+M`). Choose **Responsive**, width **1280**, height **800**, device pixel ratio **1** (enable that control in the toolbar menu if necessary).
3. Open the DevTools command menu (`Ctrl+Shift+P`, or macOS `Cmd+Shift+P`) and run **Capture screenshot**. Use the viewport screenshot, not a full-page capture of arbitrary dimensions.
4. Check the saved PNG's dimensions before uploading; alternatively crop an ordinary screenshot to 1280×800 or 640×400 without stretching it. Make sure the UI is readable and the screenshot reflects the real extension.

## 5. Publish the free privacy-policy page

No paid hosting is needed for the extension's privacy-policy page:

1. Open repository **Settings → Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Select branch **feat/web-switcher-platform**, folder **/docs**, and **Save**. You can use `main` after merging the reviewed change instead.
4. Wait for GitHub Pages deployment to finish. Copy the actual published site URL shown in Pages settings.
5. Append `/privacy.html`. For the default project URL this is `https://satyamsahu40678.github.io/web-switcher/privacy.html`.
6. Open that exact URL in a signed-out/private window and confirm it returns the readable privacy page. Paste the live URL into the Chrome dashboard. A source file being committed does not mean Pages is enabled.
7. Configure your real verified Store developer contact. If you change the distributed behavior, add a registry or introduce data collection, update the policy/disclosures before publishing that change.

Pages availability depends on repository/account settings. If unavailable, host the same standalone HTML on your existing public HTTPS site; the policy URL must be publicly readable without login.

## 6. Register with Google

1. Sign in to the Google account you will retain as publisher. Enable **2-Step Verification** and keep its recovery methods secure.
2. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Complete developer registration, accept Google's agreements and pay the **one-time registration fee shown by Google**. Check the current amount/currency in the dashboard.
4. Verify your developer/contact email. Complete any identity, publisher or regional trader-status information the dashboard requires for your situation.
5. You personally complete account verification, payment and declarations. No Google password, payment data or recovery codes belong in this repository or chat.

Official references: [registration](https://developer.chrome.com/docs/webstore/register), [account setup](https://developer.chrome.com/docs/webstore/set-up-account).

## 7. Create the Store listing and upload

1. In the dashboard click **New item** and upload `web-switcher-0.2.0.zip`.
2. Confirm it detects **Web Switcher**, Manifest V3, version **0.2.0**. Fix any validation error before continuing.
3. Fill the title, language and suitable available category; add the actual support URL, such as this repository's Issues page, and your verified contact information.
4. Upload the supplied 128×128 icon and 440×280 tile, plus at least one real screenshot from section 4. Complete any other image fields marked required by the current dashboard.
5. Use accurate listing copy. Suggested short description:

   > Find current addresses through website-declared moves and remembered successors, with local control.

   Suggested detailed description:

   > Start with an old website address, without entering its new domain. Web Switcher checks explicit HTTP/page-declared move signals, displays the successor chain and remembers origin-only links on your device. With your consent, following a selected site checks that chain on future visits and can use valid remembered links to skip a retired host with a confirmed network failure, bounded timeout or explicit HTTP 404/410 response. You control website permissions, pause and forgetting; manual mappings remain optional overrides. Direct checks contact the chosen websites, use no credentials and do not execute remote scripts. No account or backend is required. Unknown, conflicting, expired or unsupported cases stop. Source-declared moves are not independent proof of ownership, content safety or universal dead-link recovery.

6. In **Privacy practices**, describe the single purpose: **finding and following declared website-address continuity chains for user-selected old origins, with local history and user control**.
7. Justify each permission from the actual manifest:

| Permission | Suggested specific justification |
| --- | --- |
| `storage` | Persist followed origins, bounded origin-only successor edges, manual overrides, preferences, validation state and bounded local origin-only activity. |
| `declarativeNetRequestWithHostAccess` | Intercept only eligible top-level GET navigation for selected/granted source origins and send it to the packaged validation gate. |
| `activeTab` | Read the current tab's origin after the user invokes the popup, to prefill its old address and show relevant following/override controls. |
| `alarms` | Run maintenance for expired routing state and bounded retained activity. |
| `webRequest` | Read redirect/refresh response headers for the extension's own active, correlated probe requests while Fetch is in manual-redirect mode. This lets it validate the next hop before requesting it. Unrelated browsing requests are ignored and are not recorded. |
| Optional `http://*/*`, `https://*/*` | Selected-source/next-origin permissions support chosen continuity checks and manual source mappings. By default, request each exact origin at a user gesture. A separate unchecked-by-default option explicitly requests all-HTTPS access so selected chains can continue automatically. No all-sites grant is installed by default, and broad permission does not enroll every site or enable general browsing-history collection. |
| Fixed registry host, if using a custom registry build | Retrieve a signed catalog from that exact configured HTTPS endpoint. Omit this claim for the default build, which has no registry endpoint. |

8. For remote-code questions, this package uses **packaged executable code**, not remotely hosted JavaScript/Wasm. Optional signed JSON/JWS catalog data is data, not executable policy code. Do not add remote scripts to make a listing work.
9. Paste the live privacy-policy URL. Answer data-use questions from the package you are actually uploading: the default build processes navigation locally and stores settings, followed sites, successor edges and activity locally. Explicit checks and visits to followed sites also cause direct requests to the selected website/declared successors, exposing normal connection metadata such as IP address and request timing to those website operators. The probe omits cookies/HTTP credentials and referrers; no browsing-history upload or publisher analytics endpoint is configured. Do not describe this as a network-free or manual-only extension. Do not blindly select every “no data” checkbox; read Google's definitions and keep the policy/listing/implementation consistent. Registry builds require additional endpoint/IP/request disclosures.
10. Complete all required certifications truthfully. Do not promise AI, general discovery, owner-verified sites or universal safety.

Official references: [prepare a ZIP](https://developer.chrome.com/docs/webstore/prepare), [image specifications](https://developer.chrome.com/docs/webstore/images), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## 8. Give the reviewer exact working instructions

Prepare stable public HTTPS test origins A, B, C (and optionally D) that you control as in section 2. Put their **actual URLs** in the reviewer field, including any necessary explanation of test-host availability. Do not submit unreplaced placeholders, `.test` fixtures, fabricated public migration claims or a password-protected fixture as the only way to exercise the main feature. Use these instructions after replacing the origin names:

```text
This submission runs browser-side continuity discovery; no extension login/backend is required.
Controlled test origins: A = [actual old HTTPS origin], B = [actual bridge], C = [actual current origin].
A declares B; B declares C; C is reachable and has no further successor.
1. Open Web Switcher → Find current address.
2. Enter only A in Old website address. Do not add a destination/manual mapping.
3. Grant the selected origin; use Allow next check for B and C as requested.
4. Expected: A→B→C chain, reachable C, and no manually entered target.
5. Click Open latest address; C is rechecked before its homepage opens.
6. Return to settings, consent to follow the source and click Follow this website.
7. Open A in a fresh tab; its continuity gate checks and follows the observed chain.
8. Pause following and verify Web Switcher stops automatic routing; forget the site afterwards.
Move signals are source-declared observations, not independent owner/registry verification.
The signed-registry feature is inactive in this default build.
```

You may also include the `example.com` → `example.org` manual-override test from section 2 as a **secondary** test, clearly separated from automatic discovery. It must not be the only demonstration of the extension's advertised main purpose.

Before submission, perform those steps yourself in a clean Chrome profile. Test permission denial/revocation, expiry, pause, restart and uninstall as well. Use the exact-revision results in [the validation ledger](IMPLEMENTATION_STATUS.md) and CI before distributing a build; a test file alone is not a passing run. Actual Chrome/Edge native permission dialogs and Store review are separate acceptance steps.

## 9. Select visibility, submit and install the reviewed version

1. For a limited first release, choose **Unlisted** if available: anyone with its link can install; it is not private. Use **Private/trusted testers** if access must be restricted to specified Google accounts. Choose **Public** when ready for general discovery.
2. Select the intended distribution countries/regions and complete all required fields. See [distribution choices](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
3. Save, resolve validation warnings, then **Submit for review**. Select automatic/manual publication after approval according to your rollout preference.
4. Wait for Google's decision; review is not instant or guaranteed. Monitor the verified contact email/dashboard. If rejected, read the exact reason, fix the relevant code/listing and resubmit; do not remove safeguards merely to change wording.
5. Once published, open the listing in the intended Chrome profile and click **Add to Chrome**, then pin it and start with an old address in **Find current address**. Consent to follow a selected site only after inspecting its chain. Disable the unpacked copy first to avoid two installations competing.
6. Share the real listing URL after publication. GitHub, GitHub Pages and the web app do not themselves install a Store extension.

## 10. Publish updates later

1. Export your own settings and retain the previous source/ZIP before changing behavior.
2. Increase `version` in `extension/manifest.json` to a higher valid Chrome numeric version, such as `0.2.1`. Keep release metadata consistent where applicable; Google's update decision uses the manifest version, not the ZIP filename.
3. Run `npm test`, `npm run check`, `npm run package`; inspect and load the new output in a separate test profile. Currently the packaging script names its output `web-switcher-0.2.0.zip`; that filename does not set the manifest version. Rename the output for your own organization if desired, without nesting its contents.
4. Upload the ZIP as a **new package to the same existing Store item**, not as a new listing. Review permission changes, update screenshots/policy where necessary, and submit for review. [Official update instructions](https://developer.chrome.com/docs/webstore/update).
5. Store-managed installations receive approved updates through Chrome's update mechanism; unplugged source folders do not update automatically. For unpacked installations, rebuild/replace files in the same folder and click Reload.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| “Manifest missing/unreadable” | You selected the wrong folder or outer ZIP. Select the directory with `manifest.json` directly inside. |
| No automatic switch | The source is followed/enabled, global pause is off, source/next-origin access is granted, live declarations or valid remembered edges establish a reachable terminal, and no manual/signed override takes precedence. Use a new normal tab and GET navigation. |
| Find shows unknown/unavailable | Inspect the evidence/reason. A dead unobserved source, unsupported script-only move, expired history, TLS/HTTP failure or missing declaration is not a reason to guess a target. |
| `.test`, localhost or custom port rejected | Intentional production restriction. Use real public HTTPS origins for discovery; the example.com manual test is a separate secondary feature. |
| Expired mapping | Independently recheck destination, remove/re-add; do not bypass expiry. |
| Destination blocked/confirmation page | Review the reason. Sensitive/ambiguous paths intentionally need explicit confirmation; homepage mode is the safest first test. |
| Changes not taking effect | Reload at `chrome://extensions`; close old gate/popup pages and retry in a new tab. |
| Browser says administrator blocked it | Use an authorized profile/device or administrator-supported installation. |
| Store icon/image error | Use provided PNG assets, correct dimensions, real screenshots and the inner extension ZIP. SVG alone is not the Store's required PNG icon. |
| Artifact unavailable | Sign in to GitHub, choose a completed successful run, or build from source. Artifacts have finite retention. |
| Store asks for privacy/support URL | Enable Pages/host the supplied page and verify it is publicly readable; fill your real developer/support contact. |

Store submission, payments, identity verification, controlled public reviewer fixture URLs and public launch remain owner actions. This guide prepares the package/assets and instructions; it does not claim an approved or published Chrome Web Store listing.
