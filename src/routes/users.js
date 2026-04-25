const express = require('express');
const router = express.Router();
const users = require('../auth/users');
const { deleteAllUserSessions } = require('../auth/sessions');
const { requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../db');

router.use(requireAdmin);

router.get('/', (req, res) => {
  res.json({ users: users.listUsers() });
});

// Assignable admins for the incident assignment dropdown.
// In local mode: users table where is_admin=1.
// In ha/none mode: derived from audit log of admin actions (since we don't have a user directory).
// Always includes the current user so they can assign to themselves.
router.get('/assignable', (req, res) => {
  const { resolveMode } = require('../middleware/auth');
  const { getDb } = require('../db');
  const mode = resolveMode();
  const seen = new Set();
  const out = [];

  if (mode === 'local') {
    const admins = getDb().prepare(`
      SELECT username, display_name FROM users WHERE is_admin = 1 ORDER BY display_name, username
    `).all();
    for (const a of admins) {
      const label = a.display_name || a.username;
      if (!seen.has(label)) { out.push({ value: label, label }); seen.add(label); }
    }
  } else {
    // Derive from recent admin actions in audit log
    const adminActions = ['approved', 'denied', 'manually_closed', 'reopened', 'reevaluate_requested', 'assigned', 'unassigned'];
    const placeholders = adminActions.map(() => '?').join(',');
    const rows = getDb().prepare(`
      SELECT DISTINCT actor FROM audit_log
      WHERE action IN (${placeholders})
        AND actor NOT IN ('system', 'ai', 'claude', 'anonymous')
      ORDER BY actor
    `).all(...adminActions);
    for (const r of rows) {
      if (!seen.has(r.actor)) { out.push({ value: r.actor, label: r.actor }); seen.add(r.actor); }
    }
  }

  // Always include the current user at the top
  if (req.user?.name && !seen.has(req.user.name)) {
    out.unshift({ value: req.user.name, label: `${req.user.name} (you)` });
  }

  res.json({ assignees: out });
});

router.post('/', async (req, res) => {
  try {
    const user = await users.createUser({
      username: req.body.username,
      password: req.body.password,
      display_name: req.body.display_name,
      is_admin: req.body.is_admin,
      notify_target: req.body.notify_target,
    });
    logAudit(null, 'user_created', req.user.name, user.username);
    res.status(201).json({ user: users.sanitize(user) });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const user = await users.updateUser(Number(req.params.id), req.body);
    logAudit(null, 'user_updated', req.user.name, user.username);
    res.json({ user: users.sanitize(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const user = users.findById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.user_id) return res.status(400).json({ error: 'You cannot delete yourself' });
  // Also kill any active sessions
  deleteAllUserSessions(user.id);
  users.deleteUser(user.id);
  logAudit(null, 'user_deleted', req.user.name, user.username);
  res.status(204).send();
});

module.exports = router;
