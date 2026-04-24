// HA-native authentication.
//
// Each household member creates a long-lived access token in their HA profile.
// That token IS their HA identity — we validate it against HA's /api/auth/current_user
// endpoint and trust HA as the source of truth for name and admin role.
//
// Tokens arrive via `Authorization: Bearer <token>` on every /api request.
// The frontend reads the token from the URL hash (#token=...) and attaches it.

const WebSocket = require('ws');

const HA_URL = process.env.HA_URL;
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // validate against HA at most every 5 min per token

// In-memory cache: token -> { user, expiresAt }
const cache = new Map();

/**
 * Call HA's auth/current_user via WebSocket — it's not a REST endpoint.
 * Flow: connect → receive auth_required → send access_token → receive auth_ok →
 *       send auth/current_user command → receive result → close.
 */
function getCurrentUserViaWS(token) {
  return new Promise((resolve) => {
    if (!token || !HA_URL) return resolve(null);

    const wsUrl = HA_URL.replace(/^http/, 'ws') + '/api/websocket';
    // Honor NODE_TLS_REJECT_UNAUTHORIZED=0 for self-signed LAN HA certs
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
            id: msg.result.id,
            name: msg.result.name || 'Unknown',
            is_admin: !!msg.result.is_admin,
            is_owner: !!msg.result.is_owner,
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

async function validateTokenAgainstHA(token) {
  if (!token || !HA_URL) return null;

  const cached = cache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const user = await getCurrentUserViaWS(token);

  // Cache both positive and negative results (negative for a shorter window)
  cache.set(token, {
    user,
    expiresAt: Date.now() + (user ? AUTH_CACHE_TTL_MS : 30_000),
  });

  return user;
}

// Periodic cache cleanup so expired entries don't accumulate
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(token);
  }
}, 60_000).unref();

/**
 * Middleware: parse Bearer token, attach req.user (or null if absent/invalid).
 * Never rejects the request — downstream middlewares decide whether auth is required.
 */
async function attachUser(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : null;
  req.user = await validateTokenAgainstHA(token);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required. Include Authorization: Bearer <your HA token>.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin };
