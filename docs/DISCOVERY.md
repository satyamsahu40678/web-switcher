# Bounded redirect-observation discovery

The optional discovery pipeline queues an explicit hostname lookup, asks the separate isolated fetcher for bounded HTTP redirect observations, and adds a **pending, unverified** candidate to the existing moderation queue. It cannot update an active family, sign a release, or authorize browser navigation. It does not guess replacement domains, run general web search, or recover a dead source that supplies no trusted redirect evidence.

The existing local extension and reviewed registry continue to work with discovery disabled. Production deployment of the discovery worker/fetcher is deliberately not part of the default public staging topology.

The proposed [autonomous Internet discovery increment](INTERNET_DISCOVERY_PLAN.md) adds search/archive candidate generation for first-time dead sources. Its [backlog](INTERNET_DISCOVERY_BACKLOG.md) preserves this implemented `/v1` contract and requires a new versioned candidate API, phase-leased jobs and explicit budget enforcement. It is not already provided by enabling the worker described below.

## Configuration and process boundaries

The public API accepts queued discovery only with `DISCOVERY_QUEUE_ENABLED=true`. Its normal keyless `APP_ROLE=api` process does not instantiate a fetcher client or require a fetcher token. When disabled (the default), existing unknown lookups return `status: unknown` immediately. Enable the queue only after its worker and isolated fetcher are configured; a pending reference does not assert that a worker is available or that a replacement exists.

Run network work as a **separate process**, from its own working directory and copied JAR:

```sh
java -jar /absolute/path/to/copied-api.jar --spring.profiles.active=worker
```

The worker profile selects the `worker` runtime role and `spring.main.web-application-type=none`. It starts no HTTP listener, needs no administrator OIDC client, and refuses private publishing credentials or demo mode. Flyway is explicitly disabled for this runtime role: provision and verify schemaV1 through the protected database-owner bootstrap before starting it. The worker must never receive schema-management or migration-history privileges merely to boot. It requires the normal PostgreSQL datasource configuration plus:

| Variable | Requirement |
| --- | --- |
| `FETCHER_URL` | Exact, operator-configured internal HTTP(S) origin of the isolated fetcher; no credentials, query, fragment or arbitrary path |
| `FETCHER_INTERNAL_TOKEN` | Securely provisioned 32–256 printable-character internal bearer, matching the fetcher; never put it in source/chat/command arguments |
| `DISCOVERY_PROBES_PER_HOUR` | Default20, supported1–1000 |
| `DISCOVERY_PROBES_PER_DAY` | Default100, supported1–10000 |
| `DISCOVERY_QUEUED_PER_HOUR` | Default100, supported1–1000 global new jobs |
| `DISCOVERY_CONCURRENCY` | Default2, maximum4 active durable leases across workers |
| `DISCOVERY_TTL_SECONDS` | Default3600, supported60–86400; job references and cached outcomes expire |

The per-host probe ceiling is three/hour and each job has at most three attempts. Budgets are charged transactionally **before** external work. A fresh process does not reset counters. Keep API and worker credentials distinct; the API must not receive the fetcher's bearer, and the worker must not receive signing or cloud credentials.

The worker needs its own restricted database role: read family bindings, create/read/update/delete its lookup jobs and discovery budget rows, insert unverified candidates and append audit records. It must not update active families, insert releases or advance the release counter. The opt-in [discovery database bootstrap](DISCOVERY_DATABASE.md) provisions and tests those grants separately from the default staging topology. Deploy and verify the isolated worker/fetcher network before enabling a public queue. Do not reuse the publisher role.

The fetcher must remain internal and use the independently verified public-address egress boundary described in [the fetcher guide](../fetcher/README.md). An ordinary managed HTTP CONNECT proxy cannot prove the actual destination connect IP, so the supplied fetcher reports `PINNED_EGRESS_UNAVAILABLE` there. The worker handles this as unavailable; it does not bypass the proxy or turn it into positive evidence.

## Public API behavior

An explicit request still sends only a hostname:

```json
{"hostname":"old.example","requestedMode":"explain","clientVersion":"0.2.0"}
```

Known, currently published mappings return the existing verified response. An enabled unknown lookup returns HTTP202:

```json
{"status":"pending","lookupId":"opaque-random-uuid","pollAfterSeconds":5}
```

`GET /v1/lookups/{lookupId}` returns the same pending shape while queued/leased/retrying. The caller must retain the unguessable reference. The GET endpoint has separate durable per-address/global poll limits; invalid or expired references return404. Clients should not poll faster than the supplied interval.

When work finishes, the public response **still abstains**. It never returns an unverified destination:

```json
{"status":"unknown","lookupId":"opaque-random-uuid","reason":"UNVERIFIED_CANDIDATE_QUEUED"}
```

Other terminal reasons are `NO_VERIFIED_MATCH` and `DISCOVERY_UNAVAILABLE`. An unverified candidate remains pending moderation until a reviewer records continuity evidence and an independent publisher activates a new signed catalog. Reachability, HTTP redirects, body digests and a valid fetcher bearer are not proof of website ownership or safety.

## Durability and bounded evidence

The existing `lookup_job` table is reused; no migration or V1 schema checksum change is needed. A short transaction selects ready/recoverable jobs with `FOR UPDATE SKIP LOCKED`, reserves daily/hourly/host budgets and writes a random30-second lease. Network work occurs after commit. Expired leases can be reclaimed; stale owners cannot commit results. Retryable failures use bounded backoff and stop at attempt3. Completed hostname outcomes are deduplicated/negatively cached within the TTL; old references are physically pruned during queue/worker maintenance.

The internal client sends only `https://HOST/` to the configured `/probe` endpoint with the internal bearer. It refuses internal redirects, caps JSON responses at64KiB, cancels requests after12seconds, rejects duplicate/trailing JSON and closed-schema/trust/clock/hop violations, and requires the observed chain to begin at the requested source and end at the reported destination. Only a bounded cross-origin HTTP redirect produces a candidate. No arbitrary page path/query/body is retained or exposed publicly.

Unit/real-loopback integration tests cover queue deduplication, durable budgets, lease recovery/stale ownership, concurrency, retry ceilings, TTL, malformed/forged fetcher replies and a real API-to-separate-worker-to-candidate flow while the active catalog remains byte-identical. The HTTP fixture in that last test represents the internal fetcher contract; it is not a claim that public DNS/TLS, deployed egress, general search discovery or operator ownership has been verified.
