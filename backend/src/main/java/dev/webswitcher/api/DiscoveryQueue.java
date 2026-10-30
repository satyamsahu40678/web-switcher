package dev.webswitcher.api;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.*;
import java.util.*;

/** Durable bounded candidate work. No method can activate a family or publish a release. */
@Service
class DiscoveryQueue {
 record Limits(int queuedPerHour,int probesPerHour,int probesPerDay,int perHostPerHour,int concurrency,int ttlSeconds) {
  Limits { if(queuedPerHour<1||queuedPerHour>1000||probesPerHour<1||probesPerHour>1000||probesPerDay<1||probesPerDay>10000||perHostPerHour<1||perHostPerHour>3||concurrency<1||concurrency>4||ttlSeconds<60||ttlSeconds>86400)throw new IllegalStateException("Discovery limits are outside supported bounds."); }
 }
 record Claim(String id,String hostname,String leaseOwner,int attempt) {}
 private final JdbcTemplate db;private final TransactionTemplate transactions;private final boolean queueEnabled,workerEnabled;private final Limits limits;
 @Autowired DiscoveryQueue(JdbcTemplate db,PlatformTransactionManager manager,
  @Value("${web-switcher.discovery.queue-enabled:false}")boolean queued,@Value("${web-switcher.discovery.worker-enabled:false}")boolean worker,
  @Value("${web-switcher.discovery.queued-per-hour:100}")int queuedPerHour,@Value("${web-switcher.discovery.probes-per-hour:20}")int probesPerHour,
  @Value("${web-switcher.discovery.probes-per-day:100}")int probesPerDay,@Value("${web-switcher.discovery.per-host-per-hour:3}")int perHostPerHour,
  @Value("${web-switcher.discovery.concurrency:2}")int concurrency,@Value("${web-switcher.discovery.ttl-seconds:3600}")int ttlSeconds) {
  this(db,manager,queued,worker,new Limits(queuedPerHour,probesPerHour,probesPerDay,perHostPerHour,concurrency,ttlSeconds));
 }
 DiscoveryQueue(JdbcTemplate db,PlatformTransactionManager manager,boolean queued,boolean worker,Limits limits){this.db=db;this.transactions=new TransactionTemplate(manager);this.queueEnabled=queued;this.workerEnabled=worker;this.limits=limits;}
 @PostConstruct void initialize(){
  if(!queueEnabled&&!workerEnabled)return;
  for(String bucket:List.of("discovery:queue:global","discovery:hour:global","discovery:day:global","lookup-poll:global")){
   try{db.update("INSERT INTO request_budget(bucket,window_start,used) VALUES(?,0,0)",bucket);}catch(DuplicateKeyException ignored){/* Another process initialized the same durable budget. */}
  }
 }
 boolean enabled(){return queueEnabled;}
 void requireEnabled(){if(!queueEnabled)throw Policy.problem(404,"NOT_FOUND","Lookup reference is unavailable.");}
 Map<String,Object> enqueue(String hostname){
  requireEnabled();String host=Policy.hostname(hostname);
  return transactions.execute(tx->{
   Instant now=Instant.now();long hour=now.getEpochSecond()/3600;
   var budget=lockedBudget("discovery:queue:global");
   prune(now);
   var existing=db.queryForList("SELECT * FROM lookup_job WHERE hostname=? AND created_at>=? ORDER BY created_at DESC LIMIT 1",host,at(now.minusSeconds(limits.ttlSeconds)));
   if(!existing.isEmpty())return status(existing.getFirst());
   if(used(budget,hour)>=limits.queuedPerHour)throw Policy.problem(429,"BUDGET_EXCEEDED","The global hourly discovery queue budget is exhausted.");
   String id=UUID.randomUUID().toString();
   db.update("INSERT INTO lookup_job(id,hostname,state,attempt,run_after,created_at) VALUES(?,?,'queued',0,?,?)",id,host,at(now),at(now));
   charge("discovery:queue:global",hour,used(budget,hour)+1);
   return pending(id);
  });
 }
 Map<String,Object> poll(String id){
  requireEnabled();
  try{if(!UUID.fromString(id).toString().equals(id))throw new IllegalArgumentException();}catch(RuntimeException e){throw Policy.problem(404,"NOT_FOUND","Lookup reference is unavailable.");}
  var rows=db.queryForList("SELECT * FROM lookup_job WHERE id=? AND created_at>=?",id,at(Instant.now().minusSeconds(limits.ttlSeconds)));
  if(rows.isEmpty())throw Policy.problem(404,"NOT_FOUND","Lookup reference is unavailable or expired.");
  return status(rows.getFirst());
 }
 private Map<String,Object> status(Map<String,Object> row){
  String state=row.get("state").toString(),id=row.get("id").toString();
  if(Set.of("queued","leased","retry").contains(state))return pending(id);
  String reason=state.equals("candidates_found")?"UNVERIFIED_CANDIDATE_QUEUED":state.equals("failed")?"DISCOVERY_UNAVAILABLE":"NO_VERIFIED_MATCH";
  // Candidate URLs never become public destinations. Only reviewed signed releases route.
  return Map.of("status","unknown","lookupId",id,"reason",reason);
 }
 private static Map<String,Object> pending(String id){return Map.of("status","pending","lookupId",id,"pollAfterSeconds",5);}
 Claim claim(){
  if(!workerEnabled)return null;
  return transactions.execute(tx->{
   Instant now=Instant.now();long hour=now.getEpochSecond()/3600,day=now.getEpochSecond()/86400;
   var daily=lockedBudget("discovery:day:global");var hourly=lockedBudget("discovery:hour:global");
   prune(now);
   db.update("UPDATE lookup_job SET state='failed',lease_owner=NULL,lease_until=NULL WHERE state='leased' AND lease_until<=? AND attempt>=3",at(now));
   if(used(daily,day)>=limits.probesPerDay||used(hourly,hour)>=limits.probesPerHour)return null;
   if(db.queryForObject("SELECT COUNT(*) FROM lookup_job WHERE state='leased' AND lease_until>?",Integer.class,at(now))>=limits.concurrency)return null;
   var rows=db.queryForList("SELECT * FROM lookup_job WHERE attempt<3 AND ((state IN ('queued','retry') AND run_after<=?) OR (state='leased' AND lease_until<=?)) ORDER BY run_after,created_at LIMIT 1 FOR UPDATE SKIP LOCKED",at(now),at(now));
   if(rows.isEmpty())return null;
   var row=rows.getFirst();String id=row.get("id").toString(),host=row.get("hostname").toString();
   String hostBucket="discovery:host:"+Signer.digest(host);
   var hosts=db.queryForList("SELECT window_start,used FROM request_budget WHERE bucket=? FOR UPDATE",hostBucket);
   int hostUsed=hosts.isEmpty()?0:used(hosts.getFirst(),hour);
   if(hostUsed>=limits.perHostPerHour){db.update("UPDATE lookup_job SET state='retry',run_after=?,lease_owner=NULL,lease_until=NULL WHERE id=?",at(Instant.ofEpochSecond((hour+1)*3600)),id);return null;}
   if(hosts.isEmpty())db.update("INSERT INTO request_budget(bucket,window_start,used) VALUES(?,?,0)",hostBucket,hour);
   String owner=UUID.randomUUID().toString();int attempt=((Number)row.get("attempt")).intValue()+1;
   db.update("UPDATE lookup_job SET state='leased',attempt=?,lease_owner=?,lease_until=? WHERE id=?",attempt,owner,at(now.plusSeconds(30)),id);
   charge("discovery:day:global",day,used(daily,day)+1);charge("discovery:hour:global",hour,used(hourly,hour)+1);charge(hostBucket,hour,hostUsed+1);
   return new Claim(id,host,owner,attempt);
  });
 }
 boolean complete(Claim claim,DiscoveryClient.Observation observation){
  return transactions.execute(tx->{
   Instant now=Instant.now();if(!owns(claim,now))return false;
   String state="unknown";
   if(observation!=null&&!observation.finalOrigin().equals("https://"+claim.hostname())){
    String target=Policy.origin(observation.finalOrigin());
    var exists=db.queryForList("SELECT id FROM candidate WHERE source_host=? AND proposed_origin=? AND created_at>=? LIMIT 1",claim.hostname(),target,at(now.minusSeconds(86400)));
    if(exists.isEmpty()){
     var families=db.queryForList("SELECT id FROM site_family WHERE source_origin=?","https://"+claim.hostname());
     String family=families.isEmpty()?null:families.getFirst().get("id").toString();
     String candidate=UUID.randomUUID().toString();
     String reason="UNVERIFIED_HTTP_REDIRECT; checkedAt="+observation.checkedAt()+"; hops="+observation.hopCount()+"; bodySha256="+observation.sha256()+"; identity=UNVERIFIED; threatStatus=UNKNOWN. Independent continuity review is required.";
     db.update("INSERT INTO candidate(id,family_id,source_host,proposed_origin,reason,state,submitter,created_at) VALUES(?,?,?,?,?,'pending',?,?)",candidate,family,claim.hostname(),target,reason,"discovery:"+claim.id(),at(now));
     audit("DISCOVERY_CANDIDATE",claim.id(),"Unverified redirect candidate queued; no family or release activated.");
    }
    state="candidates_found";
   }
   db.update("UPDATE lookup_job SET state=?,lease_owner=NULL,lease_until=NULL WHERE id=?",state,claim.id());return true;
  });
 }
 boolean failure(Claim claim,boolean retryable,String code){
  return transactions.execute(tx->{
   Instant now=Instant.now();if(!owns(claim,now))return false;
   boolean retry=retryable&&claim.attempt()<3;
   db.update("UPDATE lookup_job SET state=?,run_after=?,lease_owner=NULL,lease_until=NULL WHERE id=?",retry?"retry":"failed",at(now.plusSeconds(Math.min(60,5L*(1L<<claim.attempt())))),claim.id());
   audit("DISCOVERY_ATTEMPT_FAILED",claim.id(),"Bounded fetch attempt failed: "+code+"; "+(retry?"retry scheduled.":"no verified result."));return true;
  });
 }
 private boolean owns(Claim claim,Instant now){
  var rows=db.queryForList("SELECT state,lease_owner,attempt,lease_until,created_at FROM lookup_job WHERE id=? FOR UPDATE",claim.id());
  if(rows.isEmpty())return false;var row=rows.getFirst();
  return row.get("state").equals("leased")&&Objects.equals(row.get("lease_owner"),claim.leaseOwner())&&((Number)row.get("attempt")).intValue()==claim.attempt()&&Registry.toInstant(row.get("lease_until")).isAfter(now)&&Registry.toInstant(row.get("created_at")).isAfter(now.minusSeconds(limits.ttlSeconds));
 }
 private void prune(Instant now){
  db.update("DELETE FROM lookup_job WHERE created_at<?",at(now.minusSeconds(limits.ttlSeconds)));
  db.update("DELETE FROM request_budget WHERE bucket LIKE 'discovery:host:%' AND window_start<?",now.getEpochSecond()/3600-24);
 }
 private Map<String,Object> lockedBudget(String bucket){return db.queryForMap("SELECT window_start,used FROM request_budget WHERE bucket=? FOR UPDATE",bucket);}
 private static int used(Map<String,Object> row,long window){return ((Number)row.get("window_start")).longValue()==window?((Number)row.get("used")).intValue():0;}
 private void charge(String bucket,long window,int used){db.update("UPDATE request_budget SET window_start=?,used=? WHERE bucket=?",window,used,bucket);}
 private void audit(String action,String entity,String detail){db.update("INSERT INTO audit_event(id,actor,action,entity_id,detail,created_at) VALUES(?,?,?,?,?,?)",UUID.randomUUID().toString(),"discovery-worker",action,entity,detail,at(Instant.now()));}
 private static OffsetDateTime at(Instant time){return OffsetDateTime.ofInstant(time,ZoneOffset.UTC);}
}
