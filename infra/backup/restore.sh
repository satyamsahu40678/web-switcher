#!/usr/bin/env bash
# Restores only into an explicitly selected empty PostgreSQL database.
set -euo pipefail
umask 077
: "${PGHOST:?Set PGHOST to a clean restore instance}"
: "${PGUSER:?Set PGUSER to a restore-only database user}"
: "${PGDATABASE:?Set PGDATABASE to an empty restore database}"
: "${RESTORE_CONFIRM_DATABASE:?Set RESTORE_CONFIRM_DATABASE to the exact target PGDATABASE}"
: "${AGE_IDENTITY_FILE:?Set AGE_IDENTITY_FILE to your separately protected age identity}"
[[ "$RESTORE_CONFIRM_DATABASE" == "$PGDATABASE" ]] || { echo 'Restore target confirmation does not match.' >&2; exit 2; }
[[ $# == 1 && -f "$1" && -f "$AGE_IDENTITY_FILE" ]] || { echo 'Usage: restore.sh /absolute/path/to/backup.dump.age' >&2; exit 2; }
for command in psql pg_restore age python3; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 2; }; done
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 "$script_dir/verify-checksum.py" "$1"
# Do not replace a live schema. This query is read-only and fails on connection errors.
restore_tables="$(psql -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')")"
[[ "$restore_tables" == 0 ]] || { echo 'Target database is not empty; restore refused.' >&2; exit 2; }
# Finish all age authentication before pg_restore can write anything. A producer
# error at the end of a streaming pipe must never leave committed restored data.
restore_workdir="$(mktemp -d "${TMPDIR:-/tmp}/web-switcher-restore-XXXXXXXX")"
trap 'rm -rf -- "$restore_workdir"' EXIT
restore_archive="$restore_workdir/archive.dump"
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$restore_archive" -- "$1"
pg_restore --list "$restore_archive" >/dev/null
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$PGDATABASE" "$restore_archive"
printf 'Restore completed into the explicitly selected database. Run application and signature checks before promotion.\n'
