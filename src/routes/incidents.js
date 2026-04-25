const express = require('express');
const router = express.Router();
const { getDb, logAudit } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// All incident routes require authentication
router.use(requireAuth);

// List incidents. Non-admin users only see their own submissions.
router.get('/', (req, res) => {
  const { status, type, category, submitted_by, assigned_to, limit = 50, offset = 0 } = req.query;
  let query = 'SELECT * FROM incidents WHERE 1=1';
  const params = [];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (type) { query += ' AND type = ?'; params.push(type); }
  if (category) { query += ' AND category = ?'; params.push(category); }
  if (assigned_to === 'me') {
    query += ' AND assigned_to = ?'; params.push(req.user.name);
  } else if (assigned_to === 'none') {
    query += " AND (assigned_to IS NULL OR assigned_to = '')";
  } else if (assigned_to) {
    query += ' AND assigned_to = ?'; params.push(assigned_to);
  }

  // Non-admins are scoped to their own incidents regardless of query param.
  // Admins can filter by submitted_by (or see everything if omitted).
  if (!req.user.is_admin) {
    query += ' AND submitted_by = ?';
    params.push(req.user.name);
  } else if (submitted_by) {
    query += ' AND submitted_by = ?';
    params.push(submitted_by);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const incidents = getDb().prepare(query).all(...params);
  res.json({ incidents, total: incidents.length });
});

// Get single incident. Non-admins can only see their own.
router.get('/:id', (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });
  if (!req.user.is_admin && incident.submitted_by !== req.user.name) {
    return res.status(403).json({ error: 'Not authorized to view this incident' });
  }

  const audit = getDb().prepare(
    'SELECT * FROM audit_log WHERE incident_id = ? ORDER BY created_at DESC'
  ).all(req.params.id);

  res.json({ incident, audit });
});

// Create incident. submitted_by is forced to the authenticated user's name.
router.post('/', (req, res) => {
  const { title, description, type, severity, urgency, category } = req.body;

  if (!title || !type) {
    return res.status(400).json({ error: 'title and type are required' });
  }

  // Validate against active categories stored in the DB
  const categoryRow = getDb().prepare('SELECT * FROM categories WHERE key = ? AND active = 1').get(type);
  if (!categoryRow) {
    const allowed = getDb().prepare('SELECT key FROM categories WHERE active = 1').all().map(c => c.key);
    return res.status(400).json({ error: `type must be one of: ${allowed.join(', ')}` });
  }

  const submittedBy = req.user.name;

  const stmt = getDb().prepare(`
    INSERT INTO incidents (title, description, type, severity, urgency, category, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    title,
    description || null,
    type,
    severity || 'low',
    urgency || 'low',
    category || 'incident',
    submittedBy
  );

  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);
  logAudit(incident.id, 'created', submittedBy, `Incident created: ${title}`);

  // Fire admin notification for the new incident
  const notifications = require('../notifications');
  notifications.notifyNewIncident(incident).catch(err => {
    console.error('New-incident notification failed:', err.message);
  });

  // Trigger Claude evaluation asynchronously
  const { evaluateIncident } = require('../claude');
  evaluateIncident(incident).catch(err => {
    console.error('Claude evaluation failed:', err.message);
  });

  res.status(201).json({ incident });
});

// Update incident
router.patch('/:id', (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const allowedFields = ['status', 'severity', 'urgency', 'assigned_to', 'resolution_notes', 'claude_recommendation', 'claude_reasoning', 'claude_confidence'];
  const updates = [];
  const params = [];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  // Auto-set resolved_at when status changes to resolved
  if (req.body.status === 'resolved') {
    updates.push("resolved_at = datetime('now')");
  }

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);

  getDb().prepare(`UPDATE incidents SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const updated = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  logAudit(updated.id, 'updated', req.user.name, JSON.stringify(req.body));

  res.json({ incident: updated });
});

// Approve a Claude recommendation (admin only)
router.post('/:id/approve', requireAdmin, (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });
  if (incident.status !== 'recommended') {
    return res.status(400).json({ error: 'Incident is not in recommended status' });
  }

  getDb().prepare(`
    UPDATE incidents SET status = 'approved', updated_at = datetime('now') WHERE id = ?
  `).run(req.params.id);

  logAudit(incident.id, 'approved', req.user.name, 'Recommendation approved');

  // Execute the approved action
  const { executeApproved } = require('../claude');
  executeApproved(incident).catch(err => {
    console.error('Action execution failed:', err.message);
  });

  const updated = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  res.json({ incident: updated });
});

// Deny a Claude recommendation (admin only)
router.post('/:id/deny', requireAdmin, (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  getDb().prepare(`
    UPDATE incidents SET status = 'denied', resolution_notes = ?, updated_at = datetime('now') WHERE id = ?
  `).run(req.body.reason || `Denied by ${req.user.name}`, req.params.id);

  logAudit(incident.id, 'denied', req.user.name, req.body.reason || 'Denied');

  const updated = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);

  // Tell the submitter their request was denied
  const notifications = require('../notifications');
  notifications.notifyUserDenied(updated).catch(err => {
    console.error('Deny notification failed:', err.message);
  });

  res.json({ incident: updated });
});

// Manually close / resolve any incident (admin only, no Claude involvement)
router.post('/:id/close', requireAdmin, (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const notes = req.body.resolution_notes || `Manually closed by ${req.user.name}`;
  getDb().prepare(`
    UPDATE incidents SET
      status = 'resolved',
      resolution_notes = ?,
      resolved_at = datetime('now'),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(notes, req.params.id);

  logAudit(incident.id, 'manually_closed', req.user.name, notes);

  const updated = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);

  // Let the submitter know it's been resolved
  const notifications = require('../notifications');
  notifications.notifyUserResolved(updated).catch(err => {
    console.error('Close notification failed:', err.message);
  });

  res.json({ incident: updated });
});

// Reopen a resolved, denied, or escalated incident back into the queue (admin only)
router.post('/:id/reopen', requireAdmin, (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const closedStates = ['resolved', 'denied', 'escalated'];
  if (!closedStates.includes(incident.status)) {
    return res.status(400).json({ error: `Cannot reopen incident in status: ${incident.status}` });
  }

  // Return to 'new' (so it can be re-evaluated) or 'recommended' if Claude already had a rec
  const targetStatus = req.body.target_status === 'recommended' && incident.claude_recommendation
    ? 'recommended'
    : 'new';

  getDb().prepare(`
    UPDATE incidents SET
      status = ?,
      resolved_at = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(targetStatus, req.params.id);

  logAudit(incident.id, 'reopened', req.user.name, req.body.reason || `Reopened to ${targetStatus}`);

  // If reopened to 'new', trigger a fresh Claude evaluation
  if (targetStatus === 'new') {
    const { evaluateIncident } = require('../claude');
    const updated = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
    evaluateIncident(updated).catch(err => {
      console.error('Re-evaluation failed:', err.message);
    });
  }

  const updated = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  res.json({ incident: updated });
});

// Assign an incident to a specific admin (or unassign by sending empty/null).
router.post('/:id/assign', requireAdmin, (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const assignee = (req.body.assigned_to || '').trim() || null;
  getDb().prepare(`
    UPDATE incidents SET assigned_to = ?, updated_at = datetime('now') WHERE id = ?
  `).run(assignee, req.params.id);

  const action = assignee ? 'assigned' : 'unassigned';
  const details = assignee ? `to ${assignee}` : `previously ${incident.assigned_to || 'nobody'}`;
  logAudit(incident.id, action, req.user.name, details);

  // Notify the new assignee if they're not the one doing the assigning
  if (assignee && assignee !== req.user.name) {
    const notifications = require('../notifications');
    const updated = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
    notifications.notifyAssigned(updated, assignee).catch(err => {
      console.error('Assignment notification failed:', err.message);
    });
  }

  const updated = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  res.json({ incident: updated });
});

// Re-evaluate with AI, factoring in current admin comments + prior recommendations.
// Works on any incident that's not already mid-evaluation or mid-action.
router.post('/:id/reevaluate', requireAdmin, (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const busyStates = ['evaluating', 'in_progress'];
  if (busyStates.includes(incident.status)) {
    return res.status(400).json({ error: `Incident is busy (${incident.status}); wait for it to settle before re-evaluating.` });
  }

  // If admin added a note with this request, log it so Claude picks it up via audit log
  const note = (req.body.comment || '').trim();
  if (note) {
    logAudit(incident.id, 'comment', req.user.name, note);
  }

  logAudit(incident.id, 'reevaluate_requested', req.user.name, req.body.reason || 'Re-evaluation requested');

  // Reset resolution/denial state so the incident flows back through evaluation
  getDb().prepare(`
    UPDATE incidents SET
      status = 'new',
      resolved_at = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id);

  // Trigger fresh evaluation (evaluateIncident pulls prior context from audit log)
  const fresh = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  const { evaluateIncident } = require('../claude');
  evaluateIncident(fresh).catch(err => {
    console.error('Re-evaluation failed:', err.message);
  });

  res.json({ incident: fresh });
});

// Add a comment / note to any incident. Submitters can comment on their own incidents; admins can comment on any.
router.post('/:id/comment', (req, res) => {
  const incident = getDb().prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });
  if (!req.user.is_admin && incident.submitted_by !== req.user.name) {
    return res.status(403).json({ error: 'Not authorized to comment on this incident' });
  }

  const comment = (req.body.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'comment is required' });

  logAudit(incident.id, 'comment', req.user.name, comment);

  // Notify the submitter if someone else commented on their incident
  const notifications = require('../notifications');
  notifications.notifyUserCommented(incident, req.user.name, comment).catch(err => {
    console.error('Comment notification failed:', err.message);
  });

  res.json({ ok: true });
});

module.exports = router;
