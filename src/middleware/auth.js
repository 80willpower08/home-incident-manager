// Unified auth middleware supporting three modes:
//
//   AUTH_MODE=none   — no auth; every request is a synthetic admin user.
//                      Fine for single-user local installs on a trusted LAN.
//   AUTH_MODE=local  — built-in user accounts stored in SQLite.
//                      Users log in with username + password → session cookie.
//   AUTH_MODE=ha     — Home Assistant long-lived token validation via WebSocket.
//
// Default: auto-detect based on env config.
//   - HA_URL set                      → ha
//   - local users exist in DB         → local
//   - neither                         → none (warning logged at startup)

const WebSocket = require('ws');

const HA_URL = process.env.HA_URL;
const HA_AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const haCache = new Map();

// Resolve the effective mode once per request (cheap lookup)
function resolveMode() {
  const configured = (process.env.AUTH_MODE || 'auto').toLowerCase();
  if (configured === 'auto') {
    if (HA_URL) return 'ha';
    try {
      const { hasAnyUsers } = require('../auth/users');
      if (hasAnyUsers()) return 'local';
    } catch {}
    return 'none';
  }
  return configured;
}

// ─── HA mode ───
function haValidateToken(token) {
  return new Promise((resolve) => {
    if (!token || !HA_URL) return resolve(null);
    const cached = haCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return resolve(cached.user);

    const wsUrl = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
    const tlsRelaxed = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
    let ws;
    try {
      ws = new WebSocket(wsUrl, { rejectUnauthorized: !tlsRelaxed });
    } catch (err) {
      console.error('HA WS connect failed:', err.message);
      return resolve(null);
    }

    const finish = (result) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      haCache.set(token, {
        user: result,
        expiresAt: Date.now() + (result ? HA_AUTH_CACHE_TTL_MS : 30_000),
      });
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), 6000);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (msg.type === 'auth_invalid') {
        finish(null);
      } else if (msg.type === 'auth_ok') {
        ws.send(JSON.stringify({ id: 1, type: 'auth/current_user' }));
      } else if (msg.type === 'result' && msg.id === 1) {
        if (msg.success && msg.result) {
          finish({
            id: `ha:${msg.result.id}`,
            name: msg.result.name || 'Unknown',
            is_admin: !!msg.result.is_admin,
            is_owner: !!msg.result.is_owner,
            source: 'ha',
          });
        } else {
          finish(null);
        }
      }
    });
    ws.on('error', (err) => {
      console.error('HA WS error:', err.message);
      finish(null);
    });
  });
}

// Sweep HA cache
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of haCache) if (v.expiresAt < now) haCache.delete(k);
}, 60_000).unref();

// ─── Cookie parsing (lightweight — no cookie-parser dependency) ───
function parseCookie(header, name) {
  if (!header) return null;
  const parts = header.split(';');
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx < 0) continue;
    const key = p.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(p.slice(idx + 1).trim());
  }
  return null;
}

// ─── Main middleware: attach req.user based on active mode ───
async function attachUser(req, res, next) {
  const mode = resolveMode();
  req.authMode = mode;

  // Anonymous mode — everyone is admin
  if (mode === 'none') {
    req.user = {
      id: 'anonymous',
      name: 'anonymous',
      is_admin: true,
      source: 'anonymous',
    };
    return next();
  }

  // Local mode — session cookie or Authorization: Bearer <session-token>
  if (mode === 'local') {
    const { lookupSession, COOKIE_NAME } = require('../auth/sessions');
    let token = null;
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m) token = m[1].trim();
    if (!token) token = parseCookie(req.headers.cookie, COOKIE_NAME);
    req.user = token ? lookupSession(token) : null;
    return next();
  }

  // HA mode — validate long-lived HA token
  if (mode === 'ha') {
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = m ? m[1].trim() : null;
    req.user = await haValidateToken(token);
    return next();
  }

  req.user = null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required', auth_mode: req.authMode });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required', auth_mode: req.authMode });
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin privileges required' });
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin, resolveMode };
