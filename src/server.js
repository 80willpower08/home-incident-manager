require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');
const { attachUser, requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3069;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public endpoint: health (no auth required so monitors can probe)
app.get('/api/health', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Detailed health: shows which integrations are wired up. Useful for first-run diagnostics.
app.get('/api/health/detailed', (req, res) => {
  const pihole = require('./services/pihole');
  const plex = require('./services/plex');
  const { getActiveProviderInfo } = require('./evaluators');

  const aiInfo = (() => {
    try {
      return getActiveProviderInfo();
    } catch (err) {
      return { name: process.env.AI_PROVIDER, available: false, error: err.message };
    }
  })();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: require('../package.json').version,
    integrations: {
      ai_provider: aiInfo,
      home_assistant: {
        configured: !!(process.env.HA_URL && process.env.HA_TOKEN),
        url_set: !!process.env.HA_URL,
        token_set: !!process.env.HA_TOKEN,
        admin_notify_target_set: !!process.env.HA_NOTIFY_ADMIN,
      },
      pihole: { configured: pihole.isConfigured() },
      plex: { configured: plex.isConfigured() },
    },
    uptime_seconds: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

// Attach req.user for all other API routes (null if unauthenticated)
app.use('/api', attachUser);

// Current-user endpoint for the UI to render name/admin state
app.get('/api/me', (req, res) => {
  res.json({ user: req.user });
});

// Auth routes (login/logout/setup — these need to work without an authenticated user)
app.use('/api/auth', require('./routes/auth'));

// API Routes (each router applies its own requireAuth/requireAdmin as needed)
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/users', require('./routes/users'));

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Home Incident Manager running on port ${PORT}`);
  console.log(`API: http://localhost:${PORT}/api`);
  console.log(`UI:  http://localhost:${PORT}`);

  // Initialize DB on startup
  getDb();
  console.log('Database initialized.');

  // Start the background auto-escalation watcher
  require('./escalation').start();
  console.log('Escalation watcher started.');

  // Log the active auth mode so users can verify their config
  const { resolveMode } = require('./middleware/auth');
  const mode = resolveMode();
  const banner = {
    none: '⚠️  AUTH_MODE=none — anonymous admin mode. Do NOT expose to the public internet.',
    local: 'AUTH_MODE=local — built-in user accounts.',
    ha: 'AUTH_MODE=ha — Home Assistant token validation.',
  }[mode] || `AUTH_MODE=${mode}`;
  console.log(banner);
});
