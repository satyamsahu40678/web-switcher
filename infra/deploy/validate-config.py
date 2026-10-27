#!/usr/bin/env python3
"""Check staging inputs without sourcing executable shell or printing secrets."""
import hashlib,os,re,stat,subprocess,sys
from pathlib import Path
from urllib.parse import urlsplit
FIELDS={'PUBLIC_HOST','APP_PUBLIC_ORIGIN','ACME_EMAIL','POSTGRES_IMAGE','OIDC_CLIENT_ID','OIDC_ISSUER_URI','ADMIN_ALLOWED_SUBJECTS','PUBLISHER_ALLOWED_SUBJECTS','PUBLISHER_PUBLIC_ORIGIN','PUBLISHER_OIDC_CLIENT_ID','PUBLISHING_KEY_ID','RUNTIME_UID','RUNTIME_GID'}
FILES=('owner-database-password','api-database-password','publisher-database-password','api-oidc-client-secret','publisher-oidc-client-secret','publisher-private.pk8')
def read_config(path):
 data={}
 for line in path.read_text().splitlines():
  line=line.strip()
  if not line or line.startswith('#'):continue
  key,sep,value=line.partition('=')
  if sep!='=' or key not in FIELDS or key in data or not value or any(x in value for x in ('$', '`', '\\', '\x00','\r')):raise ValueError('Use unique supported KEY=value settings without shell interpolation')
  if 'REPLACE_' in value:raise ValueError('Replace all example settings before deployment')
  data[key]=value
 if set(data)!=FIELDS:raise ValueError('All documented runtime settings are required')
 return data

def validate(path,check_secrets=True):
 directory=Path(path).resolve()
 if not directory.is_dir():raise ValueError('Protected configuration directory does not exist')
 if directory.stat().st_mode & 0o077:raise ValueError('Protect the configuration directory with mode0700')
 data=read_config(directory/'runtime.env')
 host=data['PUBLIC_HOST']
 if not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}',host) or host.endswith(('.test','.example','.invalid','.local','.internal')):raise ValueError('PUBLIC_HOST must be an owned public DNS hostname')
 if data['APP_PUBLIC_ORIGIN']!='https://'+host:raise ValueError('APP_PUBLIC_ORIGIN must match the exact owned HTTPS public hostname')
 for field in ('OIDC_ISSUER_URI','PUBLISHER_PUBLIC_ORIGIN'):
  value=urlsplit(data[field])
  if value.scheme!='https' or not value.hostname or value.username or value.password or value.port not in (None,443) or value.query or value.fragment:raise ValueError('OIDC/private publisher endpoints must use owned HTTPS origins')
  if value.hostname.endswith(('.test','.example','.invalid','.local')):raise ValueError('Example endpoints are not deployable')
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',data['PUBLISHING_KEY_ID']):raise ValueError('Publishing key ID must match the pinned registry key format')
 if data['PUBLISHER_PUBLIC_ORIGIN']==data['APP_PUBLIC_ORIGIN']:raise ValueError('Publisher requires a distinct private HTTPS administrative origin')
 if not re.fullmatch(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}',data['ACME_EMAIL']):raise ValueError('Configure a certificate contact email')
 if not re.fullmatch(r'(?:docker\.io/library/)?postgres@sha256:[0-9a-f]{64}',data['POSTGRES_IMAGE']):raise ValueError('Pin a reviewed PostgreSQL17 image digest')
 if set(data['ADMIN_ALLOWED_SUBJECTS'].split(',')) & set(data['PUBLISHER_ALLOWED_SUBJECTS'].split(',')):raise ValueError('Reviewer and publisher identities must be independent')
 publisher=urlsplit(data['PUBLISHER_PUBLIC_ORIGIN'])
 if publisher.path not in ('','/') or data['PUBLISHER_PUBLIC_ORIGIN'].endswith('/'):
  raise ValueError('Publisher endpoint must be an exact origin without a path')
 for field in ('RUNTIME_UID','RUNTIME_GID'):
  if not data[field].isdigit() or not 1<=int(data[field])<=60000:raise ValueError('Use a non-root runtime UID/GID')
 if directory.stat().st_uid!=int(data['RUNTIME_UID']):raise ValueError('Configuration directory must be owned by RUNTIME_UID')
 if check_secrets:
  for name in FILES:
   file=directory/name
   if not file.is_file() or file.is_symlink() or file.stat().st_mode & 0o077 or file.stat().st_size==0:raise ValueError('Required secret files must be nonempty regular files and mode0400 or0600 with no group/world access')
   if file.stat().st_uid!=int(data['RUNTIME_UID']):raise ValueError('Secret files must be owned by RUNTIME_UID so only the intended Java identity can read their mounts')
  for name in ('owner-database-password','api-database-password','publisher-database-password'):
   if (directory/name).stat().st_size<24:raise ValueError('Database passwords require at least24 random characters')
  check=subprocess.run(['openssl','pkey','-inform','DER','-in',str(directory/'publisher-private.pk8'),'-noout','-text_pub'],capture_output=True,text=True)
  if check.returncode or 'ASN1 OID: prime256v1' not in check.stdout:raise ValueError('Publisher requires a valid PKCS8 DER P-256 signing key')
 return data
if __name__=='__main__':
 try:
  result=validate(sys.argv[1], '--no-secret-check' not in sys.argv)
  if '--fingerprint' in sys.argv:
   digest=hashlib.sha256()
   for name in ('runtime.env',*FILES):
    digest.update(name.encode()+b'\0');digest.update((Path(sys.argv[1])/name).read_bytes());digest.update(b'\0')
   print(digest.hexdigest())
  else:print(result['APP_PUBLIC_ORIGIN'] if '--origin' in sys.argv else 'Staging configuration passed validation; no deployment readiness claim.')
 except (OSError,ValueError,IndexError) as error:sys.exit(str(error))
