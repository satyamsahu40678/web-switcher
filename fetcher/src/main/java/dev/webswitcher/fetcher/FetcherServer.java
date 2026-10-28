package dev.webswitcher.fetcher;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Internal service only. Bind/ingress isolation and a separate egress firewall remain required. */
public final class FetcherServer {
    static {
        // JDK HttpServer limits are process-wide and set before creating the first server.
        System.setProperty("sun.net.httpserver.maxReqTime", "5");
        System.setProperty("sun.net.httpserver.maxRspTime", "40");
        System.setProperty("sun.net.httpserver.maxReqHeaders", "32");
        System.setProperty("sun.net.httpserver.maxReqHeaderSize", "16384");
        System.setProperty("sun.net.httpserver.maxIdleConnections", "8");
        System.setProperty("sun.net.httpserver.idleInterval", "15");
    }
    private static final ObjectMapper JSON = new ObjectMapper(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(4).maxStringLength(2048).build()).build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    public static void main(String[] args) throws Exception {
        String token = System.getenv("FETCHER_INTERNAL_TOKEN");
        if (token == null || token.length() < 32) throw new IllegalStateException("FETCHER_INTERNAL_TOKEN must be securely configured (at least 32 characters)");
        String bind = System.getenv().getOrDefault("FETCHER_BIND", "127.0.0.1");
        int port = Integer.parseInt(System.getenv().getOrDefault("FETCHER_PORT", "8081"));
        HttpServer server = create(new InetSocketAddress(bind, port), token, new SafeFetcher(SafeFetcher.boundedSystemResolver(), new PinnedHttpTransport()));
        Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(1)));
        server.start();
        System.out.println("Web Switcher internal fetcher started on port " + port + "; public egress "
                + (PinnedHttpTransport.hasProxyConfiguration() ? "UNAVAILABLE (proxy cannot establish connect-IP pinning)" : "requires isolated firewall validation"));
    }

    static HttpServer create(InetSocketAddress address, String token, SafeFetcher fetcher) throws IOException {
        HttpServer server = HttpServer.create(address, 16);
        byte[] expected = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
        server.setExecutor(new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16), runnable -> {
            Thread thread = new Thread(runnable, "fetcher-request"); thread.setDaemon(true); return thread;
        }, new ThreadPoolExecutor.AbortPolicy()));
        server.createContext("/health/live", exchange -> {
            if (!exchange.getRequestURI().getPath().equals("/health/live") || !exchange.getRequestMethod().equals("GET")) { reply(exchange, 404, Map.of("code", "NOT_FOUND")); return; }
            reply(exchange, 200, Map.of("status", "UP", "publicEgress", PinnedHttpTransport.hasProxyConfiguration() ? "UNAVAILABLE" : "REQUIRES_FIREWALL_VALIDATION"));
        });
        var handler = (com.sun.net.httpserver.HttpHandler) exchange -> {
            try {
                String path = exchange.getRequestURI().getPath();
                if (!(path.equals("/probe") || path.equals("/resolve")) || exchange.getRequestURI().getRawQuery() != null) { reply(exchange, 404, Map.of("code", "NOT_FOUND")); return; }
                if (!exchange.getRequestMethod().equals("POST")) { reply(exchange, 405, Map.of("code", "METHOD_NOT_ALLOWED")); return; }
                String supplied = exchange.getRequestHeaders().getFirst("Authorization");
                if (supplied == null || supplied.length() > 512 || !MessageDigest.isEqual(expected, supplied.getBytes(StandardCharsets.UTF_8))) {
                    reply(exchange, 401, Map.of("code", "UNAUTHORIZED")); return;
                }
                String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
                if (contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT).startsWith("application/json")) { reply(exchange, 415, Map.of("code", "JSON_REQUIRED")); return; }
                byte[] bytes = exchange.getRequestBody().readNBytes(4097);
                if (bytes.length > 4096) { reply(exchange, 413, Map.of("code", "REQUEST_LIMIT")); return; }
                JsonNode node;
                try { node = JSON.readTree(bytes); }
                catch (Exception e) { reply(exchange, 400, Map.of("code", "INVALID_JSON")); return; }
                if (node == null || !node.isObject() || node.size() != 1 || !node.has("url") || !node.get("url").isTextual()) {
                    reply(exchange, 400, Map.of("code", "INVALID_REQUEST")); return;
                }
                try { reply(exchange, 200, path.equals("/resolve") ? fetcher.resolve(node.get("url").textValue()) : fetcher.probe(node.get("url").textValue())); }
                catch (SafeFetcher.ProbeFailure e) {
                    int status = e.code.contains("LIMIT") || e.code.equals("HOST_CONCURRENCY_LIMIT") ? 429
                            : e.code.equals("PINNED_EGRESS_UNAVAILABLE") || e.code.equals("NETWORK_UNAVAILABLE") || e.code.equals("DNS_UNAVAILABLE") ? 503 : 422;
                    reply(exchange, status, Map.of("code", e.code, "identity", "UNVERIFIED", "threatStatus", "UNKNOWN"));
                }
            } catch (Exception e) { reply(exchange, 500, Map.of("code", "INTERNAL_ERROR")); }
            finally { exchange.close(); }
        };
        server.createContext("/probe", handler);
        server.createContext("/resolve", handler);
        return server;
    }

    private static void reply(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = JSON.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
