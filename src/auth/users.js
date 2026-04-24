// CRUD for local user accounts. Each user has a hashed password and an admin flag.

const { getDb } = require('../db');
const { hashPassword, verifyPassword } = require('./passwords');

function hasAnyUsers() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

function listUsers() {
  return getDb().prepare(`
    SELECT id, username, display_name, is_admin, notify_target, created_at, last_login_at
    FROM users ORDER BY username ASC
  `).all().map(u => ({ ...u, is_admin: !!u.is_admin }));
}

function findByUsername(username) {
  if (!username) return null;
  return getDb().prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}

function findById(id) {
  return getDb().prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

async function createUser({ username, password, display_name, is_admin, notify_target }) {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_\-]{1,31}$/.test(username || '')) {
    throw new Error('Invalid username (2-32 chars, alphanumeric + _ -)');
  }
  const password_hash = await hashPassword(password);
  const stmt = getDb().prepare(`
    INSERT INTO users (username, password_hash, display_name, is_admin, notify_target)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    username,
    password_hash,
    display_name || null,
    is_admin ? 1 : 0,
    notify_target || null
  );
  return findById(result.lastInsertRowid);
}

async function updateUser(id, { display_name, is_admin, notify_target, password }) {
  const existing = findById(id);
  if (!existing) throw new Error('User not found');

  const updates = [];
  const params = [];
  if (display_name !== undefined) { updates.push('display_name = ?'); params.push(display_name || null); }
  if (is_admin !== undefined) { updates.push('is_admin = ?'); params.push(is_admin ? 1 : 0); }
  if (notify_target !== undefined) { updates.push('notify_target = ?'); params.push(notify_target || null); }
  if (password) {
    updates.push('password_hash = ?');
    params.push(await hashPassword(password));
  }
  if (updates.length === 0) return existing;
  updates.push(`updated_at = datetime('now')`);
  params.push(id);
  getDb().prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return findById(id);
}

function deleteUser(id) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

async function authenticate(username, password) {
  const user = findByUsername(username);
  if (!user) {
    // Do a dummy compare to mitigate timing side-channel for username enumeration
    await verifyPassword(password || '', 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;
  getDb().prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  return user;
}

function sanitize(user) {
  if (!user) return null;
  const { password_hash, ...rest } = user;
  return { ...rest, is_admin: !!user.is_admin };
}

module.exports = {
  hasAnyUsers,
  listUsers,
  findByUsername,
  findById,
  createUser,
  updateUser,
  deleteUser,
  authenticate,
  sanitize,
};
