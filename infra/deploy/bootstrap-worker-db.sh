#!/usr/bin/env bash
# Opt-in discovery worker grants. Run only as the protected database owner after
# bootstrap-db.sh; default public staging does not invoke or require this script.
set -euo pipefail
secret_dir=${WEB_SWITCHER_SECRET_DIR:-/run/secrets}
migration_file=${WEB_SWITCHER_MIGRATION_FILE:-/deployment/V1__registry.sql}
[[ ${PGDATABASE:-} == webswitcher ]] || { echo 'Set PGDATABASE=webswitcher explicitly for the opt-in worker bootstrap.' >&2; exit 1; }
for name in OWNER_DATABASE_PASSWORD WORKER_DATABASE_PASSWORD; do
  [[ -f "$secret_dir/$name" && -s "$secret_dir/$name" && ! -L "$secret_dir/$name" ]] || { echo "Missing protected regular secret file: $name" >&2; exit 1; }
done
export PGPASSWORD WEB_SWITCHER_WORKER_PASSWORD
PGPASSWORD=$(cat "$secret_dir/OWNER_DATABASE_PASSWORD")
WEB_SWITCHER_WORKER_PASSWORD=$(cat "$secret_dir/WORKER_DATABASE_PASSWORD")
[[ ${#WEB_SWITCHER_WORKER_PASSWORD} -ge 24 && "$WEB_SWITCHER_WORKER_PASSWORD" != "$PGPASSWORD" ]] || { echo 'Use an independent worker database password of at least 24 random characters.' >&2; exit 1; }
[[ -s "$migration_file" ]] || { echo 'A trusted V1 migration file is required for checksum verification.' >&2; exit 1; }
migration_digest=$(sha256sum "$migration_file" | cut -d' ' -f1)
[[ $(psql -XAt --set ON_ERROR_STOP=1 -c 'SELECT version FROM deployment_schema_version') == 1 ]] || { echo 'Bootstrap and reconcile the supported V1 schema before enabling discovery.' >&2; exit 1; }
[[ $(psql -XAt --set ON_ERROR_STOP=1 -c 'SELECT migration_sha256 FROM deployment_schema_version') == "$migration_digest" ]] || { echo 'V1 schema checksum differs; no worker policy/grant change attempted.' >&2; exit 1; }
[[ $(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('webswitcher_api','webswitcher_publisher')") == 2 ]] || { echo 'Provision the separated API/publisher roles with bootstrap-db.sh first.' >&2; exit 1; }
# Verify separation without requiring the other runtime passwords as inputs.
# A worker password must not authenticate as either existing privileged identity.
# This also refuses a trust-authenticated DB route; use authenticated host access.
for role in webswitcher_api webswitcher_publisher; do
  if PGUSER="$role" PGPASSWORD="$WEB_SWITCHER_WORKER_PASSWORD" psql -XAt --set ON_ERROR_STOP=1 -c 'SELECT current_user' >/dev/null 2>&1; then
    echo 'Worker credential must be independent of API/publisher access, with password authentication enforced.' >&2
    exit 1
  fi
done
exists=$(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='webswitcher_worker')")
if [[ "$exists" == t ]]; then
  PGUSER=webswitcher_worker PGPASSWORD="$WEB_SWITCHER_WORKER_PASSWORD" psql -XAt --set ON_ERROR_STOP=1 -c 'SELECT current_user' >/dev/null || { echo 'Existing worker credential differs. Perform a separately controlled credential rotation.' >&2; exit 1; }
  safe=$(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AND rolcanlogin FROM pg_roles WHERE rolname='webswitcher_worker'")
  [[ "$safe" == t ]] || { echo 'Refusing an existing privileged/inheriting worker role. Reconcile it explicitly.' >&2; exit 1; }
  [[ $(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='webswitcher_worker')") == 0 ]] || { echo 'Remove worker role memberships explicitly before provisioning.' >&2; exit 1; }
  owned=$(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT (SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='webswitcher_worker'))+(SELECT count(*) FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='webswitcher_worker'))+(SELECT count(*) FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname='webswitcher_worker'))+(SELECT count(*) FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname='webswitcher_worker'))")
  [[ "$owned" == 0 ]] || { echo 'Worker identity must own no schema/database/function/table objects.' >&2; exit 1; }
fi
# Unknown permissive policies could defeat the worker-specific row restrictions.
[[ $(psql -XAt --set ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='request_budget' AND policyname NOT IN ('ws_budget_api','ws_budget_publisher','ws_budget_worker_select','ws_budget_worker_insert','ws_budget_worker_update','ws_budget_worker_delete')") == 0 ]] || { echo 'Unexpected request-budget RLS policies require review before enabling discovery.' >&2; exit 1; }
psql -Xq --set ON_ERROR_STOP=1 <<'SQL'
\getenv worker_password WEB_SWITCHER_WORKER_PASSWORD
BEGIN;
SELECT format('CREATE ROLE webswitcher_worker LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'worker_password') WHERE NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='webswitcher_worker') \gexec
GRANT CONNECT ON DATABASE webswitcher TO webswitcher_worker;
GRANT USAGE ON SCHEMA public TO webswitcher_worker;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM webswitcher_worker;
-- Table revocation does not erase pre-existing column ACLs. Clear them too so a
-- rerun cannot retain an accidental extra reviewer/evidence/budget-column grant.
DO $$ DECLARE item record; columns text;
BEGIN
 FOR item IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
  SELECT string_agg(quote_ident(attname),',') INTO columns FROM pg_attribute WHERE attrelid=item.oid AND attnum>0 AND NOT attisdropped;
  IF columns IS NOT NULL THEN EXECUTE format('REVOKE SELECT (%s), INSERT (%s), UPDATE (%s), REFERENCES (%s) ON TABLE public.%I FROM webswitcher_worker',columns,columns,columns,columns,item.relname); END IF;
 END LOOP;
END $$;

GRANT SELECT ON site_family TO webswitcher_worker;
GRANT SELECT(id,source_host,proposed_origin,created_at,family_id) ON candidate TO webswitcher_worker;
GRANT INSERT(id,family_id,source_host,proposed_origin,reason,state,submitter,created_at) ON candidate TO webswitcher_worker;
GRANT INSERT ON audit_event TO webswitcher_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON lookup_job TO webswitcher_worker;
GRANT SELECT,INSERT,DELETE ON request_budget TO webswitcher_worker;
GRANT UPDATE(window_start,used) ON request_budget TO webswitcher_worker;

CREATE OR REPLACE FUNCTION public.ws_worker_pending_candidate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='webswitcher_worker' AND
   (NEW.state<>'pending' OR NEW.reviewer IS NOT NULL OR NEW.version<>0 OR NEW.submitter IS NULL OR NEW.submitter !~ '^discovery:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 THEN RAISE EXCEPTION 'Discovery identity can insert only pending unreviewed candidates with discovery provenance';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ws_worker_pending_candidate() FROM PUBLIC;
DROP TRIGGER IF EXISTS ws_worker_candidate_guard ON candidate;
CREATE TRIGGER ws_worker_candidate_guard BEFORE INSERT ON candidate FOR EACH ROW EXECUTE FUNCTION public.ws_worker_pending_candidate();

CREATE OR REPLACE FUNCTION public.ws_worker_discovery_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF current_user='webswitcher_worker' AND
   (NEW.actor<>'discovery-worker' OR NEW.action NOT IN ('DISCOVERY_CANDIDATE','DISCOVERY_ATTEMPT_FAILED'))
 THEN RAISE EXCEPTION 'Discovery identity can append only its own discovery audit event types';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ws_worker_discovery_audit() FROM PUBLIC;
DROP TRIGGER IF EXISTS ws_worker_audit_guard ON audit_event;
CREATE TRIGGER ws_worker_audit_guard BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION public.ws_worker_discovery_audit();

ALTER TABLE request_budget ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_budget_api ON request_budget;
CREATE POLICY ws_budget_api ON request_budget TO webswitcher_api USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS ws_budget_publisher ON request_budget;
CREATE POLICY ws_budget_publisher ON request_budget TO webswitcher_publisher USING(true) WITH CHECK(true);
DROP POLICY IF EXISTS ws_budget_worker_select ON request_budget;
CREATE POLICY ws_budget_worker_select ON request_budget FOR SELECT TO webswitcher_worker
 USING(bucket IN ('lookup:global','report:global','lookup-poll:global','discovery:queue:global','discovery:hour:global','discovery:day:global') OR bucket ~ '^discovery:host:[0-9a-f]{64}$');
DROP POLICY IF EXISTS ws_budget_worker_insert ON request_budget;
CREATE POLICY ws_budget_worker_insert ON request_budget FOR INSERT TO webswitcher_worker
 WITH CHECK((bucket IN ('lookup:global','report:global','lookup-poll:global','discovery:queue:global','discovery:hour:global','discovery:day:global') AND window_start=0 AND used=0)
   OR (bucket ~ '^discovery:host:[0-9a-f]{64}$' AND window_start>=0 AND used=0));
DROP POLICY IF EXISTS ws_budget_worker_update ON request_budget;
CREATE POLICY ws_budget_worker_update ON request_budget FOR UPDATE TO webswitcher_worker
 USING(bucket IN ('discovery:hour:global','discovery:day:global') OR bucket ~ '^discovery:host:[0-9a-f]{64}$')
 WITH CHECK((bucket IN ('discovery:hour:global','discovery:day:global') OR bucket ~ '^discovery:host:[0-9a-f]{64}$') AND window_start>=0 AND used>=0);
DROP POLICY IF EXISTS ws_budget_worker_delete ON request_budget;
CREATE POLICY ws_budget_worker_delete ON request_budget FOR DELETE TO webswitcher_worker
 USING(bucket ~ '^discovery:host:[0-9a-f]{64}$' AND window_start < floor(extract(epoch FROM CURRENT_TIMESTAMP)/3600)::bigint-24);
COMMIT;
SQL
unset PGPASSWORD WEB_SWITCHER_WORKER_PASSWORD
printf 'Opt-in worker role, pending-only candidates, append-only discovery audit and budget-row policies installed.\n'
