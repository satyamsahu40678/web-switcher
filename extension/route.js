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
  loop: 'A redirect returned to an old address, too many switches happened quickly, or this browser could not confirm a fresh navigation. Automatic switching is paused to prevent a loop. Check the mapped address below before opening it once.'
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
