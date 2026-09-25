// Modulo Produzione (vigneto → cantina → affinamento → imbottigliamento → compliance). Documentazione e
// regole QUANDO/ALLORA in docs/produzione/. Tutte le API stanno sotto /api/admin/prd, nel workspace
// Produzione; le scritture richiedono le capacità del ruolo (common.CAN).
// Fase 1: anagrafiche. I moduli delle fasi successive si agganciano ai controlli esportati qui.
const { createRouter } = require('../../lib/http');
const { createCommon } = require('./common');

module.exports = function registerProduction(app, deps) {
  const { authAdmin } = deps;
  const r = createRouter(app, '/api/admin/prd', authAdmin, [
    [/UNIQUE constraint failed: index 'idx_vessels_code'/, 'Esiste già un vaso con questo codice.'],
    [/UNIQUE constraint failed: index 'idx_vineyard_parcels_code'/, 'Esiste già una parcella con questo codice.'],
    [/UNIQUE constraint failed: index 'idx_cadastral_parcels'/, 'Questa particella catastale è già registrata.'],
    // Gli indici su colonne compaiono nel messaggio con il nome della colonna, quelli su espressioni con il nome dell'indice.
    [/UNIQUE constraint failed: phyto_products\.registration_number/, 'Esiste già un fitofarmaco con questo numero di registrazione.'],
    [/UNIQUE constraint failed: establishments\.icqrf_code/, 'Esiste già uno stabilimento con questo codice ICQRF.'],
    [/UNIQUE constraint failed: sian_operation_map\.operation_type/, 'Questa operazione ha già un codice SIAN nella mappa.'],
    [/UNIQUE constraint failed: analysis_parameters.code/, 'Esiste già un parametro con questo codice.'],
    [/UNIQUE constraint failed/, 'Esiste già un elemento con questo nome o codice.'],
  ]);
  const c = createCommon(deps);
  const cfg = require('./config')(r, deps, c);
  const vineyard = require('./vineyard')(r, deps, c, cfg);
  const cellar = require('./cellar')(r, deps, c, cfg);
  return { ...cfg, ...vineyard, ...cellar, can: c.can };
};
