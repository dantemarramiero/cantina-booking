// Testi delle schermate di Produzione (decisione DP10): tutti qui, pronti per aggiungere l'inglese.
// Le etichette dei valori ammessi (tipi di vaso, stati, capacità…) arrivano dal server con /prd/catalog.
const PRD_TXT = {
  it: {
    title: {
      vigneti: 'Vigneti', parcelle: 'Parcelle', catasto: 'Particelle catastali', attrezzature: 'Attrezzature', fitofarmaci: 'Fitofarmaci',
      vasi: 'Vasi e barrique', luoghi: 'Luoghi di cantina', protocolli: 'Protocolli di vinificazione',
      vitigni: 'Vitigni', denominazioni: 'Denominazioni e disciplinari', parametri: 'Parametri di analisi', stabilimenti: 'Stabilimenti',
      campagne: 'Campagne vitivinicole', sian: 'Mappa delle operazioni SIAN', soglie: 'Soglie da validare',
    },
    intro: {
      vigneti: 'I corpi aziendali. Il biologico del vigneto vale per le sue parcelle, se la parcella non dice altro.',
      parcelle: 'L\'unità di gestione in vigneto: ogni intervento e ogni conferimento parte da qui. La superficie vitata è la somma delle particelle collegate.',
      catasto: 'Le particelle con la superficie catastale. Le superfici vitate delle parcelle su una particella non possono superarla.',
      attrezzature: 'Mezzi e attrezzi. Per le irroratrici conta la data dell\'ultimo controllo funzionale.',
      fitofarmaci: 'Prodotti con numero di registrazione, dose massima, carenza e rientro: sono i controlli dei trattamenti.',
      vasi: 'Vasche, tini, barrique e cataste. Il codice QR apre la scheda del vaso dal telefono. Lo stato «pieno» lo scrive il giornale di cantina.',
      luoghi: 'Tinaia, bottaia, cantina spumanti…: dove stanno i vasi.',
      protocolli: 'Modelli di lavorazione modificabili. Il lotto mostrerà il passo successivo atteso.',
      vitigni: 'Vitigni con il colore della bacca e il codice SIAN.',
      denominazioni: 'DO e IG con le regole del disciplinare. Una regola scaduta non vale per le operazioni successive ma resta per lo storico.',
      parametri: 'Cosa si misura nelle analisi, con l\'unità e i decimali.',
      stabilimenti: 'Un registro telematico per stabilimento (codice ICQRF). Il regime decide le scadenze.',
      campagne: 'Dal 1° agosto al 31 luglio, in ora italiana. La chiusura arriverà con la Fase 7.',
      sian: 'Tipo di operazione → codice del registro telematico. Va popolata dai documenti ufficiali e validata dal consulente.',
      soglie: 'Valori di partenza dei controlli: vanno rivisti dall\'enologo o dal consulente. Un valore cambiato torna da validare.',
    },
    btn: {
      nuovo: 'Nuovo', salva: 'Salva', archivia: 'Archivia', riattiva: 'Riattiva', archiviati: 'Mostra archiviati', cerca: 'Cerca',
      stampaQr: 'Stampa QR', stampaSel: 'Stampa i QR selezionati', dismetti: 'Dismetti', riattivaVaso: 'Riattiva', duplica: 'Duplica',
      aggiungiParticella: '+ Particella', aggiungiPasso: '+ Passo', convalida: 'Convalida', modifica: 'Modifica', regole: 'Regole',
      aggiungiRegola: '+ Regola', su: '↑', giu: '↓', togli: 'Togli', apri: 'Apri', passi: 'Passi',
    },
    f: {
      name: 'Nome', code: 'Codice', notes: 'Note', locality: 'Località', municipality: 'Comune', province: 'Provincia',
      organic_status: 'Biologico', certification_body: 'Ente certificatore', public_description: 'Descrizione per le visite',
      sheet: 'Foglio', number: 'Particella', subparcel: 'Subalterno', area_m2: 'Superficie catastale', used_m2: 'Già vitata',
      vineyard_id: 'Vigneto', variety_id: 'Vitigno', clone: 'Clone', rootstock: 'Portinnesto', planting_year: "Anno d'impianto",
      row_spacing_cm: 'Distanza tra i filari (cm)', vine_spacing_cm: 'Distanza sulla fila (cm)', vines_count: 'Numero di ceppi',
      training_system: 'Forma di allevamento', exposure: 'Esposizione', altitude_m: 'Altitudine (m)', active: 'Attiva',
      vine_area_m2: 'Superficie vitata', cadastral_links: 'Particelle e unità vitate', appellation_ids: 'Idonea alle denominazioni',
      schedario_unit_code: 'Unità vitata', type: 'Tipo', plate_serial: 'Targa o matricola', last_inspection_date: 'Ultimo controllo funzionale',
      inspection_due: 'Scadenza del controllo', commercial_name: 'Nome commerciale', registration_number: 'N. di registrazione',
      active_substances: 'Sostanze attive', organic_allowed: 'Ammesso in biologico', max_dose_per_ha_e4: 'Dose massima per ettaro',
      dose_unit: 'Unità della dose', preharvest_interval_days: 'Carenza (giorni)', reentry_hours: 'Rientro (ore)',
      max_applications_per_year: 'Applicazioni massime per anno', label_url: 'Etichetta (link)',
      material: 'Materiale', capacity_ml: 'Capacità', location_id: 'Luogo', status: 'Stato', has_temperature_control: 'Termocondizionato',
      confined_space: 'Spazio confinato (DPR 177/2011)', kind: 'Tipo', establishment_id: 'Stabilimento',
      cooper_supplier_id: 'Tonnelleria (dal CRM)', cooper_name: 'Tonnelleria', oak_origin: 'Origine del rovere', forest: 'Foresta', grain: 'Grana',
      toast: 'Tostatura', purchase_date: "Data d'acquisto", purchase_cost_cents: "Costo d'acquisto (€)", useful_life_uses: 'Vita utile (passaggi)',
      uses_count: 'Passaggi già fatti', style: 'Tipologia', description: 'Descrizione', color: 'Colore della bacca', sian_code: 'Codice SIAN',
      requires_state_seal: 'Richiede i contrassegni di Stato', unit: 'Unità', decimals: 'Decimali', applies_to: 'Si misura su',
      legal_limit_config_key: 'Soglia collegata', sort_order: 'Ordine', icqrf_code: 'Codice ICQRF', address: 'Indirizzo', regime: 'Regime',
      fiscal_warehouse: 'Deposito fiscale', operation_type: 'Operazione', required_fields: 'Campi richiesti', requires_document: 'Serve un documento giustificativo',
      rule_type: 'Regola', mention: 'Menzione', value_e4: 'Valore', valid_from: 'Valida dal', valid_to: 'Valida fino al', source_note: 'Fonte',
      phase: 'Fase', title: 'Titolo', checks: 'Controlli', optional: 'Facoltativo', target_params: 'Parametri obiettivo',
      value: 'Valore', rule_ids: 'Regole', question_id: 'Domanda', validated: 'Convalida', label: 'Campagna', starts_on: 'Dal', ends_on: 'Al',
    },
    msg: {
      vuoto: 'Nessun elemento.', archiviato: 'archiviato', scaduto: 'controllo scaduto', daValidare: 'da validare',
      validataDa: 'validata da {who} il {when}', sicuro: 'Confermi?', archiviaDomanda: 'Archiviare questo elemento? Resta nello storico e si può riattivare.',
      dismettiDomanda: 'Dismettere il vaso {code}?', motivo: 'Motivo (facoltativo):', nuovoValore: 'Nuovo valore per «{name}» ({unit}):',
      nuovoNome: 'Nome della copia:', libera: 'libera', campagnaInCorso: 'in corso', soloLettura: 'Il tuo ruolo in Produzione è di sola lettura.',
      selezionaVasi: 'Seleziona almeno un vaso.', nessunaRegola: 'Nessuna regola: vanno prese dal testo del disciplinare.',
      parametriAiuto: 'Una riga per parametro, per esempio «temperatura_c: 14-16».', legno: 'Dati della barrique',
      unitaNota: 'Le unità a schermo si cambiano in Impostazioni → Customizations → Produzione.',
      vasoDaQr: 'Vaso aperto dal codice QR',
    },
  },
};
const PRD_LANG = 'it';
function T(key, params = {}) {
  const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), PRD_TXT[PRD_LANG]);
  if (typeof v !== 'string') return key;
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''));
}
