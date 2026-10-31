import {ALLOW_TEST_ORIGINS, INTERNET_PROVIDER_FIXTURES} from './build-config.js';
import {createMapping, permissionFor} from './core.js';
import {normalizeSource} from './continuity.js';
import {initializeInternetUi} from './internet-ui.js';

const form = document.querySelector('#mapping-form');
const notice = document.querySelector('#notice');
let snapshot;
let saving = false;
let pendingImport;
let continuityResult;
let continuityBusy = false;
let internetUi;
const sharedChecks = new Map();
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
function mappingInput() {
  return {...Object.fromEntries(new FormData(form)), followDestination: document.querySelector('#follow-destination').checked};
}
async function checkSharedDestination(followOrigin, generation) {
  const checked = await request({type: 'checkDestinationGroup', followOrigin, generation});
  const stopped = checked.blocked || checked;
  if (stopped.status === 'permission_required' && Array.isArray(stopped.requiredOrigins) && stopped.requiredOrigins.length) {
    sharedChecks.set(followOrigin, [...stopped.requiredOrigins]);
    announce('The shared destination declares another origin. Review the requested address and allow its next check below.');
    return;
  }
  sharedChecks.delete(followOrigin);
  if (checked.blocked || ['blocked', 'unavailable', 'unknown', 'conflict', 'loop'].includes(stopped.status)) {
    const reasons = {
      changed: 'The group changed while checking. Review it and check again.',
      paused: 'The group is paused or no active member remains.',
      expired: 'This mapping expired. Recheck and renew it before following more moves.',
      override: 'A signed registry decision takes precedence. Review it in settings.',
      conflict: 'The move signals disagree or conflict with an existing mapping. No shared destination was changed.',
      loop: 'The declared move returns to an old group address. No shared destination was changed.',
      permission: 'Browser access changed. Grant the required source and destination access before checking again.'
    };
    announce(reasons[stopped.reason] || 'A working successor could not be established. The shared destination was not changed.', true);
    return;
  }
  announce(checked.updated
    ? `Shared destination updated to ${checked.currentOrigin}. All linked mappings use this address without renewing their expiry.`
    : `Shared destination checked: ${checked.currentOrigin || 'the saved address remains current'}.`);
}
async function render() {
  snapshot = await request({type: 'read'});
  const {config, grantedOrigins, receipts} = snapshot;
  renderFollowedSites(snapshot.continuity?.sites || []);
  await refreshContinuityAccess();
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
    card.dataset.mappingId = mapping.id;
    const expired = mapping.expiresAt <= Date.now() || mapping.createdAt > Date.now();
    const granted = grantedOrigins.includes(mapping.sourceOrigin);
    const state = expired ? 'Needs verification' : !granted ? 'Access needed' : paused || !mapping.enabled ? 'Paused' : 'Enabled';
    card.append(element('span', state, `mapping-state${expired || !granted || paused || !mapping.enabled ? ' review' : ''}`));
    card.append(element('h3', mapping.sourceOrigin));
    card.append(element('p', `→ ${mapping.destinationOrigin}`, 'destination'));
    card.append(element('p', 'User configured · Not owner or registry verified', 'provenance'));
    card.append(element('p', `Confirmed locally ${new Date(mapping.createdAt).toLocaleString()} · ${mapping.pathPolicy === 'preserve' ? 'Keeps the page path' : 'Opens homepage'} · Expires ${new Date(mapping.expiresAt).toLocaleString()}`, 'hint'));
    if (mapping.followOrigin) {
      const members = config.mappings.filter(item => item.followOrigin === mapping.followOrigin);
      card.append(element('p', 'Shared destination · follows declared moves', 'provenance'));
      card.append(element('p', `${members.length} linked old origins · Current: ${mapping.destinationOrigin}`, 'hint'));
      card.append(element('p', `Group started at ${mapping.followOrigin}. Linked origins: ${members.map(item => item.sourceOrigin).join(', ')}`, 'hint'));
    } else {
      card.append(element('p', 'Following destination moves links every local mapping currently pointing to this address; their individual expiry and page-path choices stay unchanged.', 'hint'));
    }
    const controls = element('div', undefined, 'actions');
    if (!granted) controls.append(action('Grant source access', async () => {
      const accepted = await chrome.permissions.request({origins: [permissionFor(mapping.sourceOrigin)]});
      if (!accepted) throw new Error('Source access was not granted. You can still open the destination homepage manually.');
      await request({type: 'toggle', id: mapping.id, enabled: mapping.enabled});
    }));
    if (!expired) controls.append(action(mapping.enabled ? 'Pause' : 'Enable', () => request({type: 'toggle', id: mapping.id, enabled: !mapping.enabled})));
    if (!expired) controls.append(action(mapping.pathPolicy === 'preserve' ? 'Open homepage only' : 'Keep page paths', async () => {
      const pathPolicy = mapping.pathPolicy === 'preserve' ? 'homepage' : 'preserve';
      await request({type: 'setPathPolicy', id: mapping.id, pathPolicy, generation: config.generation});
      announce(pathPolicy === 'preserve'
        ? 'Mapping updated. Ordinary page links keep their page path on the saved domain; queries and fragments are removed.'
        : 'Mapping updated. Links open the saved destination homepage.');
    }));
    if (!expired) controls.append(action(mapping.followOrigin ? 'Stop following destination moves' : 'Follow destination moves', async () => {
      const enabled = !mapping.followOrigin;
      if (enabled) {
        const wide = document.querySelector('#follow-wide-access').checked ? ['https://*/*'] : [];
        const accepted = await chrome.permissions.request({origins: [...new Set([permissionFor(mapping.sourceOrigin), permissionFor(mapping.destinationOrigin), ...wide])]});
        if (!accepted) throw new Error('Access was not granted. Shared destination following was not enabled.');
      }
      await request({type: 'setDestinationFollow', id: mapping.id, generation: config.generation, enabled});
      if (!enabled) sharedChecks.delete(mapping.followOrigin);
      announce(enabled ? 'Destination following enabled for all local mappings sharing this address. Declared future moves are checked on visits.' : 'Destination following stopped for every linked mapping. Their current saved destinations remain.');
    }));
    if (!expired && mapping.followOrigin) {
      controls.append(action('Check shared destination now', () => checkSharedDestination(mapping.followOrigin, config.generation)));
      const requiredOrigins = sharedChecks.get(mapping.followOrigin);
      if (requiredOrigins?.length) {
        card.append(element('p', `Next check requires: ${requiredOrigins.join(', ')}`, 'hint'));
        controls.append(action('Allow next shared destination check', async () => {
          const accepted = await chrome.permissions.request({origins: requiredOrigins.map(permissionFor)});
          if (!accepted) throw new Error('Permission was not granted. The shared destination was not changed.');
          await checkSharedDestination(mapping.followOrigin, config.generation);
        }));
      }
    }
    controls.append(action('Open homepage', () => chrome.tabs.create({url: mapping.destinationOrigin + '/'})));
    controls.append(action('Remove', async () => {
      await request({type: 'remove', id: mapping.id});
      // The mapping is already removed even if browser policy/required host
      // permissions prevent releasing access. Always refresh the saved state.
      try {
        const released = await chrome.permissions.remove({origins: [permissionFor(mapping.sourceOrigin)]});
        announce(released ? 'Mapping removed and its source access released.' : 'Mapping removed. Source access remains; review it in your browser extension settings.');
      } catch {
        announce('Mapping removed. Your browser did not allow source access to be released; review it in your browser extension settings.');
      }
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
    const input = mappingInput();
    const mapping = createMapping(input, Date.now(), 'preview', {allowTestOrigins: ALLOW_TEST_ORIGINS});
    const old = new URL(mapping.sourceOrigin);
    preview.append(element('strong', 'Preview · exact origin only'));
    preview.append(element('p', `${mapping.sourceOrigin}/… → ${mapping.destinationOrigin}/${mapping.pathPolicy === 'preserve' ? '…' : ''}`));
    preview.append(element('p', `Does not match ${old.protocol}//sub.${old.hostname} or ${old.protocol}//${old.hostname}.other.invalid.`));
    preview.hidden = false;
  } catch { preview.hidden = true; }
}

const continuityStatus = document.querySelector('#continuity-status');
const continuityPanel = document.querySelector('#continuity-result');
const continuityConsent = document.querySelector('#continuity-follow-consent');
const continuityFollow = document.querySelector('#continuity-follow');
function continuityOrigin(value) {
  return normalizeSource(value, {allowTestOrigins: ALLOW_TEST_ORIGINS});
}
function continuityMessage(message, error = false) {
  continuityStatus.textContent = message;
  continuityStatus.classList.toggle('continuity-form-error', error);
}
async function refreshContinuityAccess() {
  const status = document.querySelector('#continuity-access-status');
  try {
    const wide = await chrome.permissions.contains({origins: ['https://*/*']});
    status.textContent = wide
      ? "Broad HTTPS access is currently granted. Unchecking the box does not revoke it; review website access in Chrome's extension Details to remove that grant."
      : 'Broad HTTPS access is not granted. The browser will ask for each reached origin that does not already have access.';
  } catch {
    status.textContent = "Website access could not be read. Review it in Chrome's extension Details. Granted access persists until you revoke it.";
  }
}
function continuitySetBusy(busy) {
  continuityBusy = busy;
  document.querySelector('#continuity-source').disabled = busy;
  document.querySelector('#continuity-wide-access').disabled = busy;
  document.querySelector('#continuity-find').disabled = busy;
  document.querySelector('#continuity-continue').disabled = busy;
  document.querySelector('#continuity-open').disabled = busy;
  continuityFollow.disabled = busy || !continuityConsent.checked;
  for (const button of document.querySelectorAll('#continuity-followed button')) button.disabled = busy;
}
function renderContinuityResult(result) {
  continuityResult = result;
  continuityPanel.hidden = false;
  continuityConsent.checked = false;
  const title = document.querySelector('#continuity-result-title');
  const detail = document.querySelector('#continuity-result-detail');
  const chain = document.querySelector('#continuity-chain');
  const proceed = document.querySelector('#continuity-continue');
  const open = document.querySelector('#continuity-open');
  const followLabel = document.querySelector('#continuity-follow-label');
  const messages = {
    found: ['A reachable address was found', 'This is an observed continuity chain, not registry or owner verification. Inspect each step before opening it or enabling automatic following.'],
    permission_required: ['The next website needs your permission', 'The chain identified another origin. Approve access to check that origin, then Web Switcher will continue without asking you to enter a destination.'],
    unknown: ['No supported next address was found', 'There is not enough available or remembered evidence to find a replacement. The extension will not guess a similarly named website.'],
    conflict: ['The move signals disagree', 'Conflicting successors cannot authorize an automatic choice. No destination will be opened.'],
    loop: ['The chain returns to an earlier address', 'A cycle is not a current destination. No destination will be opened.'],
    unavailable: ['The website could not be checked', 'A failed request alone does not establish that the website moved. Previously remembered successors may help on a later check.']
  };
  const signedBarrier = result.reason === 'SIGNED_REGISTRY_PRECEDENCE';
  const [heading, explanation] = signedBarrier
    ? ['A signed registry decision takes precedence', 'A source in this chain belongs to signed registry history. Review that decision in settings; unverified discovery cannot replace withdrawn or expired signed authority.']
    : messages[result.status] || messages.unknown;
  title.textContent = heading;
  detail.textContent = explanation;
  chain.replaceChildren();
  if (result.sourceOrigin) chain.append(element('li', result.sourceOrigin));
  for (const hop of result.chain || []) {
    const row = element('li', `${hop.fromOrigin} → ${hop.toOrigin}`);
    const evidence = String(hop.evidence || 'move signal').replaceAll('_', ' ');
    let when = '';
    if (hop.checkedAt !== undefined && !Number.isNaN(new Date(hop.checkedAt).getTime())) when = ` · ${new Date(hop.checkedAt).toLocaleString()}`;
    row.append(element('span', `${hop.remembered ? 'Remembered successor · ' : ''}${evidence}${when} · Unverified`));
    chain.append(row);
  }
  if (result.status === 'found' && result.terminalOrigin) {
    const destination = element('li', `Reachable now: ${result.terminalOrigin}`);
    destination.className = 'continuity-terminal';
    chain.append(destination);
  }
  proceed.hidden = result.status !== 'permission_required' || !Array.isArray(result.requiredOrigins) || !result.requiredOrigins.length;
  if (!proceed.hidden) proceed.textContent = `Allow next check: ${result.requiredOrigins.map(continuityOrigin).join(', ')}`;
  open.hidden = result.status !== 'found' || !result.terminalOrigin;
  continuityFollow.hidden = signedBarrier || !result.sourceOrigin || !['found', 'unknown', 'unavailable'].includes(result.status);
  followLabel.hidden = continuityFollow.hidden;
  continuityFollow.disabled = true;
  continuityMessage(result.status === 'found' ? 'Check complete. No destination was entered manually.' : heading);
}
async function grantContinuityOrigins(origins) {
  const normalized = [...new Set(origins.map(continuityOrigin))];
  if (!normalized.length || normalized.length > 8) throw new Error('The next permission request is outside supported bounds.');
  if (!await chrome.permissions.request({origins: normalized.map(permissionFor)})) throw new Error('Website access was not granted. The check did not continue.');
}
async function discoverContinuity(sourceOrigin) {
  continuityMessage('Checking the old origin, its move signals and remembered successors…');
  const result = await request({type: 'CONTINUITY_DISCOVER', sourceOrigin});
  renderContinuityResult(result);
  await render();
}
document.querySelector('#continuity-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (continuityBusy || !event.currentTarget.reportValidity()) return;
  continuitySetBusy(true);
  continuityPanel.hidden = true;
  continuityResult = undefined;
  try {
    const sourceOrigin = continuityOrigin(document.querySelector('#continuity-source').value);
    const origins = [permissionFor(sourceOrigin)];
    if (document.querySelector('#continuity-wide-access').checked) origins.push('https://*/*');
    // Ask directly in this click gesture; a later fetch cannot manufacture consent.
    if (!await chrome.permissions.request({origins})) throw new Error('Website access was not granted. No continuity check was started.');
    await discoverContinuity(sourceOrigin);
  } catch (error) { continuityMessage(error.message, true); }
  finally { continuitySetBusy(false); }
});
document.querySelector('#continuity-source').addEventListener('input', () => {
  if (continuityBusy) return;
  continuityResult = undefined;
  continuityPanel.hidden = true;
  continuityConsent.checked = false;
  continuityMessage('Ready to check this old address.');
});
document.querySelector('#continuity-continue').addEventListener('click', async () => {
  if (continuityBusy || !continuityResult?.requiredOrigins?.length) return;
  continuitySetBusy(true);
  try {
    await grantContinuityOrigins(continuityResult.requiredOrigins);
    await discoverContinuity(continuityResult.sourceOrigin);
  } catch (error) { continuityMessage(error.message, true); }
  finally { continuitySetBusy(false); }
});
document.querySelector('#continuity-open').addEventListener('click', async () => {
  if (continuityBusy || continuityResult?.status !== 'found' || !continuityResult.terminalOrigin) return;
  continuitySetBusy(true);
  const expected = continuityResult;
  try {
    await request({type: 'CONTINUITY_OPEN', sourceOrigin: expected.sourceOrigin, expectedOrigin: expected.terminalOrigin});
    continuityMessage('The chain was checked again before opening the observed address.');
  } catch (error) {
    document.querySelector('#continuity-open').hidden = true;
    continuityFollow.hidden = true;
    document.querySelector('#continuity-follow-label').hidden = true;
    continuityMessage(`${error.message} Run Find current address again before opening a result.`, true);
  }
  finally { continuitySetBusy(false); }
});
continuityConsent.addEventListener('change', () => { continuityFollow.disabled = continuityBusy || !continuityConsent.checked; });
continuityFollow.addEventListener('click', async () => {
  if (continuityBusy || !continuityResult?.sourceOrigin || !continuityConsent.checked) return;
  continuitySetBusy(true);
  try {
    await grantContinuityOrigins([continuityResult.sourceOrigin]);
    await request({type: 'CONTINUITY_FOLLOW', sourceOrigin: continuityResult.sourceOrigin, enabled: true});
    continuityConsent.checked = false;
    await render();
    continuityMessage('Following this source. Future visits can check and follow its observed successor chain.');
  } catch (error) { continuityMessage(error.message, true); }
  finally { continuitySetBusy(false); }
});
function renderFollowedSites(sites) {
  const list = document.querySelector('#continuity-followed');
  list.replaceChildren();
  if (!sites.length) list.append(element('p', 'No followed websites yet. Start with an old address above.', 'hint'));
  for (const site of sites) {
    const card = element('article', undefined, 'mapping');
    card.append(element('span', site.enabled ? 'Following future moves' : 'Following paused', `mapping-state${site.enabled ? '' : ' review'}`));
    card.append(element('h3', site.sourceOrigin));
    card.append(element('p', 'Website-declared continuity · Not owner or registry verified', 'provenance'));
    const controls = element('div', undefined, 'actions');
    controls.append(action('Check current address', async () => {
      if (continuityBusy) return;
      continuitySetBusy(true);
      try {
        await grantContinuityOrigins([site.sourceOrigin]);
        document.querySelector('#continuity-source').value = site.sourceOrigin;
        await discoverContinuity(site.sourceOrigin);
        document.querySelector('#continuity').scrollIntoView({block: 'start'});
      } finally { continuitySetBusy(false); }
    }));
    controls.append(action(site.enabled ? 'Pause following' : 'Resume following', async () => {
      if (!site.enabled) await grantContinuityOrigins([site.sourceOrigin]);
      await request({type: 'CONTINUITY_FOLLOW', sourceOrigin: site.sourceOrigin, enabled: !site.enabled});
    }));
    controls.append(action('Forget this website', async () => {
      await request({type: 'CONTINUITY_FORGET', sourceOrigin: site.sourceOrigin});
      if (continuityResult?.sourceOrigin === site.sourceOrigin) { continuityResult = undefined; continuityPanel.hidden = true; }
      continuityMessage('The followed source and its selected continuity memory were removed. Review retained website access in Chrome settings if needed.');
    }, 'text-button'));
    card.append(controls);
    list.append(card);
  }
  for (const button of list.querySelectorAll('button')) button.disabled = continuityBusy;
}
form.addEventListener('input', previewMapping);
form.addEventListener('change', previewMapping);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || !form.reportValidity()) return;
  const input = mappingInput();
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
    const wide = input.followDestination && document.querySelector('#follow-wide-access').checked ? ['https://*/*'] : [];
    const origins = [permissionFor(origin), ...(input.followDestination ? [permissionFor(mapping.destinationOrigin), ...wide] : [])];
    const accepted = await chrome.permissions.request({origins: [...new Set(origins)]});
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
      if (mapping.followOrigin) row.append(element('span', `Follows shared destination moves · Group started at ${mapping.followOrigin}`));
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
  if (!confirm('Delete all local mappings, followed websites, continuity memory, online investigations, service settings and routing activity? This cannot be undone. Export mapping settings first if you need them.')) return;
  internetUi?.clear();
  try {
    await request({type: 'CLEAR_LOCAL_DATA'});
    continuityResult = undefined;
    continuityPanel.hidden = true;
    await render();
    announce('Local mappings, followed websites, continuity memory, online investigations, service settings and routing activity deleted.');
    continuityMessage('No local continuity memory remains.');
  }
  catch (error) { announce(error.message, true); }
});
chrome.storage.local.get('uiTheme').then(({uiTheme = 'system'}) => {
  applyTheme(uiTheme);
  document.querySelector('#theme').value = ['light', 'dark'].includes(uiTheme) ? uiTheme : 'system';
}).catch(() => {});
const source = new URLSearchParams(location.search).get('source');
if (source) {
  document.querySelector('#source').value = source;
  document.querySelector('#continuity-source').value = source;
  previewMapping();
}
render().catch(error => announce(error.message, true));
let mappingRefreshTimer;
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.config || JSON.stringify(changes.config.oldValue) === JSON.stringify(changes.config.newValue)) return;
  clearTimeout(mappingRefreshTimer);
  mappingRefreshTimer = setTimeout(() => render().catch(error => announce(error.message, true)), 75);
});
internetUi = initializeInternetUi({request, refresh: render, allowTestOrigins: ALLOW_TEST_ORIGINS, providerUrls: INTERNET_PROVIDER_FIXTURES});

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
