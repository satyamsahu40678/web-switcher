package dev.webswitcher.fetcher;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Bounded conservative RFC 9309 path matching. Unknown directives do not authorize requests. */
final class RobotsPolicy {
    private record Rule(String path, boolean allow) {}
    private record Group(List<String> agents, List<Rule> rules) {}

    static boolean allows(String robots, String path) {
        List<Group> groups = new ArrayList<>();
        List<String> agents = new ArrayList<>(); List<Rule> rules = new ArrayList<>(); boolean rulesSeen = false;
        int count = 0;
        for (String raw : robots.split("\\R", -1)) {
            if (++count > 2000 || raw.length() > 1024) return false;
            String line = raw.split("#", 2)[0].trim();
            int colon = line.indexOf(':'); if (colon < 0) continue;
            String key = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(colon + 1).trim();
            if (key.equals("user-agent")) {
                if (rulesSeen) { groups.add(new Group(agents, rules)); agents = new ArrayList<>(); rules = new ArrayList<>(); rulesSeen = false; }
                agents.add(value.toLowerCase(Locale.ROOT));
            } else if ((key.equals("allow") || key.equals("disallow")) && !agents.isEmpty()) {
                rulesSeen = true;
                if (value.isEmpty()) continue;
                if (value.length() > 256 || !value.startsWith("/") || value.contains("%")) return false;
                rules.add(new Rule(value, key.equals("allow")));
            }
        }
        groups.add(new Group(agents, rules));
        int bestAgentLength = groups.stream().flatMap(g -> g.agents.stream())
                .filter(a -> !a.isEmpty() && !a.equals("*") && "webswitcherbot".contains(a))
                .mapToInt(String::length).max().orElse(0);
        Rule selected = null;
        for (Group group : groups) {
            boolean applies = bestAgentLength == 0 ? group.agents.contains("*")
                    : group.agents.stream().anyMatch(a -> a.length() == bestAgentLength && "webswitcherbot".contains(a));
            if (!applies) continue;
            for (Rule rule : group.rules) if (matches(rule.path, path)
                    && (selected == null || specificity(rule.path) > specificity(selected.path)
                    || (specificity(rule.path) == specificity(selected.path) && rule.allow))) selected = rule;
        }
        return selected == null || selected.allow;
    }

    private static int specificity(String path) { return path.replace("*", "").replace("$", "").length(); }

    // Linear glob matching with one remembered star; trailing '$' anchors otherwise prefix matching.
    private static boolean matches(String pattern, String text) {
        boolean anchored = pattern.endsWith("$");
        if (anchored) pattern = pattern.substring(0, pattern.length() - 1);
        int p = 0, t = 0, star = -1, resume = -1;
        while (t < text.length()) {
            if (p == pattern.length()) {
                if (!anchored) return true;
                if (star >= 0) { p = star + 1; t = ++resume; continue; }
                return false;
            }
            if (pattern.charAt(p) == text.charAt(t)) { p++; t++; }
            else if (pattern.charAt(p) == '*') { star = p++; resume = t; }
            else if (star >= 0) { p = star + 1; t = ++resume; }
            else return false;
        }
        while (p < pattern.length() && pattern.charAt(p) == '*') p++;
        return p == pattern.length();
    }
}
