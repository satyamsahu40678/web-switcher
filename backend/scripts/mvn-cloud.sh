#!/usr/bin/env bash
# Optional managed-cloud adapter: retain the session proxy and CA verification.
set -euo pipefail
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
backend_dir=$(dirname "$script_dir")
cache_dir=${WEB_SWITCHER_MAVEN_CACHE:-/workspace/.cache/web-switcher-maven}
mkdir -p "$cache_dir"
settings_args=()
if [[ -n ${HTTPS_PROXY:-} ]]; then
 python3 - "$cache_dir/settings.xml" <<'PY'
import os,sys,urllib.parse,xml.etree.ElementTree as ET
proxy=urllib.parse.urlsplit(os.environ['HTTPS_PROXY'])
if proxy.username or proxy.password:
 raise SystemExit('Authenticated proxy configuration requires an externally supplied Maven settings file.')
root=ET.Element('settings');proxies=ET.SubElement(root,'proxies');item=ET.SubElement(proxies,'proxy')
for key,value in {'id':'session-proxy','active':'true','protocol':'http','host':proxy.hostname,'port':str(proxy.port or 80),'nonProxyHosts':'localhost|127.0.0.1'}.items():ET.SubElement(item,key).text=value
ET.ElementTree(root).write(sys.argv[1],encoding='unicode')
PY
 settings_args=(-s "$cache_dir/settings.xml")
fi
export MAVEN_USER_HOME="$cache_dir/wrapper"
if [[ -x /workspace/tools/jdk-21/bin/javac && -z ${JAVA_HOME:-} ]]; then export JAVA_HOME=/workspace/tools/jdk-21; fi
trust_args=()
if [[ -f /etc/ssl/certs/java/cacerts ]]; then trust_args=(-Djavax.net.ssl.trustStore=/etc/ssl/certs/java/cacerts); fi
exec "$backend_dir/mvnw" "${trust_args[@]}" "${settings_args[@]}" "-Dmaven.repo.local=$cache_dir/repository" "$@"
