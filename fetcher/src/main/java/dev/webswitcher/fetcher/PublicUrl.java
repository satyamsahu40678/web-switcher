package dev.webswitcher.fetcher;

import java.net.IDN;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Set;

public final class PublicUrl {
    private static final Set<String> SENSITIVE = Set.of("login", "signin", "oauth", "authorize", "account", "reset", "password", "checkout", "payment", "download", "logout", "token");
    private PublicUrl() {}

    public static URI parse(String input) {
        if (input == null || input.isBlank() || input.length() > 2048 || input.contains("\\")
                || input.chars().anyMatch(c -> c <= 32 || c == 127)) throw new IllegalArgumentException("INVALID_URL");
        try {
            URI url = new URI(input);
            if (!"https".equalsIgnoreCase(url.getScheme()) || url.getRawUserInfo() != null
                    || url.getRawQuery() != null || url.getRawFragment() != null
                    || (url.getPort() != -1 && url.getPort() != 443)) throw new IllegalArgumentException("UNSUPPORTED_URL");
            String host = url.getHost();
            if (host == null || host.isBlank() || host.length() > 253 || host.endsWith(".") || host.contains(":")) throw new IllegalArgumentException("INVALID_HOST");
            host = IDN.toASCII(host, IDN.USE_STD3_ASCII_RULES).toLowerCase(Locale.ROOT);
            for (String suffix : new String[] {"localhost", ".localhost", ".local", ".internal", ".test", ".invalid", ".example"}) {
                if (host.equals(suffix) || host.endsWith(suffix)) throw new IllegalArgumentException("RESERVED_HOST");
            }
            String path = url.getRawPath();
            if (path == null || path.isEmpty()) path = "/";
            if (path.length() > 1024 || path.contains("//") || !url.normalize().getRawPath().equals(url.getRawPath())) throw new IllegalArgumentException("UNSUPPORTED_PATH");
            String lower = path.toLowerCase(Locale.ROOT);
            if (lower.contains("%") || lower.chars().anyMatch(c -> c > 127)) throw new IllegalArgumentException("ENCODED_PATH_UNSUPPORTED");
            for (String segment : lower.split("/")) if (SENSITIVE.contains(segment)) throw new IllegalArgumentException("SENSITIVE_PATH");
            return URI.create("https://" + host + path);
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("INVALID_URL");
        }
    }
}
