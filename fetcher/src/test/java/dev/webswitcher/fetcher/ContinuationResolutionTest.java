package dev.webswitcher.fetcher;

import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import static org.junit.jupiter.api.Assertions.*;

class ContinuationResolutionTest {
    private static InetAddress[] publicDns(String ignored) throws Exception { return new InetAddress[]{InetAddress.getByName("1.1.1.1")}; }
    private static SafeFetcher.Response html(String body) { return new SafeFetcher.Response(200, null, "text/html; charset=utf-8", body.getBytes(StandardCharsets.UTF_8)); }
    private static SafeFetcher.Response robots() { return new SafeFetcher.Response(404, null, "text/plain", new byte[0]); }
    private static SafeFetcher fetcher(SafeFetcher.Transport transport) { return new SafeFetcher(ContinuationResolutionTest::publicDns, transport, Duration.ZERO); }

    @Test void followsHttpMetaAndExplicitSuccessorWithoutAManualDestination() throws Exception {
        List<String> visited = new ArrayList<>();
        var fetcher = fetcher((url, addresses, cap, deadline) -> {
            assertEquals("1.1.1.1", addresses[0].getHostAddress());
            if (url.getPath().equals("/robots.txt")) return robots();
            visited.add(url.toString());
            return switch (url.getHost()) {
                case "old.example.org" -> new SafeFetcher.Response(301, "https://middle.example.org/", "text/plain", new byte[0]);
                case "middle.example.org" -> html("<head><meta http-equiv='refresh' content='0; URL=https://later.example.org/'></head>");
                case "later.example.org" -> html("<head><link rel='web-switcher-successor' href='https://current.example.org/'></head>");
                default -> html("<head><title>Current public site</title></head>");
            };
        });
        var result = fetcher.resolve("https://old.example.org/");
        assertEquals(List.of("https://old.example.org/", "https://middle.example.org/", "https://later.example.org/", "https://current.example.org/"), visited);
        assertEquals("https://current.example.org", result.finalOrigin());
        assertEquals(List.of("HTTP_REDIRECT", "META_REFRESH", "HTML_SUCCESSOR"), result.chain().stream().map(SafeFetcher.Continuation::kind).toList());
        assertEquals(4, result.hops().size());
        assertEquals("UNVERIFIED", result.identity()); assertEquals("UNKNOWN", result.threatStatus());
    }

    @Test void existingProbeDoesNotStartFollowingHtmlOrChangeItsContract() throws Exception {
        List<String> hosts = new ArrayList<>();
        var fetcher = fetcher((url, addresses, cap, deadline) -> {
            hosts.add(url.getHost());
            return url.getPath().equals("/robots.txt") ? robots() : html("<meta http-equiv='refresh' content='0;url=https://other.example.org/'>");
        });
        assertEquals("https://old.example.org", fetcher.probe("https://old.example.org/").finalOrigin());
        assertEquals(List.of("old.example.org", "old.example.org"), hosts);
    }

    @Test void canonicalIsOnlyAHintAndNeverBecomesAnAutomaticNextHop() throws Exception {
        List<String> visited = new ArrayList<>();
        var fetcher = fetcher((url, addresses, cap, deadline) -> {
            visited.add(url.getHost());
            return url.getPath().equals("/robots.txt") ? robots() : html("<head><link rel='canonical' href='https://canonical.example.org/docs/'></head>");
        });
        var result = fetcher.resolve("https://old.example.org/");
        assertEquals("https://old.example.org", result.finalOrigin()); assertTrue(result.chain().isEmpty());
        assertEquals(List.of(new SafeFetcher.Hint("https://canonical.example.org", "CANONICAL_HINT")), result.hints());
        assertEquals(List.of("old.example.org", "old.example.org"), visited);
    }

    @Test void doesNotExecuteScriptsOrFollowCommentsTemplateAndBodyPointers() throws Exception {
        var fetcher = fetcher((url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? robots() : html("<head><!-- <meta http-equiv='refresh' content='0;url=https://comment.example.org/'> --><script>location='https://script.example.org/'</script><template><meta http-equiv='refresh' content='0;url=https://template.example.org/'></template></head><body><meta http-equiv='refresh' content='0;url=https://body.example.org/'></body>"));
        var result = fetcher.resolve("https://old.example.org/");
        assertTrue(result.chain().isEmpty()); assertEquals("https://old.example.org", result.finalOrigin());
    }

    @ParameterizedTest @ValueSource(strings={"http://other.example.org/", "https://other.example.org/?token=secret", "https://other.example.org/account/", "https://other.example.org:8443/", "https://user:secret@other.example.org/", "https://localhost/"})
    void rejectsUnsafeMetadataBeforeContact(String target) {
        var fetcher = fetcher((url, addresses, cap, deadline) -> {
            assertEquals("old.example.org", url.getHost());
            return url.getPath().equals("/robots.txt") ? robots() : html("<meta http-equiv='refresh' content='0;url=" + target + "'>");
        });
        assertEquals("UNSAFE_CONTINUATION", assertThrows(SafeFetcher.ProbeFailure.class, () -> fetcher.resolve("https://old.example.org/")).code);
    }

    @Test void validatesAllAddressesAtEachDiscoveredHopAndRefusesPrivateCanonicalHints() throws Exception {
        List<String> contacted = new ArrayList<>();
        var fetcher = new SafeFetcher(host -> host.equals("private.example.org") ? new InetAddress[]{InetAddress.getByName("1.1.1.1"), InetAddress.getByName("169.254.169.254")} : publicDns(host),
                (url, addresses, cap, deadline) -> {
                    contacted.add(url.getHost());
                    return url.getPath().equals("/robots.txt") ? robots() : html("<head><link rel='canonical' href='https://private.example.org/'><meta http-equiv='refresh' content='0;url=https://private.example.org/'></head>");
                }, Duration.ZERO);
        assertEquals("NON_PUBLIC_ADDRESS", assertThrows(SafeFetcher.ProbeFailure.class, () -> fetcher.resolve("https://old.example.org/")).code);
        assertFalse(contacted.contains("private.example.org"));
        var hintsOnly = new SafeFetcher(host -> host.equals("private.example.org") ? new InetAddress[]{InetAddress.getByName("127.0.0.1")} : publicDns(host),
                (url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? robots() : html("<link rel='canonical' href='https://private.example.org/'>"), Duration.ZERO);
        assertTrue(hintsOnly.resolve("https://old.example.org/").hints().isEmpty());
    }

    @Test void conflictingExplicitPointersAbstainRatherThanChooseOne() {
        var fetcher = fetcher((url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? robots() : html("<head><meta http-equiv='refresh' content='0;url=https://one.example.org/'><link rel='web-switcher-successor' href='https://two.example.org/'></head>"));
        assertEquals("AMBIGUOUS_CONTINUATION", assertThrows(SafeFetcher.ProbeFailure.class, () -> fetcher.resolve("https://old.example.org/")).code);
    }

    @Test void detectsMetadataCyclesAndSharesTheHttpHopLimit() {
        var cycle = fetcher((url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? robots() : html("<meta http-equiv='refresh' content='0;url=https://" + (url.getHost().equals("old.example.org") ? "next.example.org" : "old.example.org") + "/'>"));
        assertEquals("REDIRECT_CYCLE", assertThrows(SafeFetcher.ProbeFailure.class, () -> cycle.resolve("https://old.example.org/")).code);
        var counter = new java.util.concurrent.atomic.AtomicInteger();
        var limit = fetcher((url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? robots() : html("<meta http-equiv='refresh' content='0;url=/next" + counter.incrementAndGet() + "'>"));
        assertEquals("REDIRECT_LIMIT", assertThrows(SafeFetcher.ProbeFailure.class, () -> limit.resolve("https://old.example.org/")).code);
    }

    @Test void robotsPolicyStillAppliesToDiscoveredSuccessors() {
        var fetcher = fetcher((url, addresses, cap, deadline) -> {
            if (url.getHost().equals("next.example.org")) {
                assertEquals("/robots.txt", url.getPath());
                return new SafeFetcher.Response(200, null, "text/plain", "User-agent: *\nDisallow: /".getBytes(StandardCharsets.UTF_8));
            }
            return url.getPath().equals("/robots.txt") ? robots() : html("<meta http-equiv='refresh' content='0;url=https://next.example.org/'>");
        });
        assertEquals("ROBOTS_DENIED", assertThrows(SafeFetcher.ProbeFailure.class, () -> fetcher.resolve("https://old.example.org/")).code);
    }

    @Test void resolvesRelativePointersAgainstASafeHtmlBaseAndOnlyReturnsOrigins() throws Exception {
        List<String> paths = new ArrayList<>();
        var fetcher = fetcher((url, addresses, cap, deadline) -> {
            if (url.getPath().equals("/robots.txt")) return robots();
            paths.add(url.toString());
            return url.getHost().equals("old.example.org") ? html("<head><base href='https://next.example.org/docs/'><meta http-equiv='refresh' content=\"0;url='Current'\"></head>") : html("<title>Current</title>");
        });
        var result = fetcher.resolve("https://old.example.org/");
        assertEquals(List.of("https://old.example.org/", "https://next.example.org/docs/Current"), paths);
        assertEquals("https://next.example.org", result.chain().getFirst().destinationOrigin());
    }

    @Test void capsMetadataAndDoesNotTreatJsonAsHtml() throws Exception {
        var excessive = fetcher((url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? robots() : html("<meta http-equiv='other'>".repeat(33)));
        assertEquals("METADATA_LIMIT", assertThrows(SafeFetcher.ProbeFailure.class, () -> excessive.resolve("https://old.example.org/")).code);
        var json = fetcher((url, addresses, cap, deadline) -> url.getPath().equals("/robots.txt") ? robots() : new SafeFetcher.Response(200, null, "application/json", "<meta http-equiv='refresh' content='0;url=https://other.example.org/'>".getBytes(StandardCharsets.UTF_8)));
        assertTrue(json.resolve("https://old.example.org/").chain().isEmpty());
    }

    @Test void eachModeHasAnExplicitBoundedDeadline() throws Exception {
        var fetcher = fetcher((url, addresses, cap, deadline) -> {
            long remaining = TimeUnit.NANOSECONDS.toSeconds(deadline - System.nanoTime());
            assertTrue(remaining >= 28 && remaining <= 30);
            return url.getPath().equals("/robots.txt") ? robots() : html("<title>Current</title>");
        });
        fetcher.resolve("https://old.example.org/");
    }
}
