// Registro attività: chi ha fatto cosa, quando, e com'era il dato prima e dopo.
// L'autore è salvato anche come testo (actor) così resta leggibile se l'utente viene eliminato.
function createAudit(db) {
  function audit(req, action, { entity = null, entityId = null, before = null, after = null, actor = null } = {}) {
    const user = req?.portalUser || null;
    db.prepare(`INSERT INTO audit_log (at, user_id, actor, action, entity, entity_id, before_json, after_json, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        new Date().toISOString(), user ? user.id : null,
        actor || (user ? user.name : req?.isMasterKey ? 'Chiave master' : 'Sistema'),
        action, entity, entityId == null ? null : String(entityId),
        before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
        req?.ip || null,
      );
  }
  function list({ entity = null, entityId = null, limit = 200 } = {}) {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];
    if (entity) { sql += ' AND entity = ?'; params.push(entity); }
    if (entityId != null) { sql += ' AND entity_id = ?'; params.push(String(entityId)); }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(Math.min(Math.max(parseInt(limit) || 200, 1), 1000));
    return db.prepare(sql).all(...params).map(r => ({
      ...r, before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null,
    }));
  }
  return { audit, list };
}

module.exports = { createAudit };
