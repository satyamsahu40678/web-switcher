#!/usr/bin/env python3
"""Local deployment safety tests; mocks Docker/curl, never contacts a live host."""
import importlib.util,json,os,pathlib,shutil,subprocess,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]

def load_module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
manifest=load_module('manifest',ROOT/'infra/deploy/release-manifest.py')
config=load_module('config',ROOT/'infra/deploy/validate-config.py')

def release(sha='a'*40):
 return {'schemaVersion':1,'sourceCommit':sha,'apiImage':'ghcr.io/satyamsahu40678/web-switcher-api@sha256:'+'b'*64,'webImage':'ghcr.io/satyamsahu40678/web-switcher-web@sha256:'+'c'*64}

class SafetyTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='web-switcher-deploy-test-');self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name)
  self.conf=self.root/'config';self.conf.mkdir(mode=0o700)
  data={'PUBLIC_HOST':'staging.example.org','APP_PUBLIC_ORIGIN':'https://staging.example.org','ACME_EMAIL':'operator@example.org','POSTGRES_IMAGE':'postgres@sha256:'+'1'*64,'OIDC_CLIENT_ID':'staging-api','OIDC_ISSUER_URI':'https://oidc.example.org','ADMIN_ALLOWED_SUBJECTS':'reviewer','PUBLISHER_ALLOWED_SUBJECTS':'publisher','PUBLISHER_PUBLIC_ORIGIN':'https://private.example.org','PUBLISHER_OIDC_CLIENT_ID':'private-publisher','PUBLISHING_KEY_ID':'staging-registry-1','RUNTIME_UID':str(os.getuid()),'RUNTIME_GID':str(os.getgid())}
  self.values=data;self.write_config()
  for filename in config.FILES:
   file=self.conf/filename;file.write_text('independent-secret-'+filename+'-012345678901234567890123456789');file.chmod(0o600)
  result=subprocess.run(['openssl','genpkey','-algorithm','EC','-pkeyopt','ec_paramgen_curve:P-256','-outform','DER','-out',str(self.conf/'publisher-private.pk8')],capture_output=True)
  self.assertEqual(result.returncode,0);(self.conf/'publisher-private.pk8').chmod(0o600)
  self.bin=self.root/'bin';self.bin.mkdir();self.calls=self.root/'docker-calls'
  self.env=os.environ.copy();self.env.update(PATH=str(self.bin)+':'+self.env['PATH'],TEST_DOCKER_CALLS=str(self.calls),MOCK_RELEASE_SHA='a'*40)
  self.script('docker',"""#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_DOCKER_CALLS"
if [[ ${FAIL_CANDIDATE:-} == 1 && "$*" == *"candidate2/images.env"* && "$*" == *"up -d --no-build api web"* ]]; then exit 17; fi
""")
  self.script('curl',"""#!/usr/bin/env bash
if [[ "$*" == *"--head"* ]]; then printf 'HTTP/2 200\\r\\nX-Web-Switcher-Release: %s\\r\\n' "$MOCK_RELEASE_SHA"
elif [[ "$*" == *"/v1/session"* ]]; then printf '{"demo":false}'
else printf '{"status":"UP","database":"ready"}'; fi
""")
 def write_config(self):
  file=self.conf/'runtime.env';file.write_text(''.join(k+'='+v+'\n' for k,v in self.values.items()));file.chmod(0o600)
 def script(self,name,body):
  path=self.bin/name;path.write_text(body);path.chmod(0o700)
 def candidate(self,name='candidate1',sha='a'*40):
  path=self.root/name;shutil.copytree(ROOT/'infra',path/'infra');(path/'release.json').write_text(json.dumps(release(sha)));return path
 def deploy(self,candidate,expected=0,env=None):
  result=subprocess.run(['bash',str(candidate/'infra/deploy/deploy-staging.sh'),str(candidate),str(self.conf)],env=env or self.env,capture_output=True,text=True)
  self.assertEqual(result.returncode,expected,result.stdout+result.stderr)
  return result
 def test_manifest_accepts_only_exact_namespace_and_digest(self):
  self.assertEqual(manifest.validate(release())['sourceCommit'],'a'*40)
  for change in ({'apiImage':'ghcr.io/attacker/api@sha256:'+'b'*64},{'webImage':'ghcr.io/satyamsahu40678/web-switcher-web:latest'},{'sourceCommit':'main'},{'shell':'touch /tmp/no'}):
   with self.assertRaises(ValueError):manifest.validate({**release(),**change})
 def test_configuration_refuses_demo_placeholders_roles_and_private_path(self):
  config.validate(self.conf)
  for key,value in (('APP_PUBLIC_ORIGIN','http://staging.example.org'),('PUBLISHER_PUBLIC_ORIGIN','https://private.example.org/path'),('PUBLISHER_ALLOWED_SUBJECTS','reviewer'),('POSTGRES_IMAGE','postgres:17')):
   original=self.values[key];self.values[key]=value;self.write_config()
   with self.assertRaises(ValueError):config.validate(self.conf)
   self.values[key]=original;self.write_config()
 def test_secret_files_require_private_permissions(self):
  secret=self.conf/'publisher-private.pk8';secret.chmod(0o644)
  with self.assertRaises(ValueError):config.validate(self.conf)
 def test_good_release_records_state_only_after_health_and_no_demo(self):
  candidate=self.candidate();self.deploy(candidate)
  self.assertEqual((self.conf/'deployment-state/current-release').read_text().strip(),str(candidate))
  calls=self.calls.read_text();self.assertIn('run --rm db-bootstrap',calls);self.assertIn('up -d --no-build api web',calls)
 def test_failed_new_application_rolls_back_prior_image_manifest(self):
  previous=self.candidate();self.deploy(previous)
  candidate=self.candidate('candidate2','d'*40);env={**self.env,'FAIL_CANDIDATE':'1'}
  self.deploy(candidate,17,env)
  self.assertEqual((self.conf/'deployment-state/current-release').read_text().strip(),str(previous))
  self.assertIn(str(previous/'images.env'),self.calls.read_text().splitlines()[-1])
  self.assertNotIn(' down',self.calls.read_text(),'Database must never be destroyed or rolled back')
 def test_config_rotation_is_separate_from_application_rollback(self):
  previous=self.candidate();self.deploy(previous)
  before=self.calls.read_text().count('up -d')
  self.values['OIDC_CLIENT_ID']='changed-client';self.write_config()
  candidate=self.candidate('candidate2','d'*40);self.deploy(candidate,1)
  self.assertEqual(self.calls.read_text().count('up -d'),before)
  self.assertEqual((self.conf/'deployment-state/current-release').read_text().strip(),str(previous))
 def test_invalid_manifest_stops_before_docker_mutations(self):
  candidate=self.candidate();(candidate/'release.json').write_text(json.dumps({**release(),'webImage':'latest'}))
  self.deploy(candidate,1)
  self.assertFalse(self.calls.exists())
if __name__=='__main__':unittest.main(verbosity=2)
