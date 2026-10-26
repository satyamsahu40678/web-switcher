# Research experiments

The original study was performed on 25 October 2026 UTC. Continuation work is dated 26 October 2026 in Asia/Kolkata.

`results/2026-10-25/` preserves the original JSON reports. The Python experiment recorded 19 expected outcomes; those include failure-to-recover scenarios, refusal cases and acceptance of a record signed with a compromised legitimate key. This is not a recovery/safety percentage. The original browser run executed zero checks because Chromium was missing.

## HTTP chains and signatures

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r research/requirements.txt
python research/redirect_lab.py
```

The script uses actual local HTTP servers and P-256 signatures. A custom DER-signature envelope demonstrates mechanics; it is not the proposed production JWS format. Keys are pretrusted and ephemeral. No DNS/TLS ownership, public-site identity, browser caching or internet-scale benchmark is exercised. The output is written to `research/redirect_lab_results.json`.

The experiment shows live A→B→C traversal, failure after a required origin disappears, recovery using a remembered A→C shortcut, and the inability of that history to discover an unseen successor after C disappears. An independently delivered signed update supplies the missing pointer only because the signer was already trusted.

## Original gate feasibility harness

From the repository root:

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium --no-shell
npm run test:research
```

The runner uses the locked Playwright dependency, disposable profile, generated unpacked extension and loopback `.test` origins. It writes `research/browser_gate_results.json`. Its nine checks cover gate navigation, old-origin interception, query/fragment removal, encoded paths, exact hosts, expiration, pause, hostile input and POST exclusion. This minimal fixture has no signed catalog, settings UX or permission onboarding.

The continuation downloaded Chromium 141 successfully, then hit a local process-sandbox socket restriction. The environment rejected permission escalation. An ordinary isolated CI job was prepared with a read-only token and no deployment credentials. Publishing the branch was then blocked by GitHub write permissions, so the job has not run. This does not turn an unexecuted test into a pass: see the [status record](../docs/PROTOTYPE_STATUS.md).

## Actual prototype browser suite

```sh
npm run test:browser
```

This suite copies the actual `extension/` directory and changes only its fixture-origin flag and host grants. It uses the real settings page, background worker, DNR rules and route page. Fixture hosts are pregranted; native browser permission prompts/revocation remain untested. The package checker requires `ALLOW_TEST_ORIGINS = false` and no pregranted hosts in the shipped source.

Reports are written to `test-results/browser-results.json`. CI preserves these reports, the original harness output, the HTTP lab output, fixture-only screenshots and the packaged extension for 14 days. Screenshots contain generated test data, never a personal browser session.

The lockfile pins the reference tooling. Current Chrome/Edge, browser-store installations, real TLS/DNS and the wider release matrix still require separate validation.
