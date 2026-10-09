/**
 * FlowProbe Fleet Console — the application under test.
 *
 * A single-file HTTP server with zero runtime dependencies: `node app/server.js` and it runs.
 * That matters for a test portfolio, because the suite is then reproducible on any machine and in
 * any CI container without a database, a broker or a cloud account.
 *
 * Exposes a REST API, a server-rendered single-page console, and an SSE telemetry stream.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as store from './lib/store.js';
import * as auth from './lib/auth.js';
import * as simulator from './lib/simulator.js';

const PORT = Number(process.env.PORT ?? 4173);
const TEST_MODE = process.env.FLOWPROBE_TEST_MODE === '1';
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

store.seed();
simulator.start({ intervalMs: TEST_MODE ? 60_000 : 2_000 });

// ---------------------------------------------------------------- helpers

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

function fail(res, status, message, extra = {}) {
  send(res, status, { error: { status, message, ...extra } });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};

  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Malformed JSON body');
  }
  // A bare string, number or array is syntactically valid JSON but is not a request body any
  // endpoint here accepts; rejecting it at the edge keeps that out of the validators.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Malformed JSON body');
  }
  return parsed;
}

/** @returns the session, or null after having already written a 401/403. */
function requireRole(req, res, role) {
  const session = auth.verify(auth.bearerFrom(req));
  if (!session) {
    fail(res, 401, 'Authentication required');
    return null;
  }
  if (!auth.hasRole(session, role)) {
    fail(res, 403, `Role '${role}' or higher is required; this session is '${session.role}'`);
    return null;
  }
  return session;
}

function validateDevice(payload, { partial = false } = {}) {
  const errors = [];
  const required = ['name', 'type', 'site'];

  if (!partial) {
    for (const field of required) {
      if (!payload[field]) errors.push({ field, message: `${field} is required` });
    }
  }
  if (payload.name !== undefined) {
    if (typeof payload.name !== 'string' || payload.name.trim().length < 3) {
      errors.push({ field: 'name', message: 'name must be at least 3 characters' });
    } else if (store.state.devices.some((d) => d.name === payload.name)) {
      errors.push({ field: 'name', message: 'name must be unique across the fleet' });
    }
  }
  if (payload.type !== undefined && !store.CATALOG.TYPES.includes(payload.type)) {
    errors.push({ field: 'type', message: `type must be one of ${store.CATALOG.TYPES.join(', ')}` });
  }
  if (payload.site !== undefined && !store.CATALOG.SITES.includes(payload.site)) {
    errors.push({ field: 'site', message: `site must be one of ${store.CATALOG.SITES.join(', ')}` });
  }
  if (payload.batteryPct !== undefined) {
    const value = Number(payload.batteryPct);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      errors.push({ field: 'batteryPct', message: 'batteryPct must be between 0 and 100' });
    }
  }
  if (payload.status !== undefined && !['online', 'offline', 'degraded'].includes(payload.status)) {
    errors.push({ field: 'status', message: 'status must be online, offline or degraded' });
  }
  return errors;
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = normalize(join(PUBLIC_DIR, relative));
  if (!resolved.startsWith(normalize(PUBLIC_DIR))) {
    return fail(res, 403, 'Forbidden');
  }
  try {
    const body = await readFile(resolved);
    res.writeHead(200, {
      'Content-Type': MIME[extname(resolved)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    // Unknown path inside a single-page console falls back to the shell.
    const shell = await readFile(join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(shell);
  }
}

// ----------------------------------------------------------------- routes

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);

  try {
    // ---- health -------------------------------------------------------
    if (path === '/api/health') {
      return send(res, 200, {
        status: 'UP',
        uptimeSeconds: Math.round(process.uptime()),
        version: '1.0.0',
        testMode: TEST_MODE,
      });
    }

    // ---- test-only reset ----------------------------------------------
    if (path === '/api/test/reset' && req.method === 'POST') {
      if (!TEST_MODE) return fail(res, 404, 'Not found');
      store.seed();
      auth.resetSessions();
      return send(res, 200, { reset: true, devices: store.state.devices.length });
    }

    // ---- telemetry injection (test mode) ------------------------------
    if (path === '/api/test/telemetry' && req.method === 'POST') {
      if (!TEST_MODE) return fail(res, 404, 'Not found');
      const body = await readJson(req);
      const result = simulator.inject(body.deviceId, body.reading ?? {});
      if (!result) return fail(res, 404, 'Device not found');
      return send(res, 201, result);
    }

    // ---- authentication -----------------------------------------------
    if (path === '/api/auth/login' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body.username || !body.password) {
        return fail(res, 400, 'username and password are required');
      }
      const result = auth.login(body.username, body.password);
      if (!result.ok) {
        return fail(res, result.code === 'LOCKED' ? 423 : 401, result.reason);
      }
      return send(res, 200, { token: result.token, expiresAt: result.expiresAt, user: result.user });
    }

    if (path === '/api/auth/logout' && req.method === 'POST') {
      auth.logout(auth.bearerFrom(req));
      return send(res, 204, '');
    }

    if (path === '/api/auth/me' && req.method === 'GET') {
      const session = auth.verify(auth.bearerFrom(req));
      if (!session) return fail(res, 401, 'Authentication required');
      return send(res, 200, { username: session.username, role: session.role });
    }

    // ---- fleet summary -------------------------------------------------
    if (path === '/api/fleet/summary' && req.method === 'GET') {
      if (!requireRole(req, res, 'viewer')) return undefined;
      return send(res, 200, store.fleetSummary());
    }

    // ---- devices collection --------------------------------------------
    if (path === '/api/devices' && req.method === 'GET') {
      if (!requireRole(req, res, 'viewer')) return undefined;
      const page = Number(q.page ?? 1);
      const pageSize = Math.min(Number(q.pageSize ?? 25), 100);
      if (!Number.isInteger(page) || page < 1) return fail(res, 400, 'page must be a positive integer');
      return send(res, 200, store.listDevices({ ...q, page, pageSize }));
    }

    if (path === '/api/devices' && req.method === 'POST') {
      if (!requireRole(req, res, 'operator')) return undefined;
      const body = await readJson(req);
      const errors = validateDevice(body);
      if (errors.length) return fail(res, 422, 'Validation failed', { errors });
      return send(res, 201, store.createDevice(body));
    }

    // ---- single device ---------------------------------------------------
    const deviceMatch = path.match(/^\/api\/devices\/(\d+)$/);
    if (deviceMatch) {
      const id = Number(deviceMatch[1]);

      if (req.method === 'GET') {
        if (!requireRole(req, res, 'viewer')) return undefined;
        const device = store.findDevice(id);
        return device ? send(res, 200, device) : fail(res, 404, `Device ${id} not found`);
      }

      if (req.method === 'PATCH') {
        if (!requireRole(req, res, 'operator')) return undefined;
        if (!store.findDevice(id)) return fail(res, 404, `Device ${id} not found`);
        const body = await readJson(req);
        const errors = validateDevice(body, { partial: true });
        if (errors.length) return fail(res, 422, 'Validation failed', { errors });
        return send(res, 200, store.updateDevice(id, body));
      }

      if (req.method === 'DELETE') {
        if (!requireRole(req, res, 'admin')) return undefined;
        return store.deleteDevice(id)
          ? send(res, 204, '')
          : fail(res, 404, `Device ${id} not found`);
      }
    }

    // ---- device commands -------------------------------------------------
    const commandMatch = path.match(/^\/api\/devices\/(\d+)\/commands$/);
    if (commandMatch && req.method === 'POST') {
      const session = requireRole(req, res, 'operator');
      if (!session) return undefined;
      const device = store.findDevice(commandMatch[1]);
      if (!device) return fail(res, 404, 'Device not found');
      const body = await readJson(req);
      const allowed = ['reboot', 'sync-firmware', 'run-diagnostics'];
      if (!allowed.includes(body.command)) {
        return fail(res, 422, 'Validation failed', {
          errors: [{ field: 'command', message: `command must be one of ${allowed.join(', ')}` }],
        });
      }
      if (device.status === 'offline') {
        return fail(res, 409, 'Device is offline and cannot accept commands');
      }
      return send(res, 202, store.queueCommand(device, body.command, session.username));
    }

    // ---- telemetry ---------------------------------------------------------
    const telemetryMatch = path.match(/^\/api\/devices\/(\d+)\/telemetry$/);
    if (telemetryMatch && req.method === 'GET') {
      if (!requireRole(req, res, 'viewer')) return undefined;
      if (!store.findDevice(telemetryMatch[1])) return fail(res, 404, 'Device not found');
      return send(res, 200, {
        deviceId: Number(telemetryMatch[1]),
        readings: store.getTelemetry(telemetryMatch[1], Number(q.limit ?? 50)),
      });
    }

    if (path === '/api/telemetry/stream') {
      const session = auth.verify(q.token ?? auth.bearerFrom(req));
      if (!session) return fail(res, 401, 'Authentication required');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`event: ready\ndata: ${JSON.stringify({ subscribed: q.deviceId ?? 'all' })}\n\n`);
      const unsubscribe = simulator.subscribe(res, q.deviceId);
      req.on('close', unsubscribe);
      return undefined;
    }

    // ---- alerts -------------------------------------------------------------
    if (path === '/api/alerts' && req.method === 'GET') {
      if (!requireRole(req, res, 'viewer')) return undefined;
      let rows = [...store.state.alerts];
      if (q.severity) rows = rows.filter((a) => a.severity === q.severity);
      if (q.acknowledged !== undefined) {
        rows = rows.filter((a) => String(a.acknowledged) === q.acknowledged);
      }
      rows.sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
      return send(res, 200, { total: rows.length, items: rows });
    }

    const ackMatch = path.match(/^\/api\/alerts\/(\d+)\/acknowledge$/);
    if (ackMatch && req.method === 'POST') {
      const session = requireRole(req, res, 'operator');
      if (!session) return undefined;
      const alert = store.acknowledgeAlert(ackMatch[1], session.username);
      return alert ? send(res, 200, alert) : fail(res, 404, 'Alert not found');
    }

    // ---- catalogue ------------------------------------------------------------
    if (path === '/api/catalog' && req.method === 'GET') {
      return send(res, 200, store.CATALOG);
    }

    // ---- static / SPA ---------------------------------------------------------
    if (req.method === 'GET' && !path.startsWith('/api/')) {
      return serveStatic(res, path);
    }

    return fail(res, 404, `No route for ${req.method} ${path}`);
  } catch (error) {
    const status = error.message === 'Malformed JSON body' ? 400 : 500;
    return fail(res, status, error.message);
  }
});

server.listen(PORT, () => {
  console.log(`FlowProbe Fleet Console listening on http://localhost:${PORT} (testMode=${TEST_MODE})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    simulator.stop();
    server.close(() => process.exit(0));
  });
}

export { server };
