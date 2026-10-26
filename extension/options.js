import {ALLOW_TEST_ORIGINS} from './build-config.js';
import {createMapping, permissionFor} from './core.js';

const form = document.querySelector('#mapping-form');
const notice = document.querySelector('#notice');
let snapshot;
let saving = false;
let pendingImport;
function announce(text, isError = false) {
  notice.hidden = false;
  notice.textContent = text;
  notice.classList.toggle('error', isError);
}
async function request(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || 'Web Switcher could not complete this change.');
  return reply.data;
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function action(label, callback, className = 'secondary small') {
  const button = element('button', label, className);
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await callback(); await render(); } catch (error) { announce(error.message, true); } finally { button.disabled = false; }
  });
  return button;
}
function applyTheme(value) {
  if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
}
async function render() {
  snapshot = await request({type: 'read'});
  const {config, grantedOrigins, receipts} = snapshot;
  const paused = config.paused;
  const pause = document.querySelector('#pause-all');
  pause.disabled = false;
  pause.textContent = paused ? 'Resume switching' : 'Pause all switching';
  pause.setAttribute('aria-pressed', String(paused));
  document.querySelector('#global-status').textContent = paused ? 'All switching paused' : 'Local switching enabled';
  document.querySelector('.status-dot').classList.toggle('paused', paused);
  document.querySelector('#count').textContent = `${config.mappings.length} / 50`;
  document.querySelector('#clear').disabled = receipts.length === 0;
  const registry = snapshot.registry;
  document.querySelector('#registry-controls').hidden = !snapshot.registryConfigured;
  document.querySelector('#catalog-refresh').hidden = !snapshot.registryRefreshConfigured;
  document.querySelector('#registry-status').textContent = !snapshot.registryConfigured ? 'Not configured' : registry?.sequence !== undefined ? `Sequence ${registry.sequence}` : 'No catalog imported';
  document.querySelector('#registry-summary').textContent = !snapshot.registryConfigured
    ? 'No registry key is configured in this development build. Local mappings still work.'
    : registry?.error ? `Registry unavailable: ${registry.error}`
      : registry?.expiresAt ? `Catalog expires ${new Date(registry.expiresAt).toLocaleString()}.${Array.isArray(registry.families) ? ` ${registry.families.length} families included.` : ''}`
        : 'Import a signed catalog from your configured publisher. No catalog has been activated.';
  const registrySources = document.querySelector('#registry-sources');
  registrySources.replaceChildren();
  for (const alias of registry?.aliases || []) {
    const card = element('article', undefined, 'mapping');
    const granted = grantedOrigins.includes(alias.sourceOrigin);
    card.append(element('h3', alias.sourceOrigin));
    card.append(element('p', `→ ${alias.destinationOrigin}`, 'destination'));
    card.append(element('p', `${alias.trustClass === 'owner_verified' ? 'Owner verified' : 'Registry reviewed'} · Expires ${new Date(alias.validUntil).toLocaleString()}`, 'hint'));
    card.append(element('p', 'Source access is optional. Revoking it also pauses any local mapping for this same origin.', 'hint'));
    card.append(action(granted ? 'Revoke source access' : 'Grant source access', async () => {
      if (granted) await chrome.permissions.remove({origins: [permissionFor(alias.sourceOrigin)]});
      else if (!await chrome.permissions.request({origins: [permissionFor(alias.sourceOrigin)]})) throw new Error('Source access was not granted. Registry routing remains inactive for this origin.');
    }));
    registrySources.append(card);
  }
  const list = document.querySelector('#mapping-list');
  list.replaceChildren();
  document.querySelector('#empty').hidden = config.mappings.length > 0;
  for (const mapping of config.mappings) {
    const card = element('article', undefined, 'mapping');
    const expired = mapping.expiresAt <= Date.now() || mapping.createdAt > Date.now();
    const granted = grantedOrigins.includes(mapping.sourceOrigin);
    const state = expired ? 'Needs verification' : !granted ? 'Access needed' : paused || !mapping.enabled ? 'Paused' : 'Enabled';
    card.append(element('span', state, `mapping-state${expired || !granted || paused || !mapping.enabled ? ' review' : ''}`));
    card.append(element('h3', mapping.sourceOrigin));
    card.append(element('p', `→ ${mapping.destinationOrigin}`, 'destination'));
    card.append(element('p', 'User configured · Not owner or registry verified', 'provenance'));
    card.append(element('p', `Confirmed locally ${new Date(mapping.createdAt).toLocaleString()} · ${mapping.pathPolicy === 'preserve' ? 'Keeps the page path' : 'Opens homepage'} · Expires ${new Date(mapping.expiresAt).toLocaleString()}`, 'hint'));
    const controls = element('div', undefined, 'actions');
    if (!granted) controls.append(action('Grant source access', async () => {
      const accepted = await chrome.permissions.request({origins: [permissionFor(mapping.sourceOrigin)]});
      if (!accepted) throw new Error('Source access was not granted. You can still open the destination homepage manually.');
      await request({type: 'toggle', id: mapping.id, enabled: mapping.enabled});
    }));
    if (!expired) controls.append(action(mapping.enabled ? 'Pause' : 'Enable', () => request({type: 'toggle', id: mapping.id, enabled: !mapping.enabled})));
    controls.append(action('Open homepage', () => chrome.tabs.create({url: mapping.destinationOrigin + '/'})));
    controls.append(action('Remove', async () => {
      await request({type: 'remove', id: mapping.id});
      await chrome.permissions.remove({origins: [permissionFor(mapping.sourceOrigin)]});
      announce('Mapping removed and its source access released.');
    }, 'text-button'));
    card.append(controls);
    if (expired) card.append(element('p', 'Remove and re-add this mapping after checking the destination again.', 'hint'));
    list.append(card);
  }
  const history = document.querySelector('#receipts');
  history.replaceChildren();
  if (!receipts.length) history.append(element('li', 'No switches recorded yet.', 'muted'));
  for (const receipt of receipts) {
    const row = element('li');
    const detail = element('div', undefined, 'receipt-details');
    detail.append(element('span', `${receipt.sourceOrigin} → ${receipt.destinationOrigin}`));
    const time = element('time', new Date(receipt.at).toLocaleString());
    time.dateTime = new Date(receipt.at).toISOString();
    detail.append(time);
    row.append(detail);
    history.append(row);
  }
}
function previewMapping() {
  const preview = document.querySelector('#mapping-preview');
  preview.replaceChildren();
  try {
    const input = Object.fromEntries(new FormData(form));
    const mapping = createMapping(input, Date.now(), 'preview', {allowTestOrigins: ALLOW_TEST_ORIGINS});
    const old = new URL(mapping.sourceOrigin);
    preview.append(element('strong', 'Preview · exact origin only'));
    preview.append(element('p', `${mapping.sourceOrigin}/… → ${mapping.destinationOrigin}/${mapping.pathPolicy === 'preserve' ? '…' : ''}`));
    preview.append(element('p', `Does not match ${old.protocol}//sub.${old.hostname} or ${old.protocol}//${old.hostname}.other.invalid.`));
    preview.hidden = false;
  } catch { preview.hidden = true; }
}
form.addEventListener('input', previewMapping);
form.addEventListener('change', previewMapping);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || !form.reportValidity()) return;
  const input = Object.fromEntries(new FormData(form));
  let origin;
  let grantedBefore = false;
  let committed = false;
  saving = true;
  document.querySelector('#save').disabled = true;
  try {
    const mapping = createMapping(input, Date.now(), 'preview', {allowTestOrigins: ALLOW_TEST_ORIGINS});
    origin = mapping.sourceOrigin;
    if (snapshot?.config.mappings.some(m => m.sourceOrigin === origin)) throw new Error('This source already has a mapping. Remove it before adding a replacement.');
    grantedBefore = snapshot?.grantedOrigins.includes(origin) || false;
    // Request directly within the submit gesture before asynchronous work.
    const accepted = await chrome.permissions.request({origins: [permissionFor(origin)]});
    if (!accepted) throw new Error('Source access was not granted. No mapping was saved. You can open the destination manually.');
    await request({type: 'save', input});
    committed = true;
    form.reset();
    previewMapping();
    announce(`Connection saved for ${origin}.`);
    await render();
  } catch (error) {
    if (origin && !grantedBefore && !committed) await chrome.permissions.remove({origins: [permissionFor(origin)]}).catch(() => {});
    announce(error.message, true);
  } finally {
    saving = false;
    document.querySelector('#save').disabled = false;
  }
});
document.querySelector('#pause-all').addEventListener('click', async event => {
  if (!snapshot) return;
  const button = event.currentTarget;
  button.disabled = true;
  try { await request({type: 'pauseAll', paused: !snapshot.config.paused}); await render(); } catch (error) { announce(error.message, true); button.disabled = false; }
});
document.querySelector('#clear').addEventListener('click', async () => {
  try { await request({type: 'clearReceipts'}); await render(); announce('Local activity cleared.'); } catch (error) { announce(error.message, true); }
});
document.querySelector('#theme').addEventListener('change', async event => {
  const value = event.target.value;
  applyTheme(value);
  try { await chrome.storage.local.set({uiTheme: value}); } catch { announce('Appearance could not be saved.', true); }
});
document.querySelector('#export').addEventListener('click', async () => {
  try {
    const settings = await request({type: 'EXPORT_SETTINGS'});
    const blob = new Blob([JSON.stringify(settings, null, 2) + '\n'], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = element('a');
    link.href = url;
    link.download = `web-switcher-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Settings exported. The backup contains your mapping origins, not browsing activity.');
  } catch (error) { announce(error.message, true); }
});
document.querySelector('#import').addEventListener('click', () => document.querySelector('#import-file').click());
document.querySelector('#import-file').addEventListener('change', async event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error('Choose a settings JSON file smaller than 64 KiB.');
    const text = await file.text();
    const settings = JSON.parse(text);
    if (!settings || typeof settings !== 'object' || settings.schemaVersion !== 1 || !Array.isArray(settings.mappings) || settings.mappings.length > 50) throw new Error('This file is not a supported version 1 settings backup.');
    const list = document.querySelector('#import-preview');
    list.replaceChildren();
    const currentOrigins = new Set(snapshot?.config.mappings.map(m => m.sourceOrigin));
    let replacements = 0;
    for (const mapping of settings.mappings) {
      if (!mapping || typeof mapping.sourceOrigin !== 'string' || typeof mapping.destinationOrigin !== 'string') throw new Error('Every imported mapping needs a source and destination origin.');
      if (currentOrigins.has(mapping.sourceOrigin)) replacements++;
      const row = element('li', `${mapping.sourceOrigin} → ${mapping.destinationOrigin}`);
      row.append(element('span', `${currentOrigins.has(mapping.sourceOrigin) ? 'Replaces existing source' : 'New source'} · User configured`));
      list.append(row);
    }
    document.querySelector('#import-summary').textContent = `${settings.mappings.length} incoming mappings: ${settings.mappings.length - replacements} new, ${replacements} replacements. All ${snapshot?.config.mappings.length || 0} existing mappings will be replaced.`;
    pendingImport = {settings, text};
    document.querySelector('#import-dialog').showModal();
  } catch (error) { pendingImport = undefined; announce(error.message, true); }
});
document.querySelector('#cancel-import').addEventListener('click', () => document.querySelector('#import-dialog').close());
document.querySelector('#import-dialog').addEventListener('close', () => { pendingImport = undefined; });
document.querySelector('#confirm-import').addEventListener('click', async event => {
  if (!pendingImport) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    // Send original bytes so background validation can reject duplicate JSON keys.
    await request({type: 'IMPORT_SETTINGS', text: pendingImport.text});
    document.querySelector('#import-dialog').close();
    await render();
    announce('Settings imported. Review each mapping and grant source access where needed. Imported data remains user configured.');
  } catch (error) { announce(error.message, true); document.querySelector('#import-dialog').close(); }
  finally { button.disabled = false; }
});
document.querySelector('#clear-local').addEventListener('click', async () => {
  if (!confirm('Delete all local mappings and routing activity? This cannot be undone. Export a backup first if you need it.')) return;
  try { await request({type: 'CLEAR_LOCAL_DATA'}); await render(); announce('All local mappings and routing activity deleted.'); }
  catch (error) { announce(error.message, true); }
});
chrome.storage.local.get('uiTheme').then(({uiTheme = 'system'}) => {
  applyTheme(uiTheme);
  document.querySelector('#theme').value = ['light', 'dark'].includes(uiTheme) ? uiTheme : 'system';
}).catch(() => {});
const source = new URLSearchParams(location.search).get('source');
if (source) { document.querySelector('#source').value = source; previewMapping(); }
render().catch(error => announce(error.message, true));

async function importCatalog(text) {
  if (!snapshot?.registryConfigured) throw new Error('No registry key is configured in this development build.');
  if (new TextEncoder().encode(text).byteLength > 1048576) throw new Error('Choose a signed catalog smaller than 1 MiB.');
  if (!text.trim()) throw new Error('Paste a signed catalog or choose a catalog file first.');
  await request({type: 'importCatalog', jws: text.trim()});
  document.querySelector('#catalog-jws').value = '';
  await render();
  announce('Signed catalog accepted after verification. Local mapping trust is unchanged.');
}
document.querySelector('#catalog-import').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await importCatalog(document.querySelector('#catalog-jws').value); }
  catch (error) { announce(error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector('#catalog-file-button').addEventListener('click', () => document.querySelector('#catalog-file').click());
document.querySelector('#catalog-file').addEventListener('change', async event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 1048576) throw new Error('Choose a signed catalog smaller than 1 MiB.');
    const text = await file.text();
    document.querySelector('#catalog-jws').value = text;
    announce('Catalog file loaded for review. Choose Verify & import catalog to validate and activate it.');
    document.querySelector('#catalog-import').focus();
  } catch (error) { announce(error.message, true); }
});
document.querySelector('#catalog-refresh').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await request({type: 'REFRESH_CATALOG'}); await render(); announce('Catalog refresh completed.'); }
  catch (error) { announce(error.message, true); }
  finally { button.disabled = false; }
});
