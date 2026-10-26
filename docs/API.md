# API contract

The Java API uses `/v1` and same-origin browser sessions. `backend/src/main/java/dev/webswitcher/api/Api.java` is the executable request contract. This document describes the implemented subset of the larger research plan; omitted owner, discovery and job endpoints are not promised.

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
| `POST /v1/lookups` | Hostname-only JSON | Known current decision summary or explicit unknown |
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

The plan's owner challenge/verification, passport intake, asynchronous public discovery and independently signed revocation-snapshot endpoints are not implied by these routes. The isolated fetcher's internal API is documented in `fetcher/README.md`; it must never be exposed as a public arbitrary URL proxy.
