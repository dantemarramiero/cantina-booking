// Notifiche nel portale. user_id NULL = gli amministratori che entrano con la chiave master.
// dedupe_key evita di mandare due volte lo stesso avviso alla stessa persona (es. una scadenza
// notificata da un job che gira ogni ora).
function createNotifications(db) {
  const recipientOf = req => (req?.portalUser ? req.portalUser.id : null);

  function notify({ userId = null, kind, title, body = null, link = null, dedupeKey = null }) {
    if (dedupeKey) {
      const exists = db.prepare('SELECT id FROM notifications WHERE COALESCE(user_id, 0) = ? AND dedupe_key = ?').get(userId ?? 0, dedupeKey);
      if (exists) return null;
    }
    return Number(db.prepare(`INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, kind, title, body, link, dedupeKey, new Date().toISOString()).lastInsertRowid);
  }

  function listFor(req, { unreadOnly = false, limit = 50 } = {}) {
    const uid = recipientOf(req);
    const rows = db.prepare(`SELECT * FROM notifications WHERE ${uid == null ? 'user_id IS NULL' : 'user_id = ?'}
      ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT ?`).all(...(uid == null ? [] : [uid]), limit);
    const unread = db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE ${uid == null ? 'user_id IS NULL' : 'user_id = ?'} AND read_at IS NULL`)
      .get(...(uid == null ? [] : [uid])).c;
    return { items: rows, unread };
  }

  function markRead(req, ids = null) {
    const uid = recipientOf(req);
    const owner = uid == null ? 'user_id IS NULL' : 'user_id = ?';
    const ownerParams = uid == null ? [] : [uid];
    const at = new Date().toISOString();
    if (Array.isArray(ids) && ids.length) {
      const st = db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL AND ${owner}`);
      return ids.reduce((n, id) => n + st.run(at, id, ...ownerParams).changes, 0);
    }
    return db.prepare(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND ${owner}`).run(at, ...ownerParams).changes;
  }

  return { notify, listFor, markRead };
}

module.exports = { createNotifications };
