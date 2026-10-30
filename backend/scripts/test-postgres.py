#!/usr/bin/env python3
"""Run the same HTTP acceptance tests against a fresh disposable PostgreSQL database."""
import json, os, pathlib, secrets, subprocess, tempfile, time, uuid
root=pathlib.Path(__file__).resolve().parents[2]
env=os.environ.copy()
for key in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'):env.pop(key,None)
docker=['docker','--host=unix:///var/run/docker.sock']
name='web-switcher-pg-test-'+uuid.uuid4().hex[:10]
password=secrets.token_urlsafe(32)
with tempfile.NamedTemporaryFile(mode='w',prefix='web-switcher-pg-',delete=False) as file:
 file.write('POSTGRES_PASSWORD='+password+'\nPOSTGRES_USER=webswitcher\nPOSTGRES_DB=webswitcher\n');secret_file=file.name
os.chmod(secret_file,0o600)
try:
 subprocess.run(docker+['run','--rm','-d','--name',name,'--env-file',secret_file,'-p','127.0.0.1::5432','postgres:17'],env=env,check=True,stdout=subprocess.DEVNULL)
 for _ in range(60):
  ready=subprocess.run(docker+['exec',name,'pg_isready','-U','webswitcher','-d','webswitcher'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if ready.returncode==0:break
  time.sleep(.5)
 else:raise SystemExit('Disposable PostgreSQL did not become ready.')
 port=subprocess.check_output(docker+['port',name,'5432/tcp'],env=env,text=True).strip().rsplit(':',1)[1]
 env.update(TEST_DATABASE_URL='jdbc:postgresql://127.0.0.1:'+port+'/webswitcher',TEST_DATABASE_USER='webswitcher',TEST_DATABASE_PASSWORD=password)
 command=[str(root/'backend/scripts/mvn-cloud.sh'),'-f',str(root/'backend/pom.xml'),'test','-q']
 result=subprocess.run(command,cwd=root,env=env)
 if result.returncode:raise SystemExit(result.returncode)
 print('PostgreSQL HTTP acceptance tests passed on a fresh database.')
finally:
 subprocess.run(docker+['rm','-f',name],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 os.unlink(secret_file)
