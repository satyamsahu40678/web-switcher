package dev.webswitcher.api;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import java.util.*;

@RestController
class Api {
 private final Registry registry;private final Signer signer;private final boolean demo;private final int lookupBudget,reportBudget;
 Api(Registry registry,Signer signer,@Value("${web-switcher.demo}")boolean demo,@Value("${web-switcher.lookup-budget}")int lookupBudget,@Value("${web-switcher.report-budget}")int reportBudget){this.registry=registry;this.signer=signer;this.demo=demo;this.lookupBudget=lookupBudget;this.reportBudget=reportBudget;}
 @GetMapping("/health/live") Map<String,Object> live(){return Map.of("status","UP");}
 @GetMapping("/health/ready") Map<String,Object> ready(){registry.health();return Map.of("status","UP","database","ready");}
 @GetMapping("/v1/session") Map<String,Object> session(Authentication auth,HttpServletRequest request){
  CsrfToken token=(CsrfToken)request.getAttribute(CsrfToken.class.getName());
  boolean signed=auth!=null&&auth.isAuthenticated()&&!(auth instanceof AnonymousAuthenticationToken);
  var result=new LinkedHashMap<String,Object>();result.put("authenticated",signed);result.put("username",signed?auth.getName():null);result.put("roles",signed?auth.getAuthorities().stream().filter(a->a.getAuthority().startsWith("ROLE_")).map(a->a.getAuthority().replace("ROLE_","")).sorted().toList():List.of());result.put("csrfToken",token.getToken());result.put("csrfHeader",token.getHeaderName());result.put("demo",demo);if(!demo)result.put("loginUrl","/oauth2/authorization/web");return result;
 }
 @GetMapping("/v1/keys") Map<String,Object> keys(){return Map.of("keys",List.of(signer.publicJwk()));}
 @GetMapping(value={"/v1/catalog/current","/v1/catalog/{sequence}"},produces="application/jose") ResponseEntity<String> catalog(@PathVariable(required=false)Long sequence,@RequestHeader(value="If-None-Match",required=false)String etag){
  String compact=registry.signedRelease(sequence),tag="\""+Signer.digest(compact)+"\"";
  HttpHeaders headers=new HttpHeaders();headers.setETag(tag);headers.set("Cache-Control",sequence==null?"public, max-age=300, must-revalidate":"public, max-age=3600, immutable");headers.set("X-Content-Type-Options","nosniff");
  if(tag.equals(etag))return new ResponseEntity<>(null,headers,HttpStatus.NOT_MODIFIED);
  return new ResponseEntity<>(compact,headers,HttpStatus.OK);
 }
 @GetMapping("/v1/families/{id}") Map<String,Object> family(@PathVariable String id){return registry.family(id);}
 @PostMapping("/v1/lookups") Map<String,Object> lookup(@RequestBody String raw,HttpServletRequest request){var body=body(raw);Policy.closed(body,"hostname","clientVersion","requestedMode");String host=Policy.hostname(Policy.text(body.get("hostname"),253,"hostname"));registry.budget("lookup",request.getRemoteAddr(),30,lookupBudget);return registry.lookup(host);}
 @PostMapping("/v1/reports") ResponseEntity<Map<String,Object>> report(@RequestBody String raw,HttpServletRequest request,Authentication auth){
  var body=body(raw);Policy.closed(body,"sourceHost","proposedHost","reason");String source=Policy.hostname(Policy.text(body.get("sourceHost"),253,"sourceHost")),proposed=Policy.hostname(Policy.text(body.get("proposedHost"),253,"proposedHost")),reason=Policy.text(body.get("reason"),1000,"reason");
  if(source.equals(proposed))throw Policy.problem(400,"SELF_MAPPING","Source and destination must differ.");registry.budget("report",request.getRemoteAddr(),10,reportBudget);
  String actor=auth!=null&&auth.isAuthenticated()&&!(auth instanceof AnonymousAuthenticationToken)?auth.getName():"anonymous";
  return ResponseEntity.accepted().body(registry.report(source,proposed,reason,actor));
 }
 @GetMapping("/v1/admin/candidates") Map<String,Object> candidates(@RequestParam(defaultValue="100")int limit){if(limit<1||limit>100)throw Policy.problem(400,"INVALID_LIMIT","Limit must be 1 through 100.");var items=registry.candidates(limit);return Map.of("items",items,"total",items.size());}
 @GetMapping("/v1/admin/candidates/{id}") Map<String,Object> candidate(@PathVariable String id){return registry.candidate(id);}
 @PostMapping("/v1/admin/candidates/{id}/decisions") Map<String,Object> decide(@PathVariable String id,@RequestBody String raw,Authentication auth){
  var body=body(raw);Policy.closed(body,"version","decision","reason");Object rawVersion=body.get("version");if(!(rawVersion instanceof Number n)||n.longValue()<0||n.doubleValue()!=n.longValue())throw Policy.problem(400,"INVALID_VERSION","Nonnegative integer version is required.");
  return registry.decide(id,((Number)rawVersion).longValue(),Policy.text(body.get("decision"),32,"decision"),Policy.text(body.get("reason"),1000,"reason"),auth.getName());
 }
 @GetMapping("/v1/admin/releases") Map<String,Object> releases(){return Map.of("items",registry.releases());}
 @PostMapping("/v1/admin/releases") Map<String,Object> publish(@RequestBody(required=false)String raw,Authentication auth){if(raw!=null&&!raw.isBlank())Policy.closed(body(raw));return registry.publish(auth.getName());}
 @PostMapping("/v1/admin/families/{id}/revoke") Map<String,Object> revoke(@PathVariable String id,@RequestBody String raw,Authentication auth){var body=body(raw);Policy.closed(body,"reason");return registry.revoke(id,Policy.text(body.get("reason"),256,"reason"),auth.getName());}
 @GetMapping("/v1/admin/audit") Map<String,Object> audit(){return Map.of("items",registry.audit());}
 @SuppressWarnings("unchecked") static Map<String,Object> body(String raw){
  if(raw==null||raw.length()>32768)throw Policy.problem(413,"BODY_TOO_LARGE","JSON body exceeds 32 KiB.");
  try{Object parsed=Signer.JSON.readValue(raw,Object.class);if(!(parsed instanceof Map<?,?> m))throw new IllegalArgumentException();return (Map<String,Object>)m;}catch(Exception e){throw Policy.problem(400,"INVALID_JSON","A JSON object with unique keys is required.");}
 }
}

@RestControllerAdvice
class Problems {
 @ExceptionHandler(Policy.Problem.class) ResponseEntity<Map<String,Object>> problem(Policy.Problem e){
  var response=ResponseEntity.status(e.status).contentType(MediaType.APPLICATION_PROBLEM_JSON);
  if(e.status==429)response.header("Retry-After","3600");
  return response.body(Map.of("type","about:blank","status",e.status,"code",e.code,"detail",e.getMessage(),"requestId",e.requestId));
 }
 @ExceptionHandler({HttpMessageNotReadableException.class,org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class}) ResponseEntity<Map<String,Object>> malformed(Exception e){return problem(Policy.problem(400,"INVALID_INPUT","The request is malformed."));}
}
