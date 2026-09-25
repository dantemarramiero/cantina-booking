// Eventi di dominio con outbox.
//
// Chi genera un evento lo scrive con emit() nella stessa transazione del documento che lo
// origina: se la transazione fallisce, l'evento sparisce con lei. I consumer registrati con on()
// lo elaborano dopo, in dispatch(): ogni coppia (consumer, evento) gira nella sua transazione e
// viene segnata in event_consumptions (vincolo unico), quindi un consumer non elabora mai due
// volte lo stesso evento. Se un consumer fallisce si annulla solo il suo lavoro, l'errore finisce
// in event_failures e si riprova al giro successivo, fino a MAX_ATTEMPTS.
const MAX_ATTEMPTS = 10;
const now = () => new Date().toISOString();

function createEventBus(db, { log = console.error } = {}) {
  const consumers = new Map(); // type -> [{ name, handler }]
  let depth = 0;

  // Transazione annidabile: il livello esterno fa BEGIN/COMMIT, quelli interni usano SAVEPOINT.
  function transaction(fn) {
    const sp = `sp_${depth}`;
    depth++;
    db.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${sp}`);
      return result;
    } catch (e) {
      db.exec(`ROLLBACK TO ${sp}`);
      db.exec(`RELEASE ${sp}`);
      throw e;
    } finally {
      depth--;
    }
  }

  function emit(type, { sourceTable = null, sourceId = null, payload = {} } = {}) {
    return Number(db.prepare('INSERT INTO domain_events (type, source_table, source_id, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(type, sourceTable, sourceId, JSON.stringify(payload), now()).lastInsertRowid);
  }

  function on(type, name, handler) {
    const list = consumers.get(type) || [];
    if ([...consumers.values()].flat().some(c => c.name === name)) throw new Error(`Consumer già registrato: ${name}`);
    list.push({ name, handler });
    consumers.set(type, list);
  }

  function dispatchOnce(failedNow) {
    let processed = 0;
    const pendingStmt = db.prepare(`
      SELECT e.* FROM domain_events e
      WHERE e.type = ?
        AND NOT EXISTS (SELECT 1 FROM event_consumptions ec WHERE ec.consumer = ? AND ec.event_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM event_failures f WHERE f.consumer = ? AND f.event_id = e.id AND f.attempts >= ?)
      ORDER BY e.id
    `);
    for (const [type, list] of consumers) {
      for (const c of list) {
        for (const row of pendingStmt.all(type, c.name, c.name, MAX_ATTEMPTS)) {
          if (failedNow.has(`${c.name}:${row.id}`)) continue;
          const event = { ...row, payload: JSON.parse(row.payload || '{}') };
          try {
            transaction(() => {
              c.handler(event, { emit, transaction });
              db.prepare('INSERT INTO event_consumptions (consumer, event_id, processed_at) VALUES (?, ?, ?)').run(c.name, row.id, now());
              db.prepare('DELETE FROM event_failures WHERE consumer = ? AND event_id = ?').run(c.name, row.id);
            });
            processed++;
          } catch (err) {
            db.prepare(`
              INSERT INTO event_failures (consumer, event_id, attempts, last_error, last_attempt_at) VALUES (?, ?, 1, ?, ?)
              ON CONFLICT (consumer, event_id) DO UPDATE SET attempts = attempts + 1, last_error = excluded.last_error, last_attempt_at = excluded.last_attempt_at
            `).run(c.name, row.id, String(err.message).slice(0, 1000), now());
            failedNow.add(`${c.name}:${row.id}`);
            log(`Evento ${row.type}#${row.id} non elaborato da ${c.name}: ${err.message}`);
          }
        }
      }
    }
    return processed;
  }

  // Ripete finché ci sono eventi da elaborare (un consumer può emettere nuovi eventi). Ciò che
  // fallisce in questa chiamata si riprova solo alla prossima, non subito.
  function dispatch({ maxRounds = 5 } = {}) {
    if (depth > 0) throw new Error('dispatch() va chiamato dopo il commit, non dentro una transazione.');
    const failedNow = new Set();
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      const n = dispatchOnce(failedNow);
      total += n;
      if (!n) break;
    }
    return total;
  }

  // Vero dentro una transazione aperta con transaction() (lì dispatch() non si può chiamare).
  const inTransaction = () => depth > 0;

  return { transaction, emit, on, dispatch, inTransaction };
}

module.exports = { createEventBus, MAX_ATTEMPTS };
