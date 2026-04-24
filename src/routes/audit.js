const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/auth');

// Audit log + stats are admin-only
router.use(requireAdmin);

// Get audit log with optional filters
router.get('/', (req, res) => {
  const { incident_id, actor, action, limit = 100, offset = 0 } = req.query;
  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];

  if (incident_id) { query += ' AND incident_id = ?'; params.push(incident_id); }
  if (actor) { query += ' AND actor = ?'; params.push(actor); }
  if (action) { query += ' AND action = ?'; params.push(action); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const logs = getDb().prepare(query).all(...params);
  res.json({ logs, total: logs.length });
});

// Get summary stats for dashboard
router.get('/stats', (req, res) => {
  const db = getDb();

  const byStatus = db.prepare(
    'SELECT status, COUNT(*) as count FROM incidents GROUP BY status'
  ).all();

  const byType = db.prepare(
    'SELECT type, COUNT(*) as count FROM incidents GROUP BY type'
  ).all();

  const bySeverity = db.prepare(
    'SELECT severity, COUNT(*) as count FROM incidents GROUP BY severity'
  ).all();

  const recentActivity = db.prepare(
    'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20'
  ).all();

  const openCount = db.prepare(
    "SELECT COUNT(*) as count FROM incidents WHERE status NOT IN ('resolved', 'denied')"
  ).get();

  const avgResolutionTime = db.prepare(`
    SELECT AVG(
      CAST((julianday(resolved_at) - julianday(created_at)) * 24 * 60 AS INTEGER)
    ) as avg_minutes
    FROM incidents WHERE resolved_at IS NOT NULL
  `).get();

  res.json({
    byStatus,
    byType,
    bySeverity,
    recentActivity,
    openIncidents: openCount.count,
    avgResolutionMinutes: avgResolutionTime.avg_minutes || 0,
  });
});

module.exports = router;
