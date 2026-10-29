# Optional Internet discovery service

This Node 24 service investigates **one old public hostname**, with no destination or migration history supplied by the visitor. It can query the official Brave Search API and public Wayback availability/CDX indexes, extract bounded historical move evidence, and return explained **unverified candidates**. A search result is not ownership proof, a signed registry decision or an automatic navigation instruction.

The extension's default keyless archive mode works independently of this service. Deploy this service when you want centrally budgeted broader search or archive investigation. It is separate from the existing Java API and its `/v1` candidate-only queue: neither the registry PostgreSQL schema nor its V1 Flyway checksum is changed. Service jobs, budgets and results live in a separate private SQLite database. This is an explicit simplification of the earlier proposed Java/V2 storage approach; the isolation, authority and durable accounting requirements remain.

## What runs

- `server.mjs`: authenticated `/v2/discoveries`, status/cancellation and health endpoints.
- `runner.mjs`: bounded source investigation, renewable fenced claims and phase checkpoints.
- `store.mjs`: real SQLite transactions, owner-scoped references, deduplication/cache, shared quotas, bytes/child-request reservations, deadlines, retention and backups.
- `providers.mjs`: fixed-host Brave adapter, bounded manual-redirect HTTP transport, inherited proxy/CA support and optional isolated fetcher client.
- `../extension/internet-sources.js`: the shared inert archive adapter. Neither the server nor browser variant executes downloaded page JavaScript.
- `backup.mjs`: coherent private SQLite snapshots and integrity verification. It does not encrypt, upload or schedule them.

No npm dependencies are required. Node **24.5 or newer in the Node 24 line** supplies native SQLite and proxy-aware HTTP agents; the tested cloud runtime uses Node 24.19. Tests inject controlled provider replies while exercising actual HTTP, SQLite and orchestration. This is not live-provider availability, recovery-accuracy or ownership verification. Current broad-search credentials and live network access must be configured and verified separately.

## Run locally

From the repository root:

```sh
node --test online-discovery/*.test.mjs
node online-discovery/server.mjs
```

Defaults bind to `127.0.0.1:8082` with discovery **disabled**. `/health/live` still returns a process check. Enabling requires invitation tokens; the process refuses weak or duplicate tokens. Provision secrets through your environment/secret manager, then set `ONLINE_DISCOVERY_ENABLED=true`. Do not put real token/key values in shell arguments, source, chat, image layers or a committed environment file.

If starting from the `online-discovery/` directory, `npm start` and `npm test` are equivalent entry points. Relative database paths resolve against the process working directory. Use a dedicated private data directory; startup refuses an existing directory with group/other permissions rather than changing another application's or `/tmp` permissions.

| Variable | Actual behavior/default |
| --- | --- |
| `ONLINE_DISCOVERY_ENABLED` | Only exact `true` enables admission and runner execution; default false. Disabling does not spend queued provider calls. |
| `ONLINE_BIND` | Default `127.0.0.1`; use a private/container interface behind an owned HTTPS proxy. |
| `ONLINE_PORT` | Default 8082; supported 1–65535. |
| `ONLINE_DATABASE_PATH` | Default absolute resolution of `data/online-discovery.sqlite`; dedicated mode-0700 parent and mode-0600 database. |
| `ONLINE_ACCESS_TOKENS` | Comma-separated distinct cryptographically random base64url tokens, 32–256 characters, maximum 100. One token identifies one owner/account and quota namespace. Required when enabled; no shared token is bundled in the extension. |
| `ONLINE_ALLOWED_ORIGINS` | Optional comma-separated exact HTTPS origins or `chrome-extension://` IDs for CORS response/preflight headers. Ordinary web origins outside this set are refused. Packaged Chrome extension requests can use their host permission plus a valid invitation; an unlisted extension does not receive CORS response headers. CORS never substitutes for bearer authentication. |
| `ONLINE_CONCURRENCY` | Default 2, supported 1–4; applied to the runner and durable shared database claim ceiling. |
| `ONLINE_ARCHIVE_ENABLED` | Enabled unless exact `false`; fixed archive.org and web.archive.org adapters. |
| `BRAVE_SEARCH_API_KEY` | Optional server-only official search credential. Missing key produces `SEARCH_NOT_CONFIGURED` without a paid call. It is sent only to `https://api.search.brave.com/res/v1/web/search`; redirects are not followed. Verify current provider terms, permitted usage, quota and billing before enabling. |
| `FETCHER_URL` | Optional exact operator-selected internal HTTP(S) origin, no credentials/path/query/fragment. Configure with the internal token or neither. Never accept its value from a public lookup. |
| `FETCHER_INTERNAL_TOKEN` | Matching 32–256 printable-character internal bearer for `/resolve`. The isolated fetcher does not receive the search key, service database or registry signing credentials. |

The provider transport uses Node's native agent `proxyEnv` option with the inherited proxy environment and keeps TLS verification enabled. Preserve the environment's CA trust. Do not remove proxy settings to get around an egress denial.

Readiness means the enabled service has a healthy local database and at least one configured discovery path. It exposes `searchConfigured` and `archivesEnabled`; it does not make a paid query or prove upstream availability. `/health/ready` returns 503 when disabled or when neither path is configured. `/health/live` is process liveness only.

## Public contract

All `/v2` requests require `Authorization: Bearer <your invitation>`. Send `Content-Type: application/json` for POST. HTTPS belongs at the public reverse proxy; the production extension accepts an HTTPS service origin. The loopback HTTP listener is for internal access/local diagnostics.

`POST /v2/discoveries` accepts only:

```json
{"hostname":"old.example.org","clientVersion":"0.2.0"}
```

Do not send `https://`, a port, a path/query/fragment, user credentials, a suggested target or a provider endpoint. Hostnames must be normalized ASCII/punycode. Unknown fields, duplicate/trailing JSON, invalid UTF-8 and bodies over 4096 bytes are refused before external work.

The service returns a full closed `schemaVersion: 2` Internet-discovery envelope. Initial work usually returns HTTP202 with an opaque `jobId`, `sourceOrigin`, `status: queued`, timestamps and empty candidates. Repeated owner/source submissions reuse eligible work or cache; a cached terminal result returns HTTP200. Query `GET /v2/discoveries/{jobId}` at roughly one-second intervals while pending, stopping on terminal status. `DELETE /v2/discoveries/{jobId}` records cancellation and aborts active work. The same reference under another invitation returns404. Cancellation cannot undo provider charges or traffic already dispatched.

Completed candidates have `identityClass: unverified_candidate` and `navigation: confirm_only`, bounded evidence, and a distinct availability state. `not_checked` is expected when no isolated fetcher is configured or observation budget remains insufficient. The browser must independently recheck the displayed target before opening; a server result never waives browser permission, current signed reservations or sensitive-link rules. Search placement cannot publish a registry route or silently install an automatic mapping.

Error responses contain a short code, not a provider response, credential or stack trace. Typical HTTP outcomes are400 invalid input,401 missing/rejected invitation,403 disallowed web origin,404 unavailable owner-scoped reference,405 method,413 size,415 MIME,429 budget/rate and503 disabled/unavailable infrastructure. Provider quota or credential errors become explained job reasons and an unavailable/partial result rather than an invented replacement.

## Enforced limits and retention

These are conservative code limits, not measured provider capacity or recovery promises. Tightening programmatic store limits cannot relax their hard ceilings.

| Control | Implemented ceiling |
| --- | --- |
| Job deadline / active investigation | 120 seconds from creation / 60 active seconds, durable across claims; queued time consumes the absolute deadline. |
| Lease / attempts | 15-second renewable fenced lease, heartbeat every five seconds, maximum three claims; phase progress prevents successful search repeats after recovery. |
| Search / archive calls | Two paid search reservations; two archive index calls; three selected archive snapshots. Retries do not reset any counter. Current search implementation makes one exact-hostname query; it does not spend the spare allowance speculatively. |
| Candidates / lead records | At most ten public candidate origins and five evidence entries each; at most 40 internal lead records. Archived pointers precede search placements in the bounded candidate set. |
| Child web work | Thirty web requests; the optional existing `/resolve` parent reserves eight child requests (up to four pages and four robots files) and their worst-case bytes before dispatch. |
| Response bytes | At most 1 MiB per generic web/snapshot transport response, 256 KiB per search/index reply, 64 KiB fetcher reply; 8 MiB worst-case reservations across a job. Encoded/compressed responses are refused by the server transport. |
| New jobs | 20 per owner/hour,100 global/hour,1000 retained jobs. Reusing a cached job does not create a new paid job. |
| Paid requests | 20 per owner/hour,20 global/hour,100 global/day, shared across restarts. |
| Archive requests | 100 per owner/hour,500 global/hour,2000 global/day. |
| Polls | 1200 per owner/hour,10000 global/hour; exceeding read quota does not prevent cancellation. |
| Retention/cache | Job/progress/result rows expire after24hours and are physically pruned on maintenance. Candidate cache1hour, completed no-match15minutes, unavailable5minutes. The SQLite service does not implement the earlier proposed separate seven-day evidence warehouse. |

Counters reserve before transport. Missing responses can still be billable, so uncertain failures are never assumed free. A crashed owner loses its fencing token; a late result cannot write after cancellation, expiry or replacement. Clock anomalies fail closed. The shared database enforces concurrency across separate handles/processes using it.

Provider requests contain a selected public hostname and bounded public query terms, not unrelated browsing history. The service observes the API caller's IP; configured providers see the service IP/query; archive and candidate servers see normal request metadata for calls actually made. SQLite stores invitation **hashes**, source origins, bounded public evidence facts/URLs, results, quota/progress data and timestamps; raw bearer/search keys are not written to it. Provider response bodies are parsed in bounded memory, not retained as HTML. Public locators can contain article/archive paths, but original private browser URL parts are not submitted.

Deleting a local browser job does not automatically erase a server record or already completed provider call. Owner cancellation, short retention, explicit service data management and backup expiry must be disclosed in the deployment's privacy policy. This SQLite snapshot does not include the registry PostgreSQL database or publisher keys.

## Container and HTTPS deployment

The Docker build context is the repository root, because the service imports packaged pure extension/security modules:

```sh
docker build -f online-discovery/Dockerfile -t web-switcher-discovery:local .
```

The image runs as the unprivileged `node` user and stores data under `/var/lib/web-switcher-discovery`. Mount that directory on a writable private volume, keep the rest of the filesystem read-only, drop capabilities, set memory/process limits and inject the service's own credentials through the deployment secret manager. Bind the HTTP port to loopback/private networking. Choose an owned HTTPS hostname and proxy only this service's documented paths; configure the extension with that HTTPS origin and an individual invitation. Never reuse a registry publisher token or expose the internal fetcher publicly.

The base uses the existing platform's Node24/bookworm image family. An immutable release should pin a reviewed registry digest and record/build/prove the resulting service image through CI before public rollout. The optional service is not automatically deployed by the existing registry release workflow.

Public-source egress and the optional isolated fetcher's all-address/connect-IP controls must be independently verified in the actual deployment. The service's fixed search/archive adapter hosts reduce authority but do not prove deployed firewall rules. Browser archive mode cannot pin the browser's DNS/socket IP and makes no server-grade SSRF claim.

## Backup and restore

Create a coherent SQLite snapshot instead of copying only the live `.sqlite` file while WAL writes are active:

```sh
node online-discovery/backup.mjs /private/data/state.sqlite /private/backups/new-state.sqlite
```

The command refuses an existing output, an input/output collision, a missing source or an unsupported schema. It validates source and snapshot integrity and writes mode0600. It does not encrypt, store off-host or expire backups. Encrypt the resulting snapshot with an operator-controlled key and follow a tested off-host retention/recovery process. Include backup retention in the public data policy.

For restore, stop only this service, preserve the current database plus any WAL/SHM files as a rollback copy, place the verified snapshot at the configured database path with the correct private ownership/mode, and start an isolated service instance. Do not overwrite an active database or copy stale WAL/SHM files onto the snapshot. Verify readiness, owner isolation, stored reservation counts and a controlled source-only lookup before promotion. Source/provider credentials are provisioned separately and never recovered from the database. Tests exercise actual snapshot/reopen state, but they do not establish off-host durability or a production RPO/RTO.

## Validation scope

Run `node --test online-discovery/*.test.mjs` from the repository root. The suite covers real loopback HTTP/API handling, actual SQLite restart/leases/budgets/caches, first-use no-history search/archive provider fixtures, cancellation/deadline races, owner isolation, provider/fetcher schemas, HTTP proxy behavior, redirects, bytes and coherent snapshot recovery. It does not establish real provider access/terms, regional availability, scientific identity accuracy, safe content or that every dead site has a successor.

The [operation guide](../docs/INTERNET_DISCOVERY_OPERATION.md), [design](../docs/INTERNET_DISCOVERY_PLAN.md) and [evidence ledger](../docs/IMPLEMENTATION_STATUS.md) distinguish usable browser behavior, optional service deployment and remaining research ideas.
