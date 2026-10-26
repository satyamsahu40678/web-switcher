package dev.webswitcher.fetcher;

import java.net.InetAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Deterministic bounded probe orchestration. Its output is evidence, never an approved mapping. */
public final class SafeFetcher {
    static final int MAX_BODY = 1_048_576;
    static final int MAX_ROBOTS = 65_536;
    static final int MAX_REDIRECTS = 3;
    public record Response(int status, String location, String contentType, byte[] body) {}
    public record Hop(String origin, int status) {}
    public record Result(String classification, int httpStatus, String finalOrigin,
                         List<Hop> hops, int bytes, String sha256, String checkedAt,
                         String identity, String threatStatus) {}
    @FunctionalInterface public interface Resolver { InetAddress[] resolve(String host) throws Exception; }
    @FunctionalInterface public interface Transport {
        Response get(URI url, InetAddress[] pinnedAddresses, int maxBytes, long deadlineNanos) throws Exception;
    }
    public static final class ProbeFailure extends Exception {
        public final String code;
        public ProbeFailure(String code) { super(code); this.code = code; }
    }

    private final Resolver resolver;
    private final Transport transport;
    private final long intervalMillis;
    private final Semaphore global = new Semaphore(4);
    private final ConcurrentHashMap<String, HostState> hosts = new ConcurrentHashMap<>();
    private static final class HostState { boolean busy; long lastUse; }

    public SafeFetcher(Resolver resolver, Transport transport) { this(resolver, transport, Duration.ofSeconds(5)); }
    // Package-private zero-delay injection is solely for deterministic tests; no runtime bypass switch.
    SafeFetcher(Resolver resolver, Transport transport, Duration interval) {
        this.resolver = resolver; this.transport = transport; this.intervalMillis = interval.toMillis();
    }

    public Result probe(String input) throws ProbeFailure {
        URI current;
        try { current = PublicUrl.parse(input); } catch (IllegalArgumentException e) { throw new ProbeFailure(e.getMessage()); }
        if (!global.tryAcquire()) throw new ProbeFailure("CONCURRENCY_LIMIT");
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
        Set<URI> seen = new HashSet<>();
        Map<String, String> robotsByOrigin = new HashMap<>();
        List<Hop> hops = new ArrayList<>();
        try {
            for (int count = 0; count <= MAX_REDIRECTS; count++) {
                checkDeadline(deadline);
                if (!seen.add(current)) throw new ProbeFailure("REDIRECT_CYCLE");
                InetAddress[] addresses = resolvePublic(current.getHost());
                String origin = "https://" + current.getHost();
                if (!robotsByOrigin.containsKey(origin)) {
                    Response robots = request(URI.create(origin + "/robots.txt"), addresses, MAX_ROBOTS, deadline);
                    if (robots.status == 404 || robots.status == 410) robotsByOrigin.put(origin, "");
                    else if (robots.status >= 200 && robots.status < 300) {
                        robotsByOrigin.put(origin, new String(robots.body, StandardCharsets.UTF_8));
                    } else if (robots.status == 401 || robots.status == 403) throw new ProbeFailure("ROBOTS_DENIED");
                    else throw new ProbeFailure("ROBOTS_UNAVAILABLE"); // Redirects never bypass robots policy.
                }
                if (!RobotsPolicy.allows(robotsByOrigin.get(origin), current.getRawPath())) throw new ProbeFailure("ROBOTS_DENIED");
                // A fresh validation immediately before each connection; transport can resolve ONLY
                // to this immutable approved list, and must not do an independent DNS lookup.
                addresses = resolvePublic(current.getHost());
                Response response = request(current, addresses, MAX_BODY, deadline);
                hops.add(new Hop(origin, response.status));
                if (Set.of(301, 302, 303, 307, 308).contains(response.status)) {
                    if (count == MAX_REDIRECTS) throw new ProbeFailure("REDIRECT_LIMIT");
                    if (response.location == null || response.location.length() > 2048) throw new ProbeFailure("INVALID_REDIRECT");
                    try { current = PublicUrl.parse(current.resolve(response.location).toString()); }
                    catch (IllegalArgumentException e) { throw new ProbeFailure("UNSAFE_REDIRECT"); }
                    continue;
                }
                String classification = response.status == 403 || response.status == 429 ? "CHALLENGED_OR_THROTTLED"
                        : response.status >= 200 && response.status < 300 ? "REACHABLE" : "HTTP_ERROR";
                return new Result(classification, response.status, origin, List.copyOf(hops), response.body.length,
                        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(response.body)),
                        Instant.now().toString(), "UNVERIFIED", "UNKNOWN");
            }
            throw new ProbeFailure("REDIRECT_LIMIT");
        } catch (ProbeFailure e) { throw e; }
        catch (Exception e) { throw new ProbeFailure("NETWORK_UNAVAILABLE"); }
        finally { global.release(); }
    }

    private InetAddress[] resolvePublic(String host) throws ProbeFailure {
        try { return AddressPolicy.requireAllPublic(resolver.resolve(host)); }
        catch (IllegalArgumentException e) { throw new ProbeFailure(e.getMessage()); }
        catch (Exception e) { throw new ProbeFailure("DNS_UNAVAILABLE"); }
    }

    private Response request(URI url, InetAddress[] addresses, int max, long deadline) throws Exception {
        HostState state;
        synchronized (hosts) {
            long now = System.currentTimeMillis();
            hosts.entrySet().removeIf(entry -> { synchronized (entry.getValue()) { return !entry.getValue().busy && now - entry.getValue().lastUse > 3_600_000; } });
            if (hosts.size() >= 1024 && !hosts.containsKey(url.getHost())) throw new ProbeFailure("HOST_BUDGET_LIMIT");
            state = hosts.computeIfAbsent(url.getHost(), ignored -> new HostState());
            synchronized (state) {
                if (state.busy) throw new ProbeFailure("HOST_CONCURRENCY_LIMIT");
                state.busy = true;
            }
        }
        try {
            long delay;
            synchronized (state) { delay = Math.max(0, state.lastUse + intervalMillis - System.currentTimeMillis()); }
            if (TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime()) <= delay) throw new ProbeFailure("DEADLINE_EXCEEDED");
            if (delay > 0) Thread.sleep(delay);
            checkDeadline(deadline);
            synchronized (state) { state.lastUse = System.currentTimeMillis(); }
            Response response = transport.get(url, addresses.clone(), max, deadline);
            if (response.body == null || response.body.length > max) throw new ProbeFailure("BODY_LIMIT");
            return response;
        } finally { synchronized (state) { state.busy = false; } }
    }

    static void checkDeadline(long deadline) throws ProbeFailure {
        if (System.nanoTime() >= deadline) throw new ProbeFailure("DEADLINE_EXCEEDED");
    }

    public static Resolver boundedSystemResolver() {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(4), runnable -> {
            Thread thread = new Thread(runnable, "fetcher-dns"); thread.setDaemon(true); return thread;
        });
        return host -> {
            Future<InetAddress[]> task = pool.submit(() -> InetAddress.getAllByName(host));
            try { return task.get(2, TimeUnit.SECONDS); }
            catch (TimeoutException e) { task.cancel(true); throw e; }
        };
    }
}
