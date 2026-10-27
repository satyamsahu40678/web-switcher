# API contract

The Java API uses `/v1` and same-origin browser sessions. `backend/src/main/java/dev/webswitcher/api/Api.java` is the executable request contract. This document describes the implemented subset of the larger research plan, including the optional bounded discovery queue. Owner enrollment and general search discovery remain unimplemented.

## Public endpoints

| Method/path | Request | Result |
| --- | --- | --- |
| `GET /health/live` | None | Process liveness |
| `GET /health/ready` | None | Database readiness |
| `GET /v1/session` | Same-origin session cookie if present | Authentication, roles and session CSRF token/header metadata |
| `GET /v1/catalog/current` | Optional `If-None-Match` | Compact ES256 JWS, `application/jose`, ETag/304 |
| `GET /v1/catalog/{sequence}` | Integer release sequence | Immutable signed release or 404 |
| `GET /v1/keys` | None | Demo public JWK only; production returns 404 |
| `GET /v1/families/{id}` | Family ID | Public active/history summary |
| `POST /v1/lookups` | Hostname-only JSON | Known current decision, explicit unknown, or optional queued lookup reference |
| `GET /v1/lookups/{id}` | Opaque UUID reference | Pending or terminal unknown; queue must be enabled |
| `POST /v1/reports` | Two hostnames and reason | 202 pending candidate; never publishes a route |

Lookup example:

```json
{"hostname":"old.web-switcher.test","clientVersion":"0.2.0","requestedMode":"explain"}
```

Do not send a URL, path, query, fragment, credentials or port in `hostname`. Lookup JSON does not bypass signed-catalog verification. A `verified` summary means that the registry has a current reviewed record; it is not a malware warranty or an independently verified owner signature.

Report example:

```json
{"sourceHost":"old.example.org","proposedHost":"current.example.org","reason":"The operator announcement identifies the move; please review before publication."}
```

Reports and lookups have bounded hourly global/per-address budgets. An exhausted budget returns 429 and `Retry-After`. Full URLs and arbitrary fetch requests are not accepted. Request size and unexpected fields are rejected.

### Optional queued discovery

`DISCOVERY_QUEUE_ENABLED` defaults to `false`. In that mode an unsupported hostname returns HTTP200 with `status: unknown`, and lookup-reference GETs return404. Known published mappings retain the existing verified response regardless of whether discovery is enabled.

When enabled, an unknown hostname queues or reuses a durable job. New or still-running work returns HTTP202:

```json
{"status":"pending","lookupId":"d1b94991-6403-4825-b6f0-5f62352ad02a","pollAfterSeconds":5}
```

Retain that opaque reference and request `GET /v1/lookups/{lookupId}` no faster than the supplied interval. Pending GETs return HTTP200 with the same pending shape. The website offers a manual status check rather than polling automatically. References expire after the configured TTL (default one hour); invalid/expired references return404. GET polling has durable hourly ceilings of120 per client address and1000 globally, separate from POST lookup/queue/probe budgets.

A finished job still returns no unverified destination:

```json
{"status":"unknown","lookupId":"d1b94991-6403-4825-b6f0-5f62352ad02a","reason":"UNVERIFIED_CANDIDATE_QUEUED"}
```

Terminal reasons are `UNVERIFIED_CANDIDATE_QUEUED`, `NO_VERIFIED_MATCH` and `DISCOVERY_UNAVAILABLE`. A repeated POST may return a cached terminal response with HTTP200. Discovery can only insert a pending candidate; reviewer approval and independent signed publication remain necessary for routing. A queued response does not establish worker availability or that a replacement exists. [Discovery operations and bounds](DISCOVERY.md) document the separate worker/fetcher processes, configuration and deliberately limited redirect-observation scope.

## Administrative endpoints

| Method/path | Authorization | Behavior |
| --- | --- | --- |
| `POST /v1/admin/login` | Demo profile only; form encoded | Session login with CSRF token |
| `POST /v1/admin/logout` | Current session + CSRF | End session |
| `GET /v1/admin/candidates?limit=100` | Reviewer or publisher | Bounded candidate list |
| `GET /v1/admin/candidates/{id}` | Reviewer or publisher | Candidate detail/version |
| `POST /v1/admin/candidates/{id}/decisions` | Reviewer + CSRF | Optimistic approve/reject/quarantine, pending publication |
| `GET /v1/admin/releases` | Publisher | Published release metadata |
| `POST /v1/admin/releases` | Publisher + CSRF | Validate snapshot and publish next immutable signed version |
| `POST /v1/admin/families/{id}/revoke` | Publisher + CSRF | Withdraw family and issue a new signed release |
| `GET /v1/admin/audit` | Reviewer or publisher | Bounded audit listing |

Decisions use `{ "version": 0, "decision": "approved", "reason": "Independently reviewed continuity evidence." }`. A stale version returns 409. Approval is not activation: an independent publisher must explicitly release it. A submitter cannot review their own report; a reviewer cannot publish that same pending decision.

Use the CSRF header name and value returned by `/v1/session`, then fetch a fresh session after login/logout. Do not put tokens in URL query strings. Production uses configured OIDC instead of the demonstration password endpoint, with explicit reviewer/publisher `sub` allowlists.

## Signed records

Catalog protected header: `alg=ES256`, `typ=web-switcher-catalog+jws`, known `kid`. Signature bytes use JOSE's fixed 64-byte P-256 encoding. The client verifies the original encoded bytes before use, rejects duplicate keys/unknown record fields, bounds inputs and checks expiry, compatibility and monotonic sequence/digest.

Payload version 1 includes `schemaVersion`, `bundleSequence`, `issuedAt`, `expiresAt`, `minClientVersion`, `policyVersion`, `families`, `aliases`, `decisions`, and `revocations`. A catalog has no executable policy code. Destination origins use HTTPS; query and fragment transfer is disabled. Owner passports use a distinct record type and trust bootstrap; see `packages/security/README.md`.

## Errors and unimplemented contracts

Errors use a problem envelope with `type`, `status`, `code`, `detail`, and `requestId`. Expected categories include invalid input (400), unauthenticated (401), forbidden/CSRF (403), not found (404), version conflict (409), body limit (413), exhausted budget (429), and unavailable signer/dependency (503). Stack traces and secrets are not part of responses.

The plan's owner challenge/verification, passport intake, general search discovery and independently signed revocation-snapshot endpoints are not implied by these routes. The optional queue above observes bounded redirects through a separately configured fetcher; it does not implement arbitrary dead-domain recovery. The isolated fetcher's internal API is documented in `fetcher/README.md`; it must never be exposed as a public arbitrary URL proxy.
