// Avvia l'app vera su un database SQLite temporaneo (ogni file di test gira nel suo processo,
// quindi ognuno ha il suo database) e restituisce un client già autenticato con la chiave master.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MASTER_KEY = 'test-master-key';

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cantina-test-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.RAILWAY_VOLUME_MOUNT_PATH = dir;
  process.env.ADMIN_PASSWORD = MASTER_KEY;
  process.env.MIGRATION_BACKUPS = 'off';
  process.env.HR_FILES_KEY = require('crypto').randomBytes(32).toString('hex');
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.GMAIL_USER;
  delete process.env.RESEND_API_KEY;

  const log = console.log;
  console.log = () => {}; // i messaggi di avvio non servono nei test
  const mod = require('../server.js');
  console.log = log;

  const server = await new Promise(resolve => { const s = mod.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, p, { body, token, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (token) h['x-admin-key'] = token;
    const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  const loginMaster = async () => (await request('POST', '/api/admin/session', { body: { key: MASTER_KEY } })).data.key;
  const token = await loginMaster();
  const api = (method, p, body) => request(method, p, { body, token });

  return {
    ...mod, base, dir, request, api, token, loginMaster, MASTER_KEY,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

module.exports = { startApp, MASTER_KEY };
