# Release and incident checklist

A built ZIP, a Git commit, a successful GitHub push, a green CI run, a published environment and a live deployment are distinct outcomes. Record each only when there is evidence for that exact action.

## Development checkpoint

1. Run root routing/security tests, manifest checks, the web production build, Java API/fetcher tests and the current Chromium acceptance suite.
2. Inspect test counts and current-run result files. Distinguish failures, expected failures, skips and unrun cases; do not call a zero-test run validation.
3. Review changed manifests, permissions, host grants, dependency locks and generated packages. Production fixture flags must remain disabled.
4. Scan staged files for credentials and local DB/key material. Generated demo state, Maven/npm caches and browser profiles must stay untracked.
5. Commit a coherent checkpoint and push the selected branch. Confirm its exact remote SHA. If authentication fails, retain local commits/source archives and report the actual error.
6. Inspect the actual GitHub Actions run before saying CI passed. A workflow file alone provides no execution evidence.

The platform workflow uses read-only repository permissions and immutable action commit references. It compiles/tests Java and JavaScript, builds web assets, packages the extension, runs Chromium extension/web UI acceptance, starts an isolated synthetic Java demo for cross-language API/signature checks, and preserves artifacts. Container image publication, SBOM/license scanning, signature publication, live deployment and store upload are not silently performed by that workflow.

## Staging and public launch gates

- Select hosting account, region, owned domain, operator contacts and budget. Configure production OIDC subjects and separate reviewer/publisher responsibilities.
- Verify private DB/fetcher exposure, distinct runtime/DB privileges, isolated publisher key placement, TLS and secure session cookies.
- Run public-address/redirect/rebinding/size/timeout tests from the deployed fetcher boundary with enforced egress blocking.
- Exercise encrypted off-host backup plus clean restore and document measured RPO/RTO.
- Build from an exact tested commit with production catalog endpoint and pinned public trust roots. Keep demo/staging roots out of production packages.
- Install the exact package on supported real Chrome and Edge. Test native permission grant/deny/revoke, restart, suspend/resume, offline-expired state, loops, sensitive links, races and undo.
- Verify that no full URL telemetry leaves the browser in all supported flows. Complete keyboard/screen-reader/zoom/contrast review and accurate privacy/help text.
- Review migration ground truth and continuity evidence. Synthetic `.test` fixtures are not public seed entries. Do not promote reports, search results or reachability probes directly to trusted routes.
- Prepare store identity, reviewer instructions, original screenshots/icons, permission explanations, support contacts and staged rollout. Obtain actual store acceptance before claiming availability.

The original plan's research dataset, family/time holdouts, baseline comparisons, harmful-switch measurements, usability study and independent operator pilot remain separate research work. An implementation scaffold or local smoke test does not establish novelty or universal coverage.

## Incident actions

For a wrong mapping or compromised endpoint: stop new publication for the family, investigate evidence, publish a higher-sequence withdrawal/correction, and verify client behavior against the new catalog. Never “roll back” by reusing an older sequence. Expired/offline clients must abstain according to their local validity window; immediate global revocation cannot be guaranteed.

For a signing-key compromise: isolate the key holder, stop signing, withdraw affected trust through a pre-established transition or extension release, preserve audit evidence, and rebuild trust before automatic routing resumes. A stolen key can make cryptographically valid malicious records; signature verification alone cannot diagnose compromise.

For a fetcher boundary failure: disable dispatch and public discovery, isolate the fetcher, investigate exposure and egress logs without exposing credentials, rotate any affected runtime credentials, and revalidate the deployed controls before resuming.

For database corruption/loss: stop mutation, preserve the failed volume, restore into a new clean instance, verify migrations/catalog bytes/sequences and then switch traffic. Do not overwrite the only available state or claim a backup is usable before a restore has succeeded.
