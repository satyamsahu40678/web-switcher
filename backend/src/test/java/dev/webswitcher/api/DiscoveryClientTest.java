package dev.webswitcher.api;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

/** Real internal HTTP transport tests; external-site evidence is deliberately synthetic. */
class DiscoveryClientTest {
 private static final String SOURCE="old.discovery.example",TARGET="https://current.discovery.example";
 private static final String TOKEN="fixture-discovery-token-never-real-0123456789";
 private static Map<String,Object> valid(){
  var body=new LinkedHashMap<String,Object>();
  body.put("classification","REACHABLE");body.put("httpStatus",200);body.put("finalOrigin",TARGET);
  body.put("hops",List.of(Map.of("origin","https://"+SOURCE,"status",301),Map.of("origin",TARGET,"status",200)));
  body.put("bytes",27);body.put("sha256","a".repeat(64));body.put("checkedAt",Instant.now().toString());body.put("identity","UNVERIFIED");body.put("threatStatus","UNKNOWN");
  return body;
 }
 private record Reply(int status,String contentType,String body,String location) {}
 private static final class Fixture implements AutoCloseable {
  final HttpServer server;final AtomicReference<Reply> reply=new AtomicReference<>();
  final AtomicInteger probes=new AtomicInteger(),redirected=new AtomicInteger();
  volatile boolean correctAuthorization,correctMethod,correctPath;volatile String body;
  Fixture()throws Exception{
   server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
   server.createContext("/probe",exchange->{
    probes.incrementAndGet();correctPath=exchange.getRequestURI().toString().equals("/probe");correctMethod=exchange.getRequestMethod().equals("POST");
    correctAuthorization=("Bearer "+TOKEN).equals(exchange.getRequestHeaders().getFirst("Authorization"));
    body=new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);
    Reply value=reply.get();byte[] bytes=value.body().getBytes(StandardCharsets.UTF_8);
    if(value.contentType()!=null)exchange.getResponseHeaders().set("Content-Type",value.contentType());
    if(value.location()!=null)exchange.getResponseHeaders().set("Location",value.location());
    exchange.sendResponseHeaders(value.status(),bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
   });
   server.createContext("/unexpected",exchange->{redirected.incrementAndGet();exchange.sendResponseHeaders(204,-1);exchange.close();});
   server.start();respond(valid());
  }
  String origin(){return "http://127.0.0.1:"+server.getAddress().getPort();}
  DiscoveryClient client(){return new DiscoveryClient(origin(),TOKEN);}
  void respond(Map<String,Object> body)throws Exception{reply.set(new Reply(200,"application/json; charset=utf-8",Signer.JSON.writeValueAsString(body),null));}
  void raw(String body){reply.set(new Reply(200,"application/json",body,null));}
  public void close(){server.stop(0);}
 }
 @Test void actualInternalRequestUsesFixedEndpointBearerAndHostnameOnly()throws Exception{
  try(var fixture=new Fixture()){
   var observed=fixture.client().probe(SOURCE);
   assertEquals(TARGET,observed.finalOrigin());assertEquals(2,observed.hopCount());assertEquals("a".repeat(64),observed.sha256());
   assertEquals(1,fixture.probes.get());assertTrue(fixture.correctAuthorization,"Only the configured internal bearer is sent");assertTrue(fixture.correctMethod);assertTrue(fixture.correctPath);
   assertEquals(Map.of("url","https://"+SOURCE+"/"),Signer.JSON.readValue(fixture.body,Map.class));
  }
 }
 @Test void sameOriginAndUnreachableEvidenceNeverInventReplacement()throws Exception{
  try(var fixture=new Fixture()){
   var body=valid();body.put("finalOrigin","https://"+SOURCE);body.put("hops",List.of(Map.of("origin","https://"+SOURCE,"status",200)));fixture.respond(body);
   assertEquals("https://"+SOURCE,fixture.client().probe(SOURCE).finalOrigin());
   body=valid();body.put("classification","HTTP_ERROR");body.put("httpStatus",404);fixture.respond(body);
   assertNull(fixture.client().probe(SOURCE));
  }
 }
 @Test void internalRedirectsNeverForwardBearerOrInvokeNextEndpoint()throws Exception{
  try(var fixture=new Fixture()){
   fixture.reply.set(new Reply(302,"application/json","{}",fixture.origin()+"/unexpected"));
   var error=assertThrows(DiscoveryClient.Failure.class,()->fixture.client().probe(SOURCE));
   assertFalse(error.retryable);assertEquals("FETCHER_HTTP_302",error.code);assertEquals(1,fixture.probes.get());assertEquals(0,fixture.redirected.get());
  }
 }
 @Test void onlyTransientFetcherStatusesAreRetried()throws Exception{
  try(var fixture=new Fixture()){
   for(int status:List.of(429,500,503,401,403,422)){
    fixture.reply.set(new Reply(status,"application/json","{}",null));
    var error=assertThrows(DiscoveryClient.Failure.class,()->fixture.client().probe(SOURCE));
    assertEquals(status==429||status>=500,error.retryable,"HTTP "+status);assertEquals("FETCHER_HTTP_"+status,error.code);
   }
  }
 }
 @Test void malformedDuplicateTrailingAndOversizedResponsesCannotYieldEvidence()throws Exception{
  try(var fixture=new Fixture()){
   for(String raw:List.of("not JSON","[]","{\"identity\":\"UNVERIFIED\",\"identity\":\"owner_verified\"}",Signer.JSON.writeValueAsString(valid())+" {}"," ".repeat(65537))){
    fixture.raw(raw);assertThrows(DiscoveryClient.Failure.class,()->fixture.client().probe(SOURCE));
   }
   for(String type:List.of("text/html","application/json-invalid","application/jsonp")){fixture.reply.set(new Reply(200,type,Signer.JSON.writeValueAsString(valid()),null));assertThrows(DiscoveryClient.Failure.class,()->fixture.client().probe(SOURCE));}
  }
 }
 @Test void forgedTrustStaleObservationsAndUnboundedRedirectShapesFailClosed()throws Exception{
  List<Consumer<Map<String,Object>>> attacks=List.of(
   value->value.put("identity","OWNER_VERIFIED"),value->value.put("threatStatus","SAFE"),value->value.put("unexpected","remote logic"),
   value->value.put("checkedAt",Instant.now().plusSeconds(1000).toString()),value->value.put("checkedAt",Instant.now().minusSeconds(1000).toString()),
   value->value.put("sha256","not-a-digest"),value->value.put("bytes",1048577),value->value.put("httpStatus",200.5),
   value->value.put("finalOrigin","http://current.discovery.example"),value->value.put("finalOrigin",TARGET+"/private"),
   value->value.put("finalOrigin","https://user:password@current.discovery.example"),value->value.put("hops",List.of()),
   value->value.put("hops",Collections.nCopies(5,Map.of("origin",TARGET,"status",301))),
   value->value.put("hops",List.of(Map.of("origin","https://unrelated.discovery.example","status",301),Map.of("origin",TARGET,"status",200))),
   value->value.put("hops",List.of(Map.of("origin","https://"+SOURCE,"status",200),Map.of("origin",TARGET,"status",200))),
   value->value.put("hops",List.of(Map.of("origin","https://"+SOURCE,"status",301),Map.of("origin",TARGET,"status",404))),
   value->value.put("hops",List.of(Map.of("origin","https://"+SOURCE,"status",301,"extra",true),Map.of("origin",TARGET,"status",200)))
  );
  try(var fixture=new Fixture()){
   for(int index=0;index<attacks.size();index++){
    var body=valid();attacks.get(index).accept(body);fixture.respond(body);
    var error=assertThrows(DiscoveryClient.Failure.class,()->fixture.client().probe(SOURCE),"attack "+index);assertFalse(error.retryable,"Malformed evidence must not be promoted or retried indefinitely");
   }
  }
 }
 @Test void operatorEndpointAndBearerConfigurationAreBounded()throws Exception{
  for(String endpoint:List.of("ftp://internal.example","http://user:password@internal.example","http://internal.example/path","http://internal.example?target=other","http://internal.example#fragment","http://internal.example:0","http://internal.example:65536"))assertThrows(IllegalStateException.class,()->new DiscoveryClient(endpoint,TOKEN));
  for(String token:List.of("short","a".repeat(257),"a".repeat(32)+"\n","a".repeat(32)+" "))assertThrows(IllegalStateException.class,()->new DiscoveryClient("http://internal.example",token));
  assertThrows(IllegalStateException.class,()->new DiscoveryClient("http://internal.example",null));
  try(var fixture=new Fixture()){
   for(String invalid:List.of("https://old.example/path?token=x","localhost","127.0.0.1","old.example:443")){
    var error=assertThrows(DiscoveryClient.Failure.class,()->fixture.client().probe(invalid));assertEquals("INVALID_HOST",error.code);
   }
   assertEquals(0,fixture.probes.get(),"Invalid public input must not reach the internal service");
  }
 }
}
