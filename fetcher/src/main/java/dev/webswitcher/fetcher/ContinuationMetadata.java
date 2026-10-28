package dev.webswitcher.fetcher;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;

/** Static head metadata only. No JavaScript, names, logos or generic links imply continuity. */
final class ContinuationMetadata {
    record Pointer(URI target, String kind) {}
    record Parsed(Pointer next, List<URI> canonicalHints) {}
    private static final Pattern REFRESH = Pattern.compile("(?is)^\\s*(\\d{1,2}(?:\\.\\d{1,4})?)\\s*;\\s*url\\s*=\\s*(.*?)\\s*$");

    static Parsed parse(URI current, SafeFetcher.Response response) throws SafeFetcher.ProbeFailure {
        String type = response.contentType() == null ? "" : response.contentType().split(";", 2)[0].trim();
        if (!type.equalsIgnoreCase("text/html") && !type.equalsIgnoreCase("application/xhtml+xml")) return new Parsed(null, List.of());
        var document = Jsoup.parse(new String(response.body(), StandardCharsets.UTF_8), current.toString());
        URI base = current;
        var baseElement = document.head().selectFirst("base[href]");
        if (baseElement != null) {
            try { base = PublicUrl.parse(current.resolve(baseElement.attr("href").strip()).toString()); }
            catch (IllegalArgumentException ignored) { throw new SafeFetcher.ProbeFailure("UNSAFE_CONTINUATION_BASE"); }
        }
        var pointers = new LinkedHashMap<URI, String>();
        var hints = new ArrayList<URI>();
        int count = 0;
        for (var element : document.head().select("meta[http-equiv], link[rel][href]")) {
            if (element.parents().stream().anyMatch(parent -> Set.of("template", "noscript", "script", "style", "svg", "math").contains(parent.normalName()))) continue;
            if (++count > 32) throw new SafeFetcher.ProbeFailure("METADATA_LIMIT");
            String raw = null, kind = null;
            if (element.normalName().equals("meta") && element.attr("http-equiv").strip().equalsIgnoreCase("refresh")) {
                var match = REFRESH.matcher(element.attr("content"));
                if (!match.matches() || Double.parseDouble(match.group(1)) > 30) continue;
                raw = match.group(2).strip();
                if (raw.length() >= 2 && ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'")))) raw = raw.substring(1, raw.length() - 1);
                kind = "META_REFRESH";
            } else if (element.normalName().equals("link")) {
                Set<String> relations = Set.copyOf(List.of(element.attr("rel").strip().toLowerCase(Locale.ROOT).split("\\s+")));
                if (relations.contains("web-switcher-successor")) { raw = element.attr("href").strip(); kind = "HTML_SUCCESSOR"; }
                else if (relations.contains("canonical") && hints.size() < 4) {
                    try {
                        URI hint = PublicUrl.parse(base.resolve(element.attr("href").strip()).toString());
                        if (!hints.contains(hint)) hints.add(hint);
                    } catch (IllegalArgumentException ignored) { /* Unsafe hints are never followed or returned. */ }
                }
            }
            if (kind != null) {
                try {
                    if (raw.isEmpty()) throw new IllegalArgumentException();
                    URI target = PublicUrl.parse(base.resolve(raw).toString());
                    pointers.putIfAbsent(target, kind);
                } catch (IllegalArgumentException ignored) { throw new SafeFetcher.ProbeFailure("UNSAFE_CONTINUATION"); }
            }
        }
        if (pointers.size() > 1) throw new SafeFetcher.ProbeFailure("AMBIGUOUS_CONTINUATION");
        Pointer next = pointers.isEmpty() ? null : new Pointer(pointers.keySet().iterator().next(), pointers.values().iterator().next());
        return new Parsed(next, List.copyOf(hints));
    }
}
