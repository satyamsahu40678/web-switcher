# Web Switcher registry API

Java 21 / Spring Boot 4.1.2 with JDBC, Flyway, PostgreSQL and an explicit local demo profile. This implements a bounded manually reviewed registry; it does not establish ownership from reachability, automatically discover arbitrary domain migrations or claim production deployment.

## Build and run

```sh
./backend/mvnw -f backend/pom.xml verify
cd backend
java -jar target/web-switcher-api-0.2.0.jar --spring.profiles.active=demo
```

The demo binds `127.0.0.1:8080`, keeps its H2 database and generated development-only signing key under the current working directory's ignored `data/` directory, and seeds only reserved `.test` names. Start it in a separate working directory to obtain an independent demo database. These synthetic names are not live websites. Generated demo signing material is never a production trust anchor.

In the managed cloud, use `JAVA_HOME=/workspace/tools/jdk-21 ./backend/scripts/mvn-cloud.sh -f backend/pom.xml verify`. The adapter retains the inherited HTTP proxy, uses a writable Maven cache and system CA trust, and never disables TLS/checksum verification. A full JDK with `javac`, not only a JRE, is required.

```sh
curl --fail http://127.0.0.1:8080/health/ready
curl --fail http://127.0.0.1:8080/v1/keys
curl --fail http://127.0.0.1:8080/v1/catalog/current
```

Live processes must be restarted after environment restoration; the database, dependencies and demo key are retained files. Use the existing isolated checkout rather than creating a Git worktree.

## Sessions and roles

`GET /v1/session` returns authentication state, the current CSRF token/header name, and the demo flag. In the explicit demo profile only, POST form-encoded `username` and `password` to `/v1/admin/login`, including the CSRF header and retaining the session cookie. Read `/v1/session` again after login because successful authentication rotates CSRF state.

| Demo account | Password | Capability |
| --- | --- | --- |
| `demo-reviewer` | `demo-password` | Read administration and review candidates |
| `demo-publisher` | `demo-password` | Read administration and publish/revoke |

These are deliberately public development fixture credentials. Demo mode refuses to start without the `demo` Spring profile. Cookie-authenticated mutations require CSRF. Logout is `POST /v1/admin/logout` with the current CSRF token. Production uses OIDC registration `web` at `/oauth2/authorization/web`, with exact configured provider subject allowlists; roles are not accepted from submitted display names or arbitrary token claims.

## API

- `GET /health/live`, `/health/ready`: process and DB readiness.
- `GET /v1/catalog/current`, `/v1/catalog/{sequence}`: compact ES256 JWS and ETags; immutable historical bytes.
- `GET /v1/keys`: public demo JWK set only. Production clients pin externally distributed trust anchors.
- `POST /v1/lookups` with `{ "hostname": "old.example" }`: exact hostname-only known lookup or explicit unknown abstention. No automatic outbound request or paid search is launched.
- `POST /v1/reports` with `sourceHost`, `proposedHost`, `reason`: queued candidate, HTTP 202; no routing change.
- `GET /v1/families/{id}`: public current family and available public history.
- `GET /v1/admin/candidates`, `/candidates/{id}`: bounded reviewer queue.
- `POST /v1/admin/candidates/{id}/decisions` with `version`, `decision`, `reason`: optimistic review; a substantive human continuity-review reason is required. A submitter cannot review their own report.
- `GET /v1/admin/releases`, `/v1/admin/audit`: bounded immutable-release metadata and audit list for either role.
- `POST /v1/admin/releases` with `{}`: publisher-only atomic activation and signing; the reviewer cannot publish the same decision.
- `POST /v1/admin/families/{id}/revoke` with `reason`: withdraw and publish a higher-sequence catalog.

Review decisions remain separate from active records until an authorized publish. Arbitrary manually reviewed destinations default to homepage routing and always require client confirmation. Only the controlled demo fixture declares `/docs/` path compatibility. Terminal target checks reject active alias targets rather than creating browser redirect chains. Unknown or stale lookups return no destination.

Requests are bounded to 32 KiB before JSON parsing, including chunked bodies. Duplicate JSON keys and unknown request fields are rejected. Request budgets are durable transactional hourly global and address-hash counters: 100 global/30 per address for lookups, 30 global/10 per address for reports. Old address-counter buckets are pruned after 24 hours. Behind a reverse proxy, counters use the actual TCP peer unless trusted forwarding is explicitly configured; do not accept untrusted client forwarding headers. Reports/audit currently require operator-managed retention; this implementation does not yet enforce the plan's full retention schedule.

## Production configuration

Start without the demo profile and provide:

- `DATABASE_URL` as a PostgreSQL JDBC URL, `DATABASE_USER`, `DATABASE_PASSWORD`.
- `APP_PUBLIC_ORIGIN` as an exact HTTPS origin.
- `ADMIN_ALLOWED_SUBJECTS`, `PUBLISHER_ALLOWED_SUBJECTS` as comma-separated OIDC `sub` identifiers tied to the configured issuer.
- Standard Spring OIDC properties for registration/provider `web`: `SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_WEB_PROVIDER=web`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_SCOPE=openid,profile`, and `SPRING_SECURITY_OAUTH2_CLIENT_PROVIDER_WEB_ISSUER_URI`.
- `APP_ROLE=api` (default) or `publisher`. The public API role rejects a configured private publishing key. A separately isolated publisher role requires `PUBLISHING_PRIVATE_KEY_FILE` (PKCS8 DER EC P-256 key) and `PUBLISHING_KEY_ID`.

Production startup fails without OIDC/subject configuration; loopback development-fetch overrides are forbidden. Public serving and signing use the same application artifact but must be separately deployed with independent keys, DB privileges, network exposure and authentication. A separate process name or endpoint role check alone does not prove deployed isolation. PostgreSQL least-privilege/immutable-table grants, off-host backup, real OIDC provider validation, TLS and key-rotation drills remain deployment gates. The API role without a key can serve stored signed releases but cannot sign a new release. A working authenticated publisher service is required for actual publishing.

## Validation

`./backend/mvnw -f backend/pom.xml test` exercises real HTTP sessions, CSRF, role separation, hostname privacy validation, strict JSON, conditional catalog requests, Java ES256 signature verification, review-before-publication, optimistic concurrency, revocation precision and durable request limits.

`python3 backend/scripts/test-postgres.py` runs the same acceptance suite against a fresh disposable PostgreSQL 17 container bound to a random loopback port. It generates a temporary password, never prints it, and removes only its own container/secret file afterward. Docker must be available. The managed-cloud Maven adapter is used by this helper. Running this suite verifies schema/functional compatibility; it does not validate production grants, backup restoration or public deployment.

Remaining planned modules include automated owner-control challenges, owner passport enrollment/rotation, a fully scheduled leased discovery worker, external search/threat adapters, richer evidence provenance and production-scale retention/operations. No stub endpoint represents these as delivered.
