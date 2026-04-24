const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'incident_manager.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'low' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      urgency TEXT NOT NULL DEFAULT 'low' CHECK(urgency IN ('low', 'medium', 'high')),
      category TEXT NOT NULL DEFAULT 'incident' CHECK(category IN ('incident', 'request')),
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'evaluating', 'recommended', 'approved', 'in_progress', 'resolved', 'escalated', 'denied')),
      submitted_by TEXT NOT NULL DEFAULT 'user',
      assigned_to TEXT,
      claude_recommendation TEXT,
      claude_reasoning TEXT,
      claude_confidence REAL,
      claude_action_type TEXT,
      claude_action_params TEXT,
      resolution_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_type TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      rule_description TEXT NOT NULL,
      content_md TEXT,
      auto_action TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      color TEXT,
      service_module TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add claude_action_type / claude_action_params / content_md / updated_at to pre-existing DBs
  const incCols = db.prepare(`PRAGMA table_info(incidents)`).all().map(c => c.name);
  if (!incCols.includes('claude_action_type')) {
    db.exec(`ALTER TABLE incidents ADD COLUMN claude_action_type TEXT`);
  }
  if (!incCols.includes('claude_action_params')) {
    db.exec(`ALTER TABLE incidents ADD COLUMN claude_action_params TEXT`);
  }

  const polCols = db.prepare(`PRAGMA table_info(policies)`).all().map(c => c.name);
  if (!polCols.includes('content_md')) {
    db.exec(`ALTER TABLE policies ADD COLUMN content_md TEXT`);
  }
  if (!polCols.includes('updated_at')) {
    db.exec(`ALTER TABLE policies ADD COLUMN updated_at TEXT`);
    db.exec(`UPDATE policies SET updated_at = created_at WHERE updated_at IS NULL`);
  }

  // One-time migration: drop the CHECK(type IN ...) constraint from incidents table.
  // SQLite can't ALTER a CHECK constraint directly — we rebuild the table if the constraint still exists.
  const incSQL = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='incidents'`).get();
  if (incSQL?.sql?.includes(`CHECK(type IN`)) {
    db.exec(`
      BEGIN;
      CREATE TABLE incidents_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'low' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
        urgency TEXT NOT NULL DEFAULT 'low' CHECK(urgency IN ('low', 'medium', 'high')),
        category TEXT NOT NULL DEFAULT 'incident' CHECK(category IN ('incident', 'request')),
        status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'evaluating', 'recommended', 'approved', 'in_progress', 'resolved', 'escalated', 'denied')),
        submitted_by TEXT NOT NULL DEFAULT 'user',
        assigned_to TEXT,
        claude_recommendation TEXT,
        claude_reasoning TEXT,
        claude_confidence REAL,
        claude_action_type TEXT,
        claude_action_params TEXT,
        resolution_notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );
      INSERT INTO incidents_new SELECT
        id, title, description, type, severity, urgency, category, status,
        submitted_by, assigned_to, claude_recommendation, claude_reasoning,
        claude_confidence, claude_action_type, claude_action_params,
        resolution_notes, created_at, updated_at, resolved_at
      FROM incidents;
      DROP TABLE incidents;
      ALTER TABLE incidents_new RENAME TO incidents;
      COMMIT;
    `);
  }

  seedDefaults();
}

function seedDefaults() {
  // Default settings
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  const settingDefaults = [
    ['mode_pihole', 'recommend'],
    ['mode_plex', 'recommend'],
    ['mode_blueiris', 'recommend'],
    ['mode_network', 'recommend'],
    ['mode_smarthome', 'recommend'],
    ['mode_other', 'recommend'],
    ['escalation_timeout_minutes', '30'],
  ];
  db.transaction(() => {
    for (const [k, v] of settingDefaults) insertSetting.run(k, v);
  })();

  // Default categories (users can add/edit/remove these)
  const insertCategory = db.prepare(`
    INSERT OR IGNORE INTO categories (key, label, description, icon, color, service_module, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const categoryDefaults = [
    ['pihole',    'Blocked Website',      'DNS blocking (Pi-hole). Unblock/block domain requests.', 'shield',    '#58a6ff', 'pihole',   10],
    ['plex',      'Plex / Media',         'Plex Media Server streaming issues.',                     'play',      '#e5a00d', 'plex',     20],
    ['blueiris',  'Cameras',              'BlueIris camera system issues.',                          'camera',    '#db6d28', 'blueiris', 30],
    ['network',   'Network / Internet',   'Connectivity diagnostics (ping, DNS, traceroute).',       'network',   '#39d2c0', 'network',  40],
    ['smarthome', 'Smart Home',           'General smart home device issues.',                       'home',      '#bc8cff', null,       50],
    ['other',     'Other',                'Anything that doesn\'t fit another category.',            'help',      '#8b949e', null,       99],
  ];
  db.transaction(() => {
    for (const c of categoryDefaults) insertCategory.run(...c);
  })();

  // Default policies — with full markdown content so admins can see the reasoning
  const insertPolicy = db.prepare(`
    INSERT OR IGNORE INTO policies (id, incident_type, rule_name, rule_description, content_md, auto_action)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const defaultPolicies = [
    [1, 'pihole', 'safe_categories', 'Auto-approve unblocking for known-safe categories',
`# Safe categories — auto-approve

**Applies to:** Pi-hole unblock requests for domains in these categories.

- Shopping (amazon.com, target.com, walmart.com, etc.)
- News (nytimes.com, cnn.com, bbc.com, etc.)
- Social media (reddit.com, twitter.com, facebook.com, etc.)
- Streaming (netflix.com, youtube.com, spotify.com, etc.)
- Education (wikipedia.org, khanacademy.org, etc.)

**Action:** whitelist
**Confidence threshold for auto-execution:** 0.85`, 'whitelist'],

    [2, 'pihole', 'dangerous_categories', 'Auto-deny unblocking for dangerous categories',
`# Dangerous categories — auto-deny

**Applies to:** Pi-hole unblock requests for domains clearly in these categories.

- Known malware distributors
- Phishing sites
- Ad networks (doubleclick, googleadservices, etc.)
- Tracking/analytics beacons
- Cryptocurrency mining

**Action:** deny
**Rationale:** Unblocking these defeats the purpose of Pi-hole.`, 'deny'],

    [3, 'pihole', 'unknown_domains', 'Escalate ambiguous domains',
`# Unknown/ambiguous domains — escalate

If you can't confidently place the domain in either safe_categories or dangerous_categories, escalate to the admin with diagnostic context rather than guessing.

**Action:** escalate
**Include in reasoning:** Why the domain is ambiguous, what categories it might fall under, and any context the user provided.`, 'escalate'],

    [4, 'plex', 'subtitle_sync', 'Subtitle/audio sync issues',
`# Plex subtitle / audio sync

Common cause: transcoder chose incorrect subtitle stream or encoding. First line of diagnosis is to check the active session's transcodeDecision fields.

**Action:** diagnose, then offer to restart the stream with a different subtitle option.`, 'diagnose'],

    [5, 'plex', 'transcode_issues', 'Transcoding failures',
`# Plex transcode issues

Check server load, active transcoder count, and stream bitrate. If the transcoder is overloaded, suggest lowering quality or stopping other streams.

**Action:** diagnose.`, 'diagnose'],

    [6, 'blueiris', 'camera_offline', 'Camera offline',
`# Camera offline

Ping the camera, check BlueIris status, attempt a feed restart.

**Action:** diagnose (full automation pending API integration).`, 'diagnose'],

    [7, 'network', 'connectivity', 'Network connectivity',
`# Network connectivity diagnostics

Default tooling:
- Ping 8.8.8.8 and 1.1.1.1 (external)
- Ping the gateway (local)
- Resolve google.com (DNS)
- Traceroute the failing target

**Action:** diagnose — present findings to admin for next steps.`, 'diagnose'],
  ];

  db.transaction(() => {
    for (const p of defaultPolicies) insertPolicy.run(...p);
  })();
}

function logAudit(incidentId, action, actor, details = null) {
  const stmt = getDb().prepare(
    `INSERT INTO audit_log (incident_id, action, actor, details) VALUES (?, ?, ?, ?)`
  );
  stmt.run(incidentId, action, actor, details);
}

module.exports = { getDb, logAudit };
