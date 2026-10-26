# Web Switcher continuation checkpoint

Recorded: 26 October 2026 (Asia/Kolkata).

## Authoritative available source

The currently accessible repository is the local routing prototype at commit
`5449d6a7ad909de4f74ca0986294c357007e0bdd` on
`feat/local-routing-prototype`. Its remote baseline is
`075bc000eaf203f912c4e610b3f7fbc7746681e9`.

The durable deliverables previously saved are:

- `Web_Switcher_Complete_Plan.md`, version 1.
- `Web_Switcher_Prototype_Handoff.zip`.
- `Web_Switcher_Experiments.zip`.

The prototype is not the completed platform described in the plan.

## Workspace interruption

During the continuation, a larger implementation was written and exercised in
an execution workspace. After the next continuation message, the accessible
workspace returned to the earlier prototype snapshot. The newer files,
toolchains, execution logs and local foundation commit `41924c0` are not present
in that snapshot. `git fsck --no-reflogs --unreachable` found no recoverable Git
objects there. No newer Library source checkpoint was found.

Do not report the newer implementation as delivered, recoverable from the
prototype ZIP, or present on GitHub. Reconstruction and fresh validation are
required before it can be delivered.

## Work observed before the reset

The conversation's tool outputs recorded work on the following components:

- pnpm workspace; WXT/React extension; public demo and admin React/Vite apps.
- Closed Zod catalog, passport and settings schemas; ES256 verification;
  duplicate-key rejection; rollback/equivocation and expiry checks.
- Exact-origin URL policies; compatible public-path prefixes; sensitive-route
  confirmation; query/fragment removal; approved migration graph compression.
- Java 21 / Spring Boot 4.1.2 backend with Flyway, JDBC, review queue, OIDC and
  demo authentication, CSRF, durable jobs, audit records and signed publisher.
- Separate Java fetcher with validated DNS/connect addresses, private-address
  rejection, HTTP/response bounds, robots handling and internal authentication.
- Experimental owner enrollment, single-use domain challenges and passport
  evidence intake. Automated owner-proof routing and key recovery remained
  incomplete.
- Synthetic local demo, owner signing CLI, browser/API harnesses, Dockerfiles,
  Compose configuration, database-role grants and draft CI/CD workflows.

These descriptions are reconstruction notes, not a list of files currently
available in this repository.

## Validation observed before the reset

| Check | Observed result | Applicability now |
| --- | --- | --- |
| New TypeScript policy/signature tests | 33 passed | New source no longer available; rerun after restoration |
| Existing prototype tests | 26 passed | Prototype remains available; prior result belongs to its recorded revision |
| Spring backend integration tests | 4 passed | New source no longer available; rerun after restoration |
| Fetcher address/URL policy tests | 2 passed | New source no longer available; rerun after restoration |
| Full local HTTP demo checks | 14 passed | New source no longer available; rerun after restoration |
| Browser navigation harness | Chromium could not start | No browser acceptance pass |
| PostgreSQL, Docker deployment, restore drills | Not executed | Open |
| GitHub Actions, image publication, production deployment | Not executed | Open |

The HTTP checks included catalog signature verification from Java in Node,
ETags, hostname-only lookup validation, admin authentication, CSRF, independent
review/publishing permissions, freshness prerequisites, optimistic review
concurrency, monotonic release creation, fetcher authentication, controlled
fixture reachability and metadata-address rejection.

The browser failure was an operating-environment restriction:
`socket() failed: Operation not permitted` in Chromium's process-singleton
startup. Elevated execution had previously been rejected. Do not bypass that
restriction or label the browser suite as passed/skipped-success.

## Publication blocker

The GitHub integration could read repository metadata, but attempting to create
`feat/web-switcher-platform` returned HTTP 403:
`Resource not accessible by integration`.

Repository metadata indicating that the user has push/admin permissions does
not establish that the integration has permission to write. No branch, push,
pull request, workflow run, release or deployment was successfully published.

The connected GitHub integration needs repository write access before an
external checkpoint can be created. Adding workflow files also needs whatever
workflow-writing permissions the chosen authentication method requires. Never
put credentials in source files, chat, artifacts or Git history.

## Required continuation sequence

- [x] Inspect the currently accessible Git history and working tree.
- [x] Check Git's unreachable objects for a local recovery point.
- [x] Search persistent deliverables for a newer source checkpoint.
- [x] Record the source availability and publication failures accurately.
- [ ] Restore or reconstruct the newer platform source.
- [ ] Save a durable source checkpoint immediately after each coherent change.
- [ ] Add the remaining API contract, architecture, configuration, deployment,
  demo, security, release and incident documentation.
- [ ] Reconcile every plan checkbox against current source and actual evidence.
- [ ] Run compilation, type checks, schema checks and meaningful unit tests.
- [ ] Run Java-to-JavaScript and JavaScript-to-Java signature vectors.
- [ ] Run the complete HTTP demo in one execution environment.
- [ ] Run PostgreSQL integration tests and inspect database privileges.
- [ ] Run extension tests on an environment that can launch Chromium.
- [ ] Test actual Chrome and Edge permission prompts, restarts and navigation.
- [ ] Run container, egress isolation, deployment, backup and restore checks.
- [ ] Publish commits through an authenticated write-capable GitHub connection.
- [ ] Inspect actual CI results before claiming a completed pipeline.
- [ ] Configure hosting, domain, OIDC, signing keys and deployment secrets before
  claiming a live deployment.

## Security fixes identified for reconstruction

These were under review and must not be assumed fixed:

1. Bind a confirmation click to the exact destination previewed. Revalidate
   expiry and current policy again before navigation; stop if the destination
   changed between preview and confirmation.
2. Keep pending reviewer decisions separate from activated published decisions.
   Automatic catalog renewal must not activate a new decision before the
   publisher-authorized release step.
3. Support reviewed corrections without losing migration provenance, and
   distinguish ownership transfers from continuous family identity.
4. Ensure global public lookup/report budgets are transactional, durable and
   bounded in addition to per-address rate limits.
5. Remove a tab-scoped bypass after the intended navigation or a short timeout.
6. Physically prune expired receipts; hiding them in the UI alone is insufficient.
7. Verify production-role separation, private-key placement, fetcher egress and
   read-only immutable release/audit database privileges on deployed containers.
8. Check backup and restore pipeline failures with pipefail; an empty encrypted
   dump must never count as a successful backup.

The full research plan remains the intended roadmap. No research pilot,
production deployment, browser-store submission or universal domain-discovery
claim is complete merely because a scaffold or workflow definition exists.
