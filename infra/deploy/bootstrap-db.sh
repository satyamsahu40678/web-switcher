#!/usr/bin/env bash
# One-shot V1 schema bootstrap. Future schema versions require reviewed migration.
set -euo pipefail
secret_dir=${WEB_SWITCHER_SECRET_DIR:-/run/secrets}
migration_file=${WEB_SWITCHER_MIGRATION_FILE:-/deployment/V1__registry.sql}
for name in OWNER_DATABASE_PASSWORD API_DATABASE_PASSWORD PUBLISHER_DATABASE_PASSWORD; do
  [[ -s "$secret_dir/$name" ]] || { echo "Missing protected secret file: $name" >&2; exit 1; }
done
export PGPASSWORD
PGPASSWORD=$(cat "$secret_dir/OWNER_DATABASE_PASSWORD")
export WEB_SWITCHER_API_PASSWORD WEB_SWITCHER_PUBLISHER_PASSWORD
WEB_SWITCHER_API_PASSWORD=$(cat "$secret_dir/API_DATABASE_PASSWORD")
WEB_SWITCHER_PUBLISHER_PASSWORD=$(cat "$secret_dir/PUBLISHER_DATABASE_PASSWORD")
[[ ${#WEB_SWITCHER_API_PASSWORD} -ge 24 && ${#WEB_SWITCHER_PUBLISHER_PASSWORD} -ge 24 ]] || { echo 'Use independently generated database passwords of at least 24 characters.' >&2; exit 1; }
[[ "$WEB_SWITCHER_API_PASSWORD" != "$WEB_SWITCHER_PUBLISHER_PASSWORD" && "$WEB_SWITCHER_API_PASSWORD" != "$PGPASSWORD" && "$WEB_SWITCHER_PUBLISHER_PASSWORD" != "$PGPASSWORD" ]] || { echo 'Database identities must have independent passwords.' >&2; exit 1; }
# Existing identities must still authenticate with the configured credentials.
# Refuse implicit password rotation before touching any grants/schema: otherwise a
# failed deployment could invalidate the previous application's live credentials.
for role in webswitcher_api webswitcher_publisher; do
  exists=$(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='$role')")
  if [[ "$exists" == t ]]; then
    if [[ "$role" == webswitcher_api ]]; then role_password=$WEB_SWITCHER_API_PASSWORD; else role_password=$WEB_SWITCHER_PUBLISHER_PASSWORD; fi
    PGUSER="$role" PGPASSWORD="$role_password" psql -XAt --set ON_ERROR_STOP=1 -c 'SELECT current_user' >/dev/null || { echo 'Existing database credentials differ. Perform a separate controlled credential rotation.' >&2; exit 1; }
  fi
done
migration_digest=$(sha256sum "$migration_file" | cut -d' ' -f1)
state=$(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='deployment_schema_version')")
if [[ $state == f ]]; then
  count=$(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  [[ $count == 0 ]] || { echo 'Refusing unversioned nonempty database. Migrate/reconcile it explicitly.' >&2; exit 1; }
  { printf 'BEGIN;\n'; cat "$migration_file"; printf '\nCREATE TABLE deployment_schema_version(version INTEGER PRIMARY KEY CHECK(version=1),migration_sha256 VARCHAR(64) NOT NULL);\nINSERT INTO deployment_schema_version VALUES(1,\x27%s\x27);\nCOMMIT;\n' "$migration_digest"; } | psql -Xq --set ON_ERROR_STOP=1
fi
[[ $(psql -XAt --set ON_ERROR_STOP=1 -c 'SELECT version FROM deployment_schema_version') == 1 ]] || { echo 'Unsupported database schema version; no automatic rollback/migration attempted.' >&2; exit 1; }
[[ $(psql -XAt --set ON_ERROR_STOP=1 -c 'SELECT migration_sha256 FROM deployment_schema_version') == "$migration_digest" ]] || { echo 'The V1 migration checksum changed. Reconcile through a reviewed migration; no schema overwrite attempted.' >&2; exit 1; }
# psql reads secrets from its inherited environment; they are never arguments,
# shell tracing, source, or files under a release. Never run psql with query echo.
psql -Xq --set ON_ERROR_STOP=1 <<'SQL'
\getenv api_password WEB_SWITCHER_API_PASSWORD
\getenv publisher_password WEB_SWITCHER_PUBLISHER_PASSWORD
BEGIN;
SELECT format('CREATE ROLE webswitcher_api LOGIN PASSWORD %L', :'api_password') WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='webswitcher_api') \gexec
SELECT format('CREATE ROLE webswitcher_publisher LOGIN PASSWORD %L', :'publisher_password') WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='webswitcher_publisher') \gexec
REVOKE ALL ON DATABASE webswitcher FROM PUBLIC;
GRANT CONNECT ON DATABASE webswitcher TO webswitcher_api,webswitcher_publisher;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,webswitcher_api,webswitcher_publisher;
GRANT USAGE ON SCHEMA public TO webswitcher_api,webswitcher_publisher;
GRANT SELECT ON site_family,registry_release,release_counter,audit_event,candidate,pending_decision,request_budget,lookup_job TO webswitcher_api,webswitcher_publisher;
GRANT INSERT ON audit_event TO webswitcher_api,webswitcher_publisher;
GRANT INSERT,UPDATE,DELETE ON candidate,pending_decision,request_budget,lookup_job TO webswitcher_api;
GRANT INSERT,UPDATE ON site_family TO webswitcher_publisher;
GRANT INSERT ON registry_release TO webswitcher_publisher;
GRANT UPDATE ON release_counter,pending_decision TO webswitcher_publisher;
GRANT INSERT,UPDATE,DELETE ON request_budget TO webswitcher_publisher;
COMMIT;
SQL
unset PGPASSWORD WEB_SWITCHER_API_PASSWORD WEB_SWITCHER_PUBLISHER_PASSWORD
printf 'Schema V1 and separated staging database grants verified.\n'
