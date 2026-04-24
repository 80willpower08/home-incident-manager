const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// List — any authenticated user (needed to populate the Submit form dropdown)
router.get('/', requireAuth, (req, res) => {
  const rows = getDb().prepare(`
    SELECT * FROM categories
    WHERE active = 1
    ORDER BY sort_order ASC, label ASC
  `).all();
  res.json({ categories: rows });
});

// Full list including inactive (admin only — used by category management UI)
router.get('/all', requireAdmin, (req, res) => {
  const rows = getDb().prepare(`
    SELECT * FROM categories ORDER BY sort_order ASC, label ASC
  `).all();
  res.json({ categories: rows });
});

// Create
router.post('/', requireAdmin, (req, res) => {
  const { key, label, description, icon, color, service_module, sort_order } = req.body;

  if (!key || !label) {
    return res.status(400).json({ error: 'key and label are required' });
  }
  if (!/^[a-z0-9_]+$/.test(key)) {
    return res.status(400).json({ error: 'key must be lowercase letters, numbers, and underscores only' });
  }

  try {
    const stmt = getDb().prepare(`
      INSERT INTO categories (key, label, description, icon, color, service_module, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      key,
      label,
      description || null,
      icon || null,
      color || null,
      service_module || null,
      Number(sort_order) || 0
    );
    const category = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    logAudit(null, 'category_created', req.user.name, `${key}: ${label}`);
    res.status(201).json({ category });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: `Category with key "${key}" already exists` });
    }
    throw err;
  }
});

// Update
router.patch('/:id', requireAdmin, (req, res) => {
  const existing = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });

  const allowed = ['label', 'description', 'icon', 'color', 'service_module', 'sort_order', 'active'];
  const updates = [];
  const params = [];
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(field === 'active' ? (req.body[field] ? 1 : 0) : req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push(`updated_at = datetime('now')`);
  params.push(req.params.id);

  getDb().prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const category = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  logAudit(null, 'category_updated', req.user.name, `${existing.key}: ${JSON.stringify(req.body)}`);
  res.json({ category });
});

// Delete — refuses if any incidents reference this category (use deactivate instead)
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = getDb().prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found' });

  const inUse = getDb().prepare('SELECT COUNT(*) as n FROM incidents WHERE type = ?').get(existing.key);
  if (inUse.n > 0) {
    return res.status(409).json({
      error: `Cannot delete "${existing.key}": ${inUse.n} incident(s) reference it. Deactivate it instead (set active=false).`,
    });
  }

  getDb().prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  logAudit(null, 'category_deleted', req.user.name, existing.key);
  res.status(204).send();
});

module.exports = router;
