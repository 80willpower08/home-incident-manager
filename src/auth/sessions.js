// Session tokens for local auth. 32-byte random tokens stored in the sessions table.
// Default expiry: 30 days. Tokens are bound to a user_id and validated on every request.

const crypto = require('crypto');
const { getDb } = require('../db');

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME = 'him_session';

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createSession(userId, ttlMs = DEFAULT_TTL_MS) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString().replace('T', ' ').slice(0, 19);
  getDb().prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(token, userId, expiresAt);
  return { token, expiresAt };
}

function lookupSession(token) {
  if (!token) return null;
  const row = getDb().prepare(`
    SELECT s.user_id, s.expires_at, u.*
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  // Expired?
  const now = Date.now();
  const exp = Date.parse(row.expires_at + 'Z');
  if (exp && exp < now) {
    getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return {
    id: `local:${row.id}`,
    user_id: row.id,
    name: row.display_name || row.username,
    username: row.username,
    is_admin: !!row.is_admin,
    notify_target: row.notify_target || null,
  };
}

function deleteSession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function deleteAllUserSessions(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// Periodically sweep expired sessions
setInterval(() => {
  try {
    getDb().prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  } catch {}
}, 60 * 60 * 1000).unref();

module.exports = {
  createSession,
  lookupSession,
  deleteSession,
  deleteAllUserSessions,
  COOKIE_NAME,
  DEFAULT_TTL_MS,
};
