#!/usr/bin/env bash
# Hermetic failure/guard tests. This does not test age encryption or a live PostgreSQL restore.
set -euo pipefail
backup_test_dir="$(mktemp -d)"
trap 'rm -rf -- "$backup_test_dir"' EXIT
backup_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mkdir "$backup_test_dir/bin" "$backup_test_dir/output"
cat > "$backup_test_dir/bin/pg_dump" <<'MOCK'
#!/usr/bin/env bash
if [[ "${BACKUP_TEST_CASE:-}" == failure ]]; then exit 7; fi
if [[ "${BACKUP_TEST_CASE:-}" == empty ]]; then exit 0; fi
printf 'PGDMP0123456789012345678901234567890123456789'
MOCK
cat > "$backup_test_dir/bin/age" <<'MOCK'
#!/usr/bin/env bash
if [[ "${BACKUP_TEST_CASE:-}" == encrypt_failure ]]; then exit 8; fi
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output ]]; then shift; cat > "$1"; exit 0; fi
  shift
done
cat
MOCK
cat > "$backup_test_dir/bin/psql" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' "${BACKUP_TEST_TABLES:-0}"
MOCK
cat > "$backup_test_dir/bin/pg_restore" <<'MOCK'
#!/usr/bin/env bash
printf 'called\n' > "$BACKUP_TEST_RESTORE_LOG"
cat >/dev/null
MOCK
chmod +x "$backup_test_dir/bin/"*
export PATH="$backup_test_dir/bin:$PATH"
export PGHOST=fixture.invalid PGUSER=fixture PGDATABASE=fixture_restore
export BACKUP_DIRECTORY="$backup_test_dir/output" AGE_RECIPIENT=age-test-public-placeholder
export BACKUP_TEST_RESTORE_LOG="$backup_test_dir/restore.log"
for BACKUP_TEST_CASE in failure empty encrypt_failure; do
 export BACKUP_TEST_CASE
 if "$backup_script_dir/backup.sh" >"$backup_test_dir/stdout" 2>"$backup_test_dir/stderr"; then
  echo "FAIL: $BACKUP_TEST_CASE unexpectedly succeeded" >&2; exit 1
 fi
 [[ -z "$(find "$BACKUP_DIRECTORY" -type f -print -quit)" ]] || { echo 'Failed backup left output behind.' >&2; exit 1; }
 printf 'PASS backup rejects %s\n' "$BACKUP_TEST_CASE"
done
unset BACKUP_TEST_CASE
"$backup_script_dir/backup.sh" >"$backup_test_dir/stdout"
backup_test_archive="$(find "$BACKUP_DIRECTORY" -name '*.dump.age' -print -quit)"
[[ -s "$backup_test_archive" && -s "$backup_test_archive.sha256" ]]
printf 'PASS successful producer writes archive and checksum\n'
printf 'private-test-placeholder\n' > "$backup_test_dir/identity"
export AGE_IDENTITY_FILE="$backup_test_dir/identity" RESTORE_CONFIRM_DATABASE=wrong
if "$backup_script_dir/restore.sh" "$backup_test_archive" >/dev/null 2>&1; then echo 'FAIL mismatched target accepted.' >&2; exit 1; fi
[[ ! -e "$BACKUP_TEST_RESTORE_LOG" ]]
printf 'PASS restore rejects mismatched target\n'
export RESTORE_CONFIRM_DATABASE="$PGDATABASE" BACKUP_TEST_TABLES=1
if "$backup_script_dir/restore.sh" "$backup_test_archive" >/dev/null 2>&1; then echo 'FAIL nonempty target accepted.' >&2; exit 1; fi
[[ ! -e "$BACKUP_TEST_RESTORE_LOG" ]]
printf 'PASS restore rejects nonempty database\n'
