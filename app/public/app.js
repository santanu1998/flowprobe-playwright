/**
 * FlowProbe Fleet Console — browser client.
 *
 * Plain ES modules, no framework: the suite under test should exercise the application, not a
 * build pipeline. Every element the tests target carries a stable `data-test` attribute, which is
 * the contract between the UI and the automation.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const byTest = (name, root = document) => root.querySelector(`[data-test="${name}"]`);

const session = {
  token: sessionStorage.getItem('fp.token'),
  user: JSON.parse(sessionStorage.getItem('fp.user') ?? 'null'),
};

let devices = [];
let alerts = [];
let stream = null;
let openDeviceId = null;

// ------------------------------------------------------------------ http

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && session.token) {
    signOut();
    throw new Error('Session expired. Please sign in again.');
  }
  if (res.status === 204) return null;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(payload?.error?.message ?? `Request failed (${res.status})`), {
      status: res.status,
      details: payload?.error?.errors,
    });
  }
  return payload;
}

// ------------------------------------------------------------------ views

function showConsole() {
  byTest('login-view').hidden = true;
  byTest('console-view').hidden = false;
  byTest('current-user').textContent = `${session.user.displayName} · ${session.user.role}`;
  applyRolePermissions();
  void refreshAll();
  openStream();
}

function showLogin() {
  byTest('console-view').hidden = true;
  byTest('login-view').hidden = false;
}

function applyRolePermissions() {
  const canCommand = session.user.role === 'operator' || session.user.role === 'admin';
  $$('.actions button').forEach((b) => {
    b.disabled = !canCommand;
    b.title = canCommand ? '' : 'Your role is read only';
  });
}

function toast(message) {
  const el = byTest('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2500);
}

// ------------------------------------------------------------------ auth

byTest('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = byTest('login-error');
  error.hidden = true;

  const username = byTest('username').value.trim();
  const password = byTest('password').value;

  if (!username || !password) {
    error.textContent = 'Username and password are both required.';
    error.hidden = false;
    return;
  }

  const submit = byTest('login-submit');
  submit.disabled = true;
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    session.token = result.token;
    session.user = result.user;
    sessionStorage.setItem('fp.token', result.token);
    sessionStorage.setItem('fp.user', JSON.stringify(result.user));
    byTest('password').value = '';
    showConsole();
  } catch (e) {
    error.textContent = e.message;
    error.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

function signOut() {
  if (stream) { stream.close(); stream = null; }
  session.token = null;
  session.user = null;
  sessionStorage.clear();
  showLogin();
}

byTest('logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* best effort */ }
  signOut();
});

// ------------------------------------------------------------------ data

async function refreshAll() {
  await Promise.all([refreshSummary(), refreshDevices(), refreshAlerts()]);
}

async function refreshSummary() {
  const s = await api('/api/fleet/summary');
  $('.n', byTest('stat-total')).textContent = s.total;
  $('.n', byTest('stat-online')).textContent = s.online ?? 0;
  $('.n', byTest('stat-degraded')).textContent = s.degraded ?? 0;
  $('.n', byTest('stat-offline')).textContent = s.offline ?? 0;
  $('.n', byTest('stat-alerts')).textContent = s.openAlerts;
  byTest('alert-count').textContent = s.openAlerts;

  const siteFilter = byTest('filter-site');
  if (siteFilter.options.length <= 1) {
    for (const site of s.sites) {
      siteFilter.add(new Option(site, site));
    }
  }
}

function currentFilters() {
  const params = new URLSearchParams();
  const search = byTest('filter-search').value.trim();
  const site = byTest('filter-site').value;
  const status = byTest('filter-status').value;
  if (search) params.set('search', search);
  if (site) params.set('site', site);
  if (status) params.set('status', status);
  return params;
}

async function refreshDevices() {
  const result = await api(`/api/devices?${currentFilters()}`);
  devices = result.items;

  const tbody = byTest('device-rows');
  tbody.replaceChildren(...devices.map((d) => {
    const tr = document.createElement('tr');
    tr.dataset.test = `device-row-${d.id}`;
    tr.dataset.deviceId = String(d.id);
    tr.tabIndex = 0;
    tr.innerHTML = `
      <td data-test="device-name">${escapeHtml(d.name)}</td>
      <td>${escapeHtml(d.type)}</td>
      <td data-test="device-site">${escapeHtml(d.site)}</td>
      <td>${escapeHtml(d.firmware)}</td>
      <td data-test="device-battery">${d.batteryPct}%</td>
      <td><span class="badge ${d.status}" data-test="device-status">${d.status}</span></td>`;
    tr.addEventListener('click', () => openDrawer(d.id));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDrawer(d.id); });
    return tr;
  }));

  byTest('no-devices').hidden = devices.length > 0;
  byTest('result-count').textContent =
    `${result.total} device${result.total === 1 ? '' : 's'}`;
}

async function refreshAlerts() {
  const result = await api('/api/alerts?acknowledged=false');
  alerts = result.items;

  const tbody = byTest('alert-rows');
  tbody.replaceChildren(...alerts.map((a) => {
    const tr = document.createElement('tr');
    tr.dataset.test = `alert-row-${a.id}`;
    tr.innerHTML = `
      <td><span class="badge ${a.severity}" data-test="alert-severity">${a.severity}</span></td>
      <td data-test="alert-device">${escapeHtml(a.deviceName)}</td>
      <td data-test="alert-code">${escapeHtml(a.code)}</td>
      <td>${escapeHtml(a.message)}</td>
      <td><button class="ghost" data-test="ack-${a.id}">Acknowledge</button></td>`;
    $(`[data-test="ack-${a.id}"]`, tr).addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/alerts/${a.id}/acknowledge`, { method: 'POST' });
      toast('Alert acknowledged');
      await Promise.all([refreshAlerts(), refreshSummary()]);
    });
    return tr;
  }));

  byTest('no-alerts').hidden = alerts.length > 0;
}

// ------------------------------------------------------------------ drawer

async function openDrawer(id) {
  openDeviceId = id;
  const device = await api(`/api/devices/${id}`);
  const drawer = byTest('device-drawer');

  byTest('drawer-title').textContent = device.name;
  byTest('drawer-type').textContent = device.type;
  byTest('drawer-site').textContent = device.site;
  byTest('drawer-firmware').textContent = device.firmware;
  byTest('drawer-battery').textContent = `${device.batteryPct}%`;
  byTest('drawer-status').textContent = device.status;
  byTest('drawer-lastseen').textContent = new Date(device.lastSeen).toLocaleString();
  byTest('command-result').hidden = true;

  await renderTelemetry(id);
  drawer.hidden = false;
  byTest('drawer-close').focus();
}

async function renderTelemetry(id) {
  const { readings } = await api(`/api/devices/${id}/telemetry?limit=8`);
  byTest('telemetry-rows').replaceChildren(...[...readings].reverse().map((r) => {
    const tr = document.createElement('tr');
    tr.dataset.test = 'telemetry-row';
    tr.innerHTML = `
      <td>${new Date(r.at).toLocaleTimeString()}</td>
      <td data-test="telemetry-temp">${r.temperatureC}</td>
      <td>${r.humidityPct}</td>
      <td>${r.signalDbm}</td>`;
    return tr;
  }));
}

byTest('drawer-close').addEventListener('click', () => {
  byTest('device-drawer').hidden = true;
  openDeviceId = null;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !byTest('device-drawer').hidden) {
    byTest('device-drawer').hidden = true;
    openDeviceId = null;
  }
});

$$('.actions button').forEach((button) => {
  button.addEventListener('click', async () => {
    const result = byTest('command-result');
    result.classList.remove('bad');
    try {
      const queued = await api(`/api/devices/${openDeviceId}/commands`, {
        method: 'POST',
        body: { command: button.dataset.command },
      });
      result.textContent = `Command '${queued.command}' queued (#${queued.id}).`;
    } catch (e) {
      result.classList.add('bad');
      result.textContent = e.message;
    }
    result.hidden = false;
  });
});

// ------------------------------------------------------------------ filters

['filter-search', 'filter-site', 'filter-status'].forEach((name) => {
  const el = byTest(name);
  const event = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(event, debounce(() => void refreshDevices(), 150));
});

byTest('filter-clear').addEventListener('click', () => {
  byTest('filter-search').value = '';
  byTest('filter-site').value = '';
  byTest('filter-status').value = '';
  void refreshDevices();
});

// ------------------------------------------------------------------ tabs

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    const fleet = tab.dataset.view === 'fleet';
    byTest('fleet-panel').hidden = !fleet;
    byTest('alerts-panel').hidden = fleet;
  });
});

// ------------------------------------------------------------------ stream

function openStream() {
  if (stream) stream.close();
  stream = new EventSource(`/api/telemetry/stream?token=${encodeURIComponent(session.token)}`);
  stream.addEventListener('telemetry', async (event) => {
    const reading = JSON.parse(event.data);
    document.body.dataset.lastTelemetry = reading.at;
    if (openDeviceId === reading.deviceId) await renderTelemetry(openDeviceId);
  });
  stream.onerror = () => { /* the browser reconnects on its own */ };
}

// ------------------------------------------------------------------ utils

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ------------------------------------------------------------------ boot

if (session.token && session.user) {
  api('/api/auth/me').then(showConsole).catch(signOut);
} else {
  showLogin();
}
