#!/bin/sh
# Used only in a build stage. Retain system roots and remove session trust/config.
set -eu
build_tmp="$(mktemp -d)"
trap 'rm -rf -- "$build_tmp"' EXIT HUP INT TERM
build_settings="$build_tmp/settings.xml"
printf '%s\n' '<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"></settings>' > "$build_settings"
if [ -s /run/secrets/proxy_ca ]; then
  cat /etc/ssl/certs/ca-certificates.crt /run/secrets/proxy_ca > "$build_tmp/ca-bundle.pem"
  export CURL_CA_BUNDLE="$build_tmp/ca-bundle.pem"
  printf 'ca_certificate = %s\n' "$build_tmp/ca-bundle.pem" > "$build_tmp/wgetrc"
  export WGETRC="$build_tmp/wgetrc"
  cp "$JAVA_HOME/lib/security/cacerts" "$build_tmp/cacerts"
  keytool -importcert -noprompt -alias web-switcher-build-proxy -file /run/secrets/proxy_ca \
    -keystore "$build_tmp/cacerts" -storepass changeit >/dev/null
  MAVEN_OPTS="${MAVEN_OPTS:-} -Djavax.net.ssl.trustStore=$build_tmp/cacerts -Djavax.net.ssl.trustStorePassword=changeit"
  export MAVEN_OPTS
fi
build_proxy="${HTTPS_PROXY:-${https_proxy:-${HTTP_PROXY:-${http_proxy:-}}}}"
if [ -n "$build_proxy" ]; then
  case "$build_proxy" in http://*|https://*) ;; *) echo 'Unsupported proxy URI scheme in build.' >&2; exit 2;; esac
  build_authority="${build_proxy#*://}"
  build_authority="${build_authority%/}"
  case "$build_authority" in *@*|*/*) echo 'Use an uncredentialed HTTP(S) build proxy supplied by the environment.' >&2; exit 2;; esac
  case "$build_authority" in
    *:*) build_host="${build_authority%:*}"; build_port="${build_authority##*:}";;
    *) build_host="$build_authority"; build_port=80;;
  esac
  case "$build_host" in ''|*[!A-Za-z0-9.-]*) echo 'Unsupported build proxy hostname.' >&2; exit 2;; esac
  case "$build_port" in ''|*[!0-9]*) echo 'Unsupported build proxy port.' >&2; exit 2;; esac
  cat > "$build_settings" <<SETTINGS
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0">
  <proxies><proxy><id>environment-build-proxy</id><active>true</active><protocol>http</protocol><host>$build_host</host><port>$build_port</port><nonProxyHosts>localhost|127.0.0.1</nonProxyHosts></proxy></proxies>
</settings>
SETTINGS
fi
./backend/mvnw -f backend/pom.xml --settings "$build_settings" --batch-mode --no-transfer-progress -DskipTests package
