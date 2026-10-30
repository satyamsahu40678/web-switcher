package dev.webswitcher.api;

import java.net.IDN;
import java.net.URI;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

final class Policy {
 static String hostname(String value) {
  if (value==null || value.isBlank() || value.length()>253 || !value.equals(value.strip()) || value.contains(":") || value.contains("/") || value.contains("@") || value.contains("?") || value.contains("#") || value.endsWith(".")) throw problem(400,"INVALID_HOST","A hostname without URL, port or credentials is required.");
  final String host;
  try {host=IDN.toASCII(value, IDN.USE_STD3_ASCII_RULES).toLowerCase(Locale.ROOT);} catch (IllegalArgumentException e) {throw problem(400,"INVALID_HOST","Invalid hostname.");}
  if (!host.contains(".") || host.length()>253 || host.startsWith(".") || host.contains("..") || host.matches("[0-9.]+")) throw problem(400,"INVALID_HOST","A fully qualified DNS hostname is required.");
  for (String label:host.split("\\.")) if (label.length()>63 || label.isEmpty() || label.startsWith("-") || label.endsWith("-")) throw problem(400,"INVALID_HOST","Invalid hostname label.");
  return host;
 }
 static String origin(String value) {
  try {
   URI uri=URI.create(value);
   if (!"https".equals(uri.getScheme()) || uri.getRawUserInfo()!=null || uri.getPort()!=-1 || uri.getRawQuery()!=null || uri.getRawFragment()!=null || !(uri.getRawPath().isEmpty() || uri.getRawPath().equals("/"))) throw new IllegalArgumentException();
   String host=hostname(uri.getHost());return "https://"+host;
  } catch (RuntimeException e) {throw problem(400,"INVALID_ORIGIN","An exact HTTPS origin without credentials, paths or ports is required.");}
 }
 static String text(Object value, int max, String field) {
  if (!(value instanceof String text) || text.isBlank() || text.length()>max) throw problem(400,"INVALID_INPUT",field+" is required and must be at most "+max+" characters.");
  return text.strip();
 }
 static void closed(Map<String,?> body,String... allowed) {
  var fields=java.util.Set.of(allowed);
  if (body==null || body.keySet().stream().anyMatch(k->!fields.contains(k))) throw problem(400,"INVALID_INPUT","Unexpected request fields.");
 }
 static Problem problem(int status,String code,String detail) {return new Problem(status,code,detail);}
 static final class Problem extends RuntimeException {
  final int status;final String code;final String requestId=UUID.randomUUID().toString();
  Problem(int status,String code,String detail){super(detail);this.status=status;this.code=code;}
 }
}
