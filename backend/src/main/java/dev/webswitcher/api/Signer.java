package dev.webswitcher.api;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.nio.file.*;
import java.security.*;
import java.security.interfaces.ECPublicKey;
import java.security.spec.*;
import java.util.*;

@Component
class Signer {
 static final ObjectMapper JSON=new ObjectMapper(JsonFactory.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build());
 private final PrivateKey privateKey;private final PublicKey publicKey;final String keyId;final boolean demo;
 Signer(@Value("${web-switcher.demo}")boolean demo,@Value("${web-switcher.publishing-private-key:}")String keyFile,@Value("${web-switcher.publishing-key-id:}")String keyId,@Value("${web-switcher.runtime-role:api}")String role,org.springframework.core.env.Environment environment)throws Exception{
  if(demo&&!environment.acceptsProfiles(org.springframework.core.env.Profiles.of("demo")))throw new IllegalStateException("Demo mode requires the explicit demo Spring profile.");
  if(!Set.of("api","publisher").contains(role))throw new IllegalStateException("APP_ROLE must be api or publisher.");
  if(!demo&&role.equals("api")&&!keyFile.isBlank())throw new IllegalStateException("The public API role must not hold publishing credentials.");
  if(!demo&&role.equals("publisher")&&keyFile.isBlank())throw new IllegalStateException("The publisher role requires a publishing key.");
  this.demo=demo;
  if(demo){
   Path dir=Path.of("data");Files.createDirectories(dir);Path secret=dir.resolve("demo-registry-private.pk8"),pub=dir.resolve("demo-registry-public.der");
   if(!Files.exists(secret)||!Files.exists(pub)){
    KeyPairGenerator gen=KeyPairGenerator.getInstance("EC");gen.initialize(new ECGenParameterSpec("secp256r1"));KeyPair pair=gen.generateKeyPair();
    Files.write(secret,pair.getPrivate().getEncoded());Files.write(pub,pair.getPublic().getEncoded());
    try {Files.setPosixFilePermissions(secret,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));}catch(UnsupportedOperationException ignored){}
   }
   privateKey=KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(secret)));
   publicKey=KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(Files.readAllBytes(pub)));this.keyId="demo-registry-1";
  }else{
   if(!keyFile.isBlank()&&keyId.isBlank())throw new IllegalStateException("Publishing key ID is required with private key.");
   privateKey=keyFile.isBlank()?null:KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(Path.of(keyFile))));publicKey=null;this.keyId=keyId;
  }
 }
 String sign(Map<String,Object> payload){
  if(privateKey==null)throw Policy.problem(503,"PUBLISHER_UNAVAILABLE","This process does not hold a publishing key.");
  try {
   String protectedHeader=b64(JSON.writeValueAsBytes(Map.of("alg","ES256","typ","web-switcher-catalog+jws","kid",keyId)));
   String content=protectedHeader+"."+b64(JSON.writeValueAsBytes(payload));
   Signature signer=Signature.getInstance("SHA256withECDSAinP1363Format");signer.initSign(privateKey);signer.update(content.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
   byte[] signature=signer.sign();if(signature.length!=64)throw new IllegalStateException("Unexpected ES256 signature length");
   return content+"."+b64(signature);
  }catch(GeneralSecurityException|java.io.IOException e){throw new IllegalStateException("Signing failed",e);}
 }
 Map<String,Object> publicJwk(){
  if(!demo)throw Policy.problem(404,"NOT_FOUND","Production trust anchors are distributed out of band.");
  ECPublicKey pub=(ECPublicKey)publicKey;
  return Map.of("kty","EC","crv","P-256","x",b64(fixed(pub.getW().getAffineX().toByteArray())),"y",b64(fixed(pub.getW().getAffineY().toByteArray())),"kid",keyId,"use","sig","alg","ES256");
 }
 static byte[] fixed(byte[] in){byte[] out=new byte[32];System.arraycopy(in,Math.max(0,in.length-32),out,Math.max(0,32-in.length),Math.min(32,in.length));return out;}
 static String b64(byte[] x){return Base64.getUrlEncoder().withoutPadding().encodeToString(x);}
 static String digest(String x){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(x.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
}
