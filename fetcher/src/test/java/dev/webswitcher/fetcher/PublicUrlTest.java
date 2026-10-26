package dev.webswitcher.fetcher;

import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import static org.junit.jupiter.api.Assertions.*;

class PublicUrlTest {
    static Stream<String> unsafe() {
        return Stream.of("http://example.org/", "file:///etc/passwd", "https://user:pass@example.org/", "https://example.org:8443/",
                "https://example.org/?token=secret", "https://example.org/#token", "https://localhost/", "https://a.local/",
                "https://a.test/", "https://example.org./", "https://[::1]/", "https://example.org/account/", "https://example.org/docs/../account/",
                "https://example.org/%2e%2e/", "https://example.org\\@evil.org/", "https://example.org//evil/", "https://example.org/a b");
    }
    @ParameterizedTest @MethodSource("unsafe") void rejectsUnsafeOrAmbiguous(String input) {
        assertThrows(IllegalArgumentException.class, () -> PublicUrl.parse(input));
    }
    @Test void normalizesSchemeHostAndPortWithoutChangingPathCase() {
        assertEquals("https://example.org/Docs/Guide", PublicUrl.parse("HTTPS://EXAMPLE.ORG:443/Docs/Guide").toString());
        assertEquals("https://example.org/", PublicUrl.parse("https://example.org").toString());
    }
}
