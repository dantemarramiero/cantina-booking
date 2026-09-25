// Testi della Produzione lato server (decisione DP10): etichette dei valori ammessi e messaggi.
// Tutto in un posto, pronto per aggiungere l'inglese: t('msg.chiave', { param }) sostituisce {param}.
const IT = {
  labels: {
    capability: {
      enologo: 'Enologo', cantiniere: 'Cantiniere', capo_squadra: 'Capo squadra', agronomo: 'Agronomo',
      responsabile_qualita: 'Responsabile qualità', sola_lettura: 'Sola lettura',
    },
    grape_color: { bianca: 'Bacca bianca', nera: 'Bacca nera', rosata: 'Bacca rosata' },
    appellation_type: { DOCG: 'DOCG', DOC: 'DOC', IGT: 'IGT', varietale: 'Vino varietale', generico: 'Vino (generico)' },
    rule_type: {
      max_yield_kg_ha: 'Resa massima di uva', max_wine_yield_pct: 'Resa massima uva → vino', min_variety_pct: 'Quota minima del vitigno',
      max_variety_pct: 'Quota massima del vitigno', min_alcohol_pct: 'Titolo alcolometrico minimo', min_aging_months: 'Affinamento minimo',
      min_wood_months: 'Affinamento minimo in legno', min_bottle_months: 'Affinamento minimo in bottiglia', min_lees_months: 'Tempo minimo sui lieviti',
    },
    rule_unit: {
      max_yield_kg_ha: 'kg/ha', max_wine_yield_pct: '%', min_variety_pct: '%', max_variety_pct: '%', min_alcohol_pct: '% vol',
      min_aging_months: 'mesi', min_wood_months: 'mesi', min_bottle_months: 'mesi', min_lees_months: 'mesi',
    },
    organic_status: { none: 'Convenzionale', conversion: 'In conversione', certified: 'Biologico certificato' },
    equipment_type: { irroratrice: 'Irroratrice', trattore: 'Trattore', vendemmiatrice: 'Vendemmiatrice', attrezzo: 'Attrezzo', pompa: 'Pompa', altro: 'Altro' },
    dose_unit: { 'kg/ha': 'kg/ha', 'l/ha': 'l/ha', 'g/ha': 'g/ha', 'ml/ha': 'ml/ha' },
    analysis_subject: { parcel: 'Parcella', lot: 'Lotto', vessel: 'Vaso', stack: 'Catasta', bottling_lot: "Lotto d'imbottigliamento" },
    regime: { ordinario: 'Ordinario', deroga_sotto_1000hl: 'Deroga (sotto 1000 hl, 30 giorni)' },
    location_kind: { tinaia: 'Tinaia', bottaia: 'Bottaia', cantina_spumanti: 'Cantina spumanti', magazzino: 'Magazzino', esterno: 'Esterno', altro: 'Altro' },
    vessel_type: {
      vasca_inox: 'Vasca inox', vasca_cemento: 'Vasca in cemento', vasca_vetroresina: 'Vasca in vetroresina', tino: 'Tino tronco-conico',
      barrique: 'Barrique', tonneau: 'Tonneau', botte: 'Botte grande', anfora: 'Anfora / giara', uovo: 'Uovo', autoclave: 'Autoclave',
      fusto: 'Fusto', catasta: 'Catasta di bottiglie',
    },
    vessel_status: { empty_clean: 'Vuoto, pulito', empty_dirty: 'Vuoto, da lavare', in_use: 'Pieno', maintenance: 'In manutenzione', retired: 'Dismesso' },
    protocol_style: { bianco: 'Bianco', rosso: 'Rosso', rosato: 'Rosato', base_spumante: 'Base spumante', metodo_classico: 'Metodo classico', altro: 'Altro' },
    // Tipi di operazione: servono ai protocolli, alla mappa SIAN e (Fase 3–6) al giornale di cantina.
    operation_type: {
      conferimento: 'Conferimento', diraspatura: 'Diraspatura', pigiatura: 'Pigiatura', pressatura: 'Pressatura', macerazione: 'Macerazione',
      salasso: 'Salasso', riempimento: 'Riempimento vasca', solfitazione: 'Solfitazione', chiarifica_mosto: 'Chiarifica del mosto', travaso: 'Travaso',
      inoculo: 'Inoculo', fermentazione_inizio: 'Inizio fermentazione alcolica', fermentazione_fine: 'Fine fermentazione alcolica',
      gestione_cappello: 'Gestione del cappello', svinatura: 'Svinatura', malolattica_inizio: 'Inizio malolattica', malolattica_fine: 'Fine malolattica',
      batonnage: 'Bâtonnage', sfecciatura: 'Sfecciatura', chiarifica: 'Chiarifica', stabilizzazione_proteica: 'Stabilizzazione proteica',
      stabilizzazione_tartarica: 'Stabilizzazione tartarica', filtrazione: 'Filtrazione', refrigerazione: 'Refrigerazione', aggiunta: 'Aggiunta enologica',
      correzione: 'Correzione', assemblaggio: 'Assemblaggio (taglio)', separazione: 'Separazione', colmatura: 'Colmatura', affinamento_legno: 'Affinamento in legno',
      affinamento_bottiglia: 'Affinamento in bottiglia', tiraggio: 'Tiraggio', remuage: 'Remuage', sboccatura: 'Sboccatura', dosaggio: 'Dosaggio',
      imbottigliamento: 'Imbottigliamento', etichettatura: 'Etichettatura', calo: 'Calo o perdita', rettifica_inventariale: 'Rettifica inventariale',
      cambio_designazione: 'Cambio di designazione', blocco: 'Blocco qualità', sblocco: 'Sblocco qualità', campionamento: 'Campionamento',
    },
  },
  msg: {
    no_capability: 'Per questa operazione serve il ruolo di {roles} in Produzione.',
    read_only: 'Il tuo ruolo in Produzione è di sola lettura.',
    required: '{field}: campo obbligatorio.',
    too_long: '{field}: al massimo {max} caratteri.',
    invalid_enum: '{field}: valore non valido.',
    invalid_int: '{field}: serve un numero intero.',
    invalid_number: '{field}: serve un numero.',
    min: '{field}: deve essere almeno {min}.',
    max: '{field}: deve essere al massimo {max}.',
    invalid_date: '{field}: data non valida (AAAA-MM-GG).',
    invalid_json: '{field}: formato non valido.',
    ref_missing: '{field}: il collegamento indicato non esiste.',
    not_found: '{what} non trovato.',
    duplicate: '{what}: esiste già con questo nome o codice.',
    archived: '{what} è archiviato: riattivalo per modificarlo.',
    archive_blocked: 'Non si può archiviare: {reason}.',
    cadastral_exceeded: 'Particella {cadastral}: le parcelle arrivano a {sum} m² di superficie vitata, oltre i {area} m² della particella.',
    cadastral_area_below: 'La particella ha già {sum} m² di superficie vitata nelle parcelle: la superficie non può scendere a {area} m².',
    cadastral_archived: 'Particella {cadastral}: è archiviata.',
    parcel_duplicate_link: 'La stessa particella compare due volte.',
    rule_dates: 'La fine della validità non può essere prima dell\'inizio.',
    rule_variety_needed: 'Per una quota di vitigno serve il vitigno.',
    capacity_positive: 'La capacità del vaso deve essere maggiore di zero.',
    vessel_has_content: 'Il vaso {code} non è vuoto: non si può dismettere.',
    vessel_retired: 'Il vaso {code} è dismesso.',
    vessel_status_manual: 'Lo stato «{status}» lo imposta il giornale di cantina, non si sceglie a mano.',
    barrel_only_wood: 'I dati della barrique valgono solo per barrique, tonneau e botti.',
    config_value: '{name}: valore non valido ({kind}).',
    geojson: 'Geometria: serve un GeoJSON con il campo «type».',
    steps_sequence: 'Ogni passo del protocollo ha un tipo di operazione e un titolo.',
  },
};

const LANG = { it: IT };
function t(key, params = {}, lang = 'it') {
  const dict = LANG[lang] || IT;
  const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);
  if (typeof v !== 'string') return key;
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
}
const labels = (group, lang = 'it') => (LANG[lang] || IT).labels[group] || {};
const values = group => Object.keys(IT.labels[group] || {});

module.exports = { t, labels, values, IT };
