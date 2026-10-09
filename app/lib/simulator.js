/**
 * IoT telemetry simulator.
 *
 * Stands in for the MQTT ingest a real fleet would publish to. Readings are pushed to every
 * subscribed Server-Sent Events client, and threshold breaches raise alerts exactly as the ingest
 * pipeline would — which is what lets the suite test alerting without a broker.
 *
 * Deterministic mode (FLOWPROBE_TEST_MODE=1) keeps the tick slow and the values bounded so that a
 * telemetry assertion is never a race against a random walk.
 */
import {
  appendTelemetry,
  findDevice,
  hasOpenAlert,
  raiseAlert,
  state,
  LOW_BATTERY_THRESHOLD,
} from './store.js';

const subscribers = new Set();
let timer = null;

export function subscribe(res, deviceId) {
  const entry = { res, deviceId: deviceId ? Number(deviceId) : null };
  subscribers.add(entry);
  return () => subscribers.delete(entry);
}

export function subscriberCount() {
  return subscribers.size;
}

function push(reading) {
  const payload = `event: telemetry\ndata: ${JSON.stringify(reading)}\n\n`;
  for (const sub of subscribers) {
    if (sub.deviceId && sub.deviceId !== reading.deviceId) continue;
    try {
      sub.res.write(payload);
    } catch {
      subscribers.delete(sub);
    }
  }
}

/** Produces one reading for one device and applies the alerting rules to it. */
export function tick(device) {
  const previous = (state.telemetry.get(device.id) ?? []).at(-1);
  const drift = (base, delta, min, max) =>
    Number(Math.min(max, Math.max(min, (base ?? (min + max) / 2) + (Math.random() - 0.5) * delta)).toFixed(1));

  const reading = {
    deviceId: device.id,
    deviceName: device.name,
    at: new Date().toISOString(),
    temperatureC: drift(previous?.temperatureC, 1.4, 12, 48),
    humidityPct: drift(previous?.humidityPct, 2.5, 20, 95),
    signalDbm: Math.round(drift(previous?.signalDbm, 4, -95, -40)),
    batteryPct: device.batteryPct,
  };

  appendTelemetry(device.id, reading);
  evaluateThresholds(device, reading);
  push(reading);
  return reading;
}

/** Alert rules, kept in one place so a test can assert them directly. */
export function evaluateThresholds(device, reading) {
  const raised = [];

  if (reading.temperatureC > 40 && !hasOpenAlert(device.id, 'HIGH_TEMPERATURE')) {
    raised.push(raiseAlert(device, 'HIGH_TEMPERATURE', 'critical',
      `Temperature ${reading.temperatureC}°C exceeds the 40°C ceiling`));
  }
  if (reading.signalDbm < -90 && !hasOpenAlert(device.id, 'WEAK_SIGNAL')) {
    raised.push(raiseAlert(device, 'WEAK_SIGNAL', 'warning',
      `Signal ${reading.signalDbm} dBm is below the -90 dBm floor`));
  }
  if (device.batteryPct < LOW_BATTERY_THRESHOLD && !hasOpenAlert(device.id, 'LOW_BATTERY')) {
    raised.push(raiseAlert(device, 'LOW_BATTERY',
      device.batteryPct === 0 ? 'critical' : 'warning',
      `Battery at ${device.batteryPct}% (threshold ${LOW_BATTERY_THRESHOLD}%)`));
  }
  return raised;
}

/** Injects a reading for a specific device — the hook the @iot tests drive alerting through. */
export function inject(deviceId, overrides = {}) {
  const device = findDevice(deviceId);
  if (!device) return null;
  const reading = {
    deviceId: device.id,
    deviceName: device.name,
    at: new Date().toISOString(),
    temperatureC: 22,
    humidityPct: 50,
    signalDbm: -60,
    batteryPct: device.batteryPct,
    ...overrides,
  };
  appendTelemetry(device.id, reading);
  const alerts = evaluateThresholds(device, reading);
  push(reading);
  return { reading, alerts };
}

export function start({ intervalMs = 2000 } = {}) {
  if (timer) return;
  timer = setInterval(() => {
    const online = state.devices.filter((d) => d.status !== 'offline');
    if (online.length === 0) return;
    tick(online[Math.floor(Math.random() * online.length)]);
  }, intervalMs);
  timer.unref?.();
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const sub of subscribers) {
    try {
      sub.res.end();
    } catch {
      /* already closed */
    }
  }
  subscribers.clear();
}
