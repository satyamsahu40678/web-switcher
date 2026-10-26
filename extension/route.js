import {parseEnvelope} from './core.js';

const descriptions = {
  changed: 'Your mappings changed while this page was opening. Review the mapping and reopen the original link.',
  paused: 'Switching is paused for this mapping or for the extension.',
  unknown: 'There is no saved mapping for this request.',
  expired: 'This mapping needs to be verified again. Its validity period has ended or the clock moved backwards.',
  invalid: 'This address could not be safely interpreted.',
  manual: 'This link may contain account information, a download, or an ambiguous path. You can choose the saved destination homepage without transferring the original path or parameters.',
  permission: 'Access to this source origin is no longer granted.',
  loop: 'A recent switch in this tab was stopped to prevent a redirect loop. Check the destination before trying again.'
};
document.querySelector('#manage').addEventListener('click', () => chrome.runtime.openOptionsPage());
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
    document.querySelector('#title').textContent = 'Switch paused';
    document.querySelector('#message').textContent = descriptions[result.reason] || descriptions.invalid;
    document.body.dataset.reason = result.reason;
    if (result.reason === 'manual' && result.homepage) {
      const button = document.querySelector('#homepage');
      button.hidden = false;
      button.addEventListener('click', () => location.replace(result.homepage), {once: true});
    }
  }
} catch {
  document.querySelector('#title').textContent = 'Unable to switch';
  document.querySelector('#message').textContent = 'The routing request could not be verified. Open settings to review your mappings.';
  document.body.dataset.reason = 'error';
}
