// Home Assistant push notifications.
//
// Admin notifications use the HA_NOTIFY_ADMIN env var target.
// User-specific notifications (resolved/denied) look up a per-user target stored
// in the settings table as `notify_target:<username>` so each household member
// can receive pushes on their own device.
//
// If a target isn't configured, the notification is silently skipped — no errors,
// no log spam. The core incident flow never depends on notifications succeeding.

const { getDb } = require('./db');

const HA_URL = process.env.HA_URL || 'http://homeassistant.local:8123';
const HA_TOKEN = process.env.HA_TOKEN;
const HA_NOTIFY_ADMIN = process.env.HA_NOTIFY_ADMIN;

/**
 * Send a notification to a specific notify service.
 * target is the service name without the "notify." prefix (e.g. "mobile_app_iphone").
 */
async function sendHANotification(title, message, target) {
  if (!target) return;
  if (!HA_TOKEN) {
    console.warn('HA_TOKEN not set, skipping notification');
    return;
  }

  try {
    const response = await fetch(`${HA_URL}/api/services/notify/${target}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, message }),
    });

    if (!response.ok) {
      console.error(`HA notify [${target}] failed: ${response.status} ${await response.text()}`);
    }
  } catch (err) {
    console.error(`HA notify [${target}] error:`, err.message);
  }
}

/**
 * Look up the per-user notify target. Checks the users table first (for local accounts),
 * then falls back to the settings table (for HA users / legacy configuration).
 */
function getUserTarget(username) {
  if (!username) return null;
  try {
    const userRow = getDb().prepare('SELECT notify_target FROM users WHERE username = ? OR display_name = ?').get(username, username);
    if (userRow?.notify_target) return userRow.notify_target;
  } catch { /* users table might not exist in very old DBs */ }
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(`notify_target:${username}`);
  return row?.value || null;
}

function truncate(s, n = 180) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ─── Admin-facing events ───

async function notifyNewIncident(incident) {
  const title = `New issue: ${incident.title}`;
  const msg = `From ${incident.submitted_by} · ${incident.type} · ${incident.severity}/${incident.urgency}`;
  await sendHANotification(title, msg, HA_NOTIFY_ADMIN);
}

async function notifyRecommendation(incident, evaluation) {
  const pct = evaluation?.confidence != null ? Math.round(evaluation.confidence * 100) : null;
  const title = `Review: ${incident.title}`;
  const msg = `${truncate(evaluation?.recommended_action)}${pct != null ? ` · ${pct}% confidence` : ''}`;
  await sendHANotification(title, msg, HA_NOTIFY_ADMIN);
}

async function notifyEscalation(incident) {
  const title = `Escalated: ${incident.title}`;
  const msg = truncate(incident.claude_reasoning || incident.resolution_notes || 'Needs manual review.');
  await sendHANotification(title, msg, HA_NOTIFY_ADMIN);
}

async function notifyAutoResolved(incident) {
  const title = `Auto-resolved: ${incident.title}`;
  const msg = truncate(incident.resolution_notes || 'Claude handled this automatically.');
  await sendHANotification(title, msg, HA_NOTIFY_ADMIN);
}

async function notifyActionFailed(incident, errorMsg) {
  const title = `Action failed: ${incident.title}`;
  const msg = truncate(errorMsg || 'Execution failed — see Incident Ops.');
  await sendHANotification(title, msg, HA_NOTIFY_ADMIN);
}

// ─── User-facing events (per submitter) ───

async function notifyUserResolved(incident) {
  const target = getUserTarget(incident.submitted_by);
  const title = `Resolved: ${incident.title}`;
  const msg = truncate(incident.resolution_notes || 'Your issue has been resolved.');
  await sendHANotification(title, msg, target);
}

async function notifyUserDenied(incident) {
  const target = getUserTarget(incident.submitted_by);
  const title = `Not approved: ${incident.title}`;
  const msg = truncate(incident.resolution_notes || 'Your request was not approved.');
  await sendHANotification(title, msg, target);
}

async function notifyUserCommented(incident, commenter, commentText) {
  // Don't notify if a user is commenting on their own incident
  if (commenter === incident.submitted_by) return;
  const target = getUserTarget(incident.submitted_by);
  const title = `Update on ${incident.title}`;
  const msg = truncate(`${commenter} added a note: ${commentText}`);
  await sendHANotification(title, msg, target);
}

// ─── Testing ───

async function sendTest(target, label) {
  const title = 'Incident Manager test notification';
  const msg = `If you see this, your notify target "${label || target}" is configured correctly.`;
  await sendHANotification(title, msg, target);
}

module.exports = {
  sendHANotification,
  sendTest,
  notifyNewIncident,
  notifyRecommendation,
  notifyEscalation,
  notifyAutoResolved,
  notifyActionFailed,
  notifyUserResolved,
  notifyUserDenied,
  notifyUserCommented,
};
