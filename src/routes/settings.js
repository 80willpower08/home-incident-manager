const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../db');
const { requireAdmin } = require('../middleware/auth');

// All settings/policies routes are admin-only
router.use(requireAdmin);

// Get all settings
router.get('/', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json({ settings });
});

// Update a setting (toggle mode, change timeout, etc.)
router.patch('/:key', (req, res) => {
  const { value } = req.body;
  if (value === undefined) {
    return res.status(400).json({ error: 'value is required' });
  }

  // Validate mode settings
  if (req.params.key.startsWith('mode_')) {
    if (!['recommend', 'auto'].includes(value)) {
      return res.status(400).json({ error: 'Mode must be "recommend" or "auto"' });
    }
  }

  getDb().prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `).run(req.params.key, value, value);

  logAudit(null, 'setting_changed', req.user.name, `${req.params.key} = ${value}`);

  res.json({ key: req.params.key, value });
});

// Get policies
router.get('/policies', (req, res) => {
  const { type } = req.query;
  let query = 'SELECT * FROM policies WHERE 1=1';
  const params = [];
  if (type) { query += ' AND incident_type = ?'; params.push(type); }
  query += ' ORDER BY incident_type, rule_name';
  res.json({ policies: getDb().prepare(query).all(...params) });
});

// Get single policy
router.get('/policies/:id', (req, res) => {
  const policy = getDb().prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });
  res.json({ policy });
});

// Create policy
router.post('/policies', (req, res) => {
  const { incident_type, rule_name, rule_description, content_md, auto_action, enabled } = req.body;
  if (!incident_type || !rule_name || !rule_description) {
    return res.status(400).json({ error: 'incident_type, rule_name, rule_description are required' });
  }
  const stmt = getDb().prepare(`
    INSERT INTO policies (incident_type, rule_name, rule_description, content_md, auto_action, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    incident_type,
    rule_name,
    rule_description,
    content_md || null,
    auto_action || null,
    enabled === false ? 0 : 1
  );
  const policy = getDb().prepare('SELECT * FROM policies WHERE id = ?').get(result.lastInsertRowid);
  logAudit(null, 'policy_created', req.user.name, `${incident_type}/${rule_name}`);
  res.status(201).json({ policy });
});

// Update policy (full edit or just toggle enabled)
router.patch('/policies/:id', (req, res) => {
  const existing = getDb().prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Policy not found' });

  const allowed = ['rule_name', 'rule_description', 'content_md', 'auto_action', 'enabled', 'incident_type'];
  const updates = [];
  const params = [];
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(field === 'enabled' ? (req.body[field] ? 1 : 0) : req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push(`updated_at = datetime('now')`);
  params.push(req.params.id);

  getDb().prepare(`UPDATE policies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const policy = getDb().prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  logAudit(null, 'policy_updated', req.user.name, `${existing.incident_type}/${existing.rule_name}`);
  res.json({ policy });
});

// Delete policy
router.delete('/policies/:id', (req, res) => {
  const existing = getDb().prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Policy not found' });
  getDb().prepare('DELETE FROM policies WHERE id = ?').run(req.params.id);
  logAudit(null, 'policy_deleted', req.user.name, `${existing.incident_type}/${existing.rule_name}`);
  res.status(204).send();
});

// List all known submitters plus their configured notify targets
router.get('/notify-targets', (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT DISTINCT submitted_by FROM incidents
    WHERE submitted_by IS NOT NULL AND submitted_by != ''
    ORDER BY submitted_by
  `).all();

  const targets = db.prepare(`
    SELECT key, value FROM settings WHERE key LIKE 'notify_target:%'
  `).all();
  const targetMap = Object.fromEntries(targets.map(t => [t.key.replace(/^notify_target:/, ''), t.value]));

  res.json({
    users: users.map(u => ({
      username: u.submitted_by,
      notify_target: targetMap[u.submitted_by] || null,
    })),
    admin_target_configured: !!process.env.HA_NOTIFY_ADMIN,
  });
});

// Set or clear a user's notify target
router.patch('/notify-targets/:username', (req, res) => {
  const { target } = req.body;
  const key = `notify_target:${req.params.username}`;

  if (!target) {
    // Clear
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
    logAudit(null, 'notify_target_cleared', req.user.name, req.params.username);
    return res.json({ username: req.params.username, notify_target: null });
  }

  getDb().prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
  `).run(key, target, target);

  logAudit(null, 'notify_target_set', req.user.name, `${req.params.username} → ${target}`);
  res.json({ username: req.params.username, notify_target: target });
});

// Fire a test notification to a target (used by the Test button in UI)
router.post('/notify-test', async (req, res) => {
  const { target } = req.body;
  if (!target) return res.status(400).json({ error: 'target is required' });

  const notifications = require('../notifications');
  await notifications.sendTest(target, target);
  res.json({ ok: true });
});

module.exports = router;
