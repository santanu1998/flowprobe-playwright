/**
 * Authentication and role-based authorisation for the fleet console.
 *
 * Demo-grade by design: the application under test exists so a test suite has something real to
 * exercise, and it is never deployed outside a developer machine or a CI container. The security
 * properties the suite asserts — expiry, role separation, no token for bad credentials — are real.
 */
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = randomBytes(32);
const TTL_MS = 30 * 60 * 1000;

/** Roles in increasing order of authority. */
export const ROLES = ['viewer', 'operator', 'admin'];

const USERS = [
  { username: 'admin', password: 'Admin@123', role: 'admin', displayName: 'Fleet Admin' },
  { username: 'operator', password: 'Operator@123', role: 'operator', displayName: 'Shift Operator' },
  { username: 'viewer', password: 'Viewer@123', role: 'viewer', displayName: 'Read Only' },
  { username: 'locked', password: 'Locked@123', role: 'viewer', displayName: 'Locked Account', locked: true },
];

const sessions = new Map();

function sign(payload) {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function login(username, password) {
  const user = USERS.find((u) => u.username === username);
  if (!user) return { ok: false, reason: 'Invalid username or password' };
  if (user.locked) return { ok: false, reason: 'Account is locked. Contact an administrator.', code: 'LOCKED' };
  if (!constantTimeEquals(user.password, String(password ?? ''))) {
    return { ok: false, reason: 'Invalid username or password' };
  }

  const issuedAt = Date.now();
  const body = `${user.username}.${user.role}.${issuedAt}`;
  const token = `${Buffer.from(body).toString('base64url')}.${sign(body)}`;
  sessions.set(token, { username: user.username, role: user.role, issuedAt });

  return {
    ok: true,
    token,
    expiresAt: new Date(issuedAt + TTL_MS).toISOString(),
    user: { username: user.username, role: user.role, displayName: user.displayName },
  };
}

export function verify(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.issuedAt > TTL_MS) {
    sessions.delete(token);
    return null;
  }
  const [body, signature] = token.split('.');
  const decoded = Buffer.from(body, 'base64url').toString();
  if (!constantTimeEquals(sign(decoded), signature)) {
    sessions.delete(token);
    return null;
  }
  return session;
}

export function logout(token) {
  return sessions.delete(token);
}

export function bearerFrom(req) {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** @returns true when the session's role is at least as authoritative as `required`. */
export function hasRole(session, required) {
  if (!session) return false;
  return ROLES.indexOf(session.role) >= ROLES.indexOf(required);
}

export function resetSessions() {
  sessions.clear();
}
