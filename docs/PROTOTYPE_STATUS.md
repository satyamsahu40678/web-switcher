# Prototype progress

Updated: 26 October 2026 (Asia/Kolkata).

Baseline: `075bc000eaf203f912c4e610b3f7fbc7746681e9`. No existing application or repository-specific instructions were present. Work is committed on the local branch `feat/local-routing-prototype`. No remote branch or pull request was created.

## Implemented in this branch

The source contains an unpacked MV3 prototype, original spider/thread settings UI, manual mappings, selected-origin permissions, a validating route page, expiry/pause checks, query/fragment removal, bounded receipts and loop protection. Browser execution remains unverified. There is no backend or automatic destination discovery.

## Validation record

| Check | Status | Scope |
| --- | --- | --- |
| Original local HTTP/signature lab | 19 expected outcomes recorded in the original study | Includes expected failures and a compromised-key limitation |
| Pure routing/configuration tests | 26 passed locally | URL policy, expiry, exact source, bounds, chains, rule generation and loop timing |
| Manifest/syntax/package checks | Passed locally | No pregranted production hosts; fixture flag excluded; ZIP produced |
| Local Chromium experiment | Blocked before any checks | Chromium 141 downloaded, but the process sandbox denied a required socket; escalation policy refused the permission request |
| Original browser harness in CI | Blocked before scheduling | Nine intended checks; branch could not be published |
| Prototype browser suite in CI | Blocked before scheduling | Nineteen intended checks on disposable HTTP fixtures |
| GitHub publication | Blocked | Connected API returned HTTP 403, `Resource not accessible by integration`; ordinary Git push had no authenticated credentials |

Do not treat a test's existence as a passing result. The browser suites write structured reports on both success and failure. The prepared workflow has not run. CI evidence must be recorded after repository write access is available and the branch is published.

The handoff contains the source, an extension-only ZIP and ordered Git patches. Local publication attempts changed no remote branch. The next external action requires an authenticated GitHub connection with permission to write this repository and its workflow file; changing ChatGPT's generic ask-before-action setting does not grant those GitHub permissions.

## Open release gates

- [ ] Execute the original harness and the prototype browser suite in CI; fix any failures.
- [ ] Repeat supported scenarios on actual current Chrome and Edge.
- [ ] Exercise native host-permission request, denial, regrant and revocation.
- [ ] Test suspension, sleep/resume, back/forward, source service workers and tab-navigation races.
- [ ] Expand URL fuzzing, including credential-bearing address-bar input and very long URLs.
- [ ] Test interruption between staged config, DNR replacement and committed config.
- [ ] Measure cold/warm routing latency and assess the visible transition.
- [ ] Complete keyboard, screen reader, contrast, zoom and multi-platform UI review.
- [ ] Decide whether G0 is satisfied before scaffolding the full React/WXT and Java application.

The main plan retains product-wide checklist items. Prototype coverage alone does not complete broader tasks that include untested behaviors.
