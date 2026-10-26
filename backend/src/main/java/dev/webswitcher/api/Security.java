package dev.webswitcher.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.core.userdetails.User;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.util.*;

@Configuration
class Security {
 @Bean InMemoryUserDetailsManager demoUsers(@Value("${web-switcher.demo}") boolean demo) {
  var manager=new InMemoryUserDetailsManager();
  if(demo){
   var encoder=org.springframework.security.crypto.factory.PasswordEncoderFactories.createDelegatingPasswordEncoder();
   manager.createUser(User.withUsername("demo-reviewer").password(encoder.encode("demo-password")).roles("REVIEWER").build());
   manager.createUser(User.withUsername("demo-publisher").password(encoder.encode("demo-password")).roles("PUBLISHER").build());
  }
  return manager;
 }
 @Bean SecurityFilterChain chain(HttpSecurity http,@Value("${web-switcher.demo}") boolean demo,
 @Value("${web-switcher.admin-subjects}") String reviewers,@Value("${web-switcher.publisher-subjects}") String publishers,
 ObjectProvider<ClientRegistrationRepository> registrations, @Value("${web-switcher.public-origin:}")String publicOrigin, @Value("${DEV_ALLOW_LOOPBACK:false}")boolean loopback) throws Exception {
  if(!demo){Policy.origin(publicOrigin);if(loopback)throw new IllegalStateException("DEV_ALLOW_LOOPBACK is forbidden in production.");}
  http.authorizeHttpRequests(a->a
   .requestMatchers("/health/**","/v1/session","/v1/catalog/**","/v1/keys","/v1/families/**","/v1/lookups/**","/v1/reports","/error","/","/index.html","/assets/**","/oauth2/**","/login/oauth2/**").permitAll()
   .requestMatchers(org.springframework.http.HttpMethod.POST,"/v1/admin/releases").hasRole("PUBLISHER")
   .requestMatchers("/v1/admin/families/*/revoke").hasRole("PUBLISHER")
   .requestMatchers("/v1/admin/candidates/*/decisions").hasRole("REVIEWER")
   .requestMatchers("/v1/admin/**").hasAnyRole("REVIEWER","PUBLISHER")
   .anyRequest().denyAll());
  http.csrf(c->c.csrfTokenRepository(new HttpSessionCsrfTokenRepository()).ignoringRequestMatchers("/v1/lookups","/v1/reports"));
  http.headers(h->h.contentSecurityPolicy(c->c.policyDirectives("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")));
  http.exceptionHandling(e->e.authenticationEntryPoint((req,res,error)->json(res,401,"UNAUTHENTICATED","Authentication is required.")).accessDeniedHandler((req,res,error)->json(res,403,"FORBIDDEN","Permission or CSRF token is missing.")));
  if(demo)http.formLogin(f->f.loginProcessingUrl("/v1/admin/login").successHandler((req,res,auth)->{res.setContentType("application/json");res.getWriter().write("{\"ok\":true}");}).failureHandler((req,res,error)->json(res,401,"UNAUTHENTICATED","Login failed.")));
  else {
   if(registrations.getIfAvailable()==null || (reviewers.isBlank()&&publishers.isBlank())) throw new IllegalStateException("Production requires configured OIDC and explicit reviewer/publisher subject allowlists.");
   Set<String> r=split(reviewers),p=split(publishers);
   var service=new OidcUserService();
   http.oauth2Login(o->o.userInfoEndpoint(u->u.oidcUserService(request->{
    var user=service.loadUser(request);String subject=user.getSubject();
    var roles=new ArrayList<SimpleGrantedAuthority>();
    if(r.contains(subject))roles.add(new SimpleGrantedAuthority("ROLE_REVIEWER"));
    if(p.contains(subject))roles.add(new SimpleGrantedAuthority("ROLE_PUBLISHER"));
    if(roles.isEmpty())throw new org.springframework.security.oauth2.core.OAuth2AuthenticationException("Subject is not authorized");
    return new DefaultOidcUser(roles,user.getIdToken(),user.getUserInfo(),"sub");
   })));
  }
  http.logout(l->l.logoutUrl("/v1/admin/logout").logoutSuccessHandler((req,res,auth)->{res.setContentType("application/json");res.getWriter().write("{\"ok\":true}");}));
  return http.build();
 }
 static Set<String> split(String x){return new HashSet<>(Arrays.asList(x.split(",")));}
 static void json(HttpServletResponse response,int status,String code,String detail)throws IOException{
  response.setStatus(status);response.setContentType("application/problem+json");response.getWriter().write("{\"type\":\"about:blank\",\"status\":"+status+",\"code\":\""+code+"\",\"detail\":\""+detail+"\",\"requestId\":\""+UUID.randomUUID()+"\"}");
 }
}
