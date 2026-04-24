// Background job: auto-escalate incidents stuck in `recommended` state.
//
// When Claude makes a recommendation but the admin doesn't act on it within
// the configured timeout, flip it to `escalated` and re-fire the admin
// notification so it doesn't fall through the cracks.

const { getDb, logAudit } = require('./db');

const CHECK_INTERVAL_MS = 60 * 1000; // check every minute

function getTimeoutMinutes() {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'escalation_timeout_minutes'").get();
  const n = parseInt(row?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

async function runEscalationCheck() {
  const db = getDb();
  const timeoutMinutes = getTimeoutMinutes();

  const stuck = db.prepare(`
    SELECT * FROM incidents
    WHERE status = 'recommended'
      AND (julianday('now') - julianday(updated_at)) * 24 * 60 > ?
  `).all(timeoutMinutes);

  if (stuck.length === 0) return;

  const notifications = require('./notifications');

  for (const incident of stuck) {
    try {
      db.prepare(`
        UPDATE incidents SET
          status = 'escalated',
          updated_at = datetime('now'),
          resolution_notes = COALESCE(resolution_notes || char(10), '') || ?
        WHERE id = ?
      `).run(`Auto-escalated after ${timeoutMinutes} min without admin response.`, incident.id);

      logAudit(
        incident.id,
        'auto_escalated',
        'system',
        `No admin action within ${timeoutMinutes} minutes in 'recommended' state`
      );

      const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);
      await notifications.notifyEscalation(updated);
    } catch (err) {
      console.error(`[escalation] Failed for incident #${incident.id}:`, err.message);
    }
  }

  console.log(`[escalation] Auto-escalated ${stuck.length} incident(s) (timeout ${timeoutMinutes}min)`);
}

function start() {
  // First sweep happens shortly after boot in case we came up with stale incidents
  setTimeout(() => {
    runEscalationCheck().catch(err => console.error('[escalation] initial run failed:', err.message));
  }, 5_000).unref();

  const timer = setInterval(() => {
    runEscalationCheck().catch(err => console.error('[escalation] check failed:', err.message));
  }, CHECK_INTERVAL_MS);
  timer.unref();
}

module.exports = { start, runEscalationCheck };
