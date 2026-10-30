package dev.webswitcher.api;

import java.sql.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class H2ConnectionLifecycleTest {
 @Test void migratedConstraintsSurviveClosureOfPhysicalMigrationConnections() throws Exception {
  // DB_CLOSE_DELAY preserves the database, not the physical sessions Flyway closes.
  // H2 2.4.240 cached a CHECK IN comparator attached to that closed session (#4302).
  String url="jdbc:h2:mem:lifecycle_"+UUID.randomUUID()+";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
  try {
   Flyway.configure().dataSource(url,"sa","").locations("classpath:db/migration").load().migrate();
   String[] states={"pending","approved","rejected","quarantined"};
   for(int i=0;i<states.length;i++) {
    try(var connection=DriverManager.getConnection(url,"sa","");var insert=connection.prepareStatement(
      "INSERT INTO candidate(id,source_host,proposed_origin,reason,state,submitter,created_at) VALUES(?,?,?,?,?,?,?)")) {
     insert.setString(1,"candidate-"+i);insert.setString(2,"old.documentation.test");
     insert.setString(3,"https://current.documentation.test");insert.setString(4,"unverified observation");
     insert.setString(5,states[i]);insert.setString(6,"discovery:fixture");insert.setObject(7,OffsetDateTime.now());
     assertEquals(1,insert.executeUpdate(),"valid state must remain writable after physical reconnection");
    }
   }
   try(var connection=DriverManager.getConnection(url,"sa","");var statement=connection.createStatement()) {
    assertEquals(1,statement.executeUpdate("INSERT INTO site_family(id,name,source_origin,destination_origin,state,valid_until) VALUES('family','Fixture','https://old.documentation.test','https://current.documentation.test','active',CURRENT_TIMESTAMP)"));
    assertEquals(1,statement.executeUpdate("UPDATE site_family SET state='revoked' WHERE id='family'"));
    SQLException invalidCandidate=assertThrows(SQLException.class,()->statement.executeUpdate("UPDATE candidate SET state='unreviewed' WHERE id='candidate-0'"));
    assertEquals("23513",invalidCandidate.getSQLState(),"invalid data must still violate the CHECK constraint");
    SQLException invalidFamily=assertThrows(SQLException.class,()->statement.executeUpdate("UPDATE site_family SET state='unreviewed' WHERE id='family'"));
    assertEquals("23513",invalidFamily.getSQLState());
    try(var rows=statement.executeQuery("SELECT COUNT(*) FROM candidate")) {assertTrue(rows.next());assertEquals(4,rows.getInt(1));}
   }
  } finally {
   try(var connection=DriverManager.getConnection(url,"sa","");var statement=connection.createStatement()) {statement.execute("SHUTDOWN");}
  }
 }
}
