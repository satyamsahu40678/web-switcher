package dev.webswitcher.fetcher;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class FetcherServerTest {
    @Test void requiresInternalAuthenticationAndStrictBoundedJson() throws Exception {
        String token = "test-only-" + "x".repeat(32);
        SafeFetcher fetcher = new SafeFetcher(host -> new InetAddress[]{InetAddress.getByName("1.1.1.1")},
                (url, addresses, cap, deadline) -> new SafeFetcher.Response(url.getPath().equals("/robots.txt") ? 404 : 200, null, "text/plain", new byte[0]), Duration.ZERO);
        var server = FetcherServer.create(new InetSocketAddress("127.0.0.1", 0), token, fetcher);
        server.start();
        try (HttpClient client = HttpClient.newHttpClient()) {
            URI url = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/probe");
            var unauthorized = client.send(HttpRequest.newBuilder(url).header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"url\":\"https://example.org/\"}")).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(401, unauthorized.statusCode());
            for (String body : new String[]{"{\"url\":\"https://example.org/\",\"url\":\"https://evil.org/\"}", "{\"url\":\"https://example.org/\",\"header\":\"secret\"}", "[]"}) {
                var invalid = client.send(HttpRequest.newBuilder(url).header("Content-Type", "application/json").header("Authorization", "Bearer " + token)
                        .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
                assertEquals(400, invalid.statusCode());
            }
            var valid = client.send(HttpRequest.newBuilder(url).header("Content-Type", "application/json").header("Authorization", "Bearer " + token)
                    .POST(HttpRequest.BodyPublishers.ofString("{\"url\":\"https://example.org/\"}")).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, valid.statusCode()); assertTrue(valid.body().contains("UNVERIFIED"));
            assertFalse(valid.body().contains("public content"));
        } finally { server.stop(0); }
    }
}
