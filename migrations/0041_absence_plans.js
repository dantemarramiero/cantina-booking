// Conteggio ferie: spettanze standard per contratto e saldi alla data (dal cedolino).
//
// Come negli altri software HR (Personio, Factorial): ogni dipendente ha una «politica» di spettanze che
// dipende dal contratto, con maturazione mensile e calcolo in proporzione da assunzione e cessazione; il
// saldo iniziale e i riallineamenti si fanno con una rettifica tracciata. In Italia il saldo ufficiale è
// quello del cedolino: il «saldo alla data» è il residuo che riporta il cedolino a fine mese.
//
// absence_plans: spettanze standard. Si applicano al dipendente secondo il contratto in vigore: CCNL
//   (riconosciuto dal testo: «agric…» → agricoltura, «commerc…»/«terziar…» → commercio) e tipo di contratto.
//   Vince la prima per priorità. Le spettanze della singola persona (absence_allowances) restano come eccezione.
//   Valori: ferie in millesimi di giorno, ROL ed ex festività in minuti (come i contatori).
//   Quelli iniziali vengono dai CCNL (agricoltura: 26 giorni lavorativi di ferie per OTI, impiegati e quadri;
//   commercio: 26 giorni, 72 h di ROL, 32 h di ex festività); ROL ed ex festività dell'agricoltura sono da
//   indicare. Tutto va verificato con il consulente del lavoro (People → Configurazione).
// absence_balance_anchors: residuo di un contatore a una data (di solito l'ultimo cedolino). Dal giorno dopo
//   il saldo prosegue con i ratei e le assenze successive.
const PLANS = [
  // [nome, ccnl, tipi di contratto (null = tutti), ferie gg, ROL h, ex festività h, priorità, nota]
  ['Agricoltura — operai a tempo indeterminato', 'agricoltura', ['OTI'], 26, 0, 0, 10, 'CCNL operai agricoli e florovivaisti. ROL ed ex festività da indicare con il consulente.'],
  ['Agricoltura — operai a tempo determinato e stagionali', 'agricoltura', ['OTD', 'stagionale'], 0, 0, 0, 20, 'Per gli OTD le ferie sono di norma comprese nella retribuzione (terzo elemento): da verificare.'],
  ['Agricoltura — impiegati e quadri', 'agricoltura', ['impiegato', 'quadro', 'dirigente', 'apprendista'], 26, 0, 0, 30, 'CCNL impiegati e quadri agricoli (quadri e 1ª categoria fino a 30 giorni con l\'anzianità).'],
  ['Commercio e terziario', 'commercio', null, 26, 72, 32, 40, 'ROL 72 h nelle aziende oltre 15 dipendenti (56 h fino a 15). Giorni riferiti alla settimana di 6 giorni: da verificare con l\'orario.'],
];
const hasSettings = db => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get();

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE absence_plans (
        id              INTEGER PRIMARY KEY,
        name            TEXT NOT NULL,
        ccnl            TEXT CHECK (ccnl IS NULL OR ccnl IN ('agricoltura', 'commercio')),
        contract_types  TEXT,            -- JSON dei tipi di contratto; vuoto = tutti
        ferie           INTEGER NOT NULL DEFAULT 0 CHECK (ferie >= 0),
        rol             INTEGER NOT NULL DEFAULT 0 CHECK (rol >= 0),
        ex_festivita    INTEGER NOT NULL DEFAULT 0 CHECK (ex_festivita >= 0),
        accrual         TEXT NOT NULL DEFAULT 'mensile' CHECK (accrual IN ('mensile', 'annuale')),
        priority        INTEGER NOT NULL DEFAULT 100,
        active          INTEGER NOT NULL DEFAULT 1,
        note            TEXT
      );
      CREATE TABLE absence_balance_anchors (
        id          INTEGER PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        counter     TEXT NOT NULL CHECK (counter IN ('ferie', 'rol', 'ex_festivita')),
        as_of       TEXT NOT NULL,
        amount      INTEGER NOT NULL,
        note        TEXT,
        created_at  TEXT NOT NULL,
        created_by  TEXT
      );
      CREATE INDEX idx_balance_anchors ON absence_balance_anchors(employee_id, counter, as_of);
    `);
    const ins = db.prepare('INSERT INTO absence_plans (name, ccnl, contract_types, ferie, rol, ex_festivita, accrual, priority, note) VALUES (?, ?, ?, ?, ?, ?, \'mensile\', ?, ?)');
    for (const [name, ccnl, types, ferie, rol, exf, prio, note] of PLANS) ins.run(name, ccnl, types ? JSON.stringify(types) : null, ferie * 1000, rol * 60, exf * 60, prio, note);
    // Da quando si contano i saldi con le spettanze standard: gli anni prima non generano riporti.
    if (hasSettings(db)) db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('absence_plans_since', ?)").run(new Date().toISOString().slice(0, 10));
  },
  down(db) {
    if (hasSettings(db)) db.prepare("DELETE FROM settings WHERE key = 'absence_plans_since'").run();
    db.exec('DROP TABLE absence_balance_anchors; DROP TABLE absence_plans;');
  },
};
