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
    @Test void resolveHasItsOwnAuthenticatedBoundedContractAndProbeRemainsCompatible() throws Exception {
        String token = "test-only-" + "q".repeat(32);
        SafeFetcher fetcher = new SafeFetcher(host -> new InetAddress[]{InetAddress.getByName("1.1.1.1")},
                (url, addresses, cap, deadline) -> new SafeFetcher.Response(url.getPath().equals("/robots.txt") ? 404 : 200, null, "text/html",
                        (url.getHost().equals("old.example.org") ? "<head><meta http-equiv='refresh' content='0;url=https://current.example.org/'></head>" : "<title>Current</title>").getBytes(java.nio.charset.StandardCharsets.UTF_8)), Duration.ZERO);
        var server = FetcherServer.create(new InetSocketAddress("127.0.0.1", 0), token, fetcher);
        server.start();
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        try (HttpClient client = HttpClient.newHttpClient()) {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            String body = "{\"url\":\"https://old.example.org/\"}";
            var unauthorized = client.send(HttpRequest.newBuilder(URI.create(base + "/resolve")).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(401, unauthorized.statusCode());
            var request = HttpRequest.newBuilder(URI.create(base + "/resolve")).header("Content-Type", "application/json").header("Authorization", "Bearer " + token);
            var reply = client.send(request.POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(200, reply.statusCode());
            var resolved = json.readTree(reply.body());
            assertEquals("https://current.example.org", resolved.get("finalOrigin").asText());
            assertEquals("META_REFRESH", resolved.get("chain").get(0).get("kind").asText());
            assertEquals("UNVERIFIED", resolved.get("identity").asText());
            assertFalse(reply.body().contains("<head>"));
            var probe = client.send(HttpRequest.newBuilder(URI.create(base + "/probe")).header("Content-Type", "application/json").header("Authorization", "Bearer " + token).POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
            assertEquals("https://old.example.org", json.readTree(probe.body()).get("finalOrigin").asText());
            assertFalse(json.readTree(probe.body()).has("chain"));
            for (String invalid : new String[]{body + "{}", body + " trailing", "{\"url\":\"https://old.example.org/\",\"remembered\":[]}", "x".repeat(4097)}) {
                var rejected = client.send(request.POST(HttpRequest.BodyPublishers.ofString(invalid)).build(), HttpResponse.BodyHandlers.ofString());
                assertEquals(invalid.length() > 4096 ? 413 : 400, rejected.statusCode());
            }
        } finally { server.stop(0); }
    }

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
