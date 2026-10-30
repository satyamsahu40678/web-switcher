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

## Explicit successor-chain resolution

`POST /resolve` is a separate, authenticated internal endpoint with the same
closed `{"url":"https://old.example.org/"}` request and 4096-byte request cap.
It discovers successors from the old origin; callers do not provide a new
destination. The older `/probe` contract and its HTTP-only redirect behavior are
unchanged, so existing bounded discovery workers remain compatible.

Resolution follows at most three transitions, sharing the limit across:

- HTTP 301/302/303/307/308 Location redirects;
- static HTML-head `meta http-equiv="refresh"` with an explicit URL and delay
  of at most30 seconds (the resolver inspects the pointer without waiting);
- HTML-head `link rel="web-switcher-successor" href="https://next.example.org/"`.
  This is an experimental project convention, not a registered ownership proof.

The resolver parses at most the existing bounded1MiB response with pinned jsoup
1.23.2. It never runs page JavaScript or infers a successor from logos, names,
ads, arbitrary links, comments, templates, noscript content or body metadata.
Relative pointers respect a validated HTML base. HTTPS, standard-port,
credential/query/fragment/path restrictions, DNS/all-address/socket validation,
TLS hostname checks, robots and per-host politeness apply anew at every hop.
Different explicit targets cause `AMBIGUOUS_CONTINUATION`; cycles, unsafe
metadata and hop/byte/time limits stop resolution rather than selecting a guess.
There is no private-address exception or proxy workaround.

The result adds `chain` entries with `sourceOrigin`, `destinationOrigin`, `kind`
(`HTTP_REDIRECT`, `META_REFRESH`, `HTML_SUCCESSOR`) and `httpStatus`. `hops`
retains the ordered observed origin/status sequence; neither list returns page
paths or raw HTML. It also returns the final response classification, origin,
digest, byte count and observation time. `identity` is always `UNVERIFIED` and
`threatStatus` is always `UNKNOWN`: a compromised/re-registered old origin can
publish an authentic-looking pointer too.

HTML canonical links are returned only as bounded `CANONICAL_HINT` origins after
their current DNS answers pass public-address validation. They are **never
followed as successor edges**, never used as a fallback and never confer trust.
At most four hints and32 relevant metadata elements are considered. Fetching
ordinary JSON does not cause HTML-like strings to be interpreted as metadata.

`/resolve` has a30-second total operation budget; `/probe` remains15seconds.
The extra budget allows a healthy multi-origin chain to honor the five-second
robots/page request spacing. The server response deadline accommodates this
bounded operation; component bounds, concurrency and body caps remain unchanged.

This service has no persistent history/database. A caller can retain observed
successor edges and later start from a previously known successor when an old
origin is dead, validating freshness and conflicts according to its own policy.
The service cannot discover an unseen successor when all known origins are dead
and no earlier pointer or independent record exists. It does not turn this
internal observation endpoint into public registry publication or a deployed
automatic browser-routing authority.

New injected-transport and authenticated-loopback tests cover a mixed
HTTP→meta-refresh→explicit-successor chain, canonical-only abstention, inert and
script content, conflict/cycle/hop budgets, unsafe metadata and DNS answers,
robots at a discovered successor, relative/base resolution, strict endpoint
requests and compatibility with the original `/probe` response. These are
controlled protocol/transport tests, not verification of any public example's
current operator or public egress deployment.

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
