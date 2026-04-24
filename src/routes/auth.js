const express = require('express');
const router = express.Router();
const { createSession, deleteSession, COOKIE_NAME, DEFAULT_TTL_MS } = require('../auth/sessions');
const users = require('../auth/users');
const { resolveMode } = require('../middleware/auth');

function cookieOptions(req) {
  const isHttps = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'Lax',
    maxAge: DEFAULT_TTL_MS,
    path: '/',
  };
}

function setSessionCookie(res, token, opts) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    `Path=${opts.path}`,
    `Max-Age=${Math.floor(opts.maxAge / 1000)}`,
    'HttpOnly',
    `SameSite=${opts.sameSite}`,
  ];
  if (opts.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

// Mode info — UI calls this before showing login vs the normal app
router.get('/mode', (req, res) => {
  const mode = resolveMode();
  const payload = { mode, needs_setup: false };
  if (mode === 'local') {
    payload.needs_setup = !users.hasAnyUsers();
  }
  res.json(payload);
});

// Login (local mode only)
router.post('/login', async (req, res) => {
  if (resolveMode() !== 'local') {
    return res.status(400).json({ error: 'Login only applies when AUTH_MODE=local' });
  }
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const user = await users.authenticate(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const { token } = createSession(user.id);
  const opts = cookieOptions(req);
  setSessionCookie(res, token, opts);
  res.json({ user: users.sanitize(user) });
});

// Logout
router.post('/logout', (req, res) => {
  const { COOKIE_NAME: name } = require('../auth/sessions');
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  if (match) deleteSession(decodeURIComponent(match[1]));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// First-run: create the initial admin user (only when AUTH_MODE=local and no users exist)
router.post('/setup', async (req, res) => {
  if (resolveMode() !== 'local') {
    return res.status(400).json({ error: 'Setup only applies when AUTH_MODE=local' });
  }
  if (users.hasAnyUsers()) {
    return res.status(403).json({ error: 'Setup already completed — use the admin UI to create more users' });
  }
  const { username, password, display_name } = req.body || {};
  try {
    const user = await users.createUser({
      username,
      password,
      display_name,
      is_admin: true,
    });
    const { token } = createSession(user.id);
    setSessionCookie(res, token, cookieOptions(req));
    res.status(201).json({ user: users.sanitize(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Change own password
router.post('/change-password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (!req.user.user_id) return res.status(400).json({ error: 'Change-password only supported for local accounts' });

  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password required' });

  const user = users.findById(req.user.user_id);
  const ok = await require('../auth/passwords').verifyPassword(current_password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' });

  await users.updateUser(user.id, { password: new_password });
  res.json({ ok: true });
});

module.exports = router;
