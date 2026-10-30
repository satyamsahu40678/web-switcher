package dev.webswitcher.api;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.Flow;

/** Calls one operator-configured internal fetcher; evidence never authorizes navigation. */
final class DiscoveryClient {
 record Observation(String finalOrigin,int hopCount,String sha256,String checkedAt) {}
 static final class Failure extends Exception {final boolean retryable;final String code;Failure(boolean retryable,String code){super(code);this.retryable=retryable;this.code=code;}}
 private final URI endpoint;private final String token;private final HttpClient client;
 DiscoveryClient(String base,String token){
  try{
   URI uri=URI.create(base);
   if(!Set.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!(uri.getRawPath().isEmpty()||uri.getRawPath().equals("/"))||uri.getPort()==0||uri.getPort()>65535)throw new IllegalArgumentException();
   endpoint=uri.resolve("/probe");
  }catch(RuntimeException e){throw new IllegalStateException("FETCHER_URL must be an exact configured internal HTTP(S) origin.");}
  if(token==null||token.length()<32||token.length()>256||token.chars().anyMatch(c->c<=32||c>=127))throw new IllegalStateException("A securely configured FETCHER_INTERNAL_TOKEN of 32 through 256 printable characters is required.");
  this.token=token;client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
 }
 Observation probe(String hostname)throws Failure{
  final HttpRequest request;
  try{request=HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(12)).header("Authorization","Bearer "+token).header("Content-Type","application/json").header("Accept","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(Signer.JSON.writeValueAsBytes(Map.of("url","https://"+Policy.hostname(hostname)+"/")))).build();}
  catch(Exception e){throw new Failure(false,"INVALID_HOST");}
  CompletableFuture<HttpResponse<byte[]>> pending=client.sendAsync(request,info->new LimitedBody());
  final HttpResponse<byte[]> response;
  try{response=pending.get(12,TimeUnit.SECONDS);}
  catch(InterruptedException e){pending.cancel(true);Thread.currentThread().interrupt();throw new Failure(true,"FETCHER_INTERRUPTED");}
  catch(ExecutionException e){pending.cancel(true);if(e.getCause() instanceof IllegalArgumentException)throw new Failure(false,"FETCHER_RESPONSE_LIMIT");throw new Failure(true,"FETCHER_UNAVAILABLE");}
  catch(TimeoutException e){pending.cancel(true);throw new Failure(true,"FETCHER_UNAVAILABLE");}
  if(response.statusCode()!=200){int status=response.statusCode();throw new Failure(status==429||status>=500,"FETCHER_HTTP_"+status);}
  if(!response.headers().firstValue("Content-Type").orElse("").split(";",2)[0].trim().equalsIgnoreCase("application/json"))throw new Failure(false,"FETCHER_INVALID_RESPONSE");
  try{
   Object raw=Signer.JSON.readValue(response.body(),Object.class);if(!(raw instanceof Map<?,?>))throw new IllegalArgumentException();
   @SuppressWarnings("unchecked") var data=(Map<String,Object>)raw;
   Policy.closed(data,"classification","httpStatus","finalOrigin","hops","bytes","sha256","checkedAt","identity","threatStatus");
   if(!"UNVERIFIED".equals(data.get("identity"))||!"UNKNOWN".equals(data.get("threatStatus")))throw new IllegalArgumentException();
   int status=integer(data.get("httpStatus"),100,599),bytes=integer(data.get("bytes"),0,1048576);
   if(!Set.of("REACHABLE","CHALLENGED_OR_THROTTLED","HTTP_ERROR").contains(data.get("classification")))throw new IllegalArgumentException();
   if(!"REACHABLE".equals(data.get("classification")))return null;
   if(status<200||status>=300)throw new IllegalArgumentException();
   String origin=canonical(data.get("finalOrigin"));
   if(!(data.get("sha256") instanceof String digest)||!digest.matches("[0-9a-f]{64}"))throw new IllegalArgumentException();
   if(!(data.get("checkedAt") instanceof String checked))throw new IllegalArgumentException();
   Instant time=Instant.parse(checked),now=Instant.now();if(time.isAfter(now.plusSeconds(300))||time.isBefore(now.minusSeconds(900)))throw new IllegalArgumentException();
   if(!(data.get("hops") instanceof List<?> hops)||hops.isEmpty()||hops.size()>4)throw new IllegalArgumentException();
   String first=null,last=null;
   for(int index=0;index<hops.size();index++){
    if(!(hops.get(index) instanceof Map<?,?> hopRaw))throw new IllegalArgumentException();
    @SuppressWarnings("unchecked") var hop=(Map<String,Object>)hopRaw;Policy.closed(hop,"origin","status");
    last=canonical(hop.get("origin"));if(index==0)first=last;
    int hopStatus=integer(hop.get("status"),100,599);
    if(index==hops.size()-1){if(hopStatus!=status)throw new IllegalArgumentException();}
    else if(!Set.of(301,302,303,307,308).contains(hopStatus))throw new IllegalArgumentException();
   }
   if(!Objects.equals(first,"https://"+hostname)||!Objects.equals(last,origin))throw new IllegalArgumentException();
   return new Observation(origin,hops.size(),digest,checked);
  }catch(Exception e){throw new Failure(false,"FETCHER_INVALID_RESPONSE");}
 }
 private static String canonical(Object value){if(!(value instanceof String text)||!Policy.origin(text).equals(text))throw new IllegalArgumentException();return text;}
 private static int integer(Object value,int min,int max){if(!(value instanceof Number n)||n.doubleValue()!=n.longValue()||n.longValue()<min||n.longValue()>max)throw new IllegalArgumentException();return n.intValue();}
 private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
  private final CompletableFuture<byte[]> body=new CompletableFuture<>();private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();private Flow.Subscription subscription;
  public CompletionStage<byte[]> getBody(){return body;}
  public void onSubscribe(Flow.Subscription value){subscription=value;value.request(1);}
  public void onNext(List<ByteBuffer> chunks){
   for(ByteBuffer chunk:chunks){if(chunk.remaining()>65536-bytes.size()){subscription.cancel();body.completeExceptionally(new IllegalArgumentException("Bounded fetcher response exceeded64KiB"));return;}byte[] value=new byte[chunk.remaining()];chunk.get(value);bytes.writeBytes(value);}subscription.request(1);
  }
  public void onError(Throwable error){body.completeExceptionally(error);}
  public void onComplete(){body.complete(bytes.toByteArray());}
 }
}
