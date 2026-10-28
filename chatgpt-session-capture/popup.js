(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let activeTab = null;
  let currentStatus = null;
  let sessions = [];
  let busyTimer = null;

  function formatDate(value) {
    return value ? new Date(value).toLocaleString('sv-FI') : '—';
  }

  function setMessage(text, type = '') {
    const element = $('message');
    element.textContent = text || '';
    element.className = `message ${type}`.trim();
  }

  function setBusy(value, text = '') {
    document.body.classList.toggle('busy', value);
    $('activity').value = value ? 55 : 0;
    for (const button of document.querySelectorAll('button')) button.disabled = value;
    if (text) setMessage(text);
    if (busyTimer) clearInterval(busyTimer);
    busyTimer = value ? setInterval(refreshStatus, 1500) : null;
  }

  async function api(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'Okänt tilläggsfel');
    return response;
  }

  function optionsFromUi() {
    return {
      deepNetwork: $('deepNetwork').checked,
      pageNetwork: $('pageNetwork').checked,
      reloadAfterStart: $('reloadAfterStart').checked,
      includeStorage: $('includeStorage').checked,
      captureRuntime: $('captureRuntime').checked,
      expandDetails: $('expandDetails').checked,
      aggressiveRuntime: $('aggressiveRuntime').checked,
      includeSensitive: $('includeSensitive').checked,
      settleMs: Math.max(250, Math.min(5000, Number($('settleMs').value) || 1000)),
      userAgent: navigator.userAgent
    };
  }

  function applyStatus(status) {
    currentStatus = status;
    const session = status?.session;
    const active = Boolean(status?.active);
    $('stateBadge').textContent = active ? 'AKTIV' : 'INAKTIV';
    $('stateBadge').className = `badge ${active ? 'active' : 'idle'}`;
    $('sessionId').textContent = session?.id || '—';
    $('sessionStatus').textContent = session?.status || '—';
    $('captureProfile').textContent = session?.captureProfile || session?.options?.captureProfile || '—';
    $('recordCount').textContent = String(session?.recordCount || 0);
    $('startedAt').textContent = formatDate(session?.startedAt);
    $('fullAt').textContent = formatDate(session?.lastFullCaptureAt);
    $('start').disabled = active;
    $('full').disabled = !active;
    const activeOptions = status?.activeInfo?.options || session?.options || {};
    const hasExtraSnapshot = Boolean(activeOptions.deepNetwork || activeOptions.includeStorage || activeOptions.captureRuntime);
    $('snapshot').disabled = !active || !hasExtraSnapshot;
    $('stop').disabled = !active;
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
      $('export').disabled = !sessions.length;
      $('delete').disabled = !sessions.length;
      $('clearAll').disabled = !sessions.length;
    } catch (error) {
      setMessage(String(error), 'error');
    }
  }

  async function withBusy(text, operation) {
    setBusy(true, text);
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
    if (options.includeSensitive && !confirm('Känsligt läge inkluderar webbläsaråtkomliga cookies och autentiseringsheaders i den lokala exporten. Fortsätt?')) return;
    const heavy = options.deepNetwork || options.pageNetwork || options.includeStorage || options.captureRuntime || options.aggressiveRuntime;
    await withBusy(heavy ? 'Startar utökad browserfångst…' : 'Startar kompakt AI-transkriptfångst…', async () => {
      await api({ type: 'START_CAPTURE', tabId: activeTab.id, options });
    });
    setMessage(options.reloadAfterStart
      ? 'Fångsten är startad och fliken kan ha laddats om. Öppna tillägget igen och kör helsvepning.'
      : 'Fångsten är startad. Kör nu full sessionssvepning.', 'ok');
  }

  async function runFullCapture() {
    await withBusy('Laddar äldsta turer, expanderar synliga analysblock och sveper hela den virtualiserade chatten…', async () => {
      await api({ type: 'RUN_FULL_CAPTURE', tabId: activeTab.id });
    });
  }

  async function snapshotOnly() {
    await withBusy('Tar endast de extrasnapshots som valts…', async () => {
      await api({ type: 'CAPTURE_PAGE_STATE', tabId: activeTab.id });
      await api({
        type: 'CAPTURE_DEBUGGER_SNAPSHOTS',
        tabId: activeTab.id,
        sessionId: currentStatus.activeInfo.sessionId
      });
    });
  }

  async function stopCapture() {
    await withBusy('Stoppar fångst och kopplar loss eventuell debugger…', async () => {
      await api({ type: 'STOP_CAPTURE', tabId: activeTab.id });
    });
  }

  async function exportSelected() {
    const sessionId = $('sessionSelect').value;
    if (!sessionId) return;
    await withBusy('Bygger komprimerad lokal ZIP-fil…', async () => {
      await api({ type: 'EXPORT_SESSION', sessionId });
    });
    setMessage('ZIP-exporten har skickats till Chromes nedladdningsdialog.', 'ok');
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab;
    $('tabInfo').textContent = tab ? `${tab.title || 'Flik'}\n${tab.url || ''}` : 'Ingen aktiv flik';
    const supported = /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab?.url || '');
    if (!supported) {
      $('stateBadge').textContent = 'FEL FLIK';
      $('stateBadge').className = 'badge error';
      setMessage('Öppna en ChatGPT-konversation på chatgpt.com.', 'error');
      for (const button of document.querySelectorAll('.actions button')) button.disabled = true;
    }
    await refreshStatus();
    await refreshSessions();
  }

  $('start').addEventListener('click', () => startCapture().catch(() => {}));
  $('full').addEventListener('click', () => runFullCapture().catch(() => {}));
  $('snapshot').addEventListener('click', () => snapshotOnly().catch(() => {}));
  $('stop').addEventListener('click', () => stopCapture().catch(() => {}));
  $('export').addEventListener('click', () => exportSelected().catch(() => {}));
  $('delete').addEventListener('click', () => deleteSelected().catch(() => {}));
  $('clearAll').addEventListener('click', () => clearAll().catch(() => {}));

  init().catch((error) => setMessage(String(error), 'error'));
})();
