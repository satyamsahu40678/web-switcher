package dev.webswitcher.api;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
class PolicyTest {
 @Test void canonicalHostnameAndOrigin(){assertEquals("xn--bcher-kva.example",Policy.hostname("Bücher.example"));assertEquals("https://old.example",Policy.origin("https://old.example/"));}
 @Test void rejectsUrlMaterialAndNonDnsHosts(){for(String bad:List.of("https://old.example/a?token=x","old.example:443","old.example/","old.example.","127.0.0.1","localhost","name@old.example","old..example","-old.example","old.example#token"))assertThrows(Policy.Problem.class,()->Policy.hostname(bad),bad);}
 @Test void rejectsUnsafeOrigins(){for(String bad:List.of("http://old.example","https://user:pass@old.example","https://old.example:8443","https://old.example/path","https://old.example?token=x","https://old.example#x"))assertThrows(Policy.Problem.class,()->Policy.origin(bad),bad);}
 @Test void rejectsDuplicateJsonAndOversize(){assertThrows(Policy.Problem.class,()->Api.body("{\"hostname\":\"old.example\",\"hostname\":\"evil.example\"}"));assertThrows(Policy.Problem.class,()->Api.body("x".repeat(32769)));assertThrows(Policy.Problem.class,()->Api.body("[]"));assertThrows(Policy.Problem.class,()->Api.body("{\"hostname\":\"old.example\"} {\"hostname\":\"other.example\"}"));}
}
