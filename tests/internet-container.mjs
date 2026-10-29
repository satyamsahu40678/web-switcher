// Final-image acceptance with egress disabled. Live provider testing is separate.
import {spawnSync} from 'node:child_process';
import {randomUUID, randomBytes} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const image = process.env.INTERNET_TEST_IMAGE || 'web-switcher-internet:test';
const suffix = randomUUID().slice(0, 8), container = `web-switcher-internet-${suffix}`, volume = container + '-data';
const env = {...process.env, ONLINE_ACCESS_TOKENS: randomBytes(32).toString('base64url')};
const checks = [];
function docker(args, {input, allowFailure = false} = {}) {
  const result = spawnSync('docker', args, {encoding: 'utf8', input, env, maxBuffer: 1024 * 1024});
  if (result.status !== 0 && !allowFailure) throw new Error(`Docker ${args[0]} failed: ${(result.stderr || result.stdout || result.error?.message || '').slice(-2000)}`);
  return result;
}
function client(script) {
  const result = docker(['exec', '-i', container, 'node', '--input-type=module'], {input: script});
  const line = result.stdout.trim().split('\n').at(-1); return JSON.parse(line);
}
const script = (code) => `import assert from 'node:assert/strict';
const base='http://127.0.0.1:8082', headers={'Authorization':'Bearer '+process.env.ONLINE_ACCESS_TOKENS,'Content-Type':'application/json'};
${code}`;
let created = false, launched = false;
try {
  docker(['volume', 'create', volume]); created = true;
  docker(['run', '-d', '--name', container, '--network', 'none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--mount', `type=volume,source=${volume},target=/var/lib/web-switcher-discovery`, '-e', 'ONLINE_DISCOVERY_ENABLED=true', '-e', 'ONLINE_ARCHIVE_ENABLED=false', '-e', 'ONLINE_ACCESS_TOKENS', '-e', 'ONLINE_BIND=0.0.0.0', image]); launched = true;
  const first = client(script(`
for(let i=0;i<40;i++){try{if((await fetch(base+'/health/live')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
assert.equal((await fetch(base+'/health/live')).status,200);
assert.equal((await fetch(base+'/health/ready')).status,503,'No configured source must not claim ready');
assert.equal((await fetch(base+'/v2/discoveries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hostname:'old.public.org'})})).status,401);
const response=await fetch(base+'/v2/discoveries',{method:'POST',headers,body:JSON.stringify({hostname:'old.public.org',clientVersion:'0.2.0'})});
assert.equal(response.status,202);let job=await response.json();
for(let i=0;i<60&&['queued','running'].includes(job.status);i++){await new Promise(r=>setTimeout(r,100));job=await (await fetch(base+'/v2/discoveries/'+job.jobId,{headers})).json();}
assert.equal(job.status,'completed');assert.equal(job.outcome,'unavailable');assert.deepEqual(job.candidates,[]);
assert.ok(job.reasonCodes.includes('SEARCH_NOT_CONFIGURED'));assert.ok(job.reasonCodes.includes('ARCHIVE_DISABLED'));
console.log(JSON.stringify({jobId:job.jobId,checks:4}));`));
  assert.ok(first.jobId); checks.push('live process', 'unconfigured readiness refusal', 'authenticated API', 'bounded unavailable without network');
  docker(['restart', container]);
  const recovered = client(script(`
for(let i=0;i<40;i++){try{if((await fetch(base+'/health/live')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
const job=await (await fetch(base+'/v2/discoveries/${first.jobId}',{headers})).json();
assert.equal(job.jobId,${JSON.stringify(first.jobId)});assert.equal(job.status,'completed');assert.equal(job.outcome,'unavailable');
const repeated=await (await fetch(base+'/v2/discoveries',{method:'POST',headers,body:JSON.stringify({hostname:'old.public.org'})})).json();assert.equal(repeated.jobId,job.jobId);
const cancelled=await (await fetch(base+'/v2/discoveries/'+job.jobId,{method:'DELETE',headers})).json();assert.equal(cancelled.status,'cancelled');assert.deepEqual(cancelled.candidates,[]);
console.log(JSON.stringify({recovered:true}));`));
  assert.equal(recovered.recovered, true); checks.push('SQLite restart persistence', 'durable same-owner cache', 'cancellation after restart');
  const configuration = JSON.parse(docker(['inspect', container]).stdout)[0];
  assert.notEqual(configuration.Config.User, '0'); assert.notEqual(configuration.Config.User, '');
  assert.equal(configuration.HostConfig.NetworkMode, 'none'); assert.equal(configuration.HostConfig.ReadonlyRootfs, true);
  checks.push('non-root read-only isolated final image');
  await mkdir('test-results', {recursive: true});
  await writeFile('test-results/internet-container.json', JSON.stringify({executedAt: new Date().toISOString(), passedChecks: checks.length, checks, scope: 'Actual Node/SQLite final image with no network; no live provider or public deployment claim.'}, null, 2) + '\n');
  console.log(`Internet discovery final-image acceptance: ${checks.length} checks passed.`);
} finally {
  if (launched) docker(['rm', '-f', container], {allowFailure: true});
  if (created) docker(['volume', 'rm', volume], {allowFailure: true});
}
