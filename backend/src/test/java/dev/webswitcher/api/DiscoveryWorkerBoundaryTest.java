package dev.webswitcher.api;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;

class DiscoveryWorkerBoundaryTest {
 @Test void workerIdentityRequiresExplicitNonDemoProfileAndNeverLoadsPrivatePublishingKeys()throws Exception{
  var worker=new MockEnvironment().withProperty("spring.main.web-application-type","none");worker.setActiveProfiles("worker");
  var signer=new Signer(false,"","","worker",worker);assertThrows(Policy.Problem.class,()->signer.sign(java.util.Map.of()));
  assertThrows(IllegalStateException.class,()->new Signer(false,"/never-read/private.pk8","prod-key","worker",worker));
  worker.setActiveProfiles("worker","demo");assertThrows(IllegalStateException.class,()->new Signer(true,"","","worker",worker));
 }
 @Test void networkWorkerCannotBeEnabledInsideThePublicApiOrAServletProcess(){
  String token="isolated-fixture-only-token-0123456789";
  var api=new MockEnvironment().withProperty("spring.main.web-application-type","servlet");
  assertThrows(IllegalStateException.class,()->new DiscoveryWorker(null,"http://127.0.0.1:8081",token,"api",api));
  api.setActiveProfiles("worker");assertThrows(IllegalStateException.class,()->new DiscoveryWorker(null,"http://127.0.0.1:8081",token,"worker",api));
  api.withProperty("spring.main.web-application-type","none");assertThrows(IllegalStateException.class,()->new DiscoveryWorker(null,"",token,"worker",api));
  assertThrows(IllegalStateException.class,()->new DiscoveryWorker(null,"http://127.0.0.1:8081","","worker",api));
 }
}
