// Catalogo dei permessi (docs/audit_permessi.md §6). È il codice la fonte di verità: all'avvio il
// catalogo si copia nella tabella permissions, che dall'interfaccia non si modifica.
//
// Codici "modulo.risorsa.azione". Nella Fase 1 la granularità è quella delle regole di oggi
// (lib/security.js → API_WORKSPACES): per ogni gruppo di API un codice .leggi (GET) e uno .scrivi
// (il resto). Si raffinano dopo, con il test di parità ancora verde.
const { API_WORKSPACES, ACCESS_LEVELS, PRD_CAPABILITIES } = require('./security');

const ANY = '*';
const SCOPES = ['all', 'unit', 'unit_subtree', 'own', 'assigned'];

// Gruppo di API → risorsa del catalogo, con un nome leggibile per la matrice.
const RESOURCES = {
  settings: ['impostazioni.impostazioni', 'Impostazioni generali'],
  'dashboard-widgets': ['impostazioni.widget', 'Widget della home'],
  'option-lists': ['impostazioni.liste', 'Liste modificabili'],
  'portal-users': ['impostazioni.utenti', 'Utenti del portale'],
  roles: ['impostazioni.ruoli', 'Ruoli e permessi'],
  'wine-club': ['impostazioni.wine_club', 'Wine club'],
  'audit-log': ['impostazioni.registro_attivita', 'Registro attività'],
  bookings: ['enoturismo.prenotazioni', 'Prenotazioni'],
  experiences: ['enoturismo.esperienze', 'Esperienze'],
  slots: ['enoturismo.slot', 'Disponibilità'],
  'discount-codes': ['enoturismo.codici_sconto', 'Codici sconto'],
  reviews: ['enoturismo.recensioni', 'Recensioni'],
  newsletter: ['enoturismo.newsletter', 'Newsletter'],
  operators: ['enoturismo.operatori', 'Operatori'],
  'venue-events': ['enoturismo.eventi', 'Eventi in cantina'],
  'shop-sales': ['enoturismo.cassa', 'Vendite in negozio'],
  'pickup-orders': ['enoturismo.ritiri', 'Ritiri online'],
  export: ['enoturismo.export', 'Export prenotazioni'],
  stats: ['enoturismo.statistiche', 'Statistiche'],
  'sync-payments': ['enoturismo.pagamenti', 'Sincronizzazione pagamenti'],
  'stock/tastings': ['enoturismo.degustazioni', 'Degustazioni dal check-in'],
  orders: ['commerciale.ordini', 'Ordini'],
  products: ['commerciale.prodotti', 'Prodotti'],
  'price-lists': ['commerciale.listini', 'Listini'],
  catalogs: ['commerciale.cataloghi', 'Cataloghi'],
  news: ['commerciale.news', 'News per gli agenti'],
  fairs: ['commerciale.fiere', 'Fiere'],
  'sales-targets': ['commerciale.obiettivi', 'Obiettivi di vendita'],
  'sales-target-areas': ['commerciale.aree_obiettivo', 'Aree degli obiettivi'],
  commercial: ['commerciale.report', 'Report commerciali'],
  production: ['produzione.riepilogo', 'Riepilogo produzione'],
  produzione: ['produzione.righe', 'Righe da produrre'],
  prd: ['produzione.prd', 'Vigneto e cantina'],
  warehouse: ['magazzino.giacenze', 'Giacenze'],
  magazzino: ['magazzino.kanban', 'Kanban ordini'],
  stock: ['magazzino.registro', 'Registro di magazzino'],
  customers: ['crm.clienti', 'Clienti'],
  agents: ['crm.agenti', 'Agenti'],
  importers: ['crm.importatori', 'Importatori'],
  suppliers: ['crm.fornitori', 'Fornitori'],
  people: ['crm.persone', 'Persone'],
  crm: ['crm.attivita', 'Note, compiti, riunioni, allegati'],
  hr: ['people.dipendenti', 'Dipendenti'],
  'hr/directory': ['people.rubrica', 'Rubrica aziendale'],
  'hr/absence-types': ['people.tipi_assenza', 'Tipi di assenza'],
  'hr/documents': ['people.documenti', 'Documenti del personale'],
  finance: ['finance.contabilita', 'Contabilità analitica'],
  'finance/cost-centers': ['finance.centri_di_costo', 'Centri di costo'],
};

// Livelli di riservatezza HR di oggi → permesso. "base" ce l'hanno tutti e non è un permesso.
// "personale" si può dare per ruolo (decisione Q4), gli altri solo a persone nominate.
const LEVEL_PERMISSIONS = {
  personale: 'people.dati_personali.leggi',
  retributivo: 'people.retribuzioni.leggi',
  sanitario: 'people.idoneita.leggi',
  disciplinare: 'people.disciplinare.leggi',
};
// Capacità di Produzione di oggi → permesso. "sola_lettura" non diventa un permesso: vuol dire
// avere produzione.prd.leggi e nessuna capacità (i permessi sono solo additivi).
const CAPABILITY_PERMISSIONS = Object.fromEntries(
  PRD_CAPABILITIES.filter(c => c !== 'sola_lettura').map(c => [c, `produzione.prd.${c}`]),
);

function buildCatalog() {
  const list = [];
  const add = (code, description, extra = {}) => list.push({
    code, module: code.split('.')[0], description, is_sensitive: false, scopes: ['all'], ...extra,
  });
  for (const [group, rule] of Object.entries(API_WORKSPACES)) {
    const res = RESOURCES[group];
    if (!res) continue; // gruppi aperti a chiunque abbia fatto l'accesso (me, notifiche…)
    if (rule.read !== ANY) add(`${res[0]}.leggi`, `${res[1]}: consultare`);
    if (rule.write !== ANY) add(`${res[0]}.scrivi`, `${res[1]}: modificare`);
  }
  add(LEVEL_PERMISSIONS.personale, 'Dati personali dei dipendenti (anagrafica, contatti privati, orario)', { scopes: SCOPES });
  add(LEVEL_PERMISSIONS.retributivo, 'Retribuzioni e costi orari', { is_sensitive: true });
  add(LEVEL_PERMISSIONS.sanitario, 'Idoneità alla mansione (giudizio completo)', { is_sensitive: true });
  add(LEVEL_PERMISSIONS.disciplinare, 'Procedimenti disciplinari', { is_sensitive: true });
  add('people.documenti_personali.leggi', 'Documenti personali riservati', { is_sensitive: true });
  add('finance.paghe.leggi', 'Costo del personale e paghe', { is_sensitive: true });
  const capNames = { enologo: 'Enologo', cantiniere: 'Cantiniere', capo_squadra: 'Capo squadra', agronomo: 'Agronomo', responsabile_qualita: 'Responsabile qualità' };
  for (const [cap, code] of Object.entries(CAPABILITY_PERMISSIONS)) add(code, `Produzione: azioni da ${capNames[cap] || cap}`);
  // Organigramma e permessi (Fasi 3-4).
  add('impostazioni.organigramma.leggi', 'Organigramma: consultare');
  add('impostazioni.organigramma.modifica', 'Organigramma: modificare la bozza');
  add('impostazioni.organigramma.pubblica', "Organigramma: pubblicare (cambia i permessi di tutti)");
  add('impostazioni.permessi.concedi', 'Eccezioni nominative e deleghe');
  add('enoturismo.visite.conduce', 'Conduce le visite (selezionabile come operatore)', { scopes: SCOPES });
  // Codici dei vincoli di separazione dei compiti che oggi non hanno ancora una funzione: restano
  // nel catalogo perché le regole SoD li possano citare; senza route non concedono nulla.
  add('people.ferie.approva', 'Approvare ferie e assenze', { scopes: SCOPES });
  add('people.presenze.inserisci_squadra', 'Inserire le ore della squadra', { scopes: SCOPES });
  add('people.presenze.approva', 'Approvare le presenze', { scopes: SCOPES });
  add('finance.fornitori.crea', 'Creare fornitori (contabilità)');
  add('finance.pagamenti.approva', 'Approvare pagamenti');
  add('commerciale.ordini.crea', 'Creare ordini');
  add('commerciale.sconti_extra.approva', 'Approvare sconti fuori listino');
  add('magazzino.rettifiche.crea', 'Registrare rettifiche di magazzino');
  add('magazzino.rettifiche.approva', 'Approvare rettifiche di magazzino');
  const seen = new Set();
  for (const p of list) {
    if (seen.has(p.code)) throw new Error(`Permesso duplicato nel catalogo: ${p.code}`);
    seen.add(p.code);
  }
  return list;
}

const CATALOG = buildCatalog();
const BY_CODE = new Map(CATALOG.map(p => [p.code, p]));

// Regola di API_WORKSPACES che vale per un percorso: prima "gruppo/sottogruppo", poi "gruppo".
function ruleKeyFor(pathname) {
  const m = String(pathname).match(/^\/api\/admin\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?/);
  if (!m) return null;
  if (m[2] && API_WORKSPACES[`${m[1]}/${m[2]}`]) return `${m[1]}/${m[2]}`;
  return API_WORKSPACES[m[1]] ? m[1] : null;
}
// Permesso richiesto da una chiamata: ANY = basta la sessione; null = nessuna regola, quindi 403.
function permissionForRoute(method, pathname) {
  const key = ruleKeyFor(pathname);
  if (!key) return null;
  const read = method === 'GET' || method === 'HEAD';
  if ((read ? API_WORKSPACES[key].read : API_WORKSPACES[key].write) === ANY) return ANY;
  return `${RESOURCES[key][0]}.${read ? 'leggi' : 'scrivi'}`;
}

// Permessi equivalenti a un ruolo di oggi (workspace + livello "personale" + capacità).
// I livelli sensibili non sono qui: diventano concessioni nominative (vedi legacySensitiveCodes).
function legacyRolePermissions({ workspaces = [], access_levels = [], capabilities = [] }) {
  const codes = new Set();
  const has = need => need === ANY || need.some(ws => workspaces.includes(ws));
  for (const [group, rule] of Object.entries(API_WORKSPACES)) {
    const res = RESOURCES[group];
    if (!res) continue;
    if (rule.read !== ANY && has(rule.read)) codes.add(`${res[0]}.leggi`);
    if (rule.write !== ANY && has(rule.write)) codes.add(`${res[0]}.scrivi`);
  }
  if (access_levels.includes('personale')) codes.add(LEVEL_PERMISSIONS.personale);
  if (!capabilities.includes('sola_lettura')) {
    for (const cap of capabilities) if (CAPABILITY_PERMISSIONS[cap]) codes.add(CAPABILITY_PERMISSIONS[cap]);
  }
  return [...codes];
}
function legacySensitiveCodes(access_levels = []) {
  return access_levels.filter(l => l !== 'personale' && LEVEL_PERMISSIONS[l]).map(l => LEVEL_PERMISSIONS[l]);
}

module.exports = {
  ANY, SCOPES, CATALOG, BY_CODE, RESOURCES, LEVEL_PERMISSIONS, CAPABILITY_PERMISSIONS,
  ACCESS_LEVELS, PRD_CAPABILITIES, ruleKeyFor, permissionForRoute, legacyRolePermissions, legacySensitiveCodes,
};
