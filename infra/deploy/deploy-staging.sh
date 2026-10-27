#!/usr/bin/env bash
# Deploy only verified immutable images. Config/secrets are provisioned on host.
# Database migration rollback is never automated. Current schema supports V1 only.
set -euo pipefail
umask 077
release_dir=$(CDPATH='' cd -- "${1:?Pass extracted release directory}" && pwd)
config_dir=$(CDPATH='' cd -- "${2:?Pass protected configuration directory}" && pwd)
[[ -f "$release_dir/release.json" && -f "$release_dir/infra/compose/staging.yml" ]] || { echo 'Incomplete extracted release.' >&2; exit 1; }
for tool in python3 docker curl flock; do command -v "$tool" >/dev/null || { echo "Missing host prerequisite: $tool" >&2; exit 1; }; done
origin=$(python3 "$release_dir/infra/deploy/validate-config.py" "$config_dir" --origin)
config_fingerprint=$(python3 "$release_dir/infra/deploy/validate-config.py" "$config_dir" --fingerprint)
python3 "$release_dir/infra/deploy/release-manifest.py" "$release_dir/release.json" --env > "$release_dir/images.env"
export DEPLOY_CONFIG_DIR="$config_dir"
state_dir="$config_dir/deployment-state"
mkdir -p "$state_dir"
exec 9>"$state_dir/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
compose=(docker compose --project-name web-switcher-staging --env-file "$config_dir/runtime.env" --env-file "$release_dir/images.env" -f "$release_dir/infra/compose/staging.yml")
"${compose[@]}" config --quiet
previous_release=''
if [[ -s "$state_dir/current-release" ]]; then
  [[ -s "$state_dir/config-fingerprint" && $(cat "$state_dir/config-fingerprint") == "$config_fingerprint" ]] || { echo 'Protected configuration changed. Rehearse and perform a separate controlled configuration/credential rotation before deploying application images.' >&2; exit 1; }
  previous_release=$(cat "$state_dir/current-release")
  [[ "$previous_release" == /* && "$previous_release" != *$'\n'* && -f "$previous_release/release.json" && -f "$previous_release/images.env" ]] || { echo 'Previous release state is invalid; reconcile before deployment.' >&2; exit 1; }
  python3 "$release_dir/infra/deploy/release-manifest.py" "$previous_release/release.json" >/dev/null
  # Only a known healthy prior release is eligible for automatic image rollback.
  curl --proto '=https' --silent --show-error --fail --max-time 10 "$origin/health/ready" | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("status")=="UP" and x.get("database")=="ready"'
fi
"${compose[@]}" pull
# V1 schema bootstrap is monotonic; do not revert database state on failure.
rollback() {
  local failure=$?
  trap - ERR
  if [[ -n "$previous_release" && "$previous_release" != "$release_dir" ]]; then
    echo 'New release failed health verification; restoring prior immutable application images.' >&2
    docker compose --project-name web-switcher-staging --env-file "$config_dir/runtime.env" --env-file "$previous_release/images.env" -f "$previous_release/infra/compose/staging.yml" up -d --no-build api web || echo 'Automatic image rollback failed; operator intervention required.' >&2
  else
    echo 'Deployment failed with no prior healthy release. Preserve database/state and inspect service logs.' >&2
  fi
  exit "$failure"
}
trap rollback ERR
"${compose[@]}" up -d --wait --wait-timeout 150 postgres
"${compose[@]}" run --rm db-bootstrap
"${compose[@]}" up -d --no-build api web
ready=false
for _ in $(seq 1 30); do
  if curl --proto '=https' --silent --show-error --fail --max-time 5 "$origin/health/ready" 2>/dev/null | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("status")=="UP" and x.get("database")=="ready"' 2>/dev/null; then ready=true; break; fi
  sleep 2
done
[[ "$ready" == true ]] || { echo 'New release did not become healthy.' >&2; false; }
expected=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["sourceCommit"])' "$release_dir/release.json")
actual=$(curl --proto '=https' --silent --show-error --fail --max-time 10 --head "$origin/" | tr -d '\r' | awk 'tolower($1)=="x-web-switcher-release:"{print $2}')
[[ "$actual" == "$expected" ]] || { echo 'The web endpoint is serving a different source release.' >&2; false; }
# Public deployment must remain outside the demo profile.
curl --proto '=https' --silent --show-error --fail --max-time 10 "$origin/v1/session" | python3 -c 'import json,sys;assert json.load(sys.stdin).get("demo") is False'
printf '%s\n' "$config_fingerprint" > "$state_dir/config-fingerprint.new"
mv "$state_dir/config-fingerprint.new" "$state_dir/config-fingerprint"
printf '%s\n' "$release_dir" > "$state_dir/current-release.new"
mv "$state_dir/current-release.new" "$state_dir/current-release"
trap - ERR
printf 'Staging release %s passed HTTPS/readiness/no-demo checks.\n' "$expected"
printf 'Private publisher/OIDC login, signed catalog freshness, backups and browser acceptance still require operator smoke checks.\n'
