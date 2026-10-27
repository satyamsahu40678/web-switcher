# Opt-in discovery worker database identity

`infra/deploy/bootstrap-worker-db.sh` provisions a separate PostgreSQL identity for the bounded discovery worker. It is an optional owner-controlled operation after the ordinary V1 bootstrap. The default staging Compose configuration and deployment script do not invoke it, require a new secret, or enable discovery.

Discovery produces unverified observations for moderation. Its database identity must not possess the public API's review privileges or the publisher's activation/signing privileges. The provisioning script adds grants, two invoker-mode insertion guards, and request-budget row-level security (RLS); it does not change `V1__registry.sql`, rewrite its checksum, or migrate existing registry data.

## Provisioning

First complete the normal separated owner/API/publisher bootstrap described in [deployment](DEPLOYMENT.md). Use a protected one-shot runner on the database's private network, with Bash, `psql`, and `sha256sum`. Do not publish the database port for this operation. The runner must have the reviewed script and the exact deployed V1 migration mounted read-only.

Provide two protected regular files named `OWNER_DATABASE_PASSWORD` and `WORKER_DATABASE_PASSWORD` under `WEB_SWITCHER_SECRET_DIR`. Use an independent, randomly generated worker password of at least 24 characters, owned by the runner's non-root identity and mode `0400` or `0600`, inside a directory with mode `0700`. Do not place secrets in Git, command arguments, shell history, logs, or chat. The worker needs neither the owner password nor the API/publisher passwords after provisioning.

For example, **inside that private, owner-authorized runner**, with the mounted files and reachable database hostname already configured:

```sh
PGHOST=postgres PGPORT=5432 PGUSER=webswitcher_owner PGDATABASE=webswitcher \
WEB_SWITCHER_SECRET_DIR=/run/worker-bootstrap-secrets \
WEB_SWITCHER_MIGRATION_FILE=/deployment/V1__registry.sql \
bash /deployment/bootstrap-worker-db.sh
```

The script reads passwords through files and the `psql` environment, never command arguments. It checks the stored V1 version/checksum before changing grants, requires the already separated API/publisher roles, and verifies that the worker credential cannot authenticate as either of them. A trust-authenticated route is refused by that credential-separation check. Use authenticated host access such as SCRAM; protect a remote database connection with independently configured TLS verification.

An existing worker must still authenticate with the supplied password. Provisioning refuses implicit password rotation, privileged/inheriting worker attributes, role memberships, worker-owned database/schema/table/function objects, and unrecognized request-budget RLS policies. It then reconciles grants in a transaction. Both table privileges and existing column privileges are cleared before the intended grants are installed. Rerunning preserves jobs, counters and candidates; it does not reset durable budgets or rotate credentials.

## Effective permissions

The role is named `webswitcher_worker`, with login enabled, `NOINHERIT`, and no superuser, role-creation, database-creation, replication or RLS-bypass privileges.

| Object | Worker permissions and restrictions |
| --- | --- |
| `site_family` | Read bindings; cannot update or activate a family. |
| `candidate` | Read only `id`, `family_id`, `source_host`, `proposed_origin`, `created_at` for binding/deduplication. Insert only the worker's pending, unreviewed candidates with `discovery:UUID` provenance. Cannot read report/reviewer evidence, approve, update, or delete a candidate. |
| `audit_event` | Append only `DISCOVERY_CANDIDATE` or `DISCOVERY_ATTEMPT_FAILED` as `discovery-worker`; cannot read, change or delete audit rows. |
| `lookup_job` | Read/insert/update/delete queue records for durable leases, retries, completion and TTL pruning. |
| `request_budget` | Read the explicitly named global initialization/probe rows and SHA-256 host-budget rows. Insert only supported initialization rows, update only discovery probe counters, delete only host rows older than 24 hours. Cannot read per-address hashes, change bucket identifiers, or reset public/queue counters. |
| `pending_decision`, `registry_release`, `release_counter` | No access. Cannot review, publish a catalog, or advance its sequence. |
| Database/schema | Connect and use `public`; cannot create schema objects or disable RLS. Owns no application objects. |

Request-budget RLS applies to the existing table. Explicit policies retain the API and publisher's existing full budget semantics; the database owner remains responsible for policy administration. The insertion guards leave reviewer/publisher actions unchanged and check the worker identity specifically. This is role separation for a trusted database administrator, not protection against that administrator or an owner credential compromise.

Run the worker with `DATABASE_USER=webswitcher_worker` and its own protected datasource password. The separate `worker` profile disables Flyway and starts no web server. Keep that setting disabled: schema creation is the owner's job, and a restricted runtime worker must not attempt migrations. Use the profile, internal fetcher bearer, budgets and process/network configuration in [the discovery guide](DISCOVERY.md). Do not supply publishing keys, OIDC administrator secrets, API credentials, or cloud credentials to the worker. Enable public queue admission only after this worker and the separately isolated fetcher are ready.

## Validation and limits

```sh
python3 infra/deploy/test-worker-grants.py
```

This mode creates a disposable PostgreSQL 17 database with independent temporary credentials and exercises actual SQL under all four roles. All 15 SQL checks passed locally: queue claim/complete/prune SQL; deduplication; pending-only candidate and discovery-only audit insertion; hidden per-address budgets; forbidden catalog/decision/sequence/schema writes; existing review/publication and immutable releases; bootstrap idempotence; cleanup of accidentally added column grants; and refusal of credential reuse/implicit rotation, checksum drift, unsafe existing roles and unknown permissive RLS policies.

The image mode adds an actual Spring worker process from the API image. Build the API and the existing Python drill-tools image first, retaining normal TLS/proxy verification as described in [deployment](DEPLOYMENT.md), then run:

```sh
WORKER_TEST_API_IMAGE=web-switcher-demo-api:latest \
python3 infra/deploy/test-worker-grants.py
```

`WORKER_TEST_API_IMAGE` can be an immutable image ID/digest; the example uses the locally built development image. The tools image defaults to `web-switcher-backup-drill:local`, built with `infra/backup/Dockerfile.drill`; override `WORKER_TEST_TOOLS_IMAGE` for another reviewed equivalent with Python 3. CI image acceptance supplies the exact API image under test.

All 17 image-mode checks passed locally with the rebuilt API image: the worker started under `webswitcher_worker` without Flyway, OIDC configuration or signing credentials, made an authenticated request to a controlled internal HTTP fixture, and completed a durable queued job by inserting a pending candidate and discovery audit event. Every family row, signed catalog byte and release-counter value remained identical. The worker opened no application TCP listener. This test uses an isolated Docker internal network with no published ports; the HTTP fixture represents the fetcher contract and makes no public request.

Successful results are saved to `test-results/worker-grants.json`; stale evidence is removed before a new run. The test removes its containers/network and transient credentials and never connects to a production database.

A compromised worker can consume or manipulate its permitted queue/probe workload and submit misleading pending observations; every such candidate still needs independent review before publication. These grants do not supply public-only fetcher egress, a real host, operator ownership evidence, or production monitoring. No deployed isolation or production readiness is established by this local SQL test.
