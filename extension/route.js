import {parseEnvelope, permissionFor} from './core.js';

const descriptions = {
  changed: 'Your mappings changed while this page was opening. Review the mapping and reopen the original link.',
  paused: 'Switching is paused for this mapping or for the extension.',
  unknown: 'There is no saved mapping for this request.',
  expired: 'This mapping needs to be verified again. Its validity period has ended or the clock moved backwards.',
  invalid: 'This address could not be safely interpreted.',
  confirmation: 'This registry-reviewed move requires your confirmation. Check the destination below. Verification of a relationship is not a guarantee that a website is safe.',
  manual: 'This link may contain account information, a download, or an ambiguous path. You can choose the saved destination homepage without transferring the original path or parameters.',
  permission: 'Access to this source origin is no longer granted.',
  destination_permission: 'The shared destination points to an origin that needs your permission before it can be checked.',
  unavailable: 'The shared destination could not be checked. No working replacement is being claimed.',
  conflict: 'The move signals disagree or conflict with an existing mapping. No shared destination can be chosen automatically.',
  override: 'An origin in this move belongs to signed registry history. Unverified destination following cannot replace that authority.',
  loop: 'A redirect returned to an old address, too many switches happened quickly, or this browser could not confirm a fresh navigation. Automatic switching is paused to prevent a loop. Check the mapped address below before opening it once.'
};
document.querySelector('#manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
function showPaused(result, envelope) {
  // A shared-pointer advancement can commit its own new generation before a
  // sensitive-link confirmation or further permission choice is displayed.
  // Only accept the packaged worker's strictly formed generation, never URL data.
  if (typeof result.generation === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(result.generation)) envelope.generation = result.generation;
  document.querySelector('#title').textContent = 'Switch paused';
  document.querySelector('#message').textContent = descriptions[result.reason] || descriptions[result.status] || descriptions.invalid;
  document.body.dataset.reason = result.reason;
  const button = document.querySelector('#homepage');
  const permission = document.querySelector('#route-permission');
  const preview = document.querySelector('#destination');
  permission.hidden = true;
  permission.onclick = null;
  button.hidden = true;
  button.onclick = null;
  preview.hidden = true;
  preview.textContent = '';
  if (result.status === 'permission_required' && Array.isArray(result.requiredOrigins) && result.requiredOrigins.length) {
    document.querySelector('#title').textContent = 'Continue checking the shared destination';
    document.querySelector('#message').textContent = descriptions.destination_permission;
    preview.textContent = result.requiredOrigins.join(', ');
    preview.hidden = false;
    permission.hidden = false;
    permission.disabled = false;
    permission.onclick = async () => {
      permission.disabled = true;
      try {
        const accepted = await chrome.permissions.request({origins: result.requiredOrigins.map(permissionFor)});
        if (!accepted) throw new Error('Permission was not granted. No unchecked destination was opened.');
        await resolveEnvelope(envelope);
      } catch (error) {
        document.querySelector('#message').textContent = error.message || 'The next check could not continue. Reopen the original link.';
        permission.disabled = false;
      }
    };
    return;
  }
  const retry = result.reason === 'loop' && typeof result.retryToken === 'string';
  if (!result.homepage || (!retry && !['manual', 'confirmation'].includes(result.reason))) return;
  const targetUrl = retry ? result.retryUrl || result.homepage : result.homepage;
  preview.textContent = targetUrl;
  preview.hidden = false;
  button.textContent = retry ? targetUrl === result.homepage ? 'Open destination homepage once' : 'Open mapped page once' : result.reason === 'confirmation' ? 'Open reviewed destination' : 'Open destination homepage';
  button.disabled = false;
  button.hidden = false;
  button.onclick = async () => {
    button.disabled = true;
    button.onclick = null;
    try {
      const checked = await chrome.runtime.sendMessage({type: retry ? 'retryRoute' : 'confirmRoute', envelope, expectedUrl: targetUrl, ...(retry ? {retryToken: result.retryToken} : {})});
      if (!checked?.ok) throw new Error();
      if (checked.data?.status === 'ready' && checked.data.url === targetUrl) location.replace(checked.data.url);
      else if (checked.data?.reason === 'loop') showPaused(checked.data, envelope);
      else throw new Error();
    } catch {
      button.hidden = true;
      document.querySelector('#message').textContent = 'The destination, permission or policy changed, or this one-time action expired. Reopen the original link and review the current mapping.';
      document.body.dataset.reason = 'changed';
    }
  };
}
async function resolveEnvelope(envelope) {
  const reply = await chrome.runtime.sendMessage({type: 'resolve', envelope});
  if (!reply?.ok) throw new Error('Unable to read the saved mapping.');
  const result = reply.data;
  if (result.status === 'ready') location.replace(result.url);
  else showPaused(result, envelope);
}
try {
  const envelope = parseEnvelope(location.hash);
  // Remove raw URL data from this visible history entry before asynchronous work.
  history.replaceState(null, '', chrome.runtime.getURL('route.html'));
  await resolveEnvelope(envelope);
} catch {
  document.querySelector('#title').textContent = 'Unable to switch';
  document.querySelector('#message').textContent = 'The routing request could not be verified. Open settings to review your mappings.';
  document.body.dataset.reason = 'error';
}
