// Produzione, prerequisiti (decisioni DP4 e DP12):
//   - roles.capabilities: capacità dentro Produzione (enologo, cantiniere, capo squadra, agronomo,
//     responsabile qualità, sola lettura), controllate dal server per ogni azione;
//   - prd_config: soglie e limiti normativi configurabili, con il valore di partenza marcato «da validare»
//     finché l'enologo o il consulente non lo confermano. Nessun limite di legge sta nel codice.
// I valori numerici sono testo con il punto decimale; quelli strutturati sono JSON.
const SEED = [
  // [chiave, nome, tipo, valore di partenza, unità, regole, domanda del questionario, fonte]
  ['fermentation_window', 'Finestra in cui sono ammesse le fermentazioni', 'json', '{"from":"07-15","to":"12-31"}', 'giorno-mese', 'PRD-H05', 'SOG-01', 'Normativa nazionale; deroghe da disciplinare'],
  ['acidification_max_g_l', 'Acidificazione registrabile senza dichiarazione preventiva', 'number', '4', 'g/l in acido tartarico', 'PRD-C10', 'SOG-02', 'Normativa sulle pratiche enologiche'],
  ['claim_min_share_pct', 'Quota minima per indicare annata o vitigno', 'number', '85', '%', 'PRD-C06', 'SOG-03', "Normativa sull'etichettatura"],
  ['fermentation_stall_hours', 'Arresto di fermentazione: ore senza calo di densità', 'number', '48', 'ore', 'PRD-C12', 'SOG-04', 'Pratica di cantina'],
  ['fermentation_stall_min_drop', 'Arresto di fermentazione: calo minimo di densità', 'number', null, 'unità di densità', 'PRD-C12', 'SOG-04', "Da definire con l'enologo"],
  ['phyto_late_registration_days', 'Trattamento registrato in ritardo dopo', 'number', '30', 'giorni', 'PRD-V08', 'SOG-05', 'Normativa sul registro dei trattamenti'],
  ['lees_min_months', 'Tempo minimo sui lieviti (se il disciplinare non dice di più)', 'number', '9', 'mesi', 'PRD-M02', 'SOG-06', 'Disciplinari e normativa UE'],
  ['transfer_tolerance_pct', 'Tolleranza di un travaso senza calo dichiarato', 'number', '0.5', '% del volume', 'PRD-C04', 'SOG-07', 'Pratica di cantina'],
  ['so2_total_limits', 'SO2 totale: soglia di attenzione e limite per categoria', 'json', null, 'mg/l', 'PRD-C14', 'SOG-08', 'Normativa UE sulle pratiche enologiche'],
  ['volatile_acidity_limits', 'Acidità volatile: soglia di attenzione e limite', 'json', null, 'g/l', 'PRD-C14', 'SOG-09', 'Normativa UE sulle pratiche enologiche'],
  ['dosage_categories', 'Categorie di dosaggio degli spumanti', 'json', null, 'g/l', 'PRD-M03', 'SOG-10', "Normativa UE sull'etichettatura degli spumanti"],
  ['sparkling_min_pressure_bar', 'Pressione minima per categoria di spumante', 'json', null, 'bar', 'PRD-M05', 'SOG-11', 'Normativa UE'],
  ['generic_max_yield_kg_ha', 'Resa massima di uva per i vini generici', 'number', '30000', 'kg/ha', 'PRD-H03', 'SOG-12', 'Normativa nazionale: fino a 40.000 kg/ha nei comuni indicati dalla Regione'],
  ['prebottling_analysis_max_days', "Analisi prima dell'imbottigliamento: età massima", 'number', '30', 'giorni', 'PRD-P02', 'SOG-14', 'Pratica di cantina'],
  ['prebottling_analysis_parameters', "Analisi prima dell'imbottigliamento: parametri richiesti", 'json', null, 'codici dei parametri', 'PRD-P02', 'SOG-14', 'Pratica di cantina'],
  ['topping_frequency_days', 'Frequenza delle colmature', 'number', '14', 'giorni', 'PRD-B01', 'SOG-15', 'Pratica di cantina'],
  ['empty_barrel_sulphur_days', 'Barrique vuota senza solforazione: allarme dopo', 'number', '21', 'giorni', 'PRD-B05', 'SOG-16', 'Pratica di cantina'],
  ['barrel_useful_life_uses', 'Vita utile di una barrique', 'number', '5', 'passaggi', 'PRD-B04', 'SOG-17', 'Pratica di cantina'],
  ['confined_space_min_people', 'Spazi confinati: persone abilitate presenti', 'number', '2', 'persone', 'PRD-C17', 'SOG-18', 'DPR 177/2011, documento di valutazione dei rischi'],
  ['sian_deadlines', 'Scadenze del registro SIAN', 'json', '{"ordinario":{"entrate_giorni_lavorativi":1,"uscite_giorni_lavorativi":3},"deroga_sotto_1000hl":{"giorni":30}}', 'giorni', 'PRD-S02', 'SOG-19', 'DM 293/2015'],
  ['sian_alert_working_days', 'Avviso prima della scadenza SIAN', 'number', '1', 'giorni lavorativi', 'PRD-S02', 'SOG-20', '—'],
  ['equipment_inspection_valid_months', 'Validità del controllo funzionale delle irroratrici', 'number', '36', 'mesi', 'PRD-V09', null, 'D.Lgs. 150/2012 e Piano d\'azione nazionale: periodicità da verificare'],
];

module.exports = {
  SEED,
  up(db) {
    db.exec(`
      ALTER TABLE roles ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE prd_config (
        key           TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('number', 'json', 'text')),
        value         TEXT,
        default_value TEXT,
        unit          TEXT,
        rule_ids      TEXT,
        question_id   TEXT,
        source_note   TEXT,
        to_validate   INTEGER NOT NULL DEFAULT 1,
        validated_by  TEXT,
        validated_at  TEXT,
        note          TEXT,
        created_at    TEXT NOT NULL,
        created_by    TEXT,
        updated_at    TEXT NOT NULL,
        updated_by    TEXT
      );
    `);
    const now = new Date().toISOString();
    const ins = db.prepare(`INSERT INTO prd_config (key, name, kind, value, default_value, unit, rule_ids, question_id, source_note, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Migrazione', ?, 'Migrazione')`);
    for (const [key, name, kind, value, unit, rules, question, source] of SEED) ins.run(key, name, kind, value, value, unit, rules, question, source, now, now);
  },
  down(db) {
    db.exec(`
      DROP TABLE prd_config;
      ALTER TABLE roles DROP COLUMN capabilities;
    `);
  },
};
