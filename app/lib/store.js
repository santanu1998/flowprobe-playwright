/**
 * In-memory data store for the fleet console.
 *
 * Seeded from a fixed dataset with a deterministic PRNG so that every test run starts from an
 * identical fleet. Test isolation comes from POST /api/test/reset rather than from tests tidying up
 * after each other.
 */

/** Mulberry32 — small, fast, and reproducible from a seed. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SITES = ['Kolkata-DC1', 'Chennai-DC2', 'Pune-Edge', 'Bengaluru-DC3'];
const TYPES = ['gateway', 'sensor', 'controller', 'camera'];
const FIRMWARES = ['3.1.4', '3.2.0', '3.2.1', '4.0.0-rc1'];

const SEED_DEVICES = [
  { name: 'GW-KOL-001', type: 'gateway', site: 'Kolkata-DC1', firmware: '3.2.1', status: 'online', batteryPct: 94 },
  { name: 'GW-KOL-002', type: 'gateway', site: 'Kolkata-DC1', firmware: '3.2.0', status: 'degraded', batteryPct: 41 },
  { name: 'SN-KOL-101', type: 'sensor', site: 'Kolkata-DC1', firmware: '3.1.4', status: 'online', batteryPct: 77 },
  { name: 'SN-KOL-102', type: 'sensor', site: 'Kolkata-DC1', firmware: '3.1.4', status: 'offline', batteryPct: 8 },
  { name: 'CT-CHN-201', type: 'controller', site: 'Chennai-DC2', firmware: '3.2.1', status: 'online', batteryPct: 100 },
  { name: 'CM-CHN-301', type: 'camera', site: 'Chennai-DC2', firmware: '4.0.0-rc1', status: 'online', batteryPct: 62 },
  { name: 'SN-CHN-103', type: 'sensor', site: 'Chennai-DC2', firmware: '3.2.0', status: 'degraded', batteryPct: 23 },
  { name: 'GW-PUN-003', type: 'gateway', site: 'Pune-Edge', firmware: '3.2.1', status: 'online', batteryPct: 88 },
  { name: 'SN-PUN-104', type: 'sensor', site: 'Pune-Edge', firmware: '3.1.4', status: 'online', batteryPct: 55 },
  { name: 'CT-BLR-202', type: 'controller', site: 'Bengaluru-DC3', firmware: '3.2.0', status: 'offline', batteryPct: 0 },
  { name: 'CM-BLR-302', type: 'camera', site: 'Bengaluru-DC3', firmware: '4.0.0-rc1', status: 'online', batteryPct: 73 },
  { name: 'SN-BLR-105', type: 'sensor', site: 'Bengaluru-DC3', firmware: '3.2.1', status: 'online', batteryPct: 91 },
];

/** Battery below this is an alertable condition. */
export const LOW_BATTERY_THRESHOLD = 20;

export const state = {
  devices: [],
  telemetry: new Map(), // deviceId -> reading[]
  alerts: [],
  commands: [],
  auditLog: [],
  nextDeviceId: 1,
  nextAlertId: 1,
  nextCommandId: 1,
};

export function seed() {
  const rand = prng(20261008);
  state.devices = [];
  state.telemetry = new Map();
  state.alerts = [];
  state.commands = [];
  state.auditLog = [];
  state.nextDeviceId = 1;
  state.nextAlertId = 1;
  state.nextCommandId = 1;

  const base = Date.UTC(2026, 9, 8, 6, 0, 0);

  for (const spec of SEED_DEVICES) {
    const id = state.nextDeviceId++;
    const device = {
      id,
      ...spec,
      lastSeen: new Date(base - Math.floor(rand() * 3600_000)).toISOString(),
      tags: spec.status === 'offline' ? ['needs-attention'] : [],
      createdAt: new Date(base - 86_400_000).toISOString(),
    };
    state.devices.push(device);

    const readings = [];
    for (let i = 11; i >= 0; i--) {
      readings.push({
        at: new Date(base - i * 300_000).toISOString(),
        temperatureC: Number((18 + rand() * 14).toFixed(1)),
        humidityPct: Number((35 + rand() * 40).toFixed(1)),
        signalDbm: Math.round(-45 - rand() * 45),
        batteryPct: device.batteryPct,
      });
    }
    state.telemetry.set(id, readings);

    if (device.batteryPct < LOW_BATTERY_THRESHOLD) {
      state.alerts.push({
        id: state.nextAlertId++,
        deviceId: id,
        deviceName: device.name,
        severity: device.batteryPct === 0 ? 'critical' : 'warning',
        code: 'LOW_BATTERY',
        message: `Battery at ${device.batteryPct}% (threshold ${LOW_BATTERY_THRESHOLD}%)`,
        raisedAt: new Date(base - 600_000).toISOString(),
        acknowledged: false,
      });
    }
    if (device.status === 'offline') {
      state.alerts.push({
        id: state.nextAlertId++,
        deviceId: id,
        deviceName: device.name,
        severity: 'critical',
        code: 'DEVICE_UNREACHABLE',
        message: 'No heartbeat received in the last 15 minutes',
        raisedAt: new Date(base - 900_000).toISOString(),
        acknowledged: false,
      });
    }
  }
  return state;
}

export function listDevices({ site, status, type, search, page = 1, pageSize = 25 } = {}) {
  let rows = [...state.devices];
  if (site) rows = rows.filter((d) => d.site === site);
  if (status) rows = rows.filter((d) => d.status === status);
  if (type) rows = rows.filter((d) => d.type === type);
  if (search) {
    const needle = String(search).toLowerCase();
    rows = rows.filter((d) => d.name.toLowerCase().includes(needle));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { total, page, pageSize, items: rows.slice(start, start + pageSize) };
}

export function findDevice(id) {
  return state.devices.find((d) => d.id === Number(id));
}

export function createDevice(payload) {
  const device = {
    id: state.nextDeviceId++,
    name: payload.name,
    type: payload.type,
    site: payload.site,
    firmware: payload.firmware ?? '3.2.1',
    status: payload.status ?? 'online',
    batteryPct: payload.batteryPct ?? 100,
    tags: payload.tags ?? [],
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  state.devices.push(device);
  state.telemetry.set(device.id, []);
  return device;
}

export function updateDevice(id, changes) {
  const device = findDevice(id);
  if (!device) return null;
  Object.assign(device, changes, { id: device.id });
  if (device.batteryPct < LOW_BATTERY_THRESHOLD && !hasOpenAlert(device.id, 'LOW_BATTERY')) {
    raiseAlert(device, 'LOW_BATTERY', device.batteryPct === 0 ? 'critical' : 'warning',
      `Battery at ${device.batteryPct}% (threshold ${LOW_BATTERY_THRESHOLD}%)`);
  }
  return device;
}

export function deleteDevice(id) {
  const index = state.devices.findIndex((d) => d.id === Number(id));
  if (index === -1) return false;
  const [removed] = state.devices.splice(index, 1);
  state.telemetry.delete(removed.id);
  // Deleting a device must not leave its alerts orphaned behind it.
  state.alerts = state.alerts.filter((a) => a.deviceId !== removed.id);
  return true;
}

export function hasOpenAlert(deviceId, code) {
  return state.alerts.some((a) => a.deviceId === Number(deviceId) && a.code === code && !a.acknowledged);
}

export function raiseAlert(device, code, severity, message) {
  const alert = {
    id: state.nextAlertId++,
    deviceId: device.id,
    deviceName: device.name,
    severity,
    code,
    message,
    raisedAt: new Date().toISOString(),
    acknowledged: false,
  };
  state.alerts.push(alert);
  return alert;
}

export function acknowledgeAlert(id, user) {
  const alert = state.alerts.find((a) => a.id === Number(id));
  if (!alert) return null;
  alert.acknowledged = true;
  alert.acknowledgedBy = user;
  alert.acknowledgedAt = new Date().toISOString();
  return alert;
}

export function appendTelemetry(deviceId, reading) {
  const readings = state.telemetry.get(Number(deviceId)) ?? [];
  readings.push(reading);
  // A console keeps a rolling window; unbounded growth is a memory leak, not a feature.
  if (readings.length > 240) readings.shift();
  state.telemetry.set(Number(deviceId), readings);
  return reading;
}

export function getTelemetry(deviceId, limit = 50) {
  const readings = state.telemetry.get(Number(deviceId)) ?? [];
  return readings.slice(-limit);
}

export function queueCommand(device, command, issuedBy) {
  const entry = {
    id: state.nextCommandId++,
    deviceId: device.id,
    command,
    issuedBy,
    issuedAt: new Date().toISOString(),
    status: 'queued',
  };
  state.commands.push(entry);
  state.auditLog.push({
    at: entry.issuedAt,
    actor: issuedBy,
    action: `command:${command}`,
    target: device.name,
  });
  return entry;
}

export function fleetSummary() {
  const byStatus = { online: 0, degraded: 0, offline: 0 };
  for (const d of state.devices) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
  return {
    total: state.devices.length,
    ...byStatus,
    openAlerts: state.alerts.filter((a) => !a.acknowledged).length,
    criticalAlerts: state.alerts.filter((a) => !a.acknowledged && a.severity === 'critical').length,
    sites: [...new Set(state.devices.map((d) => d.site))].sort(),
    types: [...new Set(state.devices.map((d) => d.type))].sort(),
  };
}

export const CATALOG = { SITES, TYPES, FIRMWARES };
