# Install Web Switcher in Chrome or publish it to the Chrome Web Store

**Fastest option: install the unpacked extension in desktop Chrome. No backend, Java, Docker, domain, payment or Store account is needed for manual mappings.** Store publication is a separate Google account/review process; pushing this repository does not submit an extension to Google.

## 1. Get the extension without installing development tools

1. Sign in to GitHub and open [this repository's Actions](https://github.com/satyamsahu40678/web-switcher/actions/workflows/platform.yml).
2. Select the latest **successful** `Web Switcher platform` run for branch `feat/web-switcher-platform`. To get the PNG icons added with this guide, select a run containing this guide's commit or a later one. A running/failed run is not the release artifact to use.
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
7. Click its icon, then **Settings →** or **Manage connections →**. Alternatively use the extension card's **Details → Extension options**.
8. Create a mapping using the exact old origin and the checked destination origin: include `https://`, and omit page paths, queries and fragments in these two fields.
9. Initially choose **Open the homepage** and **24 hours**. Check the destination-confirmation box, then click **Connect these addresses**.
10. Approve the browser's request for access to the selected old site. Without that grant the extension does not save an active mapping.
11. Open a **new tab** and navigate to that exact old origin. The extension should route through its local gate to the selected destination. Pause/expiry/permission checks still apply.

Use desktop Chrome 120 or later, preferably current stable. Microsoft Edge supports the same unpacked approach at `edge://extensions`. Ordinary Chrome on Android/iPhone does not support installing this desktop extension. A work/school browser may prohibit Developer mode or unpacked extensions; use an allowed personal profile/device or ask its administrator rather than changing managed security policy.

### A concrete first test requiring no owned domain

This is a temporary user-configured test, **not a claim that these sites migrated**:

1. Open `https://example.org/` yourself to inspect the intended destination.
2. In Web Switcher settings enter **Old origin:** `https://example.com` and **Current origin:** `https://example.org`.
3. Choose homepage/24 hours, confirm your choice, save and grant source access.
4. Visit `https://example.com/hello?demo=1#section` in a new tab. Expect the address bar to end at `https://example.org/`; the original query, fragment and path are not forwarded in homepage mode.
5. Inspect **Recent switches**. It records origins/time, not the original page path. Pause the mapping and try the old URL again; it should remain on the original site unless that website itself redirects.
6. Remove the example mapping after the test. Add real mappings only after checking the actual destination yourself.

No mapping is preinstalled. Unknown sites stay unchanged; the extension does not discover every moved/dead website automatically. The distributed build intentionally rejects localhost, IP literals, custom ports and reserved fixture hosts such as `.test`. Do not enable fixture mode to use it normally.

### Everyday controls and updates

- Use the popup or settings to pause switching; mapping expiry requires a fresh check and re-adding the mapping.
- `http://`, `https://`, `www` and other subdomains are distinct sources. Add only each exact origin you intend to support.
- Keep a path only when old/new public page structures are compatible. Sensitive or ambiguous links can require confirmation; cookies and logged-in sessions never transfer.
- Export settings before replacing/moving an unpacked folder. Imports require review and source permissions again; they do not acquire registry/owner trust.
- After editing/rebuilding an unpacked extension, click its **Reload** button at `chrome://extensions`. Merely rebuilding files does not reload the running worker. Retest the mapping.
- Keep the same installation/folder for updates where possible. Removing an extension can delete its local settings; export first. Store and unpacked copies usually have different IDs/storage—export/import when switching, and disable the other copy to prevent competing rules.
- Incognito is off by default. If intentionally testing it, grant **Allow in incognito** under Details and review the privacy implications.

## 3. Choose what to publish

**Recommended first Store version: the default local-mapping extension.** It works without hosting anything and includes no remote registry trust anchor. Use the truthful listing copy below; automatic internet-wide discovery and owner verification are not delivered by this package.

An optional registry build additionally needs a real HTTPS catalog endpoint, reviewed production public keys, a key-isolated publisher and the infrastructure in [DEPLOYMENT.md](DEPLOYMENT.md). Configure both `WS_REGISTRY_KEYS_FILE` and `WS_REGISTRY_URL` when packaging; include **public JWKs only**, never private keys. Never upload demo roots or fixture-enabled builds. Registry builds add a fixed network permission and require matching server/privacy disclosures; finish that deployment before submitting such a build.

## 4. Files already prepared for the Store

| Item | Location / action |
| --- | --- |
| Upload package | `dist/web-switcher-0.2.0.zip` from a successful new build. `manifest.json` is at its root. Upload this inner ZIP, not the entire repository/artifact. |
| Extension icons | `extension/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`; manifest references included. Packaged ZIP contains them. |
| Store icon | Upload the supplied `extension/icons/icon-128.png` if the dashboard asks for it separately. |
| Required small promotional tile | [440×280 PNG](store-assets/small-promo-440x280.png). In GitHub use the image's **Download raw file** button; do not save the surrounding GitHub HTML. |
| Required screenshot | Capture at least one actual installed UI screenshot, 1280×800 or 640×400. Up to five are supported. Do not upload the promotional tile as a product screenshot. |
| Privacy policy | [Ready-to-host privacy page](privacy.html), scoped to the default local-only build. Publish it as below; verify your actual distribution matches it. |
| Optional store artwork regeneration | `scripts/store-assets.mjs` exports the existing original vector brand. Assets are already committed. |

### Take the required real screenshot

1. Install the extension and open its settings. Use only the temporary example mapping or your controlled sample; remove personal URLs/data from view.
2. Open DevTools (`F12` or `Ctrl+Shift+I`; macOS `Cmd+Option+I`). Toggle the device toolbar (`Ctrl+Shift+M`, or macOS `Cmd+Shift+M`). Choose **Responsive**, width **1280**, height **800**, device pixel ratio **1** (enable that control in the toolbar menu if necessary).
3. Open the DevTools command menu (`Ctrl+Shift+P`, or macOS `Cmd+Shift+P`) and run **Capture screenshot**. Use the viewport screenshot, not a full-page capture of arbitrary dimensions.
4. Check the saved PNG's dimensions before uploading; alternatively crop an ordinary screenshot to 1280×800 or 640×400 without stretching it. Make sure the UI is readable and the screenshot reflects the real extension.

## 5. Publish the free privacy-policy page

No paid hosting is needed for the manual build's policy:

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

   > Connect old website addresses to destinations you choose, with local controls, expiry and pause.

   Suggested detailed description:

   > Web Switcher follows exact website addresses that you explicitly configure. Add an old origin and a destination you have checked, grant access to that source, and choose homepage routing or compatible public paths. Mappings expire and can be paused or removed. Queries and fragments are dropped; sensitive links may require confirmation. Settings and origin-only activity stay in your browser. No account or backend is needed for local mappings. Unknown websites remain unchanged. This is not universal broken-link discovery or a guarantee of website ownership/content safety.

6. In **Privacy practices**, describe the single purpose: **user-controlled switching from selected old website origins to explicitly selected destinations**.
7. Justify each permission from the actual manifest:

| Permission | Suggested specific justification |
| --- | --- |
| `storage` | Persist user mappings, preferences, validation state and bounded local origin-only activity. |
| `declarativeNetRequestWithHostAccess` | Intercept only eligible top-level GET navigation for selected/granted source origins and send it to the packaged validation gate. |
| `activeTab` | Read the current tab's origin after the user invokes the popup, to show relevant mapping controls. |
| `alarms` | Run maintenance for expired routing state and bounded retained activity. |
| Optional `http://*/*`, `https://*/*` | Users can choose arbitrary source websites; request only the specific selected source's access at runtime. No all-sites grant is installed by default. Explain the optional scope honestly. |
| Fixed registry host, if using a custom registry build | Retrieve a signed catalog from that exact configured HTTPS endpoint. Omit this claim for the default build, which has no registry endpoint. |

8. For remote-code questions, this package uses **packaged executable code**, not remotely hosted JavaScript/Wasm. Optional signed JSON/JWS catalog data is data, not executable policy code. Do not add remote scripts to make a listing work.
9. Paste the live privacy-policy URL. Answer data-use questions from the package you are actually uploading: the default build processes URLs locally, stores settings/activity locally, and has no publisher telemetry or server upload. Do not blindly select every “no data” checkbox; read Google's definitions and keep the policy/listing/implementation consistent. Registry builds require additional endpoint/IP/request disclosures.
10. Complete all required certifications truthfully. Do not promise AI, general discovery, owner-verified sites or universal safety.

Official references: [prepare a ZIP](https://developer.chrome.com/docs/webstore/prepare), [image specifications](https://developer.chrome.com/docs/webstore/images), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

## 8. Give the reviewer exact working instructions

Use these in **Test instructions** or the corresponding reviewer field:

```text
This submission is the local-mapping build. No login or backend is required.
1. Open Web Switcher → Settings.
2. Add https://example.com → https://example.org, homepage mode, 24-hour expiry.
3. Inspect the destination, confirm the local choice, save, and grant source access.
4. Open https://example.com/hello?demo=1#section in a new tab.
   Expected destination: https://example.org/ (query/fragment/path removed).
5. Pause the mapping and navigate to the source again; Web Switcher does not switch it.
6. Remove the mapping after testing.
This is a temporary manual test, not a verified migration claim for the example sites.
Unknown hosts are unchanged. Signed registry controls are inactive in this default build.
```

Before submission, perform those steps yourself in a clean Chrome profile. Test permission denial/revocation, expiry, pause, restart and uninstall as well. Hosted Chromium checks have passed; actual Chrome/Edge native permission dialogs and Store review are separate acceptance steps.

## 9. Select visibility, submit and install the reviewed version

1. For a limited first release, choose **Unlisted** if available: anyone with its link can install; it is not private. Use **Private/trusted testers** if access must be restricted to specified Google accounts. Choose **Public** when ready for general discovery.
2. Select the intended distribution countries/regions and complete all required fields. See [distribution choices](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
3. Save, resolve validation warnings, then **Submit for review**. Select automatic/manual publication after approval according to your rollout preference.
4. Wait for Google's decision; review is not instant or guaranteed. Monitor the verified contact email/dashboard. If rejected, read the exact reason, fix the relevant code/listing and resubmit; do not remove safeguards merely to change wording.
5. Once published, open the listing in the intended Chrome profile and click **Add to Chrome**, then pin it and configure a mapping. Disable the unpacked copy first to avoid two installations competing.
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
| No switch | Mapping exists, enabled/unexpired, global pause off, source permission granted, exact scheme/host matches; open a new normal tab and use GET navigation. |
| `.test`, localhost or custom port rejected | Intentional production restriction. Use the concrete public example test above or your real public origins. |
| Expired mapping | Independently recheck destination, remove/re-add; do not bypass expiry. |
| Destination blocked/confirmation page | Review the reason. Sensitive/ambiguous paths intentionally need explicit confirmation; homepage mode is the safest first test. |
| Changes not taking effect | Reload at `chrome://extensions`; close old gate/popup pages and retry in a new tab. |
| Browser says administrator blocked it | Use an authorized profile/device or administrator-supported installation. |
| Store icon/image error | Use provided PNG assets, correct dimensions, real screenshots and the inner extension ZIP. SVG alone is not the Store's required PNG icon. |
| Artifact unavailable | Sign in to GitHub, choose a completed successful run, or build from source. Artifacts have finite retention. |
| Store asks for privacy/support URL | Enable Pages/host the supplied page and verify it is publicly readable; fill your real developer/support contact. |

Store submission, payments, identity verification and public launch remain owner actions. This guide prepares the package/assets and instructions; it does not claim an approved or published Chrome Web Store listing.
