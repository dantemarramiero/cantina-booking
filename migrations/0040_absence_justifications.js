// Giustificativi delle assenze (handoff MyWinery «Giustificativi»).
//
// Il «motivo» del design è il tipo di assenza: non c'è un secondo catalogo. Ai tipi si aggiungono la
// categoria (ferie, permesso, malattia, congedo: i quattro pulsanti della richiesta) e cosa serve per
// giustificarli: documento richiesto, entro quanti giorni dalla fine dell'assenza, se basta il numero di
// protocollo (malattia: il certificato lo legge l'azienda sul portale INPS), se si accetta
// l'autocertificazione (DPR 445/2000) e un suggerimento. Tutto modificabile da People → Configurazione:
// tempi e documenti vanno verificati con il CCNL e il consulente del lavoro.
//
// I file stanno nell'archivio HR cifrato (hr_documents), con due tipi nuovi: «giustificativo» (livello
// personale) e «giustificativo_sanitario» (livello sanitario: il responsabile ne vede solo lo stato).
// Per il Garante (linee guida sui lavoratori e provvedimento del 30/01/2025) si raccoglie solo ciò che
// giustifica l'assenza, senza diagnosi: lo dicono i suggerimenti e l'informativa nella schermata.
//
// absence_justifications: una per assenza, con lo stato della verifica dell'ufficio personale
//   (todo = da caricare, review = in verifica, ok = accettato, ko = da ricaricare, con il motivo).
// absence_justification_files: i documenti dell'archivio collegati al giustificativo.
// Si chiedono per le assenze inserite dal giorno della migrazione (impostazione justifications_since): quelle di prima
// erano già giustificate fuori dal software e non devono diventare di colpo «scadute».
const CATEGORY = {
  ferie: 'ferie', rol: 'permesso', ex_festivita: 'permesso', legge_104: 'permesso', permesso_sindacale: 'permesso', non_retribuito: 'permesso', donazione_sangue: 'permesso',
  malattia: 'malattia', infortunio: 'malattia', congedo_parentale: 'congedo', maternita_paternita: 'congedo', lutto: 'congedo', matrimonio: 'congedo',
};
// [codice, documento, suggerimento, giorni, modalità, autocertificazione]
const DOCS = [
  ['malattia', 'Numero di protocollo del certificato (PUC)', 'Il medico lo invia all\'INPS e ti dà il numero di protocollo: basta quello, senza diagnosi.', 2, 'protocol', 0],
  ['infortunio', 'Primo certificato medico INAIL', 'Avvisa subito il responsabile, poi carica il certificato entro il giorno successivo.', 1, 'file', 0],
  ['legge_104', 'Verbale di riconoscimento L. 104 in corso di validità', 'Basta caricarlo una volta l\'anno o quando viene rinnovato.', 10, 'file', 0],
  ['donazione_sangue', 'Certificato del centro trasfusionale', null, 5, 'file', 0],
  ['matrimonio', 'Certificato di matrimonio', null, 30, 'file', 1],
  ['lutto', 'Certificato di morte o certificazione della grave infermità del familiare', null, 5, 'file', 1],
  ['maternita_paternita', 'Certificato di nascita', null, 10, 'file', 1],
];
// Tipi del catalogo che mancavano. [codice, nome, flusso, unità, retribuita, salute, mezza giornata, a ore, categoria, documento, suggerimento, giorni, autocert.]
const NEW_TYPES = [
  ['visita_medica', 'Visita medica o esami', 'approvazione', 'ore', 1, 1, 1, 1, 'permesso', 'Attestazione della struttura sanitaria con data e orario della prestazione', 'Va bene anche la ricevuta del ticket se riporta nome, data e ora. Non serve la diagnosi.', 5, 0],
  ['diritto_studio', 'Esami universitari / diritto allo studio', 'approvazione', 'giorni', 1, 0, 1, 1, 'permesso', 'Attestato di sostenimento dell\'esame', null, 10, 0],
  ['testimonianza', 'Testimonianza o udienza', 'approvazione', 'giorni', 1, 0, 1, 1, 'permesso', 'Convocazione e attestato di presenza rilasciato dal tribunale', null, 5, 0],
  ['malattia_figlio', 'Malattia del figlio', 'comunicazione', 'giorni', 0, 1, 0, 0, 'malattia', 'Certificato del pediatra o del medico curante', 'Non serve la diagnosi: basta l\'attestazione della malattia e dei giorni.', 5, 0],
  ['seggio', 'Seggio elettorale', 'comunicazione', 'giorni', 1, 0, 0, 0, 'congedo', 'Attestato di presenza firmato dal presidente di seggio', null, 5, 0],
];

const hasSettings = db => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get();

module.exports = {
  up(db) {
    db.exec(`
      ALTER TABLE absence_types ADD COLUMN category TEXT NOT NULL DEFAULT 'permesso' CHECK (category IN ('ferie', 'permesso', 'malattia', 'congedo'));
      ALTER TABLE absence_types ADD COLUMN doc_required INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE absence_types ADD COLUMN doc_label TEXT;
      ALTER TABLE absence_types ADD COLUMN doc_hint TEXT;
      ALTER TABLE absence_types ADD COLUMN doc_deadline_days INTEGER;
      ALTER TABLE absence_types ADD COLUMN doc_mode TEXT NOT NULL DEFAULT 'file' CHECK (doc_mode IN ('file', 'protocol'));
      ALTER TABLE absence_types ADD COLUMN doc_self_cert INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE absence_justifications (
        absence_id    INTEGER PRIMARY KEY REFERENCES absences(id) ON DELETE CASCADE,
        status        TEXT NOT NULL CHECK (status IN ('todo', 'review', 'ok', 'ko')),
        protocol      TEXT,
        self_cert     INTEGER NOT NULL DEFAULT 0,
        employee_note TEXT,
        hr_note       TEXT,
        submitted_at  TEXT,
        submitted_by  TEXT,
        reviewed_at   TEXT,
        reviewed_by   TEXT,
        updated_at    TEXT NOT NULL
      );
      CREATE TABLE absence_justification_files (
        absence_id  INTEGER NOT NULL REFERENCES absence_justifications(absence_id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES hr_documents(id) ON DELETE CASCADE,
        PRIMARY KEY (absence_id, document_id)
      );
    `);
    const setCat = db.prepare('UPDATE absence_types SET category = ? WHERE code = ?');
    for (const [code, cat] of Object.entries(CATEGORY)) setCat.run(cat, code);
    const setDoc = db.prepare('UPDATE absence_types SET doc_required = 1, doc_label = ?, doc_hint = ?, doc_deadline_days = ?, doc_mode = ?, doc_self_cert = ? WHERE code = ?');
    for (const [code, label, hint, days, mode, self] of DOCS) setDoc.run(label, hint, days, mode, self, code);
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM absence_types').get().n;
    const ins = db.prepare(`INSERT OR IGNORE INTO absence_types (code, name, flow, counter, unit, paid, requires_protocol, health, allow_half_day, allow_hours, active, sort_order,
      category, doc_required, doc_label, doc_hint, doc_deadline_days, doc_mode, doc_self_cert) VALUES (?, ?, ?, NULL, ?, ?, 0, ?, ?, ?, 1, ?, ?, 1, ?, ?, ?, 'file', ?)`);
    NEW_TYPES.forEach(([code, name, flow, unit, paid, health, half, hours, cat, label, hint, days, self], i) => ins.run(code, name, flow, unit, paid, health, half, hours, order + i + 1, cat, label, hint, days, self));
    const docType = db.prepare('INSERT OR IGNORE INTO hr_document_types (code, name, level, retention_years, employee_visible) VALUES (?, ?, ?, ?, 1)');
    docType.run('giustificativo', 'Giustificativo di assenza', 'personale', 5);
    docType.run('giustificativo_sanitario', 'Giustificativo di assenza (sanitario)', 'sanitario', 5);
    // settings la crea il server all'avvio: su un database nuovo non c'è ancora (e non ci sono assenze di prima).
    if (hasSettings(db)) db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('justifications_since', ?)").run(new Date().toISOString());
  },
  down(db) {
    if (hasSettings(db)) db.prepare("DELETE FROM settings WHERE key = 'justifications_since'").run();
    db.exec(`
      DROP TABLE absence_justification_files;
      DROP TABLE absence_justifications;
      DELETE FROM hr_document_types WHERE code IN ('giustificativo', 'giustificativo_sanitario') AND NOT EXISTS (SELECT 1 FROM hr_documents d WHERE d.type_code = hr_document_types.code);
      DELETE FROM absence_types WHERE code IN ('visita_medica', 'diritto_studio', 'testimonianza', 'malattia_figlio', 'seggio') AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.absence_type_id = absence_types.id);
      ALTER TABLE absence_types DROP COLUMN doc_self_cert;
      ALTER TABLE absence_types DROP COLUMN doc_mode;
      ALTER TABLE absence_types DROP COLUMN doc_deadline_days;
      ALTER TABLE absence_types DROP COLUMN doc_hint;
      ALTER TABLE absence_types DROP COLUMN doc_label;
      ALTER TABLE absence_types DROP COLUMN doc_required;
      ALTER TABLE absence_types DROP COLUMN category;
    `);
  },
};
