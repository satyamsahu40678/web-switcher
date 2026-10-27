# Security and privacy

Web Switcher helps follow supported website migrations. A live endpoint may still be malicious; a valid signature proves which key authorized data, not the identity or safety of the operator behind it.

## Reporting a vulnerability

Do not put credentials, private browsing URLs, exploit payloads against real users, or private evidence in a public issue. Contact the repository owner through their published GitHub contact route and request a private reporting channel. A dedicated security address and response commitment remain launch prerequisites. If GitHub private vulnerability reporting is enabled, use the repository's Security tab.

## Current controls

- The extension uses selected-origin optional grants, packaged code and a local gate. No history, cookies, proxy, native-messaging or general page-injection permission is needed.
- Source matching is exact-origin, top-level GET only. Current state, expiry, generation and permission checks run at the gate. Queries and fragments are dropped; sensitive/ambiguous paths stop for confirmation.
- Importing local settings cannot create registry-reviewed or owner-verified trust. A local mapping records user intent only.
- Signed catalog parsing is bounded and closed. ES256 algorithms/key IDs/record types are constrained; rollback, equivocation, expiry and duplicate JSON keys are rejected.
- Public reports enter a pending queue. Optimistic review versions and separate publisher authorization prevent a report or review from silently activating navigation.
- Cookie-authenticated writes require CSRF protection. Non-demo administrative sessions use OIDC subject allowlists, rather than display names.
- The fetcher has separate internal authentication and validates public addresses, ports, TLS and response bounds. Application checks complement deployed egress restrictions.
- Opt-in discovery uses durable leases and budgets in a separate non-web worker. It has no signing key or public listener; observed redirects remain pending unverified evidence. A restricted PostgreSQL worker role prevents family/release/decision writes and limits candidate and budget access.
- Restore verifies the adjacent ciphertext checksum and completes authenticated age decryption before starting a single-transaction database restore. Local real PostgreSQL recovery is tested; off-host durability and private-key recovery remain operator controls.

Read the actual module tests and [implementation status](IMPLEMENTATION_STATUS.md) before relying on a control; a written design is not a passing test.

## Local data and disclosures

Local mappings, selected permissions and catalog state remain in the browser profile. Receipts record origins/timestamps, which can still reveal interests; use clear-data controls and the implemented retention limit. No original query, fragment or path belongs in a receipt.

Explicit lookup sends a hostname to the API; the service sees the client's IP. Reports include user-entered reasons, so users must omit personal data and secrets. Administrative audit records include actor IDs and review/publication reasons. The service's IP budget keys are abuse controls, not an anonymity guarantee.

When optional discovery is enabled, that explicit lookup can cause the isolated fetcher to contact the public hostname. The lookup reference and cached result expire; candidates retained for moderation contain hostname/origin observations and a response digest. The UI checks job status only when the user requests it. No unverified destination appears in public status responses. See [discovery limits](DISCOVERY.md) and [the implemented threat/evidence map](NOVELTY_AND_EVIDENCE.md).

The demo uses synthetic `.test` domains and generated development keys. Its known example password is not production authentication. Never expose demo mode to the internet or trust its keys in a production extension.

## Production gates

Before real users, establish and test all of the following:

1. A separately isolated publisher with signing key unavailable to public API, web UI, DB backups and fetcher; distinct runtime identities and database grants.
2. Database-level immutable release/audit privileges, authoritative backup/restore credentials and a successful clean restore drill.
3. Fetcher public-only egress blocking private IPv4/IPv6, metadata and application networks, including DNS rebinding/mixed-address/redirect tests from the actual deployed container.
4. Real Chrome and Edge native permission, restart, race, suspend/resume, undo and privacy-capture acceptance.
5. Production OIDC configuration, secure HTTPS session cookies, TLS, redacted logs, quota/load tests, incident response and ownership review.
6. Registry root/delegated-key distribution, expiry/renewal, revocation and recovery drills. Offline clients cannot learn new revocations until they refresh or current authorization expires.

A hash chain is not independent consensus. Owner enrollment, key rotation/recovery and destination-control checks require a complete lifecycle before any owner-verified automatic routing claim. Universal dead-link recovery, certificate-warning bypass and automatic trust from matching names/logos are unsupported.
