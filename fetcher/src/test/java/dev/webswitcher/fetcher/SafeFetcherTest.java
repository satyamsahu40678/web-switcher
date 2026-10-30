package dev.webswitcher.fetcher;

import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SafeFetcherTest {
    private static InetAddress[] publicDns(String host) throws Exception { return new InetAddress[]{InetAddress.getByName("1.1.1.1")}; }
    private static SafeFetcher.Response response(int status, String location, String body) {
        return new SafeFetcher.Response(status, location, "text/plain", body.getBytes(StandardCharsets.UTF_8));
    }
    @Test void provesReachabilityOnlyAndPinsEveryConnection() throws Exception {
        List<String> paths = new ArrayList<>();
        SafeFetcher fetcher = new SafeFetcher(SafeFetcherTest::publicDns, (url, addresses, cap, deadline) -> {
            assertEquals("1.1.1.1", addresses[0].getHostAddress());
            paths.add(url.getPath());
            return url.getPath().equals("/robots.txt") ? response(404, null, "") : response(200, null, "public content");
        }, Duration.ZERO);
        var result = fetcher.probe("https://example.org/docs/");
        assertEquals("REACHABLE", result.classification());
        assertEquals("UNVERIFIED", result.identity()); assertEquals("UNKNOWN", result.threatStatus());
        assertEquals(64, result.sha256().length()); assertEquals(List.of("/robots.txt", "/docs/"), paths);
    }
    @Test void rejectsPrivateDnsAndMixedAnswersBeforeTransport() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        SafeFetcher fetcher = new SafeFetcher(host -> new InetAddress[]{InetAddress.getByName("1.1.1.1"), InetAddress.getByName("10.0.0.1")},
                (url, addresses, cap, deadline) -> { calls.incrementAndGet(); return response(200, null, ""); }, Duration.ZERO);
        assertEquals("NON_PUBLIC_ADDRESS", assertThrows(SafeFetcher.ProbeFailure.class, () -> fetcher.probe("https://example.org/")).code);
        assertEquals(0, calls.get());
    }
    @Test void rejectsRebindingBetweenRobotsAndTarget() throws Exception {
        AtomicInteger resolutions = new AtomicInteger(); AtomicInteger calls = new AtomicInteger();
        SafeFetcher fetcher = new SafeFetcher(host -> resolutions.incrementAndGet() == 1 ? publicDns(host) : new InetAddress[]{InetAddress.getByName("127.0.0.1")},
                (url, addresses, cap, deadline) -> { calls.incrementAndGet(); return response(404, null, ""); }, Duration.ZERO);
        assertEquals("NON_PUBLIC_ADDRESS", assertThrows(SafeFetcher.ProbeFailure.class, () -> fetcher.probe("https://example.org/")).code);
        assertEquals(1, calls.get());
    }
    @Test void followsValidatedRedirectButRefusesPrivateRedirect() throws Exception {
        SafeFetcher fetcher = new SafeFetcher(host -> host.equals("private.example.org")
                ? new InetAddress[]{InetAddress.getByName("169.254.169.254")} : publicDns(host),
                (url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? response(404, null, "") : response(302, "https://private.example.org/", ""), Duration.ZERO);
        assertEquals("NON_PUBLIC_ADDRESS", assertThrows(SafeFetcher.ProbeFailure.class, () -> fetcher.probe("https://example.org/")).code);
    }
    @Test void detectsCyclesAndDowngradesAndRedirectLimit() throws Exception {
        SafeFetcher cycle = new SafeFetcher(SafeFetcherTest::publicDns,
                (url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? response(404, null, "") : response(302, "/", ""), Duration.ZERO);
        assertEquals("REDIRECT_CYCLE", assertThrows(SafeFetcher.ProbeFailure.class, () -> cycle.probe("https://example.org/")).code);
        SafeFetcher downgrade = new SafeFetcher(SafeFetcherTest::publicDns,
                (url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? response(404, null, "") : response(302, "http://example.org/", ""), Duration.ZERO);
        assertEquals("UNSAFE_REDIRECT", assertThrows(SafeFetcher.ProbeFailure.class, () -> downgrade.probe("https://example.org/")).code);
        AtomicInteger n = new AtomicInteger();
        SafeFetcher limit = new SafeFetcher(SafeFetcherTest::publicDns,
                (url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? response(404, null, "") : response(302, "/next" + n.incrementAndGet(), ""), Duration.ZERO);
        assertEquals("REDIRECT_LIMIT", assertThrows(SafeFetcher.ProbeFailure.class, () -> limit.probe("https://example.org/")).code);
    }
    @Test void robotsDenialStopsPageAndFailureDoesNotAuthorizeIt() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        SafeFetcher denied = new SafeFetcher(SafeFetcherTest::publicDns, (url, addresses, cap, deadline) -> {
            calls.incrementAndGet(); return response(200, null, "User-agent: *\nDisallow: /\n");
        }, Duration.ZERO);
        assertEquals("ROBOTS_DENIED", assertThrows(SafeFetcher.ProbeFailure.class, () -> denied.probe("https://example.org/")).code);
        assertEquals(1, calls.get());
        SafeFetcher unavailable = new SafeFetcher(SafeFetcherTest::publicDns, (url, addresses, cap, deadline) -> response(503, null, ""), Duration.ZERO);
        assertEquals("ROBOTS_UNAVAILABLE", assertThrows(SafeFetcher.ProbeFailure.class, () -> unavailable.probe("https://example.org/")).code);
    }
    @Test void boundsRobotsAndPageBodiesIncludingMisbehavingTransport() throws Exception {
        SafeFetcher oversized = new SafeFetcher(SafeFetcherTest::publicDns,
                (url, addresses, cap, deadline) -> response(200, null, "x".repeat(cap + 1)), Duration.ZERO);
        assertEquals("BODY_LIMIT", assertThrows(SafeFetcher.ProbeFailure.class, () -> oversized.probe("https://example.org/")).code);
    }
}
