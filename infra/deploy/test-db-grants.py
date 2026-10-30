#!/usr/bin/env python3
"""Exercise staging schema/grants against disposable PostgreSQL; never real data."""
import json,os,pathlib,secrets,subprocess,tempfile,time,uuid
root=pathlib.Path(__file__).resolve().parents[2]
env=os.environ.copy()
for key in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'):env.pop(key,None)
docker=['docker','--host=unix:///var/run/docker.sock']
name='web-switcher-grants-'+uuid.uuid4().hex[:10]
checks=[]
def run(args,**kw):return subprocess.run(docker+args,env=env,check=True,**kw)
with tempfile.TemporaryDirectory(prefix='web-switcher-grants-') as work:
    directory=pathlib.Path(work)
    migration=directory/'V1__registry.sql';migration.write_bytes((root/'backend/src/main/resources/db/migration/V1__registry.sql').read_bytes())
    values={key:secrets.token_urlsafe(32) for key in ('OWNER_DATABASE_PASSWORD','API_DATABASE_PASSWORD','PUBLISHER_DATABASE_PASSWORD')}
    for key,value in values.items():(directory/key).write_text(value)
    def sql(role,statement,expected=True,password=None):
        # Secret travels through stdin to dockerexec, not process arguments/logs.
        command=['docker','--host=unix:///var/run/docker.sock','exec','-i',name,'sh','-c','IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$1" -d webswitcher', 'sh',role]
        key={'webswitcher_owner':'OWNER_DATABASE_PASSWORD','webswitcher_api':'API_DATABASE_PASSWORD','webswitcher_publisher':'PUBLISHER_DATABASE_PASSWORD'}[role]
        result=subprocess.run(command,env=env,input=(password or values[key])+'\n'+statement+'\n',capture_output=True,text=True)
        if expected and result.returncode:raise AssertionError('SQL acceptance failed: '+result.stderr)
        if not expected and result.returncode==0:raise AssertionError('Forbidden SQL unexpectedly succeeded')
        return result.stdout.strip()
    try:
        run(['run','--rm','-d','--name',name,'--mount',f'type=bind,src={work},dst=/secrets,readonly','--mount',f'type=bind,src={root}/infra/deploy/bootstrap-db.sh,dst=/deployment/bootstrap-db.sh,readonly','--mount',f'type=bind,src={migration},dst=/deployment/V1__registry.sql,readonly','-e','POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256','-e','POSTGRES_USER=webswitcher_owner','-e','POSTGRES_DB=webswitcher','-e','POSTGRES_PASSWORD_FILE=/secrets/OWNER_DATABASE_PASSWORD','postgres:17'],stdout=subprocess.DEVNULL)
        for _ in range(60):
            ready=subprocess.run(docker+['exec',name,'pg_isready','-h','127.0.0.1','-U','webswitcher_owner','-d','webswitcher'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if ready.returncode==0:break
            time.sleep(.25)
        else:raise AssertionError('PostgreSQL did not become ready')
        def bootstrap(expected=True):
            result=subprocess.run(docker+['exec','--user',str(os.getuid())+':'+str(os.getgid()),'-e','WEB_SWITCHER_SECRET_DIR=/secrets','-e','PGHOST=127.0.0.1','-e','PGUSER=webswitcher_owner','-e','PGDATABASE=webswitcher',name,'bash','/deployment/bootstrap-db.sh'],env=env,capture_output=True,text=True)
            if (result.returncode==0)!=expected:raise AssertionError('Bootstrap outcome unexpected: '+result.stderr)
        bootstrap();checks.append('fresh schema and independent role creation')
        assert sql('webswitcher_api','SELECT next_sequence FROM release_counter')=='1'
        sql('webswitcher_owner','UPDATE release_counter SET next_sequence=9');bootstrap()
        assert sql('webswitcher_api','SELECT next_sequence FROM release_counter')=='9';checks.append('repeat bootstrap preserves release counter/schema')
        sql('webswitcher_api',"INSERT INTO audit_event VALUES('a','reviewer','REVIEW','x','bounded audit',CURRENT_TIMESTAMP)")
        sql('webswitcher_api',"UPDATE audit_event SET detail='tampered'",expected=False)
        sql('webswitcher_publisher',"DELETE FROM audit_event",expected=False);checks.append('audit is append-only for both runtime roles')
        sql('webswitcher_api',"INSERT INTO registry_release VALUES(1,'digest','signed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'attacker')",expected=False)
        sql('webswitcher_api',"UPDATE release_counter SET next_sequence=10",expected=False);checks.append('public API cannot publish or advance release sequence')
        sql('webswitcher_publisher',"INSERT INTO registry_release VALUES(1,'digest','signed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'publisher')")
        sql('webswitcher_publisher',"UPDATE registry_release SET signed_blob='tampered'",expected=False)
        sql('webswitcher_publisher',"DELETE FROM registry_release",expected=False)
        sql('webswitcher_publisher',"UPDATE release_counter SET next_sequence=10");checks.append('publisher inserts immutable releases and advances counter')
        for role in ('webswitcher_api','webswitcher_publisher'):sql(role,'CREATE TABLE forbidden(id int)',expected=False)
        checks.append('runtime roles cannot change schema')
        original=migration.read_bytes();migration.write_bytes(original+b'\n-- changed migration\n');bootstrap(expected=False);migration.write_bytes(original)
        assert sql('webswitcher_api','SELECT next_sequence FROM release_counter')=='10';checks.append('changed migration checksum refuses implicit schema drift')
        (directory/'API_DATABASE_PASSWORD').write_text(secrets.token_urlsafe(32));bootstrap(expected=False)
        assert sql('webswitcher_api','SELECT next_sequence FROM release_counter')=='10';checks.append('implicit password rotation refused before breaking existing access')
        print(json.dumps({'checks':checks,'passed':len(checks),'limitations':['Disposable local PostgreSQL17 only, not hosted production.','Does not test OIDC/TLS/private publisher gateway or backup restoration.']},indent=2))
    finally:
        subprocess.run(docker+['rm','-f',name],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
