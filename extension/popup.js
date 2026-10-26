let snapshot;
let currentTab;
let currentOrigin;
let shownMapping;
let undoReceipt;
const notice = document.querySelector('#notice');
function announce(message, error = false) {
  notice.textContent = message;
  notice.hidden = false;
  notice.classList.toggle('error', error);
}
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Unable to read Web Switcher settings.');
  return response.data;
}
function isCurrent(mapping, config, grants) {
  const now = Date.now();
  return !config.paused && mapping.enabled && mapping.createdAt <= now && mapping.expiresAt > now && grants.includes(mapping.sourceOrigin);
}
async function render() {
  snapshot = await request({type: 'read'});
  const {config, grantedOrigins, receipts} = snapshot;
  const paused = config.paused;
  document.querySelector('#global-status').textContent = paused ? 'All switching paused' : 'Local switching enabled';
  document.querySelector('.status-dot').classList.toggle('paused', paused);
  const pause = document.querySelector('#pause-all');
  pause.disabled = false;
  pause.textContent = paused ? 'Resume switching' : 'Pause switching';
  pause.setAttribute('aria-pressed', String(paused));
  const enabled = config.mappings.filter(mapping => isCurrent(mapping, config, grantedOrigins)).length;
  document.querySelector('#active-count').textContent = `${enabled} active / ${config.mappings.length} saved`;
  shownMapping = config.mappings.find(mapping => mapping.sourceOrigin === currentOrigin) || config.mappings.find(mapping => mapping.destinationOrigin === currentOrigin);
  const detail = document.querySelector('#mapping-details');
  const open = document.querySelector('#open-current');
  detail.hidden = !shownMapping;
  open.hidden = !shownMapping;
  if (shownMapping) {
    const mapping = shownMapping;
    const expired = mapping.expiresAt <= Date.now() || mapping.createdAt > Date.now();
    const granted = grantedOrigins.includes(mapping.sourceOrigin);
    const state = expired ? 'Needs verification' : !granted ? 'Source access needed' : paused || !mapping.enabled ? 'Paused' : 'Enabled';
    document.querySelector('#popup-title').textContent = 'A connection is saved.';
    document.querySelector('#popup-message').textContent = currentOrigin === mapping.destinationOrigin ? 'You are at the saved destination for this connection.' : 'This origin has a destination you configured locally.';
    const status = document.querySelector('#mapping-status');
    status.textContent = state;
    status.classList.toggle('review', !isCurrent(mapping, config, grantedOrigins));
    document.querySelector('#mapping-destination').textContent = `Destination: ${mapping.destinationOrigin}`;
    document.querySelector('#mapping-freshness').textContent = `Confirmed ${new Date(mapping.createdAt).toLocaleString()}. Expires ${new Date(mapping.expiresAt).toLocaleString()}.`;
    open.disabled = expired;
  } else {
    document.querySelector('#popup-title').textContent = currentOrigin ? 'No connection saved.' : 'Keep the thread.';
    document.querySelector('#popup-message').textContent = currentOrigin ? 'No local replacement is configured for this origin. Add one only after checking where the website moved.' : 'Open an HTTP or HTTPS website to check its local mapping, or manage your connections.';
  }
  document.querySelector('#add-mapping').textContent = currentOrigin && !shownMapping ? 'Add a local connection ↗' : 'Manage connections ↗';
  document.querySelector('#clear').hidden = !receipts.length;
  undoReceipt = receipts.find(receipt => receipt.id && receipt.canUndo && (receipt.tabId === undefined || receipt.tabId === currentTab?.id));
  document.querySelector('#undo').hidden = !undoReceipt;
}
function openSettings() {
  if (currentOrigin && !shownMapping) return chrome.tabs.create({url: chrome.runtime.getURL('options.html') + '?source=' + encodeURIComponent(currentOrigin)});
  return chrome.runtime.openOptionsPage();
}
document.querySelector('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#add-mapping').addEventListener('click', () => openSettings().catch(error => announce(error.message, true)));
document.querySelector('#pause-all').addEventListener('click', async event => {
  if (!snapshot) return;
  const button = event.currentTarget;
  button.disabled = true;
  try { await request({type: 'pauseAll', paused: !snapshot.config.paused}); await render(); }
  catch (error) { announce(error.message, true); button.disabled = false; }
});
document.querySelector('#clear').addEventListener('click', async () => {
  try { await request({type: 'clearReceipts'}); await render(); announce('Local activity cleared.'); }
  catch (error) { announce(error.message, true); }
});
document.querySelector('#undo').addEventListener('click', async () => {
  if (!undoReceipt) return;
  try { await request({type: 'undo', receiptId: undoReceipt.id}); await render(); announce('Original address reopened with a temporary extension bypass. The website may still redirect itself.'); }
  catch (error) { announce(error.message, true); }
});
document.querySelector('#open-current').addEventListener('click', async () => {
  if (!shownMapping) return;
  const expected = {...shownMapping};
  try {
    const latest = await request({type: 'read'});
    const mapping = latest.config.mappings.find(item => item.id === expected.id);
    if (!mapping || mapping.destinationOrigin !== expected.destinationOrigin || mapping.expiresAt <= Date.now() || mapping.createdAt > Date.now()) throw new Error('This mapping changed or expired. Review it in settings before opening the destination.');
    await chrome.tabs.create({url: mapping.destinationOrigin + '/'});
  } catch (error) { announce(error.message, true); await render(); }
});
try {
  const {uiTheme} = await chrome.storage.local.get('uiTheme');
  if (uiTheme === 'light' || uiTheme === 'dark') document.documentElement.dataset.theme = uiTheme;
  [currentTab] = await chrome.tabs.query({active: true, currentWindow: true});
  try {
    const url = new URL(currentTab?.url);
    if (url.protocol === 'https:' || url.protocol === 'http:') currentOrigin = url.origin;
  } catch { /* Browser pages do not expose a usable website origin. */ }
  document.querySelector('#current-origin').textContent = currentOrigin || 'No website origin available';
  await render();
} catch (error) { announce(error.message, true); }
