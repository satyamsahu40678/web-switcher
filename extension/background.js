import {ALLOW_TEST_ORIGINS} from './build-config.js';
import {compileRules, createMapping, permissionFor, resolveRoute, validateConfig, loopDetected} from './core.js';

const options = {allowTestOrigins: ALLOW_TEST_ORIGINS};
const empty = () => ({schemaVersion: 1, generation: crypto.randomUUID(), paused: false, mappings: []});
let queue = Promise.resolve();
function serial(work) {
  const task = queue.then(work);
  queue = task.catch(() => {});
  return task;
}
async function readConfig() {
  const {config} = await chrome.storage.local.get('config');
  return validateConfig(config || empty(), options);
}
async function grantedFor(config) {
  const granted = new Set();
  for (const mapping of config.mappings) {
    if (await chrome.permissions.contains({origins: [permissionFor(mapping.sourceOrigin)]})) granted.add(mapping.sourceOrigin);
  }
  return granted;
}
async function installRules(config) {
  const grants = await grantedFor(config);
  const rules = compileRules(config, chrome.runtime.getURL('route.html'), grants, Date.now(), options);
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
    // A crash between storage and DNR writes is deliberately fail-closed at the gate.
    // Reconciliation restores the last committed configuration after a restart.
    await installRules(await readConfig()).catch(() => {});
    await chrome.storage.local.remove('pendingConfig');
    throw error;
  }
}
async function reconcile() {
  const config = await readConfig();
  await installRules(config);
  await chrome.storage.local.set({config});
  await chrome.storage.local.remove('pendingConfig');
}
function fromPage(sender, path) {
  if (sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.host === chrome.runtime.id && url.pathname === path;
  } catch { return false; }
}
async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('Invalid message.');
  if (message.type === 'resolve' && fromPage(sender, '/route.html')) {
    const config = await readConfig();
    const result = resolveRoute(config, message.envelope, Date.now(), options);
    if (result.status !== 'ready') return result;
    if (!(await chrome.permissions.contains({origins: [permissionFor(result.sourceOrigin)]}))) return {status: 'blocked', reason: 'permission'};
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return {status: 'blocked', reason: 'invalid'};
    const {attempts = {}} = await chrome.storage.session.get('attempts');
    const key = `${sender.tab.id}:${result.mappingId}`;
    const now = Date.now();
    if (loopDetected(attempts[key], now)) return {status: 'blocked', reason: 'loop'};
    const pruned = Object.fromEntries(Object.entries(attempts).filter(([, at]) => now >= at && now - at < 15000));
    pruned[key] = now;
    await chrome.storage.session.set({attempts: pruned});
    const {receipts = []} = await chrome.storage.local.get('receipts');
    // No paths, queries, fragments, page contents, or browser history are stored.
    await chrome.storage.local.set({receipts: [{sourceOrigin: result.sourceOrigin, destinationOrigin: result.destinationOrigin, at: now}, ...receipts].slice(0, 20)});
    return result;
  }
  if (!fromPage(sender, '/options.html')) throw new Error('This page cannot modify Web Switcher.');
  const current = await readConfig();
  if (message.type === 'read') {
    const {receipts = []} = await chrome.storage.local.get('receipts');
    return {config: current, receipts, grantedOrigins: [...await grantedFor(current)]};
  }
  if (message.type === 'clearReceipts') {
    await chrome.storage.local.remove('receipts');
    return {ok: true};
  }
  const next = structuredClone(current);
  next.generation = crypto.randomUUID();
  if (message.type === 'save') {
    const mapping = createMapping(message.input, Date.now(), crypto.randomUUID(), options);
    if (!(await chrome.permissions.contains({origins: [permissionFor(mapping.sourceOrigin)]}))) throw new Error('Allow access to the source origin before saving.');
    next.mappings.push(mapping);
  } else if (message.type === 'pauseAll') {
    if (typeof message.paused !== 'boolean') throw new Error('Invalid pause value.');
    next.paused = message.paused;
  } else if (message.type === 'toggle') {
    const mapping = next.mappings.find(m => m.id === message.id);
    if (!mapping || typeof message.enabled !== 'boolean') throw new Error('Mapping not found.');
    mapping.enabled = message.enabled;
  } else if (message.type === 'remove') {
    if (!next.mappings.some(m => m.id === message.id)) throw new Error('Mapping not found.');
    next.mappings = next.mappings.filter(m => m.id !== message.id);
  } else {
    throw new Error('Unsupported request.');
  }
  await commitConfig(next);
  return {ok: true};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(() => handle(message, sender)).then(data => respond({ok: true, data}), error => respond({ok: false, error: error.message}));
  return true;
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onInstalled.addListener(() => serial(reconcile).catch(console.error));
chrome.runtime.onStartup.addListener(() => serial(reconcile).catch(console.error));
chrome.permissions.onRemoved.addListener(() => serial(reconcile).catch(console.error));
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const {attempts = {}} = await chrome.storage.session.get('attempts');
  await chrome.storage.session.set({attempts: Object.fromEntries(Object.entries(attempts).filter(([key]) => !key.startsWith(`${tabId}:`)))});
}).catch(console.error));
