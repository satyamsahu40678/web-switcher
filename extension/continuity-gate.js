import {parseEnvelope, permissionFor} from './core.js';

const message = document.querySelector('#continuity-message');
const title = document.querySelector('#continuity-title');
const permission = document.querySelector('#continuity-permission');
const confirm = document.querySelector('#continuity-confirm');
document.querySelector('#continuity-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
const explanations = {
  paused: 'Following is paused or this site is no longer followed.',
  changed: 'Your settings or the destination changed. Reopen the original link to check again.',
  permission: 'Access to this source was revoked. Review its permission in settings.',
  override: 'A manual or signed registry decision takes precedence for this source. Review it in settings.',
  manual: 'This link may contain sensitive information. Only the discovered homepage will be opened after your confirmation.',
  loop: 'A recent switch in this tab was stopped to prevent a loop.',
  conflict: 'The observed successors disagree. A destination cannot be chosen automatically.',
  unavailable: 'The next address could not be checked. No working replacement is being claimed.',
  unknown: 'No current successor can be established from available declarations or remembered links.'
};
let envelope, result;
async function resolve(type = 'CONTINUITY_RESOLVE') {
  permission.hidden = true; confirm.hidden = true;
  const reply = await chrome.runtime.sendMessage({type, envelope, ...(type === 'CONTINUITY_CONFIRM' ? {expectedOrigin: result.terminalOrigin} : {})});
  if (!reply?.ok) throw new Error(reply?.error || 'Unable to check this site.');
  result = reply.data;
  if (result.status === 'ready' && result.url) { location.replace(result.url); return; }
  if (result.status === 'original') return;
  document.body.dataset.reason = result.reason || result.status;
  title.textContent = result.status === 'permission_required' ? 'Continue following this move' : result.status === 'confirmation' ? 'Review the discovered address' : 'Could not establish a current address';
  message.textContent = result.status === 'permission_required' ? 'The site points to another domain. Allow checking that domain to continue; no destination needs to be entered.' : explanations[result.reason] || explanations[result.status] || explanations.unknown;
  const chain = document.querySelector('#continuity-chain'); chain.replaceChildren();
  for (const edge of result.chain || []) {
    const item = document.createElement('li'); item.textContent = `${edge.fromOrigin} → ${edge.toOrigin} (${edge.evidence}${edge.remembered ? ', remembered' : ''})`; chain.append(item);
  }
  document.querySelector('#continuity-target').textContent = result.terminalOrigin || (result.requiredOrigins || []).join(', ');
  permission.hidden = result.status !== 'permission_required';
  confirm.hidden = result.status !== 'confirmation';
}
permission.addEventListener('click', async () => {
  permission.disabled = true;
  try {
    if (!Array.isArray(result.requiredOrigins) || !result.requiredOrigins.length) throw new Error('No next origin was supplied.');
    const accepted = await chrome.permissions.request({origins: result.requiredOrigins.map(permissionFor)});
    if (!accepted) throw new Error('Permission was not granted; no unchecked destination was opened.');
    await resolve();
  } catch (error) { message.textContent = error.message; }
  finally { permission.disabled = false; }
});
confirm.addEventListener('click', async () => {
  confirm.disabled = true;
  try { await resolve('CONTINUITY_CONFIRM'); }
  catch (error) { message.textContent = error.message; }
  finally { confirm.disabled = false; }
});
try {
  envelope = parseEnvelope(location.hash);
  history.replaceState(null, '', chrome.runtime.getURL('continuity-gate.html'));
  await resolve();
} catch (error) {
  document.body.dataset.reason = 'invalid'; title.textContent = 'Unable to follow this address'; message.textContent = error.message;
}
