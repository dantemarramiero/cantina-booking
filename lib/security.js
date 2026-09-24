// Sicurezza degli accessi al portale interno.
//
// - Sessioni: al login (chiave master o utente e password) si crea una sessione con un token
//   casuale; nel database si salva solo l'hash del token. Scade dopo SESSION_IDLE_MS senza
//   attività e comunque dopo SESSION_MAX_MS.
// - Link firmati: per scaricare file o export senza mettere la chiave nell'URL, il server firma
//   il percorso con HMAC legandolo alla sessione e a una scadenza.
// - Permessi: ogni gruppo di API /api/admin/<gruppo> dice quali workspace possono leggere (GET) e
//   quali scrivere. Il controllo è sul server, non solo nell'interfaccia.
const crypto = require('crypto');

const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createSessions(db) {
  function create({ userId = null, ip = null, userAgent = null } = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    db.prepare(`INSERT INTO portal_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(hashToken(token), userId, now.toISOString(), now.toISOString(), new Date(now.getTime() + SESSION_MAX_MS).toISOString(), ip, userAgent ? String(userAgent).slice(0, 300) : null);
    return token;
  }
  function validate(s) {
    if (!s) return null;
    const now = Date.now();
    if (Date.parse(s.expires_at) <= now || Date.parse(s.last_seen_at) + SESSION_IDLE_MS <= now) {
      db.prepare('DELETE FROM portal_sessions WHERE id = ?').run(s.id);
      return null;
    }
    if (now - Date.parse(s.last_seen_at) > TOUCH_EVERY_MS) {
      db.prepare('UPDATE portal_sessions SET last_seen_at = ? WHERE id = ?').run(new Date(now).toISOString(), s.id);
    }
    return s;
  }
  const resolve = token => (token ? validate(db.prepare('SELECT * FROM portal_sessions WHERE token_hash = ?').get(hashToken(token))) : null);
  const byId = id => validate(db.prepare('SELECT * FROM portal_sessions WHERE id = ?').get(id));
  const revoke = token => db.prepare('DELETE FROM portal_sessions WHERE token_hash = ?').run(hashToken(token)).changes;
  // exceptSessionId: la sessione da tenere (es. chi ha appena cambiato la propria password).
  const revokeUser = (userId, exceptSessionId = null) =>
    db.prepare('DELETE FROM portal_sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId ?? 0).changes;
  function cleanup(nowMs = Date.now()) {
    return db.prepare('DELETE FROM portal_sessions WHERE expires_at <= ? OR last_seen_at <= ?')
      .run(new Date(nowMs).toISOString(), new Date(nowMs - SESSION_IDLE_MS).toISOString()).changes;
  }
  return { create, resolve, byId, revoke, revokeUser, cleanup };
}

function createSigner(secret) {
  const sign = (pathname, sid, exp) => crypto.createHmac('sha256', secret).update(`${pathname}|${sid}|${exp}`).digest('base64url');
  function signUrl(pathname, sessionId, ttlSeconds = 600) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${pathname}${pathname.includes('?') ? '&' : '?'}sid=${sessionId}&exp=${exp}&sig=${sign(pathname, sessionId, exp)}`;
  }
  function verify(pathname, { sid, exp, sig } = {}) {
    if (!sid || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
    return safeEqual(sign(pathname, sid, exp), sig);
  }
  return { signUrl, verify };
}

// Chi può usare quali API. read = GET, write = tutto il resto. ANY = chiunque abbia fatto l'accesso.
// Le letture condivise sono gli elenchi che un modulo consulta pur appartenendo a un altro
// (es. il Commerciale sceglie i clienti del CRM negli ordini).
const ANY = '*';
const only = (...ws) => ({ read: ws, write: ws });
const API_WORKSPACES = {
  // Sempre disponibili a chi ha fatto l'accesso
  me: { read: ANY, write: ANY },
  'my-profile': { read: ANY, write: ANY },
  logout: { read: ANY, write: ANY },
  'signed-url': { read: ANY, write: ANY },
  notifications: { read: ANY, write: ANY },
  home: { read: ANY, write: ANY },
  // Impostazioni
  settings: { read: ANY, write: ['impostazioni'] },
  'dashboard-widgets': { read: ANY, write: ['impostazioni'] },
  'option-lists': { read: ANY, write: ['impostazioni'] },
  'portal-users': only('impostazioni'),
  roles: only('impostazioni'),
  'wine-club': only('impostazioni'),
  'audit-log': only('impostazioni'),
  // Enoturismo
  bookings: only('enoturismo'),
  experiences: only('enoturismo'),
  slots: only('enoturismo'),
  'discount-codes': only('enoturismo'),
  reviews: only('enoturismo'),
  newsletter: only('enoturismo'),
  operators: only('enoturismo'),
  'venue-events': only('enoturismo'),
  'shop-sales': only('enoturismo'),
  'pickup-orders': only('enoturismo'),
  export: only('enoturismo'),
  stats: only('enoturismo'),
  'sync-payments': only('enoturismo'),
  // Commerciale
  orders: { read: ['commerciale', 'magazzino', 'produzione', 'crm'], write: ['commerciale', 'magazzino'] },
  products: { read: ['commerciale', 'magazzino', 'produzione', 'enoturismo', 'crm'], write: ['commerciale'] },
  'price-lists': { read: ['commerciale', 'crm', 'enoturismo'], write: ['commerciale'] },
  catalogs: only('commerciale'),
  news: only('commerciale'),
  fairs: { read: ['commerciale', 'crm'], write: ['commerciale'] },
  'sales-targets': only('commerciale'),
  'sales-target-areas': only('commerciale', 'impostazioni'),
  commercial: only('commerciale'),
  // Produzione e Magazzino
  production: only('produzione'),
  produzione: only('produzione'),
  warehouse: only('magazzino'),
  magazzino: only('magazzino'),
  // CRM
  customers: { read: ['crm', 'commerciale', 'magazzino'], write: ['crm', 'commerciale'] },
  agents: { read: ['crm', 'commerciale'], write: ['crm'] },
  importers: { read: ['crm', 'commerciale'], write: ['crm'] },
  suppliers: { read: ['crm', 'magazzino'], write: ['crm'] },
  people: only('crm'),
  crm: only('crm', 'commerciale'),
};

function apiGroup(pathname) {
  const m = String(pathname).match(/^\/api\/admin\/([a-z0-9-]+)/);
  return m ? m[1] : null;
}

// permitted: array di workspace del ruolo, oppure null = accesso completo (chiave master o utente senza ruolo).
function canAccess(permitted, method, pathname) {
  if (permitted === null) return true;
  const rule = API_WORKSPACES[apiGroup(pathname)];
  if (!rule) return false;
  const need = method === 'GET' || method === 'HEAD' ? rule.read : rule.write;
  return need === ANY || need.some(ws => permitted.includes(ws));
}

// Limita i tentativi di login sbagliati: dopo MAX_FAILURES in WINDOW_MS dallo stesso IP si blocca
// per il resto della finestra.
function createLoginThrottle({ maxFailures = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map(); // ip -> [timestamps]
  const recent = ip => (failures.get(ip) || []).filter(t => Date.now() - t < windowMs);
  return {
    blocked: ip => recent(ip).length >= maxFailures,
    fail: ip => failures.set(ip, [...recent(ip), Date.now()]),
    reset: ip => failures.delete(ip),
  };
}

module.exports = {
  createSessions, createSigner, createLoginThrottle, canAccess, apiGroup, safeEqual, hashToken,
  API_WORKSPACES, SESSION_IDLE_MS, SESSION_MAX_MS,
};
