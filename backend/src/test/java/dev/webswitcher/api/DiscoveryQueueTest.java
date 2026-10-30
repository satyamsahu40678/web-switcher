package dev.webswitcher.api;

import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.core.io.ClassPathResource;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

class DiscoveryQueueTest {
 JdbcTemplate db;DataSourceTransactionManager manager;DiscoveryQueue queue;DiscoveryTestDatabase database;
 static final DiscoveryQueue.Limits NORMAL=new DiscoveryQueue.Limits(100,20,100,3,2,3600);
 @BeforeEach void fresh()throws Exception{
  database=new DiscoveryTestDatabase();var source=database.source();
  new ResourceDatabasePopulator(new ClassPathResource("db/migration/V1__registry.sql")).execute(source);
  db=new JdbcTemplate(source);manager=new DataSourceTransactionManager(source);queue=queue(NORMAL);
 }
 @AfterEach void close()throws Exception{if(database!=null)database.close();}
 DiscoveryQueue queue(DiscoveryQueue.Limits limits){var value=new DiscoveryQueue(db,manager,true,true,limits);value.initialize();return value;}
 String enqueue(String host){return queue.enqueue(host).get("lookupId").toString();}
 void ready(String id){db.update("UPDATE lookup_job SET run_after=? WHERE id=?",OffsetDateTime.now(ZoneOffset.UTC).minusSeconds(1),id);}
 DiscoveryClient.Observation observation(String target){return new DiscoveryClient.Observation(target,2,"a".repeat(64),Instant.now().toString());}
 @Test void concurrentEnqueueDeduplicatesAndCompletedUnknownIsNegativelyCached()throws Exception{
  try(var pool=Executors.newFixedThreadPool(4)){
   var tasks=new ArrayList<Future<String>>();for(int i=0;i<8;i++)tasks.add(pool.submit(()->enqueue("old.documentation.test")));
   var ids=new HashSet<String>();for(var task:tasks)ids.add(task.get(5,TimeUnit.SECONDS));assertEquals(1,ids.size());
   assertEquals(1,db.queryForObject("SELECT count(*) FROM lookup_job",Integer.class));
   var claim=queue.claim();assertNotNull(claim);assertTrue(queue.complete(claim,null));
   assertEquals(ids.iterator().next(),enqueue("old.documentation.test"));assertEquals("unknown",queue.poll(claim.id()).get("status"));
   assertEquals(1,db.queryForObject("SELECT used FROM request_budget WHERE bucket='discovery:queue:global'",Integer.class));
  }
 }
 @Test void claimLeaseOwnershipExpiryAndGlobalConcurrencyAreEnforced(){
  String one=enqueue("one.documentation.test"),two=enqueue("two.documentation.test"),three=enqueue("three.documentation.test");
  var first=queue.claim();var second=queue.claim();assertNotNull(first);assertNotNull(second);assertNull(queue.claim());
  assertFalse(queue.complete(new DiscoveryQueue.Claim(first.id(),first.hostname(),"wrong-owner",first.attempt()),observation("https://new.documentation.test")));
  db.update("UPDATE lookup_job SET run_after=? WHERE id=?",OffsetDateTime.now(ZoneOffset.UTC).plusHours(1),three);
  db.update("UPDATE lookup_job SET lease_until=? WHERE id=?",OffsetDateTime.now(ZoneOffset.UTC).minusSeconds(1),first.id());
  var recovered=queue.claim();assertNotNull(recovered);assertEquals(first.id(),recovered.id());assertEquals(2,recovered.attempt());assertNotEquals(first.leaseOwner(),recovered.leaseOwner());
  assertFalse(queue.complete(first,observation("https://new.documentation.test")),"expired/stale lease cannot write a candidate");
  assertEquals(0,db.queryForObject("SELECT count(*) FROM candidate",Integer.class));
 }
 @Test void observationCreatesOnlyAPendingCandidateAndNeverLiveRouting(){
  String id=enqueue("old.documentation.test");var claim=queue.claim();assertEquals(id,claim.id());
  assertTrue(queue.complete(claim,observation("https://current.documentation.test")));
  var candidate=db.queryForMap("SELECT * FROM candidate");assertEquals("pending",candidate.get("state"));assertEquals("https://current.documentation.test",candidate.get("proposed_origin"));assertTrue(candidate.get("reason").toString().contains("UNVERIFIED"));
  assertEquals("unknown",queue.poll(id).get("status"));assertEquals("UNVERIFIED_CANDIDATE_QUEUED",queue.poll(id).get("reason"));assertFalse(queue.poll(id).containsKey("destinationOrigin"));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM site_family",Integer.class));assertEquals(0,db.queryForObject("SELECT count(*) FROM registry_release",Integer.class));assertEquals(1L,db.queryForObject("SELECT next_sequence FROM release_counter",Long.class));
  assertFalse(queue.complete(claim,observation("https://other.documentation.test")));assertEquals(1,db.queryForObject("SELECT count(*) FROM candidate",Integer.class));
 }
 @Test void sameOriginReachabilityCannotBecomeAMigration(){
  var claim=queue.claim();assertNull(claim);String id=enqueue("old.documentation.test");claim=queue.claim();
  assertTrue(queue.complete(claim,observation("https://old.documentation.test")));assertEquals("NO_VERIFIED_MATCH",queue.poll(id).get("reason"));assertEquals(0,db.queryForObject("SELECT count(*) FROM candidate",Integer.class));
 }
 @Test void retriesStopAfterThreeAttemptsAndRespectBackoff(){
  String id=enqueue("old.documentation.test");
  for(int attempt=1;attempt<=3;attempt++){
   var claim=queue.claim();assertNotNull(claim);assertEquals(attempt,claim.attempt());assertTrue(queue.failure(claim,true,"FETCHER_HTTP_503"));
   if(attempt<3){assertNull(queue.claim(),"retry must wait for its bounded backoff");ready(id);}
  }
  assertNull(queue.claim());assertEquals("DISCOVERY_UNAVAILABLE",queue.poll(id).get("reason"));assertEquals(3,db.queryForObject("SELECT attempt FROM lookup_job WHERE id=?",Integer.class,id));
  String crashed=enqueue("crashed.documentation.test");assertNotNull(queue.claim());db.update("UPDATE lookup_job SET attempt=3,lease_until=? WHERE id=?",OffsetDateTime.now(ZoneOffset.UTC).minusSeconds(1),crashed);assertNull(queue.claim());assertEquals("failed",db.queryForObject("SELECT state FROM lookup_job WHERE id=?",String.class,crashed));
 }
 @Test void expiredReferencesAreUnavailableAndPhysicallyPruned(){
  String id=enqueue("old.documentation.test");db.update("UPDATE lookup_job SET created_at=? WHERE id=?",OffsetDateTime.now(ZoneOffset.UTC).minusHours(2),id);
  assertThrows(Policy.Problem.class,()->queue.poll(id));assertThrows(Policy.Problem.class,()->queue.poll("1-1-1-1-1"));assertThrows(Policy.Problem.class,()->queue.poll(UUID.randomUUID().toString()));
  enqueue("other.documentation.test");assertEquals(0,db.queryForObject("SELECT count(*) FROM lookup_job WHERE id=?",Integer.class,id));
 }
 @Test void durableQueueAndProbeBudgetsAreChargedBeforeDispatch(){
  queue=queue(new DiscoveryQueue.Limits(1,1,1,1,1,3600));String id=enqueue("one.documentation.test");assertThrows(Policy.Problem.class,()->enqueue("two.documentation.test"));
  var claim=queue.claim();assertNotNull(claim);assertEquals(1,db.queryForObject("SELECT used FROM request_budget WHERE bucket='discovery:hour:global'",Integer.class));assertEquals(1,db.queryForObject("SELECT used FROM request_budget WHERE bucket='discovery:day:global'",Integer.class));
  queue.failure(claim,true,"FETCHER_UNAVAILABLE");ready(id);assertNull(queue.claim(),"restarting the queue cannot replenish a durable dispatch budget");
  var restarted=queue(new DiscoveryQueue.Limits(1,1,1,1,1,3600));assertNull(restarted.claim());
 }
 @Test void terminalFetcherFailuresNeverRetryOrCreateCandidates(){
  String id=enqueue("old.documentation.test");var claim=queue.claim();assertTrue(queue.failure(claim,false,"FETCHER_INVALID_RESPONSE"));assertNull(queue.claim());assertEquals("DISCOVERY_UNAVAILABLE",queue.poll(id).get("reason"));assertEquals(0,db.queryForObject("SELECT count(*) FROM candidate",Integer.class));
 }
 @Test void disabledQueueHasNoPublicReferencesAndCannotClaim(){
  var disabled=new DiscoveryQueue(db,manager,false,false,NORMAL);disabled.initialize();assertFalse(disabled.enabled());assertThrows(Policy.Problem.class,()->disabled.enqueue("old.documentation.test"));assertThrows(Policy.Problem.class,()->disabled.poll(UUID.randomUUID().toString()));assertNull(disabled.claim());
 }
}
