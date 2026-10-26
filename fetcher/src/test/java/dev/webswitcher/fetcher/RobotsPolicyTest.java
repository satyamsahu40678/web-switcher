package dev.webswitcher.fetcher;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class RobotsPolicyTest {
    @Test void specificAgentOverridesWildcardAndLongestPathWins() {
        String robots = "User-agent: *\nDisallow: /\nUser-agent: WebSwitcherBot\nDisallow: /private\nAllow: /private/public\n";
        assertTrue(RobotsPolicy.allows(robots, "/docs/"));
        assertFalse(RobotsPolicy.allows(robots, "/private/"));
        assertTrue(RobotsPolicy.allows(robots, "/private/public/"));
    }
    @Test void denyAndAllowTieFavorsAllowAndEmptyDisallowDoesNotDeny() {
        assertTrue(RobotsPolicy.allows("User-agent: *\nDisallow:\n", "/docs/"));
        assertTrue(RobotsPolicy.allows("User-agent: *\nDisallow: /docs\nAllow: /docs\n", "/docs"));
    }
    @Test void handlesGlobAndEndAnchors() {
        String robots = "User-agent: *\nDisallow: /private*\nDisallow: /*.pdf$\n";
        assertFalse(RobotsPolicy.allows(robots, "/private/secret"));
        assertFalse(RobotsPolicy.allows(robots, "/reports/file.pdf"));
        assertTrue(RobotsPolicy.allows(robots, "/reports/file.pdf.html"));
        assertFalse(RobotsPolicy.allows("User-agent: *\nDisallow: /private*$\n", "/private/secret"));
    }
    @Test void malformedOrOverlongRulesFailClosed() {
        assertFalse(RobotsPolicy.allows("User-agent: *\nDisallow: /%2f\n", "/"));
        assertFalse(RobotsPolicy.allows("User-agent: *\nDisallow: /" + "x".repeat(2048), "/"));
    }
}
