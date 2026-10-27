package dev.webswitcher.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Non-web, keyless worker. It has no public controller or publishing API. */
@Component
@EnableScheduling
@ConditionalOnProperty(name="web-switcher.discovery.worker-enabled",havingValue="true")
class DiscoveryWorker {
 private final DiscoveryQueue queue;private final DiscoveryClient client;
 DiscoveryWorker(DiscoveryQueue queue,@Value("${web-switcher.discovery.fetcher-url:}")String url,@Value("${web-switcher.discovery.fetcher-token:}")String token,@Value("${web-switcher.runtime-role:api}")String role,Environment environment){
  if(!role.equals("worker")||!environment.acceptsProfiles(Profiles.of("worker"))||!"none".equals(environment.getProperty("spring.main.web-application-type")))throw new IllegalStateException("Discovery network work requires the separate non-web worker profile and role.");
  this.queue=queue;this.client=new DiscoveryClient(url,token);
 }
 @Scheduled(fixedDelayString="${web-switcher.discovery.poll-ms:5000}",initialDelayString="${web-switcher.discovery.initial-delay-ms:1000}")
 public void tick(){
  DiscoveryQueue.Claim claim=queue.claim();if(claim==null)return;
  try{queue.complete(claim,client.probe(claim.hostname()));}
  catch(DiscoveryClient.Failure failure){queue.failure(claim,failure.retryable,failure.code);}
 }
}
