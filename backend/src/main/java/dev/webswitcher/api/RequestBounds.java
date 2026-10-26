package dev.webswitcher.api;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Bounds JSON bytes before MVC materializes a String or JSON tree, including chunked bodies. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RequestBounds extends OncePerRequestFilter {
 static final int MAX_BYTES=32768;
 @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
  if(request.getContentLengthLong()>MAX_BYTES){Security.json(response,413,"BODY_TOO_LARGE","Request body exceeds 32 KiB.");return;}
  String contentType=request.getContentType();
  if(contentType==null||!contentType.toLowerCase(java.util.Locale.ROOT).contains("application/json")){chain.doFilter(request,response);return;}
  // Reading at most MAX+1 is bounded for both known-length and streaming requests.
  byte[] bytes=request.getInputStream().readNBytes(MAX_BYTES+1);
  if(bytes.length>MAX_BYTES){Security.json(response,413,"BODY_TOO_LARGE","JSON body exceeds 32 KiB.");return;}
  var wrapper=new HttpServletRequestWrapper(request){
   @Override public ServletInputStream getInputStream(){
    var input=new ByteArrayInputStream(bytes);
    return new ServletInputStream(){public int read(){return input.read();}public int read(byte[] b,int off,int len){return input.read(b,off,len);}public boolean isFinished(){return input.available()==0;}public boolean isReady(){return true;}public void setReadListener(ReadListener listener){throw new UnsupportedOperationException("Synchronous JSON request body");}};
   }
   @Override public BufferedReader getReader(){return new BufferedReader(new InputStreamReader(getInputStream(),StandardCharsets.UTF_8));}
   @Override public int getContentLength(){return bytes.length;}
   @Override public long getContentLengthLong(){return bytes.length;}
  };
  chain.doFilter(wrapper,response);
 }
}
