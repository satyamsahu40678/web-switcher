package dev.webswitcher.api;

import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ApiIntegrationTest {
 ConfigurableApplicationContext app;String base;HttpClient client;
 @BeforeAll void start(){
  String database=System.getenv().getOrDefault("TEST_DATABASE_URL","jdbc:h2:mem:api_test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
  app=new SpringApplicationBuilder(Application.class).profiles("demo").run("--server.port=0","--spring.datasource.url="+database,"--spring.datasource.username="+System.getenv().getOrDefault("TEST_DATABASE_USER","sa"),"--spring.datasource.password="+System.getenv().getOrDefault("TEST_DATABASE_PASSWORD",""),"--logging.level.root=WARN");
  int port=((WebServerApplicationContext)app).getWebServer().getPort();base="http://127.0.0.1:"+port;
  client=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
 }
 @AfterAll void stop(){if(app!=null)app.close();}
 HttpResponse<String> get(String path)throws Exception{return client.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString());}
 HttpResponse<String> post(String path,String json,String csrf)throws Exception{
  var builder=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json");if(csrf!=null)builder.header("X-CSRF-TOKEN",csrf);
  return client.send(builder.POST(HttpRequest.BodyPublishers.ofString(json)).build(),HttpResponse.BodyHandlers.ofString());
 }
 @SuppressWarnings("unchecked") Map<String,Object> json(String text)throws Exception{return Signer.JSON.readValue(text,Map.class);}
 String csrf()throws Exception{return json(get("/v1/session").body()).get("csrfToken").toString();}
 void login(String user)throws Exception{
  String csrf=csrf();var response=client.send(HttpRequest.newBuilder(URI.create(base+"/v1/admin/login")).header("Content-Type","application/x-www-form-urlencoded").header("X-CSRF-TOKEN",csrf).POST(HttpRequest.BodyPublishers.ofString("username="+user+"&password=demo-password")).build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());
 }
 void logout()throws Exception{assertEquals(200,post("/v1/admin/logout","{}",csrf()).statusCode());}
 @Test @Order(1) void signedCatalogAndConditionalRead()throws Exception{
  var response=get("/v1/catalog/current");assertEquals(200,response.statusCode());String[] parts=response.body().split("\\.");assertEquals(3,parts.length);assertEquals(64,Base64.getUrlDecoder().decode(parts[2]).length);
  PublicKey key=KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(Files.readAllBytes(Path.of("data/demo-registry-public.der"))));
  Signature verifier=Signature.getInstance("SHA256withECDSAinP1363Format");verifier.initVerify(key);verifier.update((parts[0]+"."+parts[1]).getBytes(StandardCharsets.US_ASCII));assertTrue(verifier.verify(Base64.getUrlDecoder().decode(parts[2])));
  var payload=json(new String(Base64.getUrlDecoder().decode(parts[1]),StandardCharsets.UTF_8));assertEquals(1,payload.get("bundleSequence"));assertEquals(1,((List<?>)payload.get("aliases")).size());
  var conditional=client.send(HttpRequest.newBuilder(URI.create(base+"/v1/catalog/current")).header("If-None-Match",response.headers().firstValue("ETag").orElseThrow()).build(),HttpResponse.BodyHandlers.ofString());assertEquals(304,conditional.statusCode());assertTrue(conditional.body().isEmpty());
 }
 @Test @Order(2) void publicInputPrivacyAndAuthBoundaries()throws Exception{
  assertEquals(200,get("/health/ready").statusCode());assertEquals(401,get("/v1/admin/candidates").statusCode());
  String oversized="{\"hostname\":\""+"x".repeat(33000)+"\"}";assertEquals(413,post("/v1/lookups",oversized,null).statusCode());
  var chunked=HttpRequest.newBuilder(URI.create(base+"/v1/lookups")).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofInputStream(()->new java.io.ByteArrayInputStream(oversized.getBytes(StandardCharsets.UTF_8)))).build();assertEquals(413,client.send(chunked,HttpResponse.BodyHandlers.ofString()).statusCode());
  assertEquals(400,post("/v1/lookups","{\"hostname\":\"https://old.web-switcher.test/private?token=x\"}",null).statusCode());
  assertEquals(400,post("/v1/lookups","{\"hostname\":\"old.example\",\"hostname\":\"evil.example\"}",null).statusCode());
  assertEquals(400,post("/v1/lookups","{\"hostname\":\"old.example\",\"fullUrl\":\"secret\"}",null).statusCode());
  assertEquals("verified",json(post("/v1/lookups","{\"hostname\":\"old.web-switcher.test\"}",null).body()).get("status"));
  assertEquals("unknown",json(post("/v1/lookups","{\"hostname\":\"unknown.example\"}",null).body()).get("status"));
 }
 @Test @Order(3) void reviewDoesNotActivateBeforeIndependentPublication()throws Exception{
  var report=post("/v1/reports","{\"sourceHost\":\"old.project.test\",\"proposedHost\":\"current.project.test\",\"reason\":\"Controlled continuity fixture for review\"}",null);assertEquals(202,report.statusCode());String id=json(report.body()).get("id").toString();
  login("demo-reviewer");assertEquals(403,post("/v1/admin/candidates/"+id+"/decisions","{}",null).statusCode());
  var review=post("/v1/admin/candidates/"+id+"/decisions","{\"version\":0,\"decision\":\"approved\",\"reason\":\"Controlled operator continuity confirmed\"}",csrf());assertEquals(200,review.statusCode(),review.body());
  assertEquals(409,post("/v1/admin/candidates/"+id+"/decisions","{\"version\":0,\"decision\":\"approved\",\"reason\":\"Stale duplicate review rejected\"}",csrf()).statusCode());
  assertEquals(403,post("/v1/admin/releases","{}",csrf()).statusCode());
  assertEquals("unknown",json(post("/v1/lookups","{\"hostname\":\"old.project.test\"}",null).body()).get("status"));logout();
  login("demo-publisher");var release=post("/v1/admin/releases","{}",csrf());assertEquals(200,release.statusCode(),release.body());assertEquals(2,json(release.body()).get("sequence"));
  assertEquals("verified",json(post("/v1/lookups","{\"hostname\":\"old.project.test\"}",null).body()).get("status"));assertEquals(200,get("/v1/catalog/1").statusCode());assertTrue(get("/v1/admin/audit").body().contains("CATALOG_PUBLISHED"));logout();
 }
 @Test @Order(4) void revocationPayloadUsesBoundedPrecisionAndKnownFamily()throws Exception{
  login("demo-publisher");var response=post("/v1/admin/families/demo-docs/revoke","{\"reason\":\"Controlled revocation precision regression\"}",csrf());assertEquals(200,response.statusCode(),response.body());
  String[] parts=get("/v1/catalog/current").body().split("\\.");var payload=json(new String(Base64.getUrlDecoder().decode(parts[1]),StandardCharsets.UTF_8));
  var families=(List<?>)payload.get("families");assertTrue(families.stream().anyMatch(f->((Map<?,?>)f).get("id").equals("demo-docs")));
  var revoked=(Map<?,?>)((List<?>)payload.get("revocations")).getFirst();assertTrue(revoked.get("revokedAt").toString().matches("[0-9T:.-]+(?:Z)"));String time=revoked.get("revokedAt").toString();assertTrue(!time.contains(".")||time.substring(time.indexOf('.')+1,time.length()-1).length()<=3,time);
  logout();
 }
 @Test @Order(5) void hourlyBudgetsAreEnforced()throws Exception{
  int limited=0;for(int i=0;i<35;i++){var response=post("/v1/lookups","{\"hostname\":\"unknown.example\"}",null);if(response.statusCode()==429){limited++;assertTrue(response.headers().firstValue("Retry-After").isPresent());}}
  assertTrue(limited>0);
 }
}
