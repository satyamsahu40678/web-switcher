package dev.webswitcher.fetcher;

import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import org.apache.hc.client5.http.impl.classic.CloseableHttpResponse;
import org.apache.hc.core5.io.CloseMode;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.ManagedHttpClientConnectionFactory;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.config.Http1Config;
import org.apache.hc.core5.http.message.BasicHeader;
import org.apache.hc.core5.http.protocol.HttpCoreContext;
import org.apache.hc.core5.util.Timeout;

/** No system proxy/auth/cookies. Hostname TLS verification is Apache's default and stays enabled. */
public final class PinnedHttpTransport implements SafeFetcher.Transport {
    @Override public SafeFetcher.Response get(URI url, InetAddress[] pinned, int maxBytes, long deadline) throws Exception {
        // A normal CONNECT proxy resolves the target independently; claiming connect-IP pinning
        // through it would be false. A deployment must provide direct isolated public egress.
        if (hasProxyConfiguration()) throw new SafeFetcher.ProbeFailure("PINNED_EGRESS_UNAVAILABLE");
        AddressPolicy.requireAllPublic(pinned);
        String expectedHost = url.getHost();
        DnsResolver resolver = new DnsResolver() {
            @Override public InetAddress[] resolve(String host) throws UnknownHostException {
                if (!expectedHost.equalsIgnoreCase(host)) throw new UnknownHostException("UNEXPECTED_DNS_HOST");
                return pinned.clone();
            }
            @Override public String resolveCanonicalHostname(String host) throws UnknownHostException {
                if (!expectedHost.equalsIgnoreCase(host)) throw new UnknownHostException("UNEXPECTED_DNS_HOST");
                return expectedHost;
            }
        };
        long millis = Math.max(1, Math.min(2000, TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())));
        var manager = PoolingHttpClientConnectionManagerBuilder.create()
                .setDnsResolver(resolver)
                .setConnectionFactory(ManagedHttpClientConnectionFactory.builder()
                        .http1Config(Http1Config.custom().setMaxHeaderCount(64).setMaxLineLength(4096).build()).build())
                .setMaxConnTotal(1).setMaxConnPerRoute(1)
                .setDefaultConnectionConfig(ConnectionConfig.custom().setConnectTimeout(Timeout.ofMilliseconds(millis))
                        .setSocketTimeout(Timeout.ofMilliseconds(millis)).build()).build();
        try (CloseableHttpClient client = HttpClients.custom().setConnectionManager(manager)
                .disableAutomaticRetries().disableRedirectHandling().disableContentCompression()
                .disableCookieManagement().disableAuthCaching()
                .addRequestInterceptorLast((request, entity, context) -> {
                    var details = HttpCoreContext.cast(context).getEndpointDetails();
                    if (details == null) throw new IOException("CONNECTED_ADDRESS_UNAVAILABLE");
                    requirePinnedRemote(details.getRemoteAddress(), pinned);
                })
                .setDefaultRequestConfig(RequestConfig.custom().setResponseTimeout(Timeout.ofMilliseconds(millis))
                        .setConnectionRequestTimeout(Timeout.ofMilliseconds(millis)).build())
                .setDefaultHeaders(List.of(new BasicHeader("User-Agent", "WebSwitcherBot/0.2 (+https://github.com/satyamsahu40678/web-switcher)"),
                        new BasicHeader("Accept", "text/html,text/plain,application/json;q=0.8"),
                        new BasicHeader("Accept-Encoding", "identity"))).build()) {
            // Handler-based execute consumes remaining entities automatically. Use explicit immediate
            // response closure instead, so oversized/redirect/error bodies are never drained.
            @SuppressWarnings("deprecation")
            CloseableHttpResponse response = client.execute(new HttpGet(url));
            try {
                SafeFetcher.checkDeadline(deadline);
                String encoding = response.getFirstHeader("Content-Encoding") == null ? "identity" : response.getFirstHeader("Content-Encoding").getValue();
                if (!encoding.equalsIgnoreCase("identity")) throw new SafeFetcher.ProbeFailure("CONTENT_ENCODING_UNSUPPORTED");
                String contentType = response.getFirstHeader("Content-Type") == null ? "" : response.getFirstHeader("Content-Type").getValue().toLowerCase(java.util.Locale.ROOT);
                int status = response.getCode();
                boolean bodyRequired = status >= 200 && status < 300;
                if (bodyRequired && !(contentType.startsWith("text/html") || contentType.startsWith("text/plain") || contentType.startsWith("application/json"))) {
                    throw new SafeFetcher.ProbeFailure("CONTENT_TYPE_UNSUPPORTED");
                }
                byte[] bytes = new byte[0];
                if (response.getEntity() != null && bodyRequired) {
                    if (response.getEntity().getContentLength() > maxBytes) throw new SafeFetcher.ProbeFailure("BODY_LIMIT");
                    InputStream body = response.getEntity().getContent();
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    byte[] buffer = new byte[4096]; int size;
                    while ((size = body.read(buffer, 0, Math.min(buffer.length, maxBytes + 1 - output.size()))) >= 0) {
                        SafeFetcher.checkDeadline(deadline);
                        output.write(buffer, 0, size);
                        if (output.size() > maxBytes) throw new SafeFetcher.ProbeFailure("BODY_LIMIT");
                    }
                    bytes = output.toByteArray();
                }
                SafeFetcher.checkDeadline(deadline);
                String location = response.getFirstHeader("Location") == null ? null : response.getFirstHeader("Location").getValue();
                return new SafeFetcher.Response(status, location, contentType, bytes);
            } finally {
                response.close(CloseMode.IMMEDIATE);
            }
        }
    }

    static void requirePinnedRemote(SocketAddress remote, InetAddress[] pinned) throws IOException {
        if (!(remote instanceof InetSocketAddress socket) || socket.isUnresolved() || socket.getPort() != 443)
            throw new IOException("CONNECTED_ADDRESS_UNAVAILABLE");
        try { AddressPolicy.requirePublic(socket.getAddress()); }
        catch (IllegalArgumentException e) { throw new IOException("CONNECTED_ADDRESS_NON_PUBLIC"); }
        for (InetAddress allowed : pinned) if (allowed.equals(socket.getAddress())) return;
        throw new IOException("CONNECTED_ADDRESS_MISMATCH");
    }

    static boolean hasProxyConfiguration() {
        for (String name : new String[]{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"})
            if (System.getenv(name) != null && !System.getenv(name).isBlank()) return true;
        return System.getProperty("http.proxyHost") != null || System.getProperty("https.proxyHost") != null;
    }
}
