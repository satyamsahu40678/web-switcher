# Use Internet discovery from an old address

Updated 29 October 2026 (Asia/Kolkata). This guide describes the implemented product paths and the separate prerequisites for operating the optional search service. Current executed outcomes belong to [the implementation ledger](IMPLEMENTATION_STATUS.md) and exact-source CI runs. A configured adapter is not proof of public-provider availability or a verified public deployment.

## Choose the path you need

| Path | Required setup | What it can find |
| --- | --- | --- |
| Direct continuity | Install the extension; grant the selected website origin | Current explicit HTTP/Refresh/page-declared successor chains and fresh local successor memory. |
| Public archives | Install the extension; consent to the selected hostname investigation and grant Archive.org/Web Archive origins | Candidate successors recorded in bounded public archive/index/snapshot evidence, even with no local migration history. No backend or paid search key is required. |
| Optional search service | Operator-deployed HTTPS service, an individual service access token and any configured provider account/key | Public search leads when its search provider is configured, plus enabled archive evidence through the bounded asynchronous service. The extension still checks and asks before opening an unverified suggestion. |
| Signed registry | Separately configured publisher keys and a current verified catalog | Independently reviewed published policy; discovery cannot create or replace this authority. |

Enter **only the old public HTTPS address**. You do not supply a replacement, a history file or a brand name. A familiar name, copied content, search rank or historical redirect is a lead rather than ownership proof. No surviving usable trace can mean no result; a website can also have closed without a successor.

## Install and investigate without a server

1. Use [the Chrome installation guide](CHROME_INSTALL_AND_STORE.md) to download the latest successful package or build it with `npm run package`. Load the directory containing `manifest.json` in an allowed desktop Chrome/Edge profile.
2. Open **Find current address** and enter the old address in **Old website address**. A full URL is accepted locally, but its original path/query/fragment are discarded before investigation. Credentialed and unsupported/private addresses are rejected.
3. The existing direct check can find live declarations or remembered successors. To investigate public evidence with no local history, use **No known chain? Search beyond this device.**, keep **Public archives · no account or server needed** selected, and select the online-lookup consent checkbox.
4. Choose **Search public sources**. The browser asks for access to `https://archive.org/*` and `https://web.archive.org/*`. Denial stops the lookup. Those providers see the selected normalized hostname/root query, your IP and request timing.
5. Wait for the bounded investigation or choose **Cancel search**. Read the source/capture dates, candidate origins, reason codes and any partial/unavailable result. An archive capture date is not the original publication date or a current liveness check.
6. Choose a candidate's **Check this address** action. Grant that candidate origin when asked, and grant any explicitly discovered next origin only if you want to continue. The result can change, fail or remain inconclusive; an HTTP response alone does not prove identity.
7. Inspect the final checked origin and choose **Open checked address**. It is rechecked again before opening its homepage. Original private URL parts do not cross to it. No top search/archive result is silently opened.
8. Optionally select **Remember this choice for 24 hours (unverified)** and choose **Remember checked choice**. The saved record is a reversible **user-configured** homepage override, not a registry/owner-verified decision and not a fabricated locally observed migration edge. It does not require typing the new address. Pause/remove it in saved mappings when no longer wanted.

Archive investigation is limited to two index requests and three selected captures, ten candidate origins, a 30-second operation budget, 128 KiB per response and 512 KiB total. Provider timeouts or malformed responses can produce partial results. The adapter contacts archive providers; checking/opening a candidate is a separate action.

The optional all-HTTPS permission lets chosen live chains continue without separate origin prompts; it does not enroll every website, collect browsing history or silently opt the user into public-source lookups. Browser literal-URL validation does not pin DNS answers or connected peer IPs. The optional isolated server fetcher has a different public-only DNS/socket boundary.

## Understand the result

| Result or evidence | Interpretation/action |
| --- | --- |
| Archived redirect or explicit archived move statement | A dated historical relationship worth checking now. It can be stale, malicious, incomplete or from a different domain-control period. |
| Search lead | The provider returned a relevant page/origin. Its rank and snippet do not establish identity. |
| Candidate reachable now | The selected address responded from the checking vantage at the displayed time. It is not a promise of future availability or safe content. |
| Further live successor | A candidate currently declares another address. Its permission and policy are checked separately. |
| Partial/provider unavailable | The investigation could not obtain all intended evidence. It does not mean no successor exists. |
| No admissible candidate | The bounded available evidence did not yield a supported replacement. No guess is installed. |
| Signed-history barrier | A source, intermediate or terminal belongs to stronger signed history. Unsigned public-source suggestions cannot bypass its expiry, withdrawal or reservation policy. |
| Conflicting or ambiguous evidence | Multiple identities/successors may exist; no automatic winner is selected. |

The user-supplied `vegamovies.rs` / `new1.vegamovies.lease` example is not hardcoded and has not been independently verified as a current relationship. Controlled fixtures demonstrate mechanisms; they do not guarantee what a particular public provider currently returns for that case.

## Local state, cancellation and restart

The extension retains at most ten public-source jobs locally for one hour. Records contain selected origins, bounded candidate/evidence facts and public locators, progress/reasons and expiry—not the original private browser URL or fetched response bodies. Reads prune expired jobs. Cleanup cannot run while the browser is closed.

An archive job interrupted by the browser worker restarting becomes interrupted/failed; the extension does not silently restart external work as if no requests had been spent. A configured service job can resume status checks through its existing opaque backend reference. Polling that reference does not launch another paid search.

The service origin is a local preference. Its individual access token is session-only, is not returned by settings readback and is not exported. Changing the service origin removes the prior session token. After a browser restart, a service may require that token again.

**Delete all local data** aborts local work, attempts remote-job cancellation where possible, and removes local jobs, service settings/session tokens, mappings, followed sources, graph activity and catalog cache. It cannot undo already transmitted queries, guarantee a provider refund or delete independently retained server data. Public signed rollback/alias-reservation metadata remains to prevent trust downgrade. Use the configured operator/provider's stated deletion process for server-side retention.

## Optional service: operator prerequisites

The service lives in [online-discovery/](../online-discovery/). It is a separate Node 24 service with its own SQLite store. It does not connect to the existing registry database or modify the Java API's V1 lookup response, Flyway migration, signed release bytes or publisher role. That separation keeps unverified search work outside signed publication authority.

The supported runtime is Node 24.5 or later, preferably the repository's Node 24 LTS line. The service uses built-in Node APIs rather than a browser-embedded provider key. The public contract is a hostname-only asynchronous `/v2/discoveries` job with a bounded result/cancel/status flow; it is not an arbitrary-URL fetch proxy. A service with no Brave key can still investigate its enabled archives, but cannot provide Brave web-search results.

Before serving other users, an operator needs:

- A public HTTPS service origin and a policy naming actual data recipients, retention and a real contact/deletion route.
- Individual unpredictable access tokens provisioned through a secure route. A shared secret embedded in every extension installation is not authentication.
- A server-side `BRAVE_SEARCH_API_KEY` if Brave search is enabled, with current permitted API access, quota and billing understood. Keyless browser archive mode remains usable without that account.
- A private persistent writable SQLite data directory and an independently tested backup/restore process. Keep runtime source/image files read-only where practical.
- Durable request/byte admission, separate provider-account billing limits and source-provider egress appropriate to the deployment. An invite token is not permission to expose an unlimited paid-search relay.
- For server-side live candidate observations, a separately isolated internal fetcher with a fixed endpoint and matching internal bearer. It must not receive the search key, SQLite access, registry/publisher credentials or cloud credentials. When absent, availability is left unchecked for the browser to check before opening.

Do not copy production keys into the repository, extension, image layers, issue/PR descriptions or chat. Store provider and operator credentials using the host's secret manager or a protected environment file; user-supplied extension access tokens are a different credential class.

### Start and configure the service

The authoritative supported configuration/commands are in [the service README](../online-discovery/README.md). From the repository root, its development entry point is:

```sh
npm --prefix online-discovery start
```

Online admission is disabled by default. To enable it, set `ONLINE_DISCOVERY_ENABLED=true` and securely provision `ONLINE_ACCESS_TOKENS` as a comma-separated list of distinct individual tokens, each containing 32–256 letters, digits, hyphens or underscores. Starting a disabled process is not a successful lookup-service readiness check. It must not become an unauthenticated public paid-query endpoint. Run it behind a TLS reverse proxy on an owned hostname rather than pointing the distributed extension at a localhost/custom-port fixture. Bind published development ports to loopback. Restrict ingress to the intended proxy and leave proxy-forwarded address headers untrusted unless explicitly configured.

The service README specifies the exact bind/port, SQLite path, provider configuration, optional fetcher settings and backup CLI. Default CLI binding is `127.0.0.1:8082`; `ONLINE_BIND`, `ONLINE_PORT` and `ONLINE_DATABASE_PATH` select an operator-controlled listener and persistent database path. `ONLINE_CONCURRENCY` accepts one to four workers, with two by default. `ONLINE_ARCHIVE_ENABLED=false` disables its archive source. `ONLINE_ALLOWED_ORIGINS` declares explicit HTTPS/extension origins for browser CORS; it is not a replacement for a token. Hard request/time/byte and quota ceilings are implemented in the store, not arbitrary unrecognized environment names. Use those executable values rather than treating proposed names in the historical planning documents as implemented settings.

In the extension, expand **Optional discovery service**, enter the **Discovery service origin** as an exact HTTPS origin and your individual **Service access token**, and choose **Save service settings**. Grant access only to that displayed origin. Select service mode, enter the old address only and start the explicitly consented lookup. A 401/403 requires checking token provisioning with that operator; entering a Brave provider key into the extension is not the fix.

### Container and HTTPS deployment

From the repository root, build the service without embedding credentials:

```sh
docker build -f online-discovery/Dockerfile -t web-switcher-online:local .
docker volume create web-switcher-online-data
docker run -d --name web-switcher-online \
  --env-file /absolute/protected/online.env \
  --mount type=volume,src=web-switcher-online-data,dst=/var/lib/web-switcher-discovery \
  --publish 127.0.0.1:8082:8082 \
  --read-only --tmpfs /tmp --cap-drop=ALL \
  --security-opt=no-new-privileges \
  web-switcher-online:local
```

`/absolute/protected/online.env` is an operator-created, private environment file, not a checked-in sample credential. It must enable admission and provision the individual tokens; add `BRAVE_SEARCH_API_KEY` there or through an equivalent host secret manager only if using search. The image's data path is `/var/lib/web-switcher-discovery/state.sqlite`; keep its named volume private and preserve it across container replacement. The image runs as a non-root user. Apply deployment firewall/egress controls separately; these container flags do not prove public-only egress.

For a host-installed Caddy reverse proxy, point an owned hostname's DNS to the server and use a site block such as the following, replacing the example with the owned name:

```caddyfile
discovery.example.org {
    reverse_proxy 127.0.0.1:8082
}
```

Caddy must actually run on the same host/network as that loopback listener, obtain a valid certificate and be reachable through the intended firewall. A proxy in another container needs an explicitly configured private network/upstream instead; its `127.0.0.1` is not the host. Do not configure the production extension with a loopback/custom-port URL or disable certificate verification to simulate deployment.

Check `/health/live` and `/health/ready` through the intended HTTPS hostname, then perform an authenticated hostname-only job and observe its actual result. Readiness checks enabled admission, database access and configured-source presence; it does not verify that a provider credential is accepted or that public network retrieval works. Perform those canaries separately. A disabled process may pass liveness while returning unavailable readiness.

### Provider and network validation

The service has a fixed Brave Search adapter; clients cannot choose its destination or authorization header. Archive adapters use fixed public provider origins and bounded source-derived queries. TLS verification, response bounds, cancellation and inherited supported proxy/CA trust must remain enabled. Do not move a denied request to a different machine or clear proxy settings to evade an enforced destination policy.

At the 29 October 2026 development check, the managed coding environment still lacks `archive.org`, `web.archive.org` and `api.search.brave.com` in its enforced allowlist and has no Brave key. Their allowlist/optional-key requirements were saved as an environment draft; saving a draft does not apply it. To run live canaries here, review/save those settings and publish the environment, then recheck actual access. Fixture tests can validate request construction, responses, first-use dead-source recovery, authorization, durable budgets and failure handling without asserting a live public-provider result. An operator must verify actual provider access, terms and canary requests from the intended deployment before enabling it for users. This guide does not assert that those live checks or a public deployment have happened.

Provider timeouts/quota errors can produce a partial/unavailable result. A valid response from Brave or an archive is not a guarantee that its suggested domain is the genuine successor. Do not bypass access challenges, robots/terms limits or a certificate failure to improve a success metric.

### Durable operations and backups

Jobs and conservative request/byte budget charges persist in SQLite so restarts cannot reset allowances or let a stale owner commit a result. This is not an account-wide currency billing meter; retain provider-account spend limits as well. Preserve the store and its schema version during updates. Do not copy only a live `.sqlite` file while ignoring its WAL; use the service's consistent backup command or a separately verified SQLite snapshot procedure. Backups contain lookup interests and access-owner metadata and need encryption/access control, finite retention and deletion handling.

Create a consistent snapshot from the repository root using the actual source path and a new private destination:

```sh
node online-discovery/backup.mjs /absolute/private/state.sqlite /absolute/private/backups/new-snapshot.sqlite
```

The command refuses to overwrite an existing backup, verifies source/backup integrity and creates a private SQLite snapshot; it does not encrypt or upload it. Encrypt it with the operator's approved tool before moving it off-host, and protect the encryption/recovery identity separately. For a named container volume, run the snapshot command inside an appropriate maintenance container or use a verified volume access procedure; a host path above is not automatically a path into a Docker volume.

Test restoring into a separate empty data directory before replacing a live deployment. Confirm owner isolation, remaining budget accounting, expiry, candidate/result integrity and refusal of unknown schema versions. An image rollback does not undo a database migration. The existing PostgreSQL/age drill is evidence for the registry stack, not automatic proof that this new SQLite store is backed up or restored.

The default server job retention is 24 hours, separate from the client's one-hour job copy. Candidate results can be reused for one hour, completed negatives for 15 minutes and unavailable outcomes for five minutes. Maintenance removes expired jobs and old quota windows; cleanup needs a running process. An operator's backup retention may outlive live-store deletion and must be separately disclosed.

Monitor aggregate job phases, queue/deadline failures, provider health, quota consumption, returned evidence classes and cancellations. Do not create a per-user browsing dashboard or log access/provider token values. Disable external admission and drain/cancel jobs if budget, provider, privacy or evidence-policy checks fail; direct local continuity and the signed registry remain separate paths.

## Validation and publication

The current source tests and [CI evidence](IMPLEMENTATION_STATUS.md) distinguish unit/replay, actual browser, optional-service HTTP, live provider and deployed egress results. Do not describe an injected replay as a successful live search call. No new Internet-discovery pass count is inferred from the preceding chain-only test counts.

Before distributing an enabled build, check a fresh browser profile with no graph/manual destination, denied provider and candidate grants, more than one candidate, malformed/private archived targets, changed live destinations, cancellation/clear/restart, sensitive original URLs and every-origin signed barriers. Review actual Chrome/Edge permission prompts and Store data-use declarations separately from pregranted native fixtures.

For a Store listing, publish the updated [privacy page](privacy.html) and follow the [Store guide](CHROME_INSTALL_AND_STORE.md). Provide a working public, independently reviewed archive example and optional-service reviewer access if that mode is advertised. Do not use private `.test` fixtures, a hardcoded answer or the unverified user example as the public demonstration. Store identity verification, submission/review and public service hosting remain separate owner/operator actions.

The [design](INTERNET_DISCOVERY_PLAN.md), [idea register](INTERNET_DISCOVERY_IDEAS.md), [backlog](INTERNET_DISCOVERY_BACKLOG.md) and [evaluation plan](INTERNET_DISCOVERY_EVALUATION.md) preserve broader proposals and research experiments. They do not mean every alternative has shipped or that universal recovery/academic novelty has been established.
