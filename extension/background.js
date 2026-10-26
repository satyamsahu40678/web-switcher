import {ALLOW_TEST_ORIGINS, TRUSTED_REGISTRY_KEYS, REGISTRY_URL} from './build-config.js';
import {compileRules, createMapping, permissionFor, validateConfig, loopDetected, importSettings, pruneReceipts, confirmationMatches, MAX_LOCAL_MAPPINGS} from './core.js';
import {combineConfig, resolveWithCatalog} from './catalog-adapter.js';
import {verifyCatalog, parseStrictJson} from './security/catalog.mjs';

const options = {allowTestOrigins: ALLOW_TEST_ORIGINS};
const empty = () => ({schemaVersion: 1, generation: crypto.randomUUID(), paused: false, mappings: []});
let queue = Promise.resolve();
function serial(work) { const task = queue.then(work); queue = task.catch(() => {}); return task; }
async function readConfig() {
  const {config} = await chrome.storage.local.get('config');
  // Corrupt storage must never preserve live routing. Keep a recovery copy.
  try { return validateConfig(config || empty(), options); }
  catch {
    await chrome.storage.local.set({corruptConfig: config, config: empty()});
    return (await chrome.storage.local.get('config')).config;
  }
}
async function currentCatalog() {
  const {catalogRecord, catalogHighwater} = await chrome.storage.local.get(['catalogRecord', 'catalogHighwater']);
  if (!catalogRecord) return {catalog: null};
  try { return await verifyCatalog(catalogRecord.jws, {keys: TRUSTED_REGISTRY_KEYS, previous: catalogHighwater || catalogRecord.memory}); }
  catch (error) { return {catalog: null, error: error.message}; }
}
async function routingState(local) {
  const registry = await currentCatalog();
  return {config: combineConfig(local, registry.catalog, options), ...registry};
}
async function grantedFor(config) {
  const granted = new Set();
  for (const mapping of config.mappings) if (await chrome.permissions.contains({origins: [permissionFor(mapping.sourceOrigin)]})) granted.add(mapping.sourceOrigin);
  return granted;
}
async function installRules(local, catalogOverride) {
  const config = catalogOverride === undefined ? (await routingState(local)).config : combineConfig(local, catalogOverride, options);
  const rules = compileRules(config, chrome.runtime.getURL('route.html'), await grantedFor(config), Date.now(), options);
  for (const rule of rules) {
    const supported = await chrome.declarativeNetRequest.isRegexSupported({regex: rule.condition.regexFilter, requireCapturing: true});
    if (!supported.isSupported) throw new Error('This browser cannot compile the requested routing rule.');
  }
  const previous = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds: previous.map(rule => rule.id), addRules: rules});
}
async function commitConfig(next) {
  validateConfig(next, options);
  await chrome.storage.local.set({pendingConfig: next});
  try {
    await installRules(next);
    await chrome.storage.local.set({config: next});
    await chrome.storage.local.remove('pendingConfig');
  } catch (error) {
    await installRules(await readConfig()).catch(() => {});
    await chrome.storage.local.remove('pendingConfig');
    throw error;
  }
}
async function receiptsNow() {
  const {receipts} = await chrome.storage.local.get('receipts');
  const clean = pruneReceipts(receipts, Date.now());
  await chrome.storage.local.set({receipts: clean});
  return clean;
}
async function reconcile() {
  const config = await readConfig();
  await installRules(config);
  await chrome.storage.local.set({config});
  await chrome.storage.local.remove('pendingConfig');
  await receiptsNow();
  await cleanBypasses();
}
function fromPage(sender, path) {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try { const url = new URL(sender.url); return url.protocol === 'chrome-extension:' && url.host === chrome.runtime.id && url.pathname === path; }
  catch { return false; }
}
async function recordSwitch(result, sender) {
  const {attempts = {}, receiptTabs = {}} = await chrome.storage.session.get(['attempts', 'receiptTabs']);
  const key = `${sender.tab.id}:${result.mappingId}`;
  const now = Date.now();
  if (loopDetected(attempts[key], now)) return {status: 'blocked', reason: 'loop'};
  const pruned = Object.fromEntries(Object.entries(attempts).filter(([, at]) => now >= at && now - at < 15000));
  pruned[key] = now;
  const at = Math.max(now, ...(await receiptsNow()).map(receipt => receipt.at + 1));
  receiptTabs[String(at)] = {tabId: sender.tab.id, expectedUrl: result.url, expiresAt: now + 120000};
  await chrome.storage.session.set({attempts: pruned, receiptTabs: Object.fromEntries(Object.entries(receiptTabs).filter(([, ref]) => ref.expiresAt > now))});
  await chrome.storage.local.set({receipts: [{sourceOrigin: result.sourceOrigin, destinationOrigin: result.destinationOrigin, at}, ...await receiptsNow()].slice(0, 20)});
  return result;
}
async function resolve(message, sender) {
  if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return {status: 'blocked', reason: 'invalid'};
  const {config, catalog} = await routingState(await readConfig());
  const result = resolveWithCatalog(config, message.envelope, Date.now(), catalog, options);
  if (!result.sourceOrigin) return result;
  if (!(await chrome.permissions.contains({origins: [permissionFor(result.sourceOrigin)]}))) return {status: 'blocked', reason: 'permission'};
  if (message.type === 'confirmRoute') {
    // Recompute from current signed/local policy. Never trust the click's target.
    if (!confirmationMatches(result, message.expectedUrl)) return {status: 'blocked', reason: 'changed'};
    return recordSwitch({...result, status: 'ready', url: result.homepage}, sender);
  }
  return result.status === 'ready' ? recordSwitch(result, sender) : result;
}
async function cleanBypasses(tabId) {
  const {bypasses = {}} = await chrome.storage.session.get('bypasses');
  const remove = Object.entries(bypasses).filter(([key, value]) => Number(key) === tabId || value.expiresAt <= Date.now());
  if (remove.length) {
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: remove.map(([, value]) => value.ruleId)});
    for (const [key] of remove) delete bypasses[key];
    await chrome.storage.session.set({bypasses});
  }
}
async function undo(message) {
  if (!Number.isInteger(message.tabId) || typeof message.receiptId !== 'string') throw new Error('Select the recently switched tab.');
  const receipt = (await receiptsNow()).find(item => String(item.at) === message.receiptId);
  const {receiptTabs = {}, bypasses = {}} = await chrome.storage.session.get(['receiptTabs', 'bypasses']);
  const ref = receiptTabs[message.receiptId];
  if (!receipt || !ref || ref.tabId !== message.tabId || ref.expiresAt <= Date.now()) throw new Error('This undo has expired. Open the original origin manually.');
  const tab = await chrome.tabs.get(message.tabId);
  if (!tab.url || tab.url !== ref.expectedUrl || new URL(tab.url).origin !== receipt.destinationOrigin) throw new Error('The tab has moved. Undo was stopped.');
  const ruleId = 1000000 + message.tabId;
  const regexFilter = '^' + receipt.sourceOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/.*$';
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [ruleId], addRules: [{id: ruleId, priority: 100, action: {type: 'allow'}, condition: {tabIds: [message.tabId], regexFilter, resourceTypes: ['main_frame'], requestMethods: ['get']}}]});
  bypasses[message.tabId] = {ruleId, sourceOrigin: receipt.sourceOrigin, expiresAt: Date.now() + 60000};
  await chrome.storage.session.set({bypasses});
  await chrome.alarms.create('cleanup', {delayInMinutes: 1});
  await chrome.tabs.update(message.tabId, {url: receipt.sourceOrigin + '/'});
  return {ok: true};
}
async function acceptCatalog(jws) {
  const {catalogHighwater} = await chrome.storage.local.get('catalogHighwater');
  const record = await verifyCatalog(jws, {keys: TRUSTED_REGISTRY_KEYS, previous: catalogHighwater});
  const memory = {sequence: record.sequence, digest: record.digest, acceptedAt: record.acceptedAt};
  // Validate composition before writing. Local overrides win, conflicts fail closed.
  combineConfig(await readConfig(), record.catalog, options);
  const config = await readConfig(); config.generation = crypto.randomUUID();
  await chrome.storage.local.set({pendingConfig: config});
  try {
    await installRules(config, record.catalog);
    await chrome.storage.local.set({config, catalogHighwater: memory, catalogRecord: {jws, memory}});
    await chrome.storage.local.remove('pendingConfig');
  } catch (error) {
    await installRules(await readConfig()).catch(() => {});
    await chrome.storage.local.remove('pendingConfig');
    throw error;
  }
  return {sequence: record.sequence};
}
async function refreshCatalog() {
  if (!REGISTRY_URL || Object.keys(TRUSTED_REGISTRY_KEYS).length === 0) throw new Error('No registry endpoint and trust anchor configured.');
  const url = new URL(REGISTRY_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Registry endpoint must be an exact HTTPS URL.');
  const {catalogEtag} = await chrome.storage.local.get('catalogEtag');
  const response = await fetch(url, {credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15000), headers: catalogEtag ? {'If-None-Match': catalogEtag} : {}});
  if (response.status === 304) { const current = await currentCatalog(); if (!current.catalog) throw new Error('Cached catalog expired; request a new release.'); return {ok: true}; }
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}.`);
  const reader = response.body.getReader(); let text = ''; let size = 0; const decoder = new TextDecoder('utf-8', {fatal: true});
  for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 1000000) { await reader.cancel(); throw new Error('Catalog is too large.'); } text += decoder.decode(value, {stream: true}); }
  text += decoder.decode();
  const result = await acceptCatalog(text.trim());
  await chrome.storage.local.set({catalogEtag: response.headers.get('ETag') || ''});
  return result;
}
async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('Invalid message.');
  if (['resolve', 'confirmRoute'].includes(message.type) && fromPage(sender, '/route.html')) return resolve(message, sender);
  const settings = fromPage(sender, '/options.html');
  const popup = fromPage(sender, '/popup.html');
  if (!settings && !popup) throw new Error('This page cannot modify Web Switcher.');
  const current = await readConfig();
  if (message.type === 'read') {
    const registry = await currentCatalog();
    return {config: current, receipts: await receiptsNow(), grantedOrigins: [...await grantedFor((await routingState(current)).config)], registryConfigured: Object.keys(TRUSTED_REGISTRY_KEYS).length > 0, registryRefreshConfigured: Boolean(REGISTRY_URL), registry: registry.catalog ? {sequence: registry.sequence, expiresAt: registry.catalog.expiresAt, families: registry.catalog.families} : {error: registry.error}};
  }
  if (message.type === 'clearReceipts') { await chrome.storage.local.remove('receipts'); await chrome.storage.session.remove('receiptTabs'); return {ok: true}; }
  if (message.type === 'undo') return undo(message);
  if (message.type === 'EXPORT_SETTINGS' && settings) return {schemaVersion: 1, paused: current.paused, mappings: current.mappings};
  if (message.type === 'importCatalog' && settings) return acceptCatalog(message.jws);
  if (message.type === 'REFRESH_CATALOG' && settings) return refreshCatalog();
  if (message.type === 'CLEAR_LOCAL_DATA' && settings) {
    await commitConfig(empty());
    await chrome.storage.local.remove(['receipts', 'catalogRecord', 'catalogEtag', 'corruptConfig']);
    // Keep rollback highwater; clearing settings must not make old signatures new.
    await chrome.storage.session.clear();
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: rules.map(rule => rule.id)});
    await installRules(await readConfig());
    return {ok: true};
  }
  let next = structuredClone(current); next.generation = crypto.randomUUID();
  if (message.type === 'IMPORT_SETTINGS' && settings) {
    if (typeof message.text !== 'string' || message.text.length > 100000) throw new Error('Import a settings file smaller than 100 KB.');
    next = importSettings(parseStrictJson(message.text), next.generation, options);
    // Imports never request or manufacture browser grants. Ungranted rules remain inactive.
  } else if (message.type === 'save' && settings) {
    if (next.mappings.length >= MAX_LOCAL_MAPPINGS) throw new Error('At most 50 local mappings are supported.');
    const mapping = createMapping(message.input, Date.now(), crypto.randomUUID(), options);
    if (!(await chrome.permissions.contains({origins: [permissionFor(mapping.sourceOrigin)]}))) throw new Error('Allow access to the source origin before saving.');
    next.mappings.push(mapping);
  } else if (message.type === 'pauseAll') {
    if (typeof message.paused !== 'boolean') throw new Error('Invalid pause value.'); next.paused = message.paused;
  } else if (message.type === 'toggle' && settings) {
    const mapping = next.mappings.find(item => item.id === message.id);
    if (!mapping || typeof message.enabled !== 'boolean') throw new Error('Mapping not found.'); mapping.enabled = message.enabled;
  } else if (message.type === 'remove' && settings) {
    if (!next.mappings.some(item => item.id === message.id)) throw new Error('Mapping not found.'); next.mappings = next.mappings.filter(item => item.id !== message.id);
  } else throw new Error('Unsupported request.');
  await commitConfig(next); return {ok: true};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => { serial(() => handle(message, sender)).then(data => respond({ok: true, data}), error => respond({ok: false, error: error.message})); return true; });
chrome.runtime.onInstalled.addListener(() => serial(async () => { await reconcile(); await chrome.alarms.create('maintenance', {periodInMinutes: 60}); }).catch(console.error));
chrome.runtime.onStartup.addListener(() => serial(reconcile).catch(console.error));
chrome.permissions.onRemoved.addListener(() => serial(reconcile).catch(console.error));
chrome.permissions.onAdded.addListener(() => serial(reconcile).catch(console.error));
chrome.alarms.onAlarm.addListener(alarm => serial(async () => { await reconcile(); if (alarm.name === 'maintenance' && REGISTRY_URL) await refreshCatalog(); }).catch(console.error));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => { if (changeInfo.status === 'complete') serial(() => cleanBypasses(tabId)).catch(console.error); });
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  await cleanBypasses(tabId);
  const {attempts = {}, receiptTabs = {}} = await chrome.storage.session.get(['attempts', 'receiptTabs']);
  await chrome.storage.session.set({attempts: Object.fromEntries(Object.entries(attempts).filter(([key]) => !key.startsWith(`${tabId}:`))), receiptTabs: Object.fromEntries(Object.entries(receiptTabs).filter(([, ref]) => ref.tabId !== tabId))});
}).catch(console.error));
