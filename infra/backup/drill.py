#!/usr/bin/env python3
"""Real encrypted PostgreSQL recovery drill using only disposable owned containers."""
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
IMAGE = os.environ.get('RESTORE_DRILL_TOOLS_IMAGE', 'web-switcher-backup-drill:local')
API_IMAGE = os.environ.get('RESTORE_DRILL_API_IMAGE', '')
RUN_ID = uuid.uuid4().hex[:12]
DB_CONTAINER = 'web-switcher-restore-db-' + RUN_ID
API_CONTAINER = 'web-switcher-restore-api-' + RUN_ID
NETWORK = 'web-switcher-restore-' + RUN_ID
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
ENV = os.environ.copy()
for name in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'):
    ENV.pop(name, None)
UID_GID = str(os.getuid()) + ':' + str(os.getgid())
CHECKS = []
MEASUREMENTS = {}
STARTED = time.monotonic()
REDACT_VALUES = []
os.umask(0o077)
TABLES = ('site_family', 'candidate', 'pending_decision', 'registry_release', 'release_counter', 'audit_event', 'request_budget', 'lookup_job')


def command(args, *, data=None, expected=True, timeout=60):
    result = subprocess.run(args, env=ENV, input=data, text=True, capture_output=True, timeout=timeout, cwd=ROOT)
    if expected and result.returncode:
        # Commands never carry secret values. PostgreSQL errors are intentionally
        # summarized here; do not expose potentially secret query/server output.
        detail = result.stderr[-1800:]
        for value in REDACT_VALUES:
            detail = detail.replace(value, '[redacted]')
        raise RuntimeError('Command failed: ' + ' '.join(args[:5]) + ' (exit ' + str(result.returncode) + '): ' + detail)
    if not expected and result.returncode == 0:
        raise AssertionError('An intentionally invalid operation unexpectedly succeeded')
    return result


def docker(args, **kwargs):
    return command(DOCKER + args, **kwargs)


def check(name):
    CHECKS.append({'name': name, 'passed': True})
    print('PASS ' + name, flush=True)


def pg(database, sql, *, role='ws_owner', expected=True):
    file = '/secrets/backup.pgpass' if role == 'ws_backup' else '/secrets/owner.pgpass'
    return docker(['exec', '-i', '--user', UID_GID, '-e', 'PGHOST=127.0.0.1', '-e', 'PGUSER=' + role,
                   '-e', 'PGDATABASE=' + database, '-e', 'PGPASSFILE=' + file,
                   DB_CONTAINER, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1'], data=sql + '\n', expected=expected).stdout.strip()


def script(name, database, *, directory='/backups/main', identity='/secrets/identity.agekey', archive='', role='ws_owner', expected=True):
    file = '/secrets/backup.pgpass' if role == 'ws_backup' else '/secrets/owner.pgpass'
    args = ['exec', '--user', UID_GID, '-e', 'PGHOST=127.0.0.1', '-e', 'PGUSER=' + role,
            '-e', 'PGDATABASE=' + database, '-e', 'PGPASSFILE=' + file,
            '-e', 'BACKUP_DIRECTORY=' + directory, '-e', 'AGE_RECIPIENT=' + recipient,
            '-e', 'AGE_IDENTITY_FILE=' + identity, '-e', 'RESTORE_CONFIRM_DATABASE=' + database,
            DB_CONTAINER, 'bash', '/scripts/' + name]
    if archive:
        args.append(archive)
    return docker(args, expected=expected, timeout=120)


def snapshot(database):
    # Canonical data comparison covers every application table, not just counts.
    return {table: json.loads(pg(database, 'SELECT COALESCE(json_agg(t ORDER BY t::text)::text,\'[]\') FROM ' + table + ' t')) for table in TABLES}


def count_tables(database):
    return pg(database, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")


def verify_signed(jws, public_jwk, digest):
    # Only the original separately retained public trust anchor is accepted.
    command(['node', '--input-type=module', '-e', '''
import {verifyCatalog} from './packages/security/catalog.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
const value=JSON.parse(input);const result=await verifyCatalog(value.jws,{keys:{'restore-drill-1':value.jwk}});
if(result.sequence!==42||result.digest!==value.digest)throw new Error('Restored catalog mismatch');
'''], data=json.dumps({'jws': jws, 'jwk': public_jwk, 'digest': digest}))


work = pathlib.Path(tempfile.mkdtemp(prefix='web-switcher-restore-'))
try:
    secret_dir, backup_dir, runtime_dir = (work / name for name in ('secrets', 'backups', 'runtime'))
    for path in (secret_dir, backup_dir, runtime_dir):
        path.mkdir(mode=0o700)
    owner_password, backup_password = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    REDACT_VALUES.extend((owner_password, backup_password))
    files = {
        'owner-password': owner_password,
        'backup-password': backup_password,
        'owner.pgpass': '127.0.0.1:5432:*:ws_owner:' + owner_password + '\n',
        'backup.pgpass': '127.0.0.1:5432:*:ws_backup:' + backup_password + '\n',
    }
    for name, value in files.items():
        path = secret_dir / name
        path.write_text(value)
        path.chmod(0o600)
    docker(['network', 'create', '--internal', NETWORK])
    docker(['run', '--rm', '-d', '--name', DB_CONTAINER, '--network', NETWORK, '--network-alias', 'restore-db',
            '--mount', f'type=bind,src={secret_dir},dst=/secrets',
            '--mount', f'type=bind,src={backup_dir},dst=/backups',
            '--mount', f'type=bind,src={ROOT / "infra/backup"},dst=/scripts,readonly',
            '-e', 'POSTGRES_USER=ws_owner', '-e', 'POSTGRES_DB=postgres',
            '-e', 'POSTGRES_PASSWORD_FILE=/secrets/owner-password',
            '-e', 'POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256', IMAGE])
    for _ in range(60):
        ready = subprocess.run(DOCKER + ['exec', DB_CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'ws_owner', '-d', 'postgres'], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if ready.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Disposable PostgreSQL did not become ready')
    for database in ('ws_source', 'ws_restored', 'ws_checksum', 'ws_wrongkey', 'ws_tamper'):
        pg('postgres', 'CREATE DATABASE ' + database)
    pg('ws_source', (ROOT / 'backend/src/main/resources/db/migration/V1__registry.sql').read_text())
    # The private ECDSA key stays in this subprocess's memory and is never
    # returned, written to disk, placed in PostgreSQL, or included in a dump.
    generated = command(['node', '--input-type=module', '-e', '''
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
const issuedAt=new Date(Date.now()-1000).toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();
const payload={schemaVersion:1,bundleSequence:42,issuedAt,expiresAt,minClientVersion:'0.2.0',policyVersion:1,families:[{id:'restore-docs',name:'Controlled restore drill'}],aliases:[{sourceOrigin:'https://old.restore.test',familyId:'restore-docs'}],decisions:[{familyId:'restore-docs',destinationOrigin:'https://current.restore.test',trustClass:'registry_reviewed',validUntil:expiresAt,pathPolicy:{type:'homepage'},reasonCodes:['REVIEWED_CONTINUITY'],requiresConfirmation:true}],revocations:[]};
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const input=enc({alg:'ES256',typ:'web-switcher-catalog+jws',kid:'restore-drill-1'})+'.'+enc(payload);
const jws=input+'.'+sign('sha256',Buffer.from(input),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
process.stdout.write(JSON.stringify({jws,jwk:publicKey.export({format:'jwk'}),digest:createHash('sha256').update(jws).digest('hex'),issuedAt,expiresAt}));
'''])
    fixture = json.loads(generated.stdout)
    marker = 'RESTORE_DRILL_PLAINTEXT_' + RUN_ID
    quote = lambda value: "'" + str(value).replace("'", "''") + "'"
    seed = """
INSERT INTO site_family VALUES('restore-docs','Controlled restore drill','https://old.restore.test','https://current.restore.test','active',CURRENT_TIMESTAMP+INTERVAL '1 hour',NULL,NULL,3);
INSERT INTO candidate VALUES('candidate-restore','restore-docs','old.restore.test','https://current.restore.test','controlled continuity evidence','approved','reviewer','submitter',1,CURRENT_TIMESTAMP);
INSERT INTO pending_decision VALUES('decision-restore','candidate-restore','https://old.restore.test','https://current.restore.test','reviewer','controlled review',CURRENT_TIMESTAMP+INTERVAL '1 hour',42);
INSERT INTO registry_release VALUES(42,{digest},{jws},{issued},{expires},'publisher');
UPDATE release_counter SET next_sequence=43;
INSERT INTO audit_event VALUES('audit-restore','reviewer','REVIEW_APPROVED','restore-docs',{marker},CURRENT_TIMESTAMP);
INSERT INTO request_budget VALUES('lookup:global',1,2),('report:global',1,1);
INSERT INTO lookup_job VALUES('job-restore','unknown.restore.test','pending',1,CURRENT_TIMESTAMP,NULL,NULL,CURRENT_TIMESTAMP);
""".format(digest=quote(fixture['digest']), jws=quote(fixture['jws']), issued=quote(fixture['issuedAt']), expires=quote(fixture['expiresAt']), marker=quote(marker))
    pg('ws_source', seed)
    docker(['exec', '-i', '--user', UID_GID, '-e', 'PGHOST=127.0.0.1', '-e', 'PGUSER=ws_owner', '-e', 'PGDATABASE=ws_source', '-e', 'PGPASSFILE=/secrets/owner.pgpass', DB_CONTAINER, 'bash', '-c',
            'export WS_BACKUP_PASSWORD="$(cat /secrets/backup-password)"; exec psql -Xq -v ON_ERROR_STOP=1'], data="\\getenv backup_password WS_BACKUP_PASSWORD\nSELECT format('CREATE ROLE ws_backup LOGIN PASSWORD %L', :'backup_password') \\gexec\nGRANT CONNECT ON DATABASE ws_source TO ws_backup;\nGRANT USAGE ON SCHEMA public TO ws_backup;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO ws_backup;\n")
    pg('ws_source', 'DELETE FROM registry_release', role='ws_backup', expected=False)
    check('source dump identity is read-only and cannot alter signed releases')
    before = snapshot('ws_source')
    docker(['exec', '--user', UID_GID, DB_CONTAINER, 'age-keygen', '--output', '/secrets/identity.agekey'])
    docker(['exec', '--user', UID_GID, DB_CONTAINER, 'age-keygen', '--output', '/secrets/wrong-identity.agekey'])
    recipient = docker(['exec', '--user', UID_GID, DB_CONTAINER, 'age-keygen', '-y', '/secrets/identity.agekey']).stdout.strip()
    for name in ('main', 'failed-producer'):
        (backup_dir / name).mkdir(mode=0o700)
    started = time.monotonic()
    script('backup.sh', 'ws_source', role='ws_backup')
    MEASUREMENTS['encryptedBackupSeconds'] = round(time.monotonic() - started, 3)
    archives = list((backup_dir / 'main').glob('*.dump.age'))
    assert len(archives) == 1 and archives[0].stat().st_size > 100
    archive = archives[0]
    encrypted = archive.read_bytes()
    assert encrypted.startswith(b'age-encryption.org/v1\n') and marker.encode() not in encrypted and fixture['jws'].encode() not in encrypted
    assert archive.stat().st_mode & 0o077 == 0
    assert (secret_dir / 'identity.agekey').stat().st_mode & 0o077 == 0
    command(['python3', str(ROOT / 'infra/backup/verify-checksum.py'), str(archive)])
    check('real read-only pg_dump produces authenticated age ciphertext and matching SHA256')
    cipher_digest = hashlib.sha256(encrypted).hexdigest()
    # A failed real pg_dump cannot leave an apparently successful encrypted
    # archive/checksum. No fake producer or fake encryption is involved.
    failure = script('backup.sh', 'database_that_does_not_exist', role='ws_backup', directory='/backups/failed-producer', expected=False)
    assert 'does not exist' in failure.stderr
    assert not list((backup_dir / 'failed-producer').iterdir())
    check('failed real PostgreSQL producer leaves no backup or checksum artifact')
    corrupt = backup_dir / 'checksum.dump.age'
    corrupt.write_bytes(encrypted + b'corruption')
    pathlib.Path(str(corrupt) + '.sha256').write_text(cipher_digest + '  ' + corrupt.name + '\n')
    failure = script('restore.sh', 'ws_checksum', archive='/backups/' + corrupt.name, expected=False)
    assert 'checksum mismatch' in failure.stderr
    assert count_tables('ws_checksum') == '0'
    check('changed ciphertext is refused by checksum before restore writes')
    original_in_container = '/backups/main/' + archive.name
    failure = script('restore.sh', 'ws_wrongkey', identity='/secrets/wrong-identity.agekey', archive=original_in_container, expected=False)
    assert 'no identity matched' in failure.stderr
    assert count_tables('ws_wrongkey') == '0'
    check('incorrect age identity fails authentication without changing the target')
    corrupt = backup_dir / 'authenticated-tamper.dump.age'
    tampered = bytearray(encrypted); tampered[len(tampered) // 2] ^= 1
    corrupt.write_bytes(tampered)
    pathlib.Path(str(corrupt) + '.sha256').write_text(hashlib.sha256(tampered).hexdigest() + '  ' + corrupt.name + '\n')
    failure = script('restore.sh', 'ws_tamper', archive='/backups/' + corrupt.name, expected=False)
    assert 'age:' in failure.stderr and 'authenticate' in failure.stderr
    assert count_tables('ws_tamper') == '0'
    check('age authentication rejects tampering even with a recomputed file checksum')
    started = time.monotonic()
    script('restore.sh', 'ws_restored', archive=original_in_container)
    MEASUREMENTS['localRestoreSeconds'] = round(time.monotonic() - started, 3)
    after = snapshot('ws_restored')
    assert before == after
    assert after['release_counter'][0]['next_sequence'] == 43
    assert after['registry_release'][0]['signed_blob'] == fixture['jws']
    assert after['registry_release'][0]['digest'] == fixture['digest']
    assert after['audit_event'][0]['detail'] == marker
    check('clean restore preserves every application table, signed bytes, audit records and rollback counter')
    verify_signed(after['registry_release'][0]['signed_blob'], fixture['jwk'], fixture['digest'])
    check('restored signed catalog independently verifies in browser-compatible WebCrypto')
    script('restore.sh', 'ws_restored', archive=original_in_container, expected=False)
    assert snapshot('ws_restored') == after
    check('second restore refuses the nonempty target and preserves recovered data')
    if API_IMAGE:
        api_env = work / 'api.env'
        api_env.write_text('SPRING_DATASOURCE_URL=jdbc:postgresql://restore-db:5432/ws_restored\nSPRING_DATASOURCE_USERNAME=ws_owner\nSPRING_DATASOURCE_PASSWORD=' + owner_password + '\nSPRING_FLYWAY_ENABLED=false\n')
        api_env.chmod(0o600)
        docker(['run', '--rm', '-d', '--name', API_CONTAINER, '--network', NETWORK, '--network-alias', 'restore-api', '--user', UID_GID,
                '--mount', f'type=bind,src={runtime_dir},dst=/runtime', '--workdir', '/runtime', '--env-file', str(api_env),
                API_IMAGE, '--spring.profiles.active=demo', '--server.address=0.0.0.0', '--server.port=8080'])
        started = time.monotonic()
        for _ in range(60):
            result = subprocess.run(DOCKER + ['exec', '--user', UID_GID, DB_CONTAINER, 'python3', '-c', "import urllib.request,json;u=urllib.request.build_opener(urllib.request.ProxyHandler({}));d=json.load(u.open('http://restore-api:8080/health/ready',timeout=2));assert d.get('status')=='UP' and d.get('database')=='ready'"], env=ENV, capture_output=True, text=True)
            if result.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError('Restored Java API did not become ready')
        actual = docker(['exec', '--user', UID_GID, DB_CONTAINER, 'python3', '-c', "import urllib.request;u=urllib.request.build_opener(urllib.request.ProxyHandler({}));print(u.open('http://restore-api:8080/v1/catalog/current',timeout=5).read().decode())"]).stdout.strip()
        assert actual == fixture['jws']
        verify_signed(actual, fixture['jwk'], fixture['digest'])
        MEASUREMENTS['restoredApiReadinessSeconds'] = round(time.monotonic() - started, 3)
        check('real Java API becomes ready and serves the recovered catalog verified with its original public anchor')
    scratch = docker(['exec', '--user', UID_GID, DB_CONTAINER, 'find', '/tmp', '-maxdepth', '1', '-type', 'd', '-name', 'web-switcher-restore-*', '-print']).stdout.strip()
    assert not scratch, 'Authenticated plaintext scratch files must be removed on success and failure'
    check('private plaintext restore scratch directories are removed after successful and failed decryptions')
    versions = {'postgres': docker(['exec', DB_CONTAINER, 'postgres', '--version']).stdout.strip(), 'age': docker(['exec', DB_CONTAINER, 'age', '--version']).stdout.strip()}
    MEASUREMENTS['encryptedArchiveBytes'] = len(encrypted)
    MEASUREMENTS['totalDrillSeconds'] = round(time.monotonic() - STARTED, 3)
    report = {'executedAt': datetime.now(timezone.utc).isoformat(), 'passedChecks': len(CHECKS), 'checks': CHECKS,
              'versions': versions, 'measurements': MEASUREMENTS, 'catalogSequence': 42, 'catalogDigest': fixture['digest'],
              'tableRowCounts': {name: len(rows) for name, rows in after.items()},
              'apiReadiness': 'passed' if API_IMAGE else 'not-run: set RESTORE_DRILL_API_IMAGE to a built demo API image',
              'limitations': ['Disposable local databases and generated keys only; no production account or customer data.', 'Local elapsed times do not establish off-host backup durability, a production RPO/RTO, real-provider OIDC or production TLS.', 'This restores schema/data without database-owner grants; apply and verify intended role grants separately before promotion.']}
    output = ROOT / 'test-results/backup-restore-drill.json'
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passedChecks': len(CHECKS), 'measurements': MEASUREMENTS, 'apiReadiness': report['apiReadiness']}, indent=2))
except Exception as error:
    print('FAIL real encrypted restore drill: ' + str(error), file=sys.stderr)
    raise SystemExit(1)
finally:
    for name in (API_CONTAINER, DB_CONTAINER):
        subprocess.run(DOCKER + ['rm', '-fv', name], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(DOCKER + ['network', 'rm', NETWORK], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shutil.rmtree(work)
