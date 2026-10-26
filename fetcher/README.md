# Isolated evidence fetcher

This internal Java 21 service probes public HTTPS pages. A reachable response is
**not** evidence of website identity or safety. It returns `identity: UNVERIFIED`
and `threatStatus: UNKNOWN`, plus status, public origin, bounded byte count and a
SHA-256 content digest. It never returns the fetched HTML or approves a mapping.

Build from the repository root:

```sh
./backend/mvnw -f fetcher/pom.xml verify
```

The executable artifact is `fetcher/target/web-switcher-fetcher-0.2.0.jar`.
Configure `FETCHER_INTERNAL_TOKEN` securely with at least 32 random characters;
there is no default. Do not commit it or pass it in a command argument.

```sh
java -jar fetcher/target/web-switcher-fetcher-0.2.0.jar
```

The server binds `127.0.0.1:8081`. `FETCHER_BIND` and `FETCHER_PORT` override the
interface and port. The Dockerfile uses port 8081 inside the container. Give it
only the internal token, a read-only filesystem and public-only egress. It must
not receive database, signing, cloud, search, admin or GitHub credentials.

`GET /health/live` checks process liveness. `POST /probe` requires
`Authorization: Bearer <internal token>` and `Content-Type: application/json`.
The request is a closed object such as `{"url":"https://example.org/docs/"}`.
Duplicate keys, additional properties and inputs over 4096 bytes are rejected.
Only standard-port HTTPS is accepted. Credentials, queries, fragments, reserved
hostnames, encoded or ambiguous paths and common account/payment/download routes
are rejected. IPv6 host literals are intentionally unsupported; a DNS hostname
may resolve to approved global-unicast IPv6 addresses.

Each hop resolves and validates **all** addresses. Mixed public/private answers
fail. Apache HttpClient's custom resolver exposes only the validated immutable
address set to the connection operator. A request interceptor also checks that
the actual connected socket is public, port 443, and in that approved set before
sending the request. Missing socket evidence fails closed. The URI retains the original hostname,
so default TLS certificate checks and SNI remain active. Redirect following,
retries, cookies, credentials and decompression are disabled. Every redirect is
parsed, resolved, checked and connected independently. At most three redirects
are followed; cycles and HTTPS downgrades fail.

The fetcher applies a 15-second operation budget, two-second DNS/connect/read
component bounds, four concurrent operations, one connection per exact hostname,
five seconds between requests to that hostname, at most 1024 retained host
budget entries, 64 response headers, 4096 bytes per response header line, 1 MiB
page bodies and 64 KiB robots bodies. Compressed responses are rejected instead
of decompressed. Oversized/error/redirect responses are closed immediately,
never drained into memory. Successful page bodies must be HTML, plain text or
JSON. Robots rules are fetched before each new origin; unavailability, redirects
or malformed supported directives fail closed. User-agent matching, grouped
rules, longest paths, `*` and terminal `$` are handled; percent-encoded robot
rules are conservatively refused. No robots cache or paid search is used.

## Egress deployment gate

The HTTP client intentionally does not use inherited proxies. A normal CONNECT
proxy resolves destinations independently and cannot prove the actual connected
address matches the validated addresses. **If proxy environment variables are
present, outbound probes fail with `PINNED_EGRESS_UNAVAILABLE`.** Do not unset a
managed environment's required proxy to bypass its network policy. This cloud
environment can compile and test the service, but cannot validate its direct
public egress deployment through that proxy.

Production requires an isolated network/firewall that denies application
networks, metadata, private and reserved IPv4/IPv6 ranges, including independent
redirect/rebinding tests. The Dockerfile alone does not enforce that boundary.
The service is therefore opt-in and must not be exposed to the Internet.
The fixed per-host policy is not a public-suffix/registrable-domain budget;
global concurrency still caps cross-subdomain probes. Parked-domain, soft-404,
CAPTCHA and threat-feed classification are not implemented: their absence must
not be described as a positive identity/safety result.

Unit and loopback internal-API tests use injected resolvers/transports, with
production address validation still enabled. There is no runtime local-address
exception or production test-bypass flag. Actual public TLS, firewall isolation,
proxy replacement, and deployed DNS-race behavior remain release gates.
