package dev.webswitcher.api;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.IOException;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.interfaces.RSAPublicKey;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Actual production-profile Spring OIDC code flow, not an injected principal.
 * The identity provider is an isolated HTTP loopback fixture. The application
 * uses real HTTPS with a generated certificate explicitly trusted by the test
 * client; hostname verification, production Secure cookies and CSRF stay on.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class OidcIntegrationTest {
    private static final String CLIENT_ID = "controlled-oidc-client";
    private static final String CLIENT_SECRET = "controlled-fixture-client-secret";
    private static final char[] STORE_PASSWORD = "controlled-tls-store-password".toCharArray();
    private final AtomicReference<Mode> nextMode = new AtomicReference<>(Mode.REVIEWER);
    private final AtomicInteger tokenRequests = new AtomicInteger();
    private final ConcurrentMap<String, Authorization> codes = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Authorization> accessTokens = new ConcurrentHashMap<>();
    private ExecutorService providerThreads;
    private HttpServer provider;
    private ConfigurableApplicationContext app;
    private KeyPair signingKey;
    private KeyPair wrongSigningKey;
    private RSAKey publicJwk;
    private Path temporaryDirectory;
    private SSLContext trustedApplicationTls;
    private String issuer;
    private String base;

    enum Mode {
        REVIEWER, PUBLISHER, UNKNOWN_SUBJECT, INVALID_SIGNATURE, WRONG_ISSUER,
        WRONG_AUDIENCE, WRONG_NONCE, EXPIRED_TOKEN, WRONG_USERINFO_SUBJECT
    }
    record Authorization(String clientId, String redirectUri, String nonce, String subject, Mode mode) {}
    record Browser(HttpClient client, CookieManager cookies) {}
    record LoginAttempt(Browser browser, HttpResponse<String> start, URI callback) {}

    @BeforeAll
    void startProductionApplicationAndControlledIdentityProvider() throws Exception {
        temporaryDirectory = Files.createTempDirectory("web-switcher-oidc-");
        Path keyStorePath = temporaryDirectory.resolve("application-tls.p12");
        generateApplicationCertificate(keyStorePath);
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (var input = Files.newInputStream(keyStorePath)) { keyStore.load(input, STORE_PASSWORD); }
        TrustManagerFactory trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        trust.init(keyStore);
        trustedApplicationTls = SSLContext.getInstance("TLS");
        trustedApplicationTls.init(null, trust.getTrustManagers(), new SecureRandom());

        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        signingKey = generator.generateKeyPair();
        wrongSigningKey = generator.generateKeyPair();
        publicJwk = new RSAKey.Builder((RSAPublicKey) signingKey.getPublic()).keyID("controlled-rsa-key").build();
        provider = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        providerThreads = Executors.newVirtualThreadPerTaskExecutor();
        provider.setExecutor(providerThreads);
        issuer = "http://127.0.0.1:" + provider.getAddress().getPort();
        provider.createContext("/.well-known/openid-configuration", exchange -> json(exchange, Map.of(
                "issuer", issuer,
                "authorization_endpoint", issuer + "/authorize",
                "token_endpoint", issuer + "/token",
                "userinfo_endpoint", issuer + "/userinfo",
                "jwks_uri", issuer + "/jwks",
                "response_types_supported", List.of("code"),
                "subject_types_supported", List.of("public"),
                "id_token_signing_alg_values_supported", List.of("RS256"),
                "token_endpoint_auth_methods_supported", List.of("client_secret_basic"),
                "scopes_supported", List.of("openid", "profile"))));
        provider.createContext("/jwks", exchange -> json(exchange, new JWKSet(publicJwk).toJSONObject()));
        provider.createContext("/authorize", this::authorize);
        provider.createContext("/token", this::token);
        provider.createContext("/userinfo", this::userinfo);
        provider.start();
        try {
            app = new SpringApplicationBuilder(Application.class).run(
                    "--server.port=0", "--server.address=127.0.0.1",
                    "--server.ssl.enabled=true", "--server.ssl.key-store=" + keyStorePath.toUri(),
                    "--server.ssl.key-store-type=PKCS12", "--server.ssl.key-alias=oidc-test",
                    "--server.ssl.key-store-password=" + new String(STORE_PASSWORD),
                    "--spring.datasource.url=jdbc:h2:mem:oidc_production_test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
                    "--spring.datasource.username=sa", "--spring.datasource.password=",
                    "--web-switcher.demo=false", "--web-switcher.runtime-role=api",
                    "--web-switcher.public-origin=https://staging.web-switcher.dev",
                    "--web-switcher.admin-subjects=reviewer-subject",
                    "--web-switcher.publisher-subjects=publisher-subject",
                    "--spring.security.oauth2.client.registration.web.provider=controlled",
                    "--spring.security.oauth2.client.registration.web.client-id=" + CLIENT_ID,
                    "--spring.security.oauth2.client.registration.web.client-secret=" + CLIENT_SECRET,
                    "--spring.security.oauth2.client.registration.web.authorization-grant-type=authorization_code",
                    "--spring.security.oauth2.client.registration.web.scope=openid,profile",
                    "--spring.security.oauth2.client.provider.controlled.issuer-uri=" + issuer,
                    "--logging.level.root=WARN");
            base = "https://127.0.0.1:" + ((WebServerApplicationContext) app).getWebServer().getPort();
        } catch (Exception error) {
            stop();
            throw error;
        }
    }

    private void generateApplicationCertificate(Path keyStore) throws Exception {
        Path keytool = Path.of(System.getProperty("java.home"), "bin", "keytool");
        Process process = new ProcessBuilder(keytool.toString(), "-genkeypair", "-noprompt",
                "-alias", "oidc-test", "-keyalg", "RSA", "-keysize", "2048",
                "-dname", "CN=localhost", "-ext", "SAN=DNS:localhost,IP:127.0.0.1",
                "-validity", "2", "-storetype", "PKCS12", "-keystore", keyStore.toString(),
                "-storepass", new String(STORE_PASSWORD)).redirectErrorStream(true).start();
        // This noninteractive command emits only a short status message, never
        // key bytes. Bound its lifetime before reading its output.
        boolean completed = process.waitFor(30, TimeUnit.SECONDS);
        if (!completed) process.destroyForcibly();
        assertTrue(completed, "Fixture certificate generation timed out");
        process.getInputStream().readAllBytes();
        assertEquals(0, process.exitValue(), "Could not generate the test TLS certificate");
        try { Files.setPosixFilePermissions(keyStore, java.nio.file.attribute.PosixFilePermissions.fromString("rw-------")); }
        catch (UnsupportedOperationException ignored) { /* Not required on non-POSIX developer systems. */ }
    }

    @AfterAll
    void stop() throws Exception {
        if (app != null) { app.close(); app = null; }
        if (provider != null) { provider.stop(0); provider = null; }
        if (providerThreads != null) providerThreads.shutdownNow();
        if (temporaryDirectory != null && Files.exists(temporaryDirectory)) {
            try (var paths = Files.walk(temporaryDirectory)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
    }

    private Browser browser() {
        CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        return new Browser(HttpClient.newBuilder().sslContext(trustedApplicationTls).cookieHandler(cookies)
                .followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(5)).build(), cookies);
    }
    private HttpResponse<String> get(Browser browser, URI uri) throws Exception {
        return browser.client().send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10)).GET().build(), HttpResponse.BodyHandlers.ofString());
    }
    private HttpResponse<String> get(Browser browser, String path) throws Exception { return get(browser, URI.create(base + path)); }
    private HttpResponse<String> post(Browser browser, String path, String csrf) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json");
        if (csrf != null) request.header("X-CSRF-TOKEN", csrf);
        return browser.client().send(request.POST(HttpRequest.BodyPublishers.ofString("{}")).build(), HttpResponse.BodyHandlers.ofString());
    }
    @SuppressWarnings("unchecked")
    private Map<String, Object> session(Browser browser) throws Exception {
        var response = get(browser, "/v1/session");
        assertEquals(200, response.statusCode());
        var result = Signer.JSON.readValue(response.body(), Map.class);
        assertEquals(false, result.get("demo"), "The test must exercise the production authentication branch");
        return result;
    }
    private LoginAttempt begin(Mode mode) throws Exception {
        nextMode.set(mode);
        Browser browser = browser();
        var start = get(browser, "/oauth2/authorization/web");
        assertEquals(302, start.statusCode());
        URI authorizationEndpoint = URI.create(start.headers().firstValue("Location").orElseThrow());
        assertEquals(issuer, authorizationEndpoint.getScheme() + "://" + authorizationEndpoint.getAuthority());
        var authorizeResponse = get(browser, authorizationEndpoint);
        assertEquals(302, authorizeResponse.statusCode());
        URI callback = URI.create(authorizeResponse.headers().firstValue("Location").orElseThrow());
        assertTrue(callback.toString().startsWith(base + "/login/oauth2/code/web?"));
        return new LoginAttempt(browser, start, callback);
    }
    private HttpResponse<String> finish(LoginAttempt attempt) throws Exception { return get(attempt.browser(), attempt.callback()); }
    private static void assertFailed(LoginAttempt attempt, HttpResponse<String> response) {
        assertEquals(302, response.statusCode());
        assertTrue(response.headers().firstValue("Location").orElse("").contains("error"), "OIDC failure must not become successful authentication");
    }

    @Test
    void reviewerAuthorizationCodeFlowUsesSecureSessionRotationAndCsrf() throws Exception {
        var attempt = begin(Mode.REVIEWER);
        String before = attempt.browser().cookies().getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("JSESSIONID")).findFirst().orElseThrow().getValue();
        String setCookie = attempt.start().headers().firstValue("Set-Cookie").orElseThrow();
        assertTrue(setCookie.contains("Secure") && setCookie.contains("HttpOnly") && setCookie.contains("SameSite=Lax"));
        var response = finish(attempt);
        assertEquals(302, response.statusCode());
        var user = session(attempt.browser());
        assertEquals(true, user.get("authenticated"));
        assertEquals("reviewer-subject", user.get("username"));
        assertEquals(List.of("REVIEWER"), user.get("roles"));
        String after = attempt.browser().cookies().getCookieStore().getCookies().stream()
                .filter(cookie -> cookie.getName().equals("JSESSIONID")).findFirst().orElseThrow().getValue();
        assertFalse(before.equals(after), "OIDC success must rotate the session identifier");
        assertEquals(200, get(attempt.browser(), "/v1/admin/candidates").statusCode());
        assertEquals(403, post(attempt.browser(), "/v1/admin/releases", user.get("csrfToken").toString()).statusCode());
        assertEquals(403, post(attempt.browser(), "/v1/admin/logout", null).statusCode());
        assertEquals(200, post(attempt.browser(), "/v1/admin/logout", user.get("csrfToken").toString()).statusCode());
        assertEquals(false, session(attempt.browser()).get("authenticated"));
    }

    @Test
    void publisherSubjectGetsOnlyPublishingRoleAndNoDemoLogin() throws Exception {
        var attempt = begin(Mode.PUBLISHER);
        assertEquals(302, finish(attempt).statusCode());
        var user = session(attempt.browser());
        assertEquals(true, user.get("authenticated"));
        assertEquals("publisher-subject", user.get("username"));
        assertEquals(List.of("PUBLISHER"), user.get("roles"));
        assertEquals(200, get(attempt.browser(), "/v1/admin/releases").statusCode());
        assertEquals(403, post(attempt.browser(), "/v1/admin/candidates/nonexistent/decisions", user.get("csrfToken").toString()).statusCode());
        // The keyless public API authenticates a publisher but cannot sign.
        assertEquals(503, post(attempt.browser(), "/v1/admin/releases", user.get("csrfToken").toString()).statusCode());
        assertEquals(403, post(browser(), "/v1/admin/login", null).statusCode(), "Production must not expose the known demo form login");
    }

    @Test
    void validlySignedUnknownSubjectCannotAuthenticate() throws Exception {
        var attempt = begin(Mode.UNKNOWN_SUBJECT);
        assertFailed(attempt, finish(attempt));
        assertEquals(false, session(attempt.browser()).get("authenticated"));
        assertEquals(401, get(attempt.browser(), "/v1/admin/candidates").statusCode());
    }

    @ParameterizedTest
    @EnumSource(value = Mode.class, names = {"INVALID_SIGNATURE", "WRONG_ISSUER", "WRONG_AUDIENCE", "WRONG_NONCE", "EXPIRED_TOKEN", "WRONG_USERINFO_SUBJECT"})
    void invalidOidcAssertionsNeverGrantAnAllowlistedSubject(Mode mode) throws Exception {
        var attempt = begin(mode);
        assertFailed(attempt, finish(attempt));
        assertEquals(false, session(attempt.browser()).get("authenticated"), mode.name());
        assertEquals(401, get(attempt.browser(), "/v1/admin/candidates").statusCode());
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void missingOrTamperedAuthorizationStateIsRejectedBeforeTokenExchange(boolean tamper) throws Exception {
        var attempt = begin(Mode.REVIEWER);
        Map<String, String> query = form(attempt.callback().getRawQuery());
        if (tamper) query.put("state", "different-state"); else query.remove("state");
        URI callback = URI.create(attempt.callback().toString().split("\\?", 2)[0] + "?" + encodeForm(query));
        int before = tokenRequests.get();
        assertFailed(attempt, get(attempt.browser(), callback));
        assertEquals(before, tokenRequests.get(), "Invalid state must stop before exchanging the code");
        assertEquals(false, session(attempt.browser()).get("authenticated"));
    }

    private void authorize(HttpExchange exchange) throws IOException {
        var query = form(exchange.getRequestURI().getRawQuery());
        if (!CLIENT_ID.equals(query.get("client_id")) || !"code".equals(query.get("response_type"))
                || query.get("nonce") == null || query.get("state") == null) { reply(exchange, 400, Map.of("error", "invalid_request")); return; }
        Mode mode = nextMode.get();
        String subject = mode == Mode.PUBLISHER ? "publisher-subject" : mode == Mode.UNKNOWN_SUBJECT ? "not-enrolled" : "reviewer-subject";
        String code = UUID.randomUUID().toString();
        codes.put(code, new Authorization(CLIENT_ID, query.get("redirect_uri"), query.get("nonce"), subject, mode));
        String redirect = query.get("redirect_uri") + "?" + encodeForm(Map.of("code", code, "state", query.get("state")));
        exchange.getResponseHeaders().set("Location", redirect);
        exchange.sendResponseHeaders(302, -1); exchange.close();
    }
    private void token(HttpExchange exchange) throws IOException {
        tokenRequests.incrementAndGet();
        String expected = "Basic " + Base64.getEncoder().encodeToString((CLIENT_ID + ":" + CLIENT_SECRET).getBytes(StandardCharsets.UTF_8));
        if (!expected.equals(exchange.getRequestHeaders().getFirst("Authorization"))) { reply(exchange, 401, Map.of("error", "invalid_client")); return; }
        var data = form(new String(exchange.getRequestBody().readNBytes(8192), StandardCharsets.UTF_8));
        Authorization authorization = codes.remove(data.get("code"));
        if (authorization == null || !"authorization_code".equals(data.get("grant_type")) || !authorization.redirectUri().equals(data.get("redirect_uri"))) { reply(exchange, 400, Map.of("error", "invalid_grant")); return; }
        try {
            Instant now = Instant.now();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(authorization.mode() == Mode.WRONG_ISSUER ? "https://untrusted-issuer.invalid" : issuer)
                    .subject(authorization.subject())
                    .audience(authorization.mode() == Mode.WRONG_AUDIENCE ? "different-client" : CLIENT_ID)
                    .issueTime(Date.from(authorization.mode() == Mode.EXPIRED_TOKEN ? now.minusSeconds(7200) : now.minusSeconds(5)))
                    .expirationTime(Date.from(authorization.mode() == Mode.EXPIRED_TOKEN ? now.minusSeconds(3600) : now.plusSeconds(120)))
                    .claim("nonce", authorization.mode() == Mode.WRONG_NONCE ? "different-nonce" : authorization.nonce()).build();
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(publicJwk.getKeyID()).build(), claims);
            jwt.sign(new RSASSASigner(authorization.mode() == Mode.INVALID_SIGNATURE ? wrongSigningKey.getPrivate() : signingKey.getPrivate()));
            String access = UUID.randomUUID().toString(); accessTokens.put(access, authorization);
            json(exchange, Map.of("access_token", access, "token_type", "Bearer", "expires_in", 120, "scope", "openid profile", "id_token", jwt.serialize()));
        } catch (Exception error) { reply(exchange, 500, Map.of("error", "fixture_signing_failed")); }
    }
    private void userinfo(HttpExchange exchange) throws IOException {
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        Authorization authorization = header != null && header.startsWith("Bearer ") ? accessTokens.get(header.substring(7)) : null;
        if (authorization == null) { reply(exchange, 401, Map.of("error", "invalid_token")); return; }
        json(exchange, Map.of("sub", authorization.mode() == Mode.WRONG_USERINFO_SUBJECT ? "different-subject" : authorization.subject(), "name", "Controlled test identity"));
    }
    private static Map<String, String> form(String data) {
        var result = new LinkedHashMap<String, String>();
        if (data == null || data.isEmpty()) return result;
        for (String part : data.split("&")) {
            String[] pieces = part.split("=", 2);
            result.put(URLDecoder.decode(pieces[0], StandardCharsets.UTF_8), pieces.length == 2 ? URLDecoder.decode(pieces[1], StandardCharsets.UTF_8) : "");
        }
        return result;
    }
    private static String encodeForm(Map<String, String> values) {
        return values.entrySet().stream().map(entry -> URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8) + "=" + URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8)).collect(java.util.stream.Collectors.joining("&"));
    }
    private static void json(HttpExchange exchange, Object body) throws IOException { reply(exchange, 200, body); }
    private static void reply(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] bytes = Signer.JSON.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes); exchange.close();
    }
}
