import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { basicAuth } from '../src/api/middleware/auth.js';

const serve = (auth) => {
  const app = express();
  app.get('/open', (req, res) => res.json({ ok: true }));
  app.use(basicAuth(auth));
  app.get('/private', (req, res) => res.json({ ok: true }));
  return app.listen(0);
};
const header = (user, pass) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` });

test('password protection: on when APP_PASSWORD is set, off when it is empty', async (t) => {
  const locked = serve({ username: 'admin', password: 's3cret:with:colons' });
  const open = serve({ username: 'admin', password: '' });
  t.after(() => { locked.close(); open.close(); });
  const get = (server, route, headers) => fetch(`http://127.0.0.1:${server.address().port}${route}`, { headers });

  assert.equal((await get(open, '/private')).status, 200);
  assert.equal((await get(locked, '/open')).status, 200, 'routes before the middleware stay open');

  const denied = await get(locked, '/private');
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('www-authenticate'), /^Basic/);
  assert.equal((await get(locked, '/private', header('admin', 'wrong'))).status, 401);
  assert.equal((await get(locked, '/private', header('other', 's3cret:with:colons'))).status, 401);
  assert.equal((await get(locked, '/private', { Authorization: 'Bearer x' })).status, 401);
  assert.equal((await get(locked, '/private', header('admin', 's3cret:with:colons'))).status, 200);
});
