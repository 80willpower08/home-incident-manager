const express = require('express');
const router = express.Router();
const users = require('../auth/users');
const { deleteAllUserSessions } = require('../auth/sessions');
const { requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../db');

router.use(requireAdmin);

router.get('/', (req, res) => {
  res.json({ users: users.listUsers() });
});

router.post('/', async (req, res) => {
  try {
    const user = await users.createUser({
      username: req.body.username,
      password: req.body.password,
      display_name: req.body.display_name,
      is_admin: req.body.is_admin,
      notify_target: req.body.notify_target,
    });
    logAudit(null, 'user_created', req.user.name, user.username);
    res.status(201).json({ user: users.sanitize(user) });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(400).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const user = await users.updateUser(Number(req.params.id), req.body);
    logAudit(null, 'user_updated', req.user.name, user.username);
    res.json({ user: users.sanitize(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const user = users.findById(Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.user_id) return res.status(400).json({ error: 'You cannot delete yourself' });
  // Also kill any active sessions
  deleteAllUserSessions(user.id);
  users.deleteUser(user.id);
  logAudit(null, 'user_deleted', req.user.name, user.username);
  res.status(204).send();
});

module.exports = router;
