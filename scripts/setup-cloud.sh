#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
export npm_config_cache=${npm_config_cache:-/workspace/.cache/web-switcher-npm}
mkdir -p "$npm_config_cache"
# Cloud tasks already have isolated checkouts; do not create a worktree.
npm ci --no-audit --no-fund
npm --prefix apps/web ci --no-audit --no-fund
if [[ -x /workspace/tools/jdk-21/bin/javac ]]; then
  export JAVA_HOME=/workspace/tools/jdk-21
elif ! command -v javac >/dev/null || ! javac -version 2>&1 | rg -q 'javac 21\.'; then
  [[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Install a supported JDK21 for this platform.' >&2; exit 1; }
  mkdir -p /workspace/tools
  tool_tmp=$(mktemp -d /tmp/web-switcher-jdk.XXXXXX)
  trap 'rm -rf "$tool_tmp"' EXIT
  jdk_asset=OpenJDK21U-jdk_x64_linux_hotspot_21.0.9_10.tar.gz
  jdk_url=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.9%2B10
  curl --fail --location --retry 2 "$jdk_url/$jdk_asset" -o "$tool_tmp/$jdk_asset"
  curl --fail --location --retry 2 "$jdk_url/$jdk_asset.sha256.txt" -o "$tool_tmp/checksum"
  python3 - "$tool_tmp" "$jdk_asset" <<'PY'
import hashlib,pathlib,sys
root=pathlib.Path(sys.argv[1]); artifact=root/sys.argv[2]
expected=(root/'checksum').read_text().split()[0]
assert len(expected)==64 and hashlib.file_digest(artifact.open('rb'),'sha256').hexdigest()==expected, 'JDK checksum mismatch'
PY
  tar -xzf "$tool_tmp/$jdk_asset" -C /workspace/tools
  ln -s jdk-21.0.9+10 /workspace/tools/jdk-21
  export JAVA_HOME=/workspace/tools/jdk-21
fi
# Extend Java trust through the system's configured CA store; never disable TLS.
export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts"
./backend/scripts/mvn-cloud.sh -f backend/pom.xml --batch-mode --no-transfer-progress verify
./backend/scripts/mvn-cloud.sh -f fetcher/pom.xml --batch-mode --no-transfer-progress verify
npm test
npm run check
npm --prefix apps/web run build
npm run package
