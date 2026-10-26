package dev.webswitcher.api;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;
class ProductionBoundaryTest {
 @Test void demoProfileAndPublisherCredentialsFailClosed()throws Exception{
  var production=new MockEnvironment();
  assertThrows(IllegalStateException.class,()->new Signer(true,"","","api",production));
  assertThrows(IllegalStateException.class,()->new Signer(false,"/not-loaded/private.pk8","prod-key","api",production));
  assertThrows(IllegalStateException.class,()->new Signer(false,"","prod-key","publisher",production));
  assertThrows(IllegalStateException.class,()->new Signer(false,"","","worker",production));
  var api=new Signer(false,"","","api",production);
  assertThrows(Policy.Problem.class,()->api.sign(java.util.Map.of()));
 }
}
