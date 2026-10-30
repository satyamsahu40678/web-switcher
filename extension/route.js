import {parseEnvelope} from './core.js';

const descriptions = {
  changed: 'Your mappings changed while this page was opening. Review the mapping and reopen the original link.',
  paused: 'Switching is paused for this mapping or for the extension.',
  unknown: 'There is no saved mapping for this request.',
  expired: 'This mapping needs to be verified again. Its validity period has ended or the clock moved backwards.',
  invalid: 'This address could not be safely interpreted.',
  confirmation: 'This registry-reviewed move requires your confirmation. Check the destination below. Verification of a relationship is not a guarantee that a website is safe.',
  manual: 'This link may contain account information, a download, or an ambiguous path. You can choose the saved destination homepage without transferring the original path or parameters.',
  permission: 'Access to this source origin is no longer granted.',
  loop: 'This tab used this mapping recently. The destination may have sent you back, or you may have opened another old link. Automatic switching is paused to prevent a loop. If you intended another visit, check the saved address and open its homepage once.'
};
document.querySelector('#manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
function showPaused(result, envelope) {
  document.querySelector('#title').textContent = 'Switch paused';
  document.querySelector('#message').textContent = descriptions[result.reason] || descriptions.invalid;
  document.body.dataset.reason = result.reason;
  const button = document.querySelector('#homepage');
  const preview = document.querySelector('#destination');
  button.hidden = true;
  button.onclick = null;
  preview.hidden = true;
  preview.textContent = '';
  const retry = result.reason === 'loop' && typeof result.retryToken === 'string';
  if (!result.homepage || (!retry && !['manual', 'confirmation'].includes(result.reason))) return;
  preview.textContent = result.homepage;
  preview.hidden = false;
  button.textContent = retry ? 'Open destination homepage once' : result.reason === 'confirmation' ? 'Open reviewed destination' : 'Open destination homepage';
  button.disabled = false;
  button.hidden = false;
  button.onclick = async () => {
    button.disabled = true;
    button.onclick = null;
    try {
      const checked = await chrome.runtime.sendMessage({type: retry ? 'retryRoute' : 'confirmRoute', envelope, expectedUrl: result.homepage, ...(retry ? {retryToken: result.retryToken} : {})});
      if (!checked?.ok) throw new Error();
      if (checked.data?.status === 'ready' && checked.data.url === result.homepage) location.replace(checked.data.url);
      else if (checked.data?.reason === 'loop') showPaused(checked.data, envelope);
      else throw new Error();
    } catch {
      button.hidden = true;
      document.querySelector('#message').textContent = 'The destination, permission or policy changed, or this one-time action expired. Reopen the original link and review the current mapping.';
      document.body.dataset.reason = 'changed';
    }
  };
}
try {
  const envelope = parseEnvelope(location.hash);
  // Remove raw URL data from this visible history entry before asynchronous work.
  history.replaceState(null, '', chrome.runtime.getURL('route.html'));
  const reply = await chrome.runtime.sendMessage({type: 'resolve', envelope});
  if (!reply?.ok) throw new Error('Unable to read the saved mapping.');
  const result = reply.data;
  if (result.status === 'ready') {
    location.replace(result.url);
  } else {
    showPaused(result, envelope);
  }
} catch {
  document.querySelector('#title').textContent = 'Unable to switch';
  document.querySelector('#message').textContent = 'The routing request could not be verified. Open settings to review your mappings.';
  document.body.dataset.reason = 'error';
}
