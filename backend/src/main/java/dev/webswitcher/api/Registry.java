package dev.webswitcher.api;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;

@Service
class Registry {
 private final JdbcTemplate db;private final Signer signer;private final boolean demo;
 Registry(JdbcTemplate db,Signer signer,@Value("${web-switcher.demo}")boolean demo){this.db=db;this.signer=signer;this.demo=demo;}
 @PostConstruct void initialize(){
  for(String bucket:List.of("lookup:global","report:global")) {
   try {db.update("INSERT INTO request_budget(bucket,window_start,used) VALUES(?,0,0)",bucket);}
   catch(org.springframework.dao.DuplicateKeyException ignored){/* API and worker can initialize concurrently; never reset existing counters. */}
  }
  if(demo&&db.queryForObject("SELECT COUNT(*) FROM site_family",Integer.class)==0){
   db.update("INSERT INTO site_family(id,name,source_origin,destination_origin,state,valid_until,version) VALUES(?,?,?,?,?,?,0)","demo-docs","Web Switcher controlled documentation demo","https://old.web-switcher.test","https://current.web-switcher.test","active",OffsetDateTime.now(ZoneOffset.UTC).plusHours(24));
  }
  if(demo&&db.queryForObject("SELECT COUNT(*) FROM registry_release",Integer.class)==0) publish("demo-bootstrap");
 }
 @Transactional
 synchronized void budget(String action,String client,int perIp,int global){
  long window=Instant.now().getEpochSecond()/3600;
  String ipBucket=action+":ip:"+Signer.digest(client).substring(0,32);
  String globalBucket=action+":global";
  // Short transaction serializes each global budget before charging its per-address bucket.
  var g=db.queryForMap("SELECT window_start,used FROM request_budget WHERE bucket=? FOR UPDATE",globalBucket);
  int globalUsed=((Number)g.get("window_start")).longValue()==window?((Number)g.get("used")).intValue():0;
  if(globalUsed>=global)throw Policy.problem(429,"BUDGET_EXCEEDED","The global hourly request budget is exhausted.");
  var rows=db.queryForList("SELECT window_start,used FROM request_budget WHERE bucket=? FOR UPDATE",ipBucket);
  int ipUsed=rows.isEmpty()?0:((Number)rows.getFirst().get("window_start")).longValue()==window?((Number)rows.getFirst().get("used")).intValue():0;
  if(ipUsed>=perIp)throw Policy.problem(429,"BUDGET_EXCEEDED","The hourly request limit is exhausted.");
  if(rows.isEmpty())db.update("INSERT INTO request_budget(bucket,window_start,used) VALUES(?,?,?)",ipBucket,window,1);
  else db.update("UPDATE request_budget SET window_start=?,used=? WHERE bucket=?",window,ipUsed+1,ipBucket);
  db.update("UPDATE request_budget SET window_start=?,used=? WHERE bucket=?",window,globalUsed+1,globalBucket);
  db.update("DELETE FROM request_budget WHERE window_start<? AND bucket LIKE '%:ip:%'",window-24);
 }
 Map<String,Object> lookup(String host){
  List<Map<String,Object>> rows=db.queryForList("SELECT * FROM site_family WHERE source_origin=? AND state='active' AND valid_until>CURRENT_TIMESTAMP","https://"+host);
  if(rows.isEmpty())return Map.of("status","unknown","reason","NO_VERIFIED_MATCH");
  var family=rows.getFirst();var current=currentRelease();
  if(current==null||Instant.parse(current.get("expiresAt").toString()).isBefore(Instant.now()))return Map.of("status","unknown","reason","STALE_DATA");
  return Map.of("status","verified","familyId",family.get("id"),"destinationOrigin",family.get("destination_origin"),"trustClass","registry_reviewed","catalogSequence",current.get("sequence"),"requiresConfirmation",true);
 }
 @Transactional
 Map<String,Object> report(String source,String proposed,String reason,String submitter){
  String id=UUID.randomUUID().toString();var families=db.queryForList("SELECT id FROM site_family WHERE source_origin=?","https://"+source);
  String familyId=families.isEmpty()?null:families.getFirst().get("id").toString();
  db.update("INSERT INTO candidate(id,family_id,source_host,proposed_origin,reason,state,submitter,created_at) VALUES(?,?,?,?,?,'pending',?,?)",id,familyId,source,"https://"+proposed,reason,submitter,OffsetDateTime.now(ZoneOffset.UTC));
  audit(submitter,"REPORT_SUBMITTED",id,"Candidate queued; no automatic routing decision.");
  return Map.of("id",id,"status","pending");
 }
 List<Map<String,Object>> candidates(int limit){return db.queryForList("SELECT * FROM candidate ORDER BY created_at DESC LIMIT ?",limit).stream().map(this::candidateDto).toList();}
 Map<String,Object> candidate(String id){var rows=db.queryForList("SELECT * FROM candidate WHERE id=?",id);if(rows.isEmpty())throw Policy.problem(404,"NOT_FOUND","Candidate not found.");return candidateDto(rows.getFirst());}
 private Map<String,Object> candidateDto(Map<String,Object> row){var m=new LinkedHashMap<String,Object>();for(var entry:Map.of("id","id","familyId","family_id","sourceHost","source_host","proposedOrigin","proposed_origin","reason","reason","state","state","version","version","createdAt","created_at").entrySet())m.put(entry.getKey(),row.get(entry.getValue()));return m;}
 @Transactional
 Map<String,Object> decide(String id,long version,String decision,String reason,String actor){
  var rows=db.queryForList("SELECT * FROM candidate WHERE id=? FOR UPDATE",id);
  if(rows.isEmpty())throw Policy.problem(404,"NOT_FOUND","Candidate not found.");var candidate=rows.getFirst();
  if(((Number)candidate.get("version")).longValue()!=version)throw Policy.problem(409,"VERSION_CONFLICT","Candidate changed; reload before deciding.");
  if(db.queryForObject("SELECT COUNT(*) FROM pending_decision WHERE candidate_id=? AND published_sequence IS NOT NULL",Integer.class,id)>0)throw Policy.problem(409,"PUBLISHED_REVIEW_IMMUTABLE","Submit a new correction report; published review provenance is immutable.");
  if(actor.equals(candidate.get("submitter")))throw Policy.problem(403,"SELF_REVIEW","A submitter cannot approve their own report.");
  if(!Set.of("approved","rejected","quarantined").contains(decision))throw Policy.problem(400,"INVALID_DECISION","Decision must be approved, rejected or quarantined.");
  if(reason.length()<10)throw Policy.problem(400,"REVIEW_REASON_REQUIRED","Record a substantive review reason (at least 10 characters).");
  db.update("UPDATE candidate SET state=?,reviewer=?,version=version+1 WHERE id=?",decision,actor,id);
  db.update("DELETE FROM pending_decision WHERE candidate_id=? AND published_sequence IS NULL",id);
  if("approved".equals(decision))db.update("INSERT INTO pending_decision(id,candidate_id,source_origin,destination_origin,reviewer,reason,valid_until) VALUES(?,?,?,?,?,?,?)",UUID.randomUUID().toString(),id,"https://"+candidate.get("source_host"),candidate.get("proposed_origin"),actor,reason,OffsetDateTime.now(ZoneOffset.UTC).plusHours(24));
  audit(actor,"REVIEW_"+decision.toUpperCase(Locale.ROOT),id,reason);
  return candidate(id);
 }
 @Transactional
 synchronized Map<String,Object> publish(String actor){
  long sequence=((Number)db.queryForMap("SELECT next_sequence FROM release_counter WHERE id=1 FOR UPDATE").get("next_sequence")).longValue();
  var pending=db.queryForList("SELECT * FROM pending_decision WHERE published_sequence IS NULL AND valid_until>CURRENT_TIMESTAMP ORDER BY id");
  if(pending.stream().anyMatch(d->actor.equals(d.get("reviewer"))))throw Policy.problem(403,"INDEPENDENT_PUBLISHER_REQUIRED","Reviewing and publishing the same decision requires different actors.");
  var targetBySource=new HashMap<String,String>();
  for(var d:pending){String source=d.get("source_origin").toString(),target=d.get("destination_origin").toString();String previous=targetBySource.putIfAbsent(source,target);if(previous!=null&&!previous.equals(target))throw Policy.problem(409,"CONFLICTING_DECISIONS","Conflicting reviewed destinations require investigation before publication.");}
  Instant issued=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS),expires=issued.plusSeconds(3600);
  for(var d:pending){
   String source=Policy.origin(d.get("source_origin").toString()),target=Policy.origin(d.get("destination_origin").toString());
   if(source.equals(target))throw Policy.problem(409,"CYCLE_DETECTED","Source and destination cannot be identical.");
   var existing=db.queryForList("SELECT id FROM site_family WHERE source_origin=?",source);
   if(existing.isEmpty())db.update("INSERT INTO site_family(id,name,source_origin,destination_origin,state,valid_until,version) VALUES(?,?,?,?,?,?,0)","reviewed-"+d.get("candidate_id"),"Reviewed website migration",source,target,"active",d.get("valid_until"));
   else db.update("UPDATE site_family SET destination_origin=?,state='active',valid_until=?,version=version+1,revoked_at=NULL,revoke_reason=NULL WHERE source_origin=?",target,d.get("valid_until"),source);
  }
  var active=db.queryForList("SELECT * FROM site_family WHERE state='active' AND valid_until>CURRENT_TIMESTAMP ORDER BY id");
  var sources=new HashSet<String>();for(var f:active)sources.add(f.get("source_origin").toString());
  for(var f:active)if(sources.contains(f.get("destination_origin").toString()))throw Policy.problem(409,"NON_TERMINAL_DESTINATION","Flatten approved migration chains before publication; targets cannot be active aliases.");
  List<Map<String,Object>> families=new ArrayList<>(),aliases=new ArrayList<>(),decisions=new ArrayList<>(),revocations=new ArrayList<>();
  for(var f:active){
   String id=f.get("id").toString();families.add(Map.of("id",id,"name",f.get("name")));aliases.add(Map.of("sourceOrigin",f.get("source_origin"),"familyId",id));
   Instant valid=toInstant(f.get("valid_until")).truncatedTo(java.time.temporal.ChronoUnit.MILLIS);if(valid.isAfter(expires))valid=expires;
   decisions.add(Map.of("familyId",id,"destinationOrigin",f.get("destination_origin"),"trustClass","registry_reviewed","validUntil",valid.toString(),"pathPolicy",id.equals("demo-docs")?Map.of("type","preserve","publicPrefixes",List.of("/docs/")):Map.of("type","homepage"),"reasonCodes",List.of("REVIEWED_CONTINUITY"),"requiresConfirmation",true));
  }
  for(var f:db.queryForList("SELECT * FROM site_family WHERE state='revoked' ORDER BY id")){families.add(Map.of("id",f.get("id"),"name",f.get("name")));revocations.add(Map.of("familyId",f.get("id"),"revokedAt",toInstant(f.get("revoked_at")).truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString(),"reason",f.get("revoke_reason")));}
  var payload=new LinkedHashMap<String,Object>();payload.put("schemaVersion",1);payload.put("bundleSequence",sequence);payload.put("issuedAt",issued.toString());payload.put("expiresAt",expires.toString());payload.put("minClientVersion","0.2.0");payload.put("policyVersion",1);payload.put("families",families);payload.put("aliases",aliases);payload.put("decisions",decisions);payload.put("revocations",revocations);
  String signed=signer.sign(payload),digest=Signer.digest(signed);
  db.update("INSERT INTO registry_release(sequence,digest,signed_blob,issued_at,expires_at,publisher) VALUES(?,?,?,?,?,?)",sequence,digest,signed,OffsetDateTime.ofInstant(issued,ZoneOffset.UTC),OffsetDateTime.ofInstant(expires,ZoneOffset.UTC),actor);
  db.update("UPDATE release_counter SET next_sequence=? WHERE id=1",sequence+1);
  for(var d:pending)db.update("UPDATE pending_decision SET published_sequence=? WHERE id=?",sequence,d.get("id"));
  audit(actor,"CATALOG_PUBLISHED",Long.toString(sequence),"Immutable catalog "+digest);
  return release(sequence);
 }
 @Transactional
 Map<String,Object> revoke(String id,String reason,String actor){
  int count=db.update("UPDATE site_family SET state='revoked',revoked_at=?,revoke_reason=?,version=version+1 WHERE id=?",OffsetDateTime.now(ZoneOffset.UTC),reason,id);
  if(count==0)throw Policy.problem(404,"NOT_FOUND","Family not found.");audit(actor,"FAMILY_REVOKED",id,reason);return publish(actor);
 }
 String signedRelease(Long sequence){var rows=sequence==null?db.queryForList("SELECT signed_blob FROM registry_release ORDER BY sequence DESC LIMIT 1"):db.queryForList("SELECT signed_blob FROM registry_release WHERE sequence=?",sequence);if(rows.isEmpty())throw Policy.problem(404,"NOT_FOUND","No published catalog exists.");return rows.getFirst().get("signed_blob").toString();}
 Map<String,Object> currentRelease(){var rows=db.queryForList("SELECT * FROM registry_release ORDER BY sequence DESC LIMIT 1");return rows.isEmpty()?null:releaseDto(rows.getFirst());}
 Map<String,Object> release(long sequence){return releaseDto(db.queryForMap("SELECT * FROM registry_release WHERE sequence=?",sequence));}
 List<Map<String,Object>> releases(){return db.queryForList("SELECT * FROM registry_release ORDER BY sequence DESC LIMIT 100").stream().map(this::releaseDto).toList();}
 private Map<String,Object> releaseDto(Map<String,Object> r){return Map.of("sequence",r.get("sequence"),"digest",r.get("digest"),"issuedAt",toInstant(r.get("issued_at")).toString(),"expiresAt",toInstant(r.get("expires_at")).toString(),"publisher",r.get("publisher"));}
 Map<String,Object> family(String id){var rows=db.queryForList("SELECT * FROM site_family WHERE id=?",id);if(rows.isEmpty())throw Policy.problem(404,"NOT_FOUND","Family not found.");var row=rows.getFirst();return Map.of("id",row.get("id"),"name",row.get("name"),"sourceOrigin",row.get("source_origin"),"destinationOrigin",row.get("destination_origin"),"state",row.get("state"),"validUntil",toInstant(row.get("valid_until")).toString(),"history",db.queryForList("SELECT action,created_at FROM audit_event WHERE entity_id=? ORDER BY created_at",id));}
 List<Map<String,Object>> audit(){return db.queryForList("SELECT * FROM audit_event ORDER BY created_at DESC LIMIT 100").stream().map(r->Map.<String,Object>of("id",r.get("id"),"actor",r.get("actor"),"action",r.get("action"),"entityId",r.get("entity_id"),"detail",r.get("detail"),"createdAt",toInstant(r.get("created_at")).toString())).toList();}
 void audit(String actor,String action,String entity,String detail){db.update("INSERT INTO audit_event(id,actor,action,entity_id,detail,created_at) VALUES(?,?,?,?,?,?)",UUID.randomUUID().toString(),actor,action,entity,detail,OffsetDateTime.now(ZoneOffset.UTC));}
 void health(){db.queryForObject("SELECT 1",Integer.class);}
 static Instant toInstant(Object o){if(o instanceof OffsetDateTime t)return t.toInstant();if(o instanceof java.sql.Timestamp t)return t.toInstant();return Instant.parse(o.toString());}
}
