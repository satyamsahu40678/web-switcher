package dev.webswitcher.api;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class DiscoveryIntegrationTest {
 @Test void realApiAndSeparateNonWebWorkerQueueEvidenceWithoutActivatingIt()throws Exception{
  var database=new DiscoveryTestDatabase();
  String token=UUID.randomUUID().toString()+UUID.randomUUID();AtomicInteger calls=new AtomicInteger();
  HttpServer fetcher=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  fetcher.createContext("/probe",exchange->{
   try{
    String authorization=exchange.getRequestHeaders().getFirst("Authorization");
    assertTrue(authorization!=null&&java.security.MessageDigest.isEqual(("Bearer "+token).getBytes(StandardCharsets.UTF_8),authorization.getBytes(StandardCharsets.UTF_8)),"Internal fetcher authorization must match without exposing its value.");
    var input=Api.body(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));assertEquals("https://old.discovery.test/",input.get("url"));calls.incrementAndGet();
    var body=Map.of("classification","REACHABLE","httpStatus",200,"finalOrigin","https://current.discovery.test","hops",List.of(Map.of("origin","https://old.discovery.test","status",301),Map.of("origin","https://current.discovery.test","status",200)),"bytes",32,"sha256","a".repeat(64),"checkedAt",Instant.now().toString(),"identity","UNVERIFIED","threatStatus","UNKNOWN");
    byte[] bytes=Signer.JSON.writeValueAsBytes(body);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);
   }finally{exchange.close();}
  });fetcher.start();
  ConfigurableApplicationContext api=null,worker=null;
  try{
   api=new SpringApplicationBuilder(Application.class).profiles("demo").run("--server.port=0","--spring.datasource.url="+database.url,"--spring.datasource.username="+database.user,"--spring.datasource.password="+database.password,"--web-switcher.discovery.queue-enabled=true","--logging.level.root=WARN");
   String base="http://127.0.0.1:"+((WebServerApplicationContext)api).getWebServer().getPort();var http=HttpClient.newHttpClient();
   var signed=http.send(HttpRequest.newBuilder(URI.create(base+"/v1/catalog/current")).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,signed.statusCode());
   assertTrue(api.getBeansOfType(DiscoveryWorker.class).isEmpty(),"queue-serving API has no fetching worker or token client");
   var request=HttpRequest.newBuilder(URI.create(base+"/v1/lookups")).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString("{\"hostname\":\"old.discovery.test\"}")).build();
   var pending=http.send(request,HttpResponse.BodyHandlers.ofString());assertEquals(202,pending.statusCode(),pending.body());
   String id=Api.body(pending.body()).get("lookupId").toString();
   var repeat=http.send(request,HttpResponse.BodyHandlers.ofString());assertEquals(id,Api.body(repeat.body()).get("lookupId"));
   worker=new SpringApplicationBuilder(Application.class).profiles("worker").run("--spring.datasource.url="+database.url,"--spring.datasource.username="+database.user,"--spring.datasource.password="+database.password,"--web-switcher.discovery.fetcher-url=http://127.0.0.1:"+fetcher.getAddress().getPort(),"--web-switcher.discovery.fetcher-token="+token,"--web-switcher.discovery.initial-delay-ms=600000","--logging.level.root=WARN");
   assertFalse(worker instanceof WebServerApplicationContext,"worker process must not create an HTTP listener");assertTrue(worker.getBeansOfType(Security.class).isEmpty());
   assertFalse(worker.getEnvironment().getProperty("spring.flyway.enabled",Boolean.class,true),"runtime worker must not require schema-management privileges");
   assertTrue(worker.getBeansOfType(org.flywaydb.core.Flyway.class).isEmpty(),"owner bootstrap manages schema before restricted workers start");
   var keylessSigner=worker.getBean(Signer.class);assertThrows(Policy.Problem.class,()->keylessSigner.sign(Map.of()));
   worker.getBean(DiscoveryWorker.class).tick();assertEquals(1,calls.get());
   var poll=http.send(HttpRequest.newBuilder(URI.create(base+"/v1/lookups/"+id)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,poll.statusCode());var result=Api.body(poll.body());assertEquals("unknown",result.get("status"));assertEquals("UNVERIFIED_CANDIDATE_QUEUED",result.get("reason"));assertFalse(result.containsKey("destinationOrigin"));
   var db=worker.getBean(JdbcTemplate.class);assertEquals("candidates_found",db.queryForObject("SELECT state FROM lookup_job WHERE id=?",String.class,id));assertEquals("pending",db.queryForObject("SELECT state FROM candidate WHERE source_host='old.discovery.test'",String.class));assertEquals(0,db.queryForObject("SELECT count(*) FROM site_family WHERE source_origin='https://old.discovery.test'",Integer.class));
   assertEquals(signed.body(),http.send(HttpRequest.newBuilder(URI.create(base+"/v1/catalog/current")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
   assertEquals(200,http.send(request,HttpResponse.BodyHandlers.ofString()).statusCode());assertEquals(1,calls.get());
  }finally{if(worker!=null)worker.close();if(api!=null)api.close();fetcher.stop(0);database.close();}
 }
 private static Signer workerSigner(ConfigurableApplicationContext context){return context.getBean(Signer.class);}
}
