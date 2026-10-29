import {normalizeSource} from './continuity.js';
import {permissionFor} from './core.js';

export const INTERNET_ARCHIVE_PERMISSIONS = ['https://archive.org/*', 'https://web.archive.org/*'];
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired']);
const STATES = new Set(['queued', 'running', ...TERMINAL]);

/** Packaged UI only. The worker owns networking, result validation and authority. */
export function initializeInternetUi({request, refresh = async () => {}, allowTestOrigins = false, providerUrls = null}) {
  const section = document.querySelector('#internet-discovery');
  if (!section) return {clear() {}};
  const sourceInput = document.querySelector('#continuity-source');
  const modeInput = document.querySelector('#internet-mode');
  const consent = document.querySelector('#internet-consent');
  const start = document.querySelector('#internet-start');
  const cancel = document.querySelector('#internet-cancel');
  const status = document.querySelector('#internet-status');
  const results = document.querySelector('#internet-results');
  const serviceInput = document.querySelector('#internet-service-origin');
  const tokenInput = document.querySelector('#internet-service-token');
  const configSave = document.querySelector('#internet-config-save');
  let serviceOrigin = '', hasAccessToken = false, job, pollTimer, pendingStart = false, epoch = 0;
  const archivePermissions = allowTestOrigins && providerUrls
    ? [...new Set([providerUrls.availability, providerUrls.cdx, providerUrls.replay].map(value => {
      const url = new URL(value);
      if (url.protocol !== 'http:' || !url.hostname.endsWith('.test') || url.username || url.password) throw new Error('Invalid archive fixture origin.');
      return url.origin + '/*';
    }))]
    : INTERNET_ARCHIVE_PERMISSIONS;

  function node(tag, text, className) {
    const value = document.createElement(tag);
    if (text !== undefined) value.textContent = String(text);
    if (className) value.className = className;
    return value;
  }
  const origin = value => normalizeSource(value, {allowTestOrigins});
  function exactOrigin(value) {
    const normalized = origin(value);
    if (typeof value !== 'string' || ![normalized, normalized + '/'].includes(value.trim())) throw new Error('Use an exact public HTTPS origin without a page path.');
    return normalized;
  }
  function display(message, error = false, state = '') {
    status.textContent = message;
    status.classList.toggle('continuity-form-error', error);
    status.dataset.status = state;
  }
  function busy() { return pendingStart || (job && !TERMINAL.has(job.status)); }
  function controls() {
    start.disabled = !consent.checked || Boolean(busy());
    cancel.hidden = !busy();
  }
  function disclosure() {
    document.querySelector('#internet-disclosure').textContent = modeInput.value === 'service'
      ? serviceOrigin
        ? `The discovery service at ${serviceOrigin} receives this selected hostname and may ask its configured search and archive providers. Your entered path, query and fragment are not sent. Its operators and providers can observe normal request metadata.`
        : 'Configure a discovery service below before choosing this mode. Public archive investigation works without a service, account or access token.'
      : 'Archive.org and the Wayback Machine receive the selected hostname and normal connection information. Your entered path, query and fragment are not sent. Public history may be incomplete or unavailable.';
  }
  function sourcePreview() {
    let value = 'Enter an old website address above.';
    try { value = origin(sourceInput.value); } catch { /* Keep private/invalid input out of the preview. */ }
    document.querySelector('#internet-source-preview').textContent = value;
  }
  function tokenState() {
    document.querySelector('#internet-service-state').textContent = serviceOrigin
      ? `Service: ${serviceOrigin}. ${hasAccessToken ? 'An access token is saved for this browser session; it is not read back into this form.' : 'No access token is saved for this browser session.'}`
      : 'No service configured. Public archive investigation is available without one.';
  }
  async function loadConfig() {
    const config = await request({type: 'INTERNET_CONFIG_GET'});
    serviceOrigin = config?.serviceOrigin ? exactOrigin(config.serviceOrigin) : '';
    hasAccessToken = Boolean(config?.hasAccessToken);
    serviceInput.value = serviceOrigin;
    tokenInput.value = '';
    tokenState(); disclosure();
  }
  function stopTimer() { clearTimeout(pollTimer); pollTimer = undefined; }
  function cancelJob(previous) {
    // Completed suggestions can still have a check/open in flight. Invalidate
    // their worker reference too when the user changes source or clears the UI.
    if (previous?.id && !['cancelled', 'expired'].includes(previous.status)) void request({type: 'INTERNET_CANCEL', jobId: previous.id}).catch(() => {});
  }
  function invalidate(message, {resetConsent = true} = {}) {
    const previous = job;
    epoch++; stopTimer(); job = undefined; pendingStart = false;
    cancelJob(previous);
    results.replaceChildren();
    delete results.dataset.jobId;
    if (resetConsent) consent.checked = false;
    controls();
    if (message) display(message);
  }
  async function grant(origins) {
    const unique = [...new Set(origins.map(exactOrigin))];
    if (!unique.length || unique.length > 10) throw new Error('This permission request is outside the supported lookup bounds.');
    // Called directly from a user click, never by polling or a provider reply.
    if (!await chrome.permissions.request({origins: unique.map(permissionFor)})) throw new Error('Website access was not granted. No unchecked address was opened.');
  }
  function evidenceLink(value) {
    try {
      const url = new URL(value);
      exactOrigin(url.origin);
      if (url.username || url.password || url.href.length > 2048) return null;
      url.search = ''; url.hash = '';
      return url.href;
    } catch { return null; }
  }
  function date(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
  }
  function resultMessage(result) {
    const codes = Array.isArray(result.reasonCodes) ? result.reasonCodes.filter(value => typeof value === 'string') : [];
    if (codes.includes('SIGNED_REGISTRY_PRECEDENCE')) return 'A source in this investigation belongs to signed registry history. Public suggestions cannot replace that authority; review the registry decision in settings.';
    if (result.status === 'cancelled') return 'Search cancelled. No suggestion has been opened.';
    if (result.status === 'expired') return 'This investigation expired. Start a fresh search before using a result.';
    if (result.outcome === 'conflict' || result.outcome === 'blocked') return 'The evidence or current policy does not permit a destination to be chosen. No address was opened.';
    if (result.status === 'failed' || result.outcome === 'unavailable') return 'Public sources could not complete this investigation. You can retry later or use a configured discovery service. This does not establish that the website has no successor.';
    if (codes.some(value => value.includes('BUDGET') || value.includes('LIMIT'))) return 'The investigation reached its request or time limit. Any displayed suggestions remain incomplete and unverified.';
    if (result.outcome === 'candidates' && result.candidates?.length) return result.completeness === 'partial'
      ? 'Public sources found suggestions, but some checks were unavailable or incomplete. Inspect the evidence and check an address before opening it.'
      : 'Public sources found possible successors. These are unverified suggestions; inspect their evidence and check an address before opening it.';
    return 'No supported replacement was established from these public sources. You do not need to provide a history file; a public record may simply be missing or unavailable.';
  }
  function candidateCard(candidate, selectedJob, currentEpoch) {
    const candidateOrigin = exactOrigin(candidate.origin);
    if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(candidate.id)) throw new Error('A suggestion has an unsupported identifier.');
    const card = node('article', undefined, 'internet-candidate');
    card.dataset.candidateId = candidate.id;
    card.append(node('h3', candidateOrigin));
    if (typeof candidate.title === 'string' && candidate.title) card.append(node('p', candidate.title.slice(0, 240), 'muted'));
    card.append(node('p', 'Unverified suggestion · Not owner or registry verified', 'provenance'));
    const evidence = node('ul', undefined, 'internet-evidence');
    for (const item of (Array.isArray(candidate.evidence) ? candidate.evidence : []).slice(0, 10)) {
      if (!item || typeof item !== 'object') continue;
      const row = node('li');
      const kind = typeof item.kind === 'string' ? item.kind.slice(0, 80).replaceAll('_', ' ') : 'Public claim';
      row.append(node('strong', kind));
      if (typeof item.summary === 'string') row.append(node('p', item.summary.slice(0, 1000)));
      const captured = item.capturedAt === undefined ? '' : date(item.capturedAt);
      if (captured) row.append(node('p', `Historical capture: ${captured}. This is not a live availability check.`));
      const href = evidenceLink(item.sourceUrl);
      if (href) {
        const link = node('a', 'View public evidence');
        link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
        row.append(link);
      }
      evidence.append(row);
    }
    if (evidence.childNodes.length) card.append(evidence);
    const hint = node('p', candidate.availability?.state === 'reachable'
      ? `A service reported this address reachable${candidate.availability.checkedAt ? ` at ${date(candidate.availability.checkedAt)}` : ''}. Check it from this browser before opening.`
      : 'This suggestion has not been checked in this browser. A familiar name, archived claim or reachable page does not prove identity.', 'internet-candidate-status');
    hint.setAttribute('role', 'status');
    card.append(hint);
    const actions = node('div', undefined, 'actions');
    const check = node('button', 'Check this address', 'secondary'); check.type = 'button'; check.dataset.action = 'check';
    const next = node('button', 'Allow next check', 'secondary'); next.type = 'button'; next.dataset.action = 'continue'; next.hidden = true;
    const open = node('button', 'Open checked address', 'primary'); open.type = 'button'; open.dataset.action = 'open'; open.hidden = true;
    actions.append(check, next, open); card.append(actions);
    const rememberLabel = node('label', undefined, 'check-label');
    const remember = node('input'); remember.type = 'checkbox'; remember.dataset.action = 'remember';
    rememberLabel.append(remember, node('span', 'Remember this choice for 24 hours (unverified). Future visits use a user-configured homepage override; this does not establish website ownership.'));
    rememberLabel.hidden = true;
    const save = node('button', 'Remember checked choice', 'secondary'); save.type = 'button'; save.dataset.action = 'save'; save.hidden = true; save.disabled = true;
    card.append(rememberLabel, save);
    let checked;
    function current() { return epoch === currentEpoch && job?.id === selectedJob.id && job.status === 'completed'; }
    function rejectChecked(message) {
      checked = undefined; open.hidden = true; next.hidden = true; rememberLabel.hidden = true; remember.checked = false; save.hidden = true; save.disabled = true;
      hint.textContent = message; hint.classList.add('continuity-form-error'); card.dataset.checkStatus = 'unavailable';
    }
    function showCheck(result) {
      hint.classList.remove('continuity-form-error');
      open.hidden = true; next.hidden = true; rememberLabel.hidden = true; remember.checked = false; save.hidden = true; save.disabled = true;
      checked = result;
      card.dataset.checkStatus = result?.status || 'unavailable';
      if (result?.status === 'ready' && result.terminalOrigin) {
        const terminal = exactOrigin(result.terminalOrigin);
        checked = {...result, terminalOrigin: terminal};
        hint.textContent = `Checked endpoint: ${terminal}. The browser can reach it now; the original website's identity remains unverified.`;
        open.hidden = false; rememberLabel.hidden = false; save.hidden = false;
      } else if (result?.status === 'permission_required' && Array.isArray(result.requiredOrigins) && result.requiredOrigins.length) {
        const required = result.requiredOrigins.map(exactOrigin);
        if (required.length > 8) throw new Error('The suggested chain exceeds the supported permission bounds.');
        checked = {...result, requiredOrigins: required};
        hint.textContent = `This address points to another origin. Allow its check to continue: ${required.join(', ')}.`;
        next.hidden = false;
      } else {
        rejectChecked(result?.reason === 'SIGNED_REGISTRY_PRECEDENCE'
          ? 'A signed registry decision takes precedence for a source in this chain. This suggestion cannot replace it.'
          : 'A current reachable endpoint could not be established. No address was opened; check again before making a choice.');
      }
    }
    async function inspect(required = [selectedJob.sourceOrigin, candidateOrigin]) {
      if (!current()) return;
      check.disabled = true; next.disabled = true;
      rejectChecked('Checking the suggestion and any explicit successor chain…');
      try {
        await grant(required);
        if (!current()) return;
        const result = await request({type: 'INTERNET_CHECK', jobId: selectedJob.id, candidateId: candidate.id});
        if (current()) showCheck(result);
      } catch (error) { if (current()) rejectChecked(error.message); }
      finally { check.disabled = false; next.disabled = false; }
    }
    check.addEventListener('click', () => inspect());
    next.addEventListener('click', () => { if (checked?.requiredOrigins) void inspect(checked.requiredOrigins); });
    remember.addEventListener('change', () => { save.disabled = !remember.checked || checked?.status !== 'ready'; });
    open.addEventListener('click', async () => {
      if (!current() || checked?.status !== 'ready') return;
      const expectedOrigin = checked.terminalOrigin;
      open.disabled = true;
      try {
        await grant([selectedJob.sourceOrigin, expectedOrigin]);
        if (!current()) return;
        await request({type: 'INTERNET_OPEN', jobId: selectedJob.id, candidateId: candidate.id, expectedOrigin});
        if (current()) hint.textContent = 'The endpoint was checked again before opening its homepage. No original private URL information was forwarded.';
      } catch (error) { if (current()) rejectChecked(`${error.message} Check this address again before opening it.`); }
      finally { open.disabled = false; }
    });
    save.addEventListener('click', async () => {
      if (!current() || checked?.status !== 'ready' || !remember.checked) return;
      const expectedOrigin = checked.terminalOrigin;
      save.disabled = true;
      try {
        await grant([selectedJob.sourceOrigin, expectedOrigin]);
        if (!current()) return;
        await request({type: 'INTERNET_SAVE', jobId: selectedJob.id, candidateId: candidate.id, expectedOrigin, durationHours: 24, confirmed: true});
        if (!current()) return;
        remember.checked = false;
        hint.textContent = 'Choice remembered for 24 hours as a user-configured homepage override. It is not owner or registry verified; you can remove it from Saved mappings.';
        await refresh();
      } catch (error) { if (current()) rejectChecked(`${error.message} Check this address again before remembering it.`); }
      finally { save.disabled = !remember.checked; }
    });
    return card;
  }
  function renderResult(result, selectedJob, currentEpoch) {
    if (!result || !STATES.has(result.status)) throw new Error('The investigation returned an unsupported state. Start a fresh search.');
    if (result.jobId !== selectedJob.id || origin(result.sourceOrigin) !== selectedJob.sourceOrigin) throw new Error('The investigation no longer matches this old address. Start a fresh search.');
    selectedJob.status = result.status;
    results.dataset.jobId = selectedJob.id;
    if (typeof result.expiresAt === 'number' && result.expiresAt <= Date.now()) selectedJob.status = 'expired';
    results.replaceChildren();
    if (!TERMINAL.has(selectedJob.status)) {
      display('Investigating public evidence… You can cancel while the bounded search runs.', false, selectedJob.status);
    } else {
      display(resultMessage({...result, status: selectedJob.status}), result.status === 'failed', selectedJob.status);
      if (selectedJob.status === 'completed' && result.outcome === 'candidates') {
        const cards = [];
        for (const candidate of (Array.isArray(result.candidates) ? result.candidates : []).slice(0, 10)) cards.push(candidateCard(candidate, selectedJob, currentEpoch));
        results.append(...cards);
      }
    }
    controls();
  }
  async function poll(currentEpoch) {
    const selectedJob = job;
    if (!selectedJob || currentEpoch !== epoch) return;
    if (Date.now() - selectedJob.startedAt >= 120000) {
      cancelJob(selectedJob); selectedJob.status = 'expired'; controls();
      display('The investigation reached its time limit. Start a fresh search before using a result.', true, 'expired');
      return;
    }
    try {
      const result = await request({type: 'INTERNET_STATUS', jobId: selectedJob.id});
      if (currentEpoch !== epoch || job !== selectedJob) return;
      renderResult(result, selectedJob, currentEpoch);
      if (!TERMINAL.has(selectedJob.status)) pollTimer = setTimeout(() => void poll(currentEpoch), 1000);
    } catch (error) {
      if (currentEpoch !== epoch || job !== selectedJob) return;
      cancelJob(selectedJob); selectedJob.status = 'failed'; controls();
      results.replaceChildren(); display(error.message, true, 'failed');
    }
  }
  start.addEventListener('click', async () => {
    if (!consent.checked || busy()) return;
    const currentEpoch = ++epoch;
    cancelJob(job);
    stopTimer(); results.replaceChildren(); delete results.dataset.jobId; job = undefined; pendingStart = true; controls();
    try {
      const sourceOrigin = origin(sourceInput.value);
      const mode = modeInput.value === 'service' ? 'service' : 'archives';
      if (mode === 'service' && !serviceOrigin) throw new Error('Configure a trusted discovery service below, or choose Public archives.');
      const permissions = mode === 'service' ? [permissionFor(serviceOrigin)] : [...archivePermissions];
      // Fixed archive providers or the explicitly configured service only.
      if (!await chrome.permissions.request({origins: permissions})) throw new Error('Public-source access was not granted. No Internet investigation was started.');
      if (currentEpoch !== epoch) return;
      display(`Investigating public evidence for ${sourceOrigin}…`, false, 'queued');
      const startedAt = Date.now();
      const result = await request({type: 'INTERNET_START', sourceOrigin, mode});
      if (currentEpoch !== epoch) {
        if (typeof result?.jobId === 'string') cancelJob({id: result.jobId, status: 'running'});
        return;
      }
      if (typeof result?.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.jobId)) throw new Error('The investigation did not return a usable reference.');
      job = {id: result.jobId, sourceOrigin, status: 'queued', startedAt}; pendingStart = false; controls();
      results.dataset.jobId = job.id;
      await poll(currentEpoch);
    } catch (error) {
      if (currentEpoch === epoch) { pendingStart = false; job = undefined; controls(); display(error.message, true, 'failed'); }
    }
  });
  cancel.addEventListener('click', () => invalidate('Search cancelled. No suggestion has been opened.'));
  consent.addEventListener('change', () => {
    if (!consent.checked && (job || pendingStart)) invalidate('Public-source consent withdrawn. The investigation was cancelled.', {resetConsent: false});
    else controls();
  });
  sourceInput.addEventListener('input', () => {
    invalidate('Ready to investigate this old address after your public-source consent.'); sourcePreview();
  });
  modeInput.addEventListener('change', () => {
    invalidate('Review the selected public sources before starting an investigation.'); disclosure();
  });
  configSave.addEventListener('click', async () => {
    configSave.disabled = true;
    try {
      const configured = serviceInput.value.trim() ? exactOrigin(serviceInput.value) : '';
      const accessToken = tokenInput.value;
      if (configured && !await chrome.permissions.request({origins: [permissionFor(configured)]})) throw new Error('Service access was not granted. Its settings were not saved.');
      invalidate('Service settings changed. Review the selected sources and start a fresh investigation.');
      await request({type: 'INTERNET_CONFIG_SET', serviceOrigin: configured, ...(accessToken ? {accessToken} : {})});
      await loadConfig();
      display(configured ? 'Service settings saved. Select the service above when you want it to investigate an old hostname.' : 'Service configuration removed. Public archive investigation remains available.');
    } catch (error) { display(error.message, true); }
    finally { tokenInput.value = ''; configSave.disabled = false; }
  });
  window.addEventListener('pagehide', () => { stopTimer(); cancelJob(job); epoch++; });
  sourcePreview(); disclosure(); controls();
  void loadConfig().catch(() => { tokenState(); disclosure(); });
  return {clear() {
    invalidate('Online investigations and service settings cleared. No further suggestion will be opened from this investigation.');
    serviceOrigin = ''; hasAccessToken = false; serviceInput.value = ''; tokenInput.value = ''; modeInput.value = 'archives';
    tokenState(); disclosure();
  }};
}
