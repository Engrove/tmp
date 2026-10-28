(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const OPTIONS_KEY = 'cgscPopupOptions';
  const CHECKBOXES = ['deepNetwork', 'pageNetwork', 'reloadAfterStart', 'includeStorage', 'captureRuntime', 'expandDetails', 'aggressiveRuntime', 'includeSensitive'];
  const STAGES = {
    'sweep-start': 'startar',
    'loading-oldest': 'laddar äldsta turer',
    sweeping: 'sveper',
    'sweep-complete': 'klar',
    'sweep-aborted': 'avbruten'
  };
  let activeTab = null;
  let supported = false;
  let currentStatus = null;
  let sessions = [];
  let busyCount = 0;
  let abortableBusy = false;

  function formatDate(value) {
    return value ? new Date(value).toLocaleString('sv-FI') : '—';
  }

  function setMessage(text, type = '') {
    const element = $('message');
    element.textContent = text || '';
    element.className = `message ${type}`.trim();
  }

  // Button state is derived from one place so that status polling can never
  // re-enable controls while an operation is running.
  function updateControls() {
    const busy = busyCount > 0;
    const status = currentStatus;
    const active = Boolean(status?.active);
    const sweepRunning = Boolean(status?.sweepRunning);
    const activeOptions = status?.activeInfo?.options || {};
    const hasExtraSnapshot = Boolean(activeOptions.deepNetwork || activeOptions.includeStorage || activeOptions.captureRuntime);
    $('start').disabled = busy || !supported || active;
    $('full').disabled = busy || !supported || !active || sweepRunning;
    $('snapshot').disabled = busy || !supported || !active || sweepRunning || !hasExtraSnapshot;
    // Stop stays available during a sweep: it aborts the sweep.
    $('stop').disabled = !supported || !active || (busy && !abortableBusy && !sweepRunning);
    $('export').disabled = busy || !sessions.length;
    $('delete').disabled = busy || !sessions.length;
    $('clearAll').disabled = busy || !sessions.length;
    for (const id of [...CHECKBOXES, 'settleMs']) $(id).disabled = busy || active;
    document.body.classList.toggle('busy', busy || sweepRunning);
  }

  function setBusy(value, text = '', abortable = false) {
    busyCount = Math.max(0, busyCount + (value ? 1 : -1));
    if (value && abortable) abortableBusy = true;
    if (!busyCount) abortableBusy = false;
    if (text) setMessage(text);
    updateControls();
  }

  async function api(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Okänt tilläggsfel');
    return response;
  }

  function optionsFromUi() {
    const options = {};
    for (const id of CHECKBOXES) options[id] = $(id).checked;
    options.settleMs = Math.max(250, Math.min(5000, Number($('settleMs').value) || 1000));
    options.userAgent = navigator.userAgent;
    return options;
  }

  function applyOptionsToUi(options) {
    for (const id of CHECKBOXES) if (typeof options?.[id] === 'boolean') $(id).checked = options[id];
    if (Number.isFinite(Number(options?.settleMs))) $('settleMs').value = String(options.settleMs);
  }

  async function loadSavedOptions() {
    try {
      const stored = (await chrome.storage.local.get(OPTIONS_KEY))[OPTIONS_KEY];
      if (stored) applyOptionsToUi(stored);
    } catch (_) {}
  }

  function saveOptions() {
    const options = optionsFromUi();
    delete options.userAgent;
    chrome.storage.local.set({ [OPTIONS_KEY]: options }).catch(() => {});
  }

  function progressText(status) {
    const progress = status?.progress;
    if (!progress || (status?.activeInfo && progress.sessionId !== status.activeInfo.sessionId)) {
      return status?.sweepRunning ? 'pågår' : '—';
    }
    const parts = [STAGES[progress.stage] || progress.stage];
    if (progress.stage === 'loading-oldest' && progress.round != null) parts.push(`runda ${progress.round}`);
    if (progress.stage === 'sweeping' && progress.scanIndex != null) parts.push(`steg ${progress.scanIndex + 1}`);
    if (progress.uniqueTurns != null) parts.push(`${progress.uniqueTurns} turer`);
    if (progress.reason) parts.push(progress.reason);
    return parts.join(' · ');
  }

  function applyStatus(status) {
    currentStatus = status;
    const session = status?.session;
    const active = Boolean(status?.active);
    if (supported) {
      $('stateBadge').textContent = active ? (status?.sweepRunning ? 'SVEPER' : 'AKTIV') : 'INAKTIV';
      $('stateBadge').className = `badge ${active ? 'active' : 'idle'}`;
    }
    $('sessionId').textContent = session?.id || '—';
    $('sessionStatus').textContent = session?.status || '—';
    $('captureProfile').textContent = session?.captureProfile || session?.options?.captureProfile || '—';
    $('recordCount').textContent = String(session?.recordCount || 0);
    $('startedAt').textContent = formatDate(session?.startedAt);
    $('fullAt').textContent = formatDate(session?.lastFullCaptureAt);
    $('sweepProgress').textContent = progressText(status);
    // While a capture is active the controls show the options it was started with.
    if (active && status.activeInfo?.options) applyOptionsToUi(status.activeInfo.options);
    updateControls();
  }

  async function refreshStatus() {
    if (!activeTab?.id) return;
    try {
      const response = await api({ type: 'GET_STATUS', tabId: activeTab.id });
      applyStatus(response.status);
    } catch (error) {
      setMessage(String(error), 'error');
    }
  }

  async function refreshSessions() {
    try {
      const response = await api({ type: 'LIST_SESSIONS' });
      sessions = response.sessions || [];
      const select = $('sessionSelect');
      const previous = select.value;
      select.textContent = '';
      for (const session of sessions) {
        const option = document.createElement('option');
        option.value = session.id;
        option.textContent = `${new Date(session.startedAt).toLocaleString('sv-FI')} — ${session.captureProfile || 'capture'} — ${session.title || 'ChatGPT'} — ${session.status}`;
        select.append(option);
      }
      if (!sessions.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Inga captures';
        select.append(option);
      } else if (sessions.some((item) => item.id === previous)) {
        select.value = previous;
      } else if (currentStatus?.session?.id && sessions.some((item) => item.id === currentStatus.session.id)) {
        select.value = currentStatus.session.id;
      }
    } catch (error) {
      setMessage(String(error), 'error');
    }
    updateControls();
  }

  async function withBusy(text, operation, { abortable = false } = {}) {
    setBusy(true, text, abortable);
    try {
      const result = await operation();
      await refreshStatus();
      await refreshSessions();
      setMessage('Klart.', 'ok');
      return result;
    } catch (error) {
      setMessage(String(error), 'error');
      throw error;
    } finally {
      setBusy(false);
      await refreshStatus();
    }
  }

  async function startCapture() {
    const options = optionsFromUi();
    if (options.includeSensitive && !confirm('Känsligt läge inkluderar webbläsaråtkomliga cookies, autentiseringsheaders, åtkomsttoken och MHTML-sidarkiv i den lokala exporten. Fortsätt?')) return;
    saveOptions();
    const heavy = options.deepNetwork || options.pageNetwork || options.includeStorage || options.captureRuntime || options.aggressiveRuntime;
    await withBusy(heavy ? 'Startar utökad browserfångst…' : 'Startar kompakt AI-transkriptfångst…', async () => {
      await api({ type: 'START_CAPTURE', tabId: activeTab.id, options });
    });
    setMessage(options.reloadAfterStart
      ? 'Fångsten är startad och fliken kan ha laddats om. Öppna tillägget igen och kör helsvepning.'
      : 'Fångsten är startad. Kör nu full sessionssvepning.', 'ok');
  }

  async function runFullCapture() {
    const response = await withBusy('Laddar äldsta turer, expanderar synliga analysblock och sveper hela den virtualiserade chatten… Stoppa fångst avbryter svepningen.', async () => (
      api({ type: 'RUN_FULL_CAPTURE', tabId: activeTab.id })
    ), { abortable: true });
    const summary = response?.result?.sweep?.result;
    if (summary) {
      setMessage(`Svepning klar: ${summary.uniqueTurnCount} turer, topp verifierad: ${summary.topVerified ? 'ja' : 'nej'}, botten verifierad: ${summary.bottomVerified ? 'ja' : 'nej'}.`, 'ok');
    }
  }

  async function snapshotOnly() {
    await withBusy('Tar endast de extrasnapshots som valts…', async () => {
      await api({ type: 'CAPTURE_PAGE_STATE', tabId: activeTab.id });
      await api({ type: 'CAPTURE_DEBUGGER_SNAPSHOTS', tabId: activeTab.id });
    });
  }

  async function stopCapture() {
    await withBusy('Stoppar fångst, avbryter pågående svepning och kopplar loss eventuell debugger…', async () => {
      await api({ type: 'STOP_CAPTURE', tabId: activeTab.id });
    });
  }

  async function exportSelected() {
    const sessionId = $('sessionSelect').value;
    if (!sessionId) return;
    const response = await withBusy('Bygger komprimerad lokal ZIP-fil…', async () => api({ type: 'EXPORT_SESSION', sessionId }));
    const summary = response?.result?.summary;
    setMessage(`ZIP-exporten har skickats till Chromes nedladdningsdialog.${summary ? ` Verdikt: ${summary.status} (${summary.uniqueTurns} turer).` : ''}`, 'ok');
  }

  async function deleteSelected() {
    const sessionId = $('sessionSelect').value;
    if (!sessionId || !confirm('Radera vald lokal capture permanent?')) return;
    await withBusy('Raderar capture…', async () => api({ type: 'DELETE_SESSION', sessionId }));
  }

  async function clearAll() {
    if (!confirm('Radera alla lokala captures permanent?')) return;
    await withBusy('Raderar samtliga captures…', async () => api({ type: 'CLEAR_ALL' }));
  }

  async function init() {
    await loadSavedOptions();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;
    $('tabInfo').textContent = tab ? `${tab.title || 'Flik'}\n${tab.url || ''}` : 'Ingen aktiv flik';
    supported = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab?.url || '');
    if (!supported) {
      $('stateBadge').textContent = 'FEL FLIK';
      $('stateBadge').className = 'badge error';
      setMessage('Öppna en ChatGPT-konversation på chatgpt.com.', 'error');
    }
    await refreshStatus();
    await refreshSessions();
    // Status is polled while the popup is open so that a sweep started earlier
    // (the popup closes when it loses focus) shows its progress.
    setInterval(refreshStatus, 1500);
  }

  for (const id of [...CHECKBOXES, 'settleMs']) $(id).addEventListener('change', saveOptions);
  $('start').addEventListener('click', () => startCapture().catch(() => {}));
  $('full').addEventListener('click', () => runFullCapture().catch(() => {}));
  $('snapshot').addEventListener('click', () => snapshotOnly().catch(() => {}));
  $('stop').addEventListener('click', () => stopCapture().catch(() => {}));
  $('export').addEventListener('click', () => exportSelected().catch(() => {}));
  $('delete').addEventListener('click', () => deleteSelected().catch(() => {}));
  $('clearAll').addEventListener('click', () => clearAll().catch(() => {}));

  init().catch((error) => setMessage(String(error), 'error'));
})();
