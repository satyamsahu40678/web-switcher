package dev.webswitcher.api;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.DriverManager;
import java.util.*;

/** Every test owns its own schema; never touches the surrounding PostgreSQL test database's public schema. */
final class DiscoveryTestDatabase implements AutoCloseable {
 final String url,user,password;private final String original,schema;private HikariDataSource source;
 DiscoveryTestDatabase()throws Exception{
  original=System.getenv("TEST_DATABASE_URL");
  if(original!=null&&!original.isBlank()){
   if(!original.startsWith("jdbc:postgresql:"))throw new IllegalStateException("The discovery external test target must be PostgreSQL.");
   user=System.getenv().getOrDefault("TEST_DATABASE_USER","sa");password=System.getenv().getOrDefault("TEST_DATABASE_PASSWORD","");schema="discovery_"+UUID.randomUUID().toString().replace("-","");
   try(var connection=DriverManager.getConnection(original,user,password);var statement=connection.createStatement()){statement.execute("CREATE SCHEMA "+schema);}
   var pieces=original.split("\\?",2);var query=new ArrayList<String>();if(pieces.length==2)for(String item:pieces[1].split("&"))if(!item.startsWith("currentSchema=")&&!item.isEmpty())query.add(item);
   query.add("currentSchema="+schema);url=pieces[0]+"?"+String.join("&",query);
  }else{user="sa";password="";schema=null;url="jdbc:h2:mem:discovery_"+UUID.randomUUID()+";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE";}
 }
 HikariDataSource source(){
  if(source==null){var settings=new HikariConfig();settings.setJdbcUrl(url);settings.setUsername(user);settings.setPassword(password);settings.setMaximumPoolSize(4);settings.setMinimumIdle(1);source=new HikariDataSource(settings);}return source;
 }
 public void close()throws Exception{
  if(source!=null)source.close();
  if(schema!=null){
   if(!schema.matches("discovery_[0-9a-f]{32}"))throw new IllegalStateException("Unexpected owned test schema identifier.");
   try(var connection=DriverManager.getConnection(original,user,password);var statement=connection.createStatement()){statement.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE");}
  }
 }
}
