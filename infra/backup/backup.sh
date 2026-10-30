#!/usr/bin/env bash
# Credentials are supplied through normal libpq environment variables or PGPASSFILE.
set -euo pipefail
umask 077
: "${PGHOST:?Set PGHOST to the database host}"
: "${PGUSER:?Set PGUSER to a read-only backup user}"
: "${PGDATABASE:?Set PGDATABASE to the source database}"
: "${BACKUP_DIRECTORY:?Set an existing absolute directory outside the checkout}"
: "${AGE_RECIPIENT:?Set an age public recipient key}"
[[ "$BACKUP_DIRECTORY" == /* && -d "$BACKUP_DIRECTORY" ]] || { echo 'BACKUP_DIRECTORY must be an existing absolute directory.' >&2; exit 2; }
for command in pg_dump python3 age sha256sum; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 2; }
done
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$BACKUP_DIRECTORY/web-switcher-$backup_stamp.dump.age"
[[ ! -e "$backup_path" ]] || { echo 'A backup for this timestamp already exists.' >&2; exit 2; }
backup_workdir="$(mktemp -d "$BACKUP_DIRECTORY/.web-switcher-XXXXXXXX")"
backup_tmp="$backup_workdir/archive.age"
trap 'rm -f -- "$backup_tmp"; rmdir -- "$backup_workdir"' EXIT
pg_dump --format=custom --no-owner --no-privileges \
  | python3 "$script_dir/check-archive.py" \
  | age --encrypt --recipient "$AGE_RECIPIENT" --output "$backup_tmp"
[[ -s "$backup_tmp" ]] || { echo 'Encrypted backup is empty.' >&2; exit 1; }
mv -- "$backup_tmp" "$backup_path"
(cd -- "$BACKUP_DIRECTORY" && sha256sum -- "$(basename -- "$backup_path")" > "$(basename -- "$backup_path").sha256")
printf 'Encrypted backup saved: %s\n' "$backup_path"
