#!/usr/bin/env python3
"""Exercise opt-in worker permissions and normal queue SQL on disposable PG17."""
import json,os,pathlib,secrets,subprocess,tempfile,time,uuid
root=pathlib.Path(__file__).resolve().parents[2]
env=os.environ.copy()
for key in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'):env.pop(key,None)
docker=['docker','--host=unix:///var/run/docker.sock']
container='web-switcher-worker-grants-'+uuid.uuid4().hex[:10]
network=container+'-private'
fixture=container+'-fetcher'
runtime=container+'-runtime'
api_image=os.environ.get('WORKER_TEST_API_IMAGE','')
tools_image=os.environ.get('WORKER_TEST_TOOLS_IMAGE','web-switcher-backup-drill:local')
checks=[]
report=root/'test-results/worker-grants.json'
report.parent.mkdir(exist_ok=True)
report.unlink(missing_ok=True)
with tempfile.TemporaryDirectory(prefix='web-switcher-worker-grants-') as work:
    directory=pathlib.Path(work)
    migration=directory/'V1__registry.sql';migration.write_bytes((root/'backend/src/main/resources/db/migration/V1__registry.sql').read_bytes())
    passwords={key:secrets.token_urlsafe(32) for key in ('OWNER_DATABASE_PASSWORD','API_DATABASE_PASSWORD','PUBLISHER_DATABASE_PASSWORD','WORKER_DATABASE_PASSWORD')}
    for key,value in passwords.items():
        file=directory/key;file.write_text(value);file.chmod(0o600)
    role_key={'webswitcher_owner':'OWNER_DATABASE_PASSWORD','webswitcher_api':'API_DATABASE_PASSWORD','webswitcher_publisher':'PUBLISHER_DATABASE_PASSWORD','webswitcher_worker':'WORKER_DATABASE_PASSWORD'}
    def sanitized(text):
        for value in passwords.values():text=text.replace(value,'[REDACTED]')
        return text
    def sql(role,statement,expected=True,database='webswitcher'):
        # Credential is consumed on stdin into psql's environment, never args/logs.
        command=docker+['exec','-i',container,'sh','-c','IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$1" -d "$2"','sh',role,database]
        result=subprocess.run(command,env=env,input=passwords[role_key[role]]+'\n'+statement+'\n',capture_output=True,text=True)
        if expected and result.returncode:raise AssertionError('Required SQL failed: '+sanitized(result.stderr))
        if not expected and result.returncode==0:raise AssertionError('Forbidden SQL unexpectedly succeeded')
        return result.stdout.strip()
    def bootstrap(worker=True,expected=True):
        script='bootstrap-worker-db.sh' if worker else 'bootstrap-db.sh'
        command=docker+['exec','--user',str(os.getuid())+':'+str(os.getgid()),'-e','WEB_SWITCHER_SECRET_DIR=/secrets','-e','PGHOST=127.0.0.1','-e','PGUSER=webswitcher_owner','-e','PGDATABASE=webswitcher',container,'bash','/deployment/'+script]
        result=subprocess.run(command,env=env,capture_output=True,text=True)
        if (result.returncode==0)!=expected:raise AssertionError('Bootstrap outcome unexpected: '+sanitized(result.stderr))
    def docker_run(arguments):
        result=subprocess.run(docker+arguments,env=env,capture_output=True,text=True)
        if result.returncode:raise AssertionError('Docker acceptance command failed: '+sanitized(result.stderr))
        return result.stdout.strip()
    owner='webswitcher_owner';api='webswitcher_api';publisher='webswitcher_publisher';worker='webswitcher_worker'
    job=str(uuid.uuid4());candidate=str(uuid.uuid4());family='worker-grants-family';host='old.worker-grants.test';target='https://current.worker-grants.test';host_bucket='discovery:host:'+'b'*64
    try:
        if api_image:docker_run(['network','create','--internal',network])
        command=docker+['run','--rm','-d','--name',container,'--mount',f'type=bind,src={work},dst=/secrets,readonly','--mount',f'type=bind,src={root}/infra/deploy/bootstrap-db.sh,dst=/deployment/bootstrap-db.sh,readonly','--mount',f'type=bind,src={root}/infra/deploy/bootstrap-worker-db.sh,dst=/deployment/bootstrap-worker-db.sh,readonly','--mount',f'type=bind,src={migration},dst=/deployment/V1__registry.sql,readonly','-e','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256','-e','POSTGRES_USER=webswitcher_owner','-e','POSTGRES_DB=webswitcher','-e','POSTGRES_PASSWORD_FILE=/secrets/OWNER_DATABASE_PASSWORD','postgres:17']
        if api_image:command[-1:-1]=['--network',network,'--network-alias','postgres']
        subprocess.run(command,env=env,check=True,stdout=subprocess.DEVNULL)
        for _ in range(80):
            ready=subprocess.run(docker+['exec',container,'pg_isready','-h','127.0.0.1','-U',owner,'-d','webswitcher'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if ready.returncode==0:break
            time.sleep(.25)
        else:raise AssertionError('Disposable PostgreSQL did not become ready')
        bootstrap(False);bootstrap();checks.append('opt-in owner bootstrap creates a non-inheriting restricted worker on verifiedV1')
        sql(owner,f"INSERT INTO site_family(id,name,source_origin,destination_origin,state,valid_until) VALUES('{family}','Controlled grants fixture','https://{host}','{target}','active',CURRENT_TIMESTAMP+INTERVAL '1 day'); INSERT INTO registry_release VALUES(1,'fixture-digest','signed-unchanged',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '1 hour','fixture-publisher')")
        for bucket in ('lookup:global','report:global','lookup-poll:global','discovery:queue:global','discovery:hour:global','discovery:day:global'):
            sql(worker,f"INSERT INTO request_budget(bucket,window_start,used) VALUES('{bucket}',0,0)")
        assert sql(worker,"SELECT count(*) FROM request_budget")=='6';checks.append('worker initializes exact API/discovery global rows without private IP data')
        sql(api,"INSERT INTO request_budget VALUES('lookup:ip:private-address-hash',0,3)")
        assert sql(worker,"SELECT count(*) FROM request_budget WHERE bucket LIKE '%:ip:%'")=='0'
        sql(worker,"INSERT INTO request_budget VALUES('lookup:ip:forged',0,0)",False)
        sql(worker,"INSERT INTO request_budget VALUES('unscoped-global',0,0)",False)
        sql(worker,"INSERT INTO request_budget VALUES('discovery:host:not-a-sha256',0,0)",False)
        checks.append('budget RLS hides IP-hash rows and refuses arbitrary/public bucket insertion')
        sql(api,f"INSERT INTO lookup_job(id,hostname,state,attempt,run_after,created_at) VALUES('{job}','{host}','queued',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        hour=sql(owner,'SELECT floor(extract(epoch FROM CURRENT_TIMESTAMP)/3600)::bigint');day=sql(owner,'SELECT floor(extract(epoch FROM CURRENT_TIMESTAMP)/86400)::bigint')
        sql(worker,f"BEGIN; SELECT window_start,used FROM request_budget WHERE bucket='discovery:day:global' FOR UPDATE; SELECT window_start,used FROM request_budget WHERE bucket='discovery:hour:global' FOR UPDATE; SELECT id FROM lookup_job WHERE attempt<3 AND state='queued' AND run_after<=CURRENT_TIMESTAMP ORDER BY run_after,created_at LIMIT 1 FOR UPDATE SKIP LOCKED; INSERT INTO request_budget VALUES('{host_bucket}',{hour},0); UPDATE lookup_job SET state='leased',attempt=1,lease_owner='lease-owner',lease_until=CURRENT_TIMESTAMP+INTERVAL '30 seconds' WHERE id='{job}'; UPDATE request_budget SET window_start={day},used=1 WHERE bucket='discovery:day:global'; UPDATE request_budget SET window_start={hour},used=1 WHERE bucket IN ('discovery:hour:global','{host_bucket}'); COMMIT")
        assert sql(worker,f"SELECT state FROM lookup_job WHERE id='{job}'")=='leased';checks.append('normal durable claim SQL locks jobs/budgets and charges only probe buckets')
        sql(worker,f"SELECT id FROM candidate WHERE source_host='{host}' AND proposed_origin='{target}' AND created_at>=CURRENT_TIMESTAMP-INTERVAL '1 day' LIMIT 1; SELECT id FROM site_family WHERE source_origin='https://{host}'; INSERT INTO candidate(id,family_id,source_host,proposed_origin,reason,state,submitter,created_at) VALUES('{candidate}','{family}','{host}','{target}','UNVERIFIED_HTTP_REDIRECT fixture','pending','discovery:{job}',CURRENT_TIMESTAMP); INSERT INTO audit_event VALUES('worker-audit','discovery-worker','DISCOVERY_CANDIDATE','{job}','Unverified fixture; no route activated',CURRENT_TIMESTAMP); UPDATE lookup_job SET state='candidates_found',lease_owner=NULL,lease_until=NULL WHERE id='{job}'")
        assert sql(owner,'SELECT signed_blob FROM registry_release WHERE sequence=1')=='signed-unchanged';checks.append('dedupe and pending-candidate/audit completion leaves published catalog unchanged')
        for field in ('reason','reviewer','submitter','state'):
            sql(worker,'SELECT '+field+' FROM candidate',False)
        assert sql(worker,f"SELECT id FROM candidate WHERE id='{candidate}'")==candidate;checks.append('worker reads only candidate dedupe columns, not report/review evidence')
        forged=str(uuid.uuid4())
        sql(worker,f"INSERT INTO candidate(id,source_host,proposed_origin,reason,state,submitter,created_at) VALUES('{forged}','other.test','https://current.test','forged trusted state','approved','discovery:{job}',CURRENT_TIMESTAMP)",False)
        sql(worker,f"INSERT INTO candidate(id,source_host,proposed_origin,reason,state,submitter,created_at) VALUES('{forged}','other.test','https://current.test','forged submitter','pending','publisher',CURRENT_TIMESTAMP)",False)
        sql(worker,f"INSERT INTO candidate(id,source_host,proposed_origin,reason,state,submitter,reviewer,created_at) VALUES('{forged}','other.test','https://current.test','forged reviewer','pending','discovery:{job}','reviewer',CURRENT_TIMESTAMP)",False)
        sql(worker,f"UPDATE candidate SET state='approved' WHERE id='{candidate}'",False);sql(worker,f"DELETE FROM candidate WHERE id='{candidate}'",False)
        checks.append('candidate guard and column grants prevent approvals/reviewer forgery or candidate mutation')
        for statement in ("UPDATE site_family SET destination_origin='https://attacker.test'","INSERT INTO registry_release VALUES(2,'forged','forged',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'forged')","UPDATE release_counter SET next_sequence=99","SELECT * FROM pending_decision","CREATE TABLE forbidden(id int)","ALTER TABLE request_budget DISABLE ROW LEVEL SECURITY"):
            sql(worker,statement,False)
        checks.append('worker cannot alter families, decisions, releases, sequence, schema or RLS')
        sql(worker,"INSERT INTO audit_event VALUES('forged-audit','publisher','CATALOG_PUBLISHED','2','forged privileged event',CURRENT_TIMESTAMP)",False)
        sql(worker,"SELECT * FROM audit_event",False);sql(worker,"UPDATE audit_event SET detail='tampered'",False);sql(worker,"DELETE FROM audit_event",False)
        checks.append('worker appends only its own discovery audit event types')
        sql(worker,"UPDATE request_budget SET used=100 WHERE bucket IN ('lookup:global','report:global','lookup-poll:global','discovery:queue:global')")
        assert sql(owner,"SELECT sum(used) FROM request_budget WHERE bucket IN ('lookup:global','report:global','lookup-poll:global','discovery:queue:global')")=='0'
        sql(worker,f"UPDATE request_budget SET bucket='lookup:ip:forged' WHERE bucket='{host_bucket}'",False)
        sql(worker,f"DELETE FROM request_budget WHERE bucket='{host_bucket}'")
        assert sql(owner,f"SELECT count(*) FROM request_budget WHERE bucket='{host_bucket}'")=='1'
        aged='discovery:host:'+'c'*64;sql(owner,f"INSERT INTO request_budget VALUES('{aged}',0,1)");sql(worker,"DELETE FROM request_budget WHERE bucket LIKE 'discovery:host:%' AND window_start<floor(extract(epoch FROM CURRENT_TIMESTAMP)/3600)::bigint-24")
        assert sql(owner,f"SELECT count(*) FROM request_budget WHERE bucket='{aged}'")=='0';checks.append('worker cannot change public/queue budgets or bucket keys and prunes only aged host rows')
        sql(api,"BEGIN; SELECT used FROM request_budget WHERE bucket='lookup:global' FOR UPDATE; UPDATE request_budget SET window_start=1,used=2 WHERE bucket='lookup:global'; UPDATE request_budget SET used=4 WHERE bucket='lookup:ip:private-address-hash'; DELETE FROM request_budget WHERE bucket LIKE '%:ip:%' AND window_start<1; COMMIT")
        sql(publisher,"UPDATE request_budget SET used=1 WHERE bucket='report:global'; INSERT INTO audit_event VALUES('publisher-audit','publisher','CATALOG_PUBLISHED','2','Existing publisher semantics',CURRENT_TIMESTAMP)")
        assert sql(api,"SELECT used FROM request_budget WHERE bucket='lookup:global'")=='2';checks.append('existing API/publisher counter locking, updates and retention still work under RLS')
        decision=str(uuid.uuid4())
        sql(api,f"UPDATE candidate SET state='approved',reviewer='reviewer',version=version+1 WHERE id='{candidate}'; INSERT INTO pending_decision VALUES('{decision}','{candidate}','https://{host}','{target}','reviewer','Independent reviewed fixture',CURRENT_TIMESTAMP+INTERVAL '1 day',NULL)")
        sql(publisher,f"BEGIN; SELECT next_sequence FROM release_counter WHERE id=1 FOR UPDATE; UPDATE site_family SET destination_origin='{target}',version=version+1 WHERE id='{family}'; INSERT INTO registry_release VALUES(2,'second-fixture','signed-publisher',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '1 hour','publisher'); UPDATE release_counter SET next_sequence=3 WHERE id=1; UPDATE pending_decision SET published_sequence=2 WHERE id='{decision}'; COMMIT")
        sql(publisher,"UPDATE registry_release SET signed_blob='tampered'",False);checks.append('separate reviewer/publisher SQL still publishes immutable releases')
        sql(owner,'GRANT SELECT(reason) ON candidate TO webswitcher_worker; GRANT UPDATE(bucket) ON request_budget TO webswitcher_worker')
        bootstrap();bootstrap(False)
        sql(worker,'SELECT reason FROM candidate',False);sql(worker,"UPDATE request_budget SET bucket='forged' WHERE bucket='discovery:hour:global'",False)
        assert sql(worker,f"SELECT state FROM lookup_job WHERE id='{job}'")=='candidates_found'
        assert sql(api,"SELECT used FROM request_budget WHERE bucket='lookup:global'")=='2';checks.append('worker and default bootstrap reruns preserve counters/jobs and role boundaries')
        (directory/'WORKER_DATABASE_PASSWORD').write_text(passwords['API_DATABASE_PASSWORD']);bootstrap(expected=False)
        (directory/'WORKER_DATABASE_PASSWORD').write_text(secrets.token_urlsafe(32));bootstrap(expected=False)
        (directory/'WORKER_DATABASE_PASSWORD').write_text(passwords['WORKER_DATABASE_PASSWORD'])
        assert sql(worker,'SELECT count(*) FROM lookup_job')=='1';checks.append('credential reuse and implicit worker password rotation refuse before breaking existing access')
        original=migration.read_bytes();migration.write_bytes(original+b'\n-- unexpected V1 drift\n');bootstrap(expected=False);migration.write_bytes(original)
        sql(owner,'ALTER ROLE webswitcher_worker BYPASSRLS');bootstrap(expected=False);sql(owner,'ALTER ROLE webswitcher_worker NOBYPASSRLS')
        sql(owner,'CREATE POLICY unreviewed_public ON request_budget TO PUBLIC USING(true)');bootstrap(expected=False);sql(owner,'DROP POLICY unreviewed_public ON request_budget')
        checks.append('schema drift, privileged existing role and unexpected permissive RLS fail closed')
        # pg_dump normally sets row_security=off to refuse silently incomplete
        # backups. A permissive SELECT policy alone is therefore insufficient.
        backup='webswitcher_backup_fixture'
        passwords['BACKUP_DATABASE_PASSWORD']=secrets.token_urlsafe(32)
        role_key[backup]='BACKUP_DATABASE_PASSWORD'
        sql(owner,f"CREATE ROLE {backup} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '{passwords['BACKUP_DATABASE_PASSWORD']}'; GRANT CONNECT ON DATABASE webswitcher TO {backup}; GRANT USAGE ON SCHEMA public TO {backup}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO {backup}; CREATE POLICY backup_read_fixture ON request_budget FOR SELECT TO {backup} USING(true)")
        sql(api,"INSERT INTO request_budget VALUES('lookup:ip:backup-private-fixture',floor(extract(epoch FROM CURRENT_TIMESTAMP)/3600)::bigint,5)")
        expected_budgets=sql(owner,'SELECT row_to_json(t) FROM request_budget t ORDER BY bucket')
        def custom_dump():
            command=docker+['exec','-i',container,'sh','-c','IFS= read -r PGPASSWORD; export PGPASSWORD; exec pg_dump --format=custom --no-owner --no-privileges -h 127.0.0.1 -U "$1" -d webswitcher','sh',backup]
            return subprocess.run(command,env=env,input=(passwords['BACKUP_DATABASE_PASSWORD']+'\n').encode(),capture_output=True)
        refused=custom_dump()
        assert refused.returncode!=0,'A non-bypassing dump identity unexpectedly bypassed request-budget RLS'
        error=sanitized(refused.stderr.decode(errors='replace'))
        assert 'row-level security' in error and 'request_budget' in error,'Expected pg_dump RLS refusal, received: '+error
        assert sql(backup,'SELECT count(*) FROM request_budget')==sql(owner,'SELECT count(*) FROM request_budget')
        checks.append('real pg_dump refuses a SELECT-only non-bypassing backup role despite an explicit allow-all budget SELECT policy')
        # BYPASSRLS is granted only to a dedicated test backup identity, never a
        # runtime role. SQL grants remain SELECT-only and are asserted below.
        sql(owner,f'ALTER ROLE {backup} BYPASSRLS; DROP POLICY backup_read_fixture ON request_budget')
        assert sql(backup,"SELECT rolsuper||'|'||rolbypassrls||'|'||rolinherit FROM pg_roles WHERE rolname=current_user")=='false|true|false'
        for statement in ("UPDATE registry_release SET signed_blob='forged'","UPDATE request_budget SET used=0","CREATE TABLE forbidden_backup(id int)"):
            sql(backup,statement,False)
        archive=custom_dump()
        if archive.returncode:raise AssertionError('Dedicated backup pg_dump failed: '+sanitized(archive.stderr.decode(errors='replace')))
        assert archive.stdout.startswith(b'PGDMP')
        sql(owner,'CREATE DATABASE worker_backup_restore')
        restore_command=docker+['exec','-i',container,'sh','-c','IFS= read -r PGPASSWORD; export PGPASSWORD; exec pg_restore --single-transaction --exit-on-error --no-owner --no-privileges -h 127.0.0.1 -U "$1" -d worker_backup_restore','sh',owner]
        restored=subprocess.run(restore_command,env=env,input=(passwords['OWNER_DATABASE_PASSWORD']+'\n').encode()+archive.stdout,capture_output=True)
        if restored.returncode:raise AssertionError('RLS-aware backup restore failed: '+sanitized(restored.stderr.decode(errors='replace')))
        assert sql(owner,'SELECT row_to_json(t) FROM request_budget t ORDER BY bucket',database='worker_backup_restore')==expected_budgets
        assert sql(owner,"SELECT used FROM request_budget WHERE bucket='lookup:ip:backup-private-fixture'",database='worker_backup_restore')=='5'
        assert sql(worker,"SELECT count(*) FROM request_budget WHERE bucket LIKE '%:ip:%'")=='0'
        checks.append('dedicated non-superuser BYPASSRLS backup role retains SELECT-only SQL grants and dumps/restores every budget row without widening worker access')
        if api_image:
            # The same final API image runs the actual non-web Spring worker with
            # only its restricted DB password and fetcher token. Fixture HTTP is
            # confined to this disposable internal network; no public ports.
            token=secrets.token_urlsafe(40);passwords['FETCHER_INTERNAL_TOKEN']=token
            worker_secrets=directory/'worker-runtime';worker_secrets.mkdir(mode=0o700)
            for filename,value in (('DATABASE_PASSWORD',passwords['WORKER_DATABASE_PASSWORD']),('FETCHER_INTERNAL_TOKEN',token)):
                file=worker_secrets/filename;file.write_text(value);file.chmod(0o600)
            fixture_dir=directory/'fetcher-fixture';fixture_dir.mkdir(mode=0o700)
            file=fixture_dir/'token';file.write_text(token);file.chmod(0o600)
            fixture_source='''import datetime,hashlib,hmac,http.server,json,pathlib
token=pathlib.Path('/fixture/token').read_text()
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  try:
   length=int(self.headers.get('Content-Length','0'))
   if self.path!='/probe' or length<1 or length>1024 or not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):raise ValueError()
   if json.loads(self.rfile.read(length))!={'url':'https://old.worker-process.test/'}:raise ValueError()
  except (ValueError,TypeError):
   self.send_response(400);self.end_headers();return
  body=json.dumps({'classification':'REACHABLE','httpStatus':200,'finalOrigin':'https://current.worker-process.test','hops':[{'origin':'https://old.worker-process.test','status':301},{'origin':'https://current.worker-process.test','status':200}],'bytes':7,'sha256':hashlib.sha256(b'fixture').hexdigest(),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z'),'identity':'UNVERIFIED','threatStatus':'UNKNOWN'}).encode()
  self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
  print('controlled probe accepted',flush=True)
print('fixture ready',flush=True)
http.server.HTTPServer(('0.0.0.0',8090),Handler).serve_forever()
'''
            (fixture_dir/'server.py').write_text(fixture_source)
            docker_run(['run','-d','--name',fixture,'--network',network,'--network-alias','fetcher','--user',str(os.getuid())+':'+str(os.getgid()),'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--mount',f'type=bind,src={fixture_dir},dst=/fixture,readonly','--entrypoint','python3',tools_image,'-u','/fixture/server.py'])
            for _ in range(60):
                if 'fixture ready' in docker_run(['logs',fixture]):break
                time.sleep(.25)
            else:raise AssertionError('Controlled fetcher fixture did not become ready')
            def catalog_state():
                return sql(owner,"SELECT row_to_json(t) FROM site_family t ORDER BY id; SELECT row_to_json(t) FROM registry_release t ORDER BY sequence; SELECT row_to_json(t) FROM release_counter t ORDER BY id")
            unchanged=catalog_state();runtime_job=str(uuid.uuid4())
            sql(api,f"INSERT INTO lookup_job(id,hostname,state,attempt,run_after,created_at) VALUES('{runtime_job}','old.worker-process.test','queued',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
            docker_run(['run','-d','--name',runtime,'--network',network,'--user',str(os.getuid())+':'+str(os.getgid()),'--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--cap-drop=ALL','--security-opt=no-new-privileges:true','--memory','768m','--mount',f'type=bind,src={worker_secrets},dst=/run/secrets,readonly','-e','DATABASE_URL=jdbc:postgresql://postgres:5432/webswitcher','-e','DATABASE_USER=webswitcher_worker','-e','SPRING_CONFIG_IMPORT=configtree:/run/secrets/','-e','FETCHER_URL=http://fetcher:8090','-e','PORT=18080',api_image,'--spring.profiles.active=worker'])
            for _ in range(240):
                if sql(owner,f"SELECT state FROM lookup_job WHERE id='{runtime_job}'")=='candidates_found':break
                running=subprocess.run(docker+['inspect','--format','{{.State.Running}}',runtime],env=env,capture_output=True,text=True)
                if running.returncode or running.stdout.strip()!='true':
                    logs=subprocess.run(docker+['logs',runtime],env=env,capture_output=True,text=True)
                    raise AssertionError('Restricted worker stopped: '+sanitized(logs.stdout+logs.stderr))
                time.sleep(.25)
            else:
                logs=subprocess.run(docker+['logs',runtime],env=env,capture_output=True,text=True)
                raise AssertionError('Restricted worker did not complete controlled job: '+sanitized(logs.stdout+logs.stderr))
            assert sql(owner,f"SELECT state||'|'||coalesce(reviewer,'')||'|'||proposed_origin||'|'||submitter FROM candidate WHERE source_host='old.worker-process.test'")==f'pending||https://current.worker-process.test|discovery:{runtime_job}'
            assert sql(owner,f"SELECT count(*) FROM audit_event WHERE actor='discovery-worker' AND action='DISCOVERY_CANDIDATE' AND entity_id='{runtime_job}'")=='1'
            assert catalog_state()==unchanged
            assert 'controlled probe accepted' in docker_run(['logs',fixture])
            assert docker_run(['inspect','--format','{{.State.Running}}',runtime])=='true'
            sockets=docker_run(['exec',runtime,'cat','/proc/net/tcp','/proc/net/tcp6'])
            for line in sockets.splitlines():
                fields=line.split()
                if len(fields)>3 and fields[3]=='0A':
                    assert fields[1].split(':')[0]=='0B00007F','Non-web worker unexpectedly opened a listening TCP socket'
            checks.append('final API image starts the non-web restricted worker without Flyway/OIDC/signing credentials and completes a real internal fixture probe')
            checks.append('real worker inserts only pending candidate and discovery audit while active families, signed release bytes and sequence remain unchanged')
        evidence={'checks':checks,'passed':len(checks),'workerImageTest':'passed' if api_image else 'not requested; set WORKER_TEST_API_IMAGE to exercise the real image','workerImage':api_image or None,'limitations':['Disposable PostgreSQL17 and controlled internal fetcher fixture only, not a production deployment or public fetch.','Worker compromise can affect its permitted queue/candidate workload; no compromise-proof or public-fetcher-egress claim.']}
        rendered=json.dumps(evidence,indent=2)+'\n'
        report.write_text(rendered)
        print(rendered,end='')
    finally:
        for item in (runtime,fixture,container):subprocess.run(docker+['rm','-f',item],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if api_image:subprocess.run(docker+['network','rm',network],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
