# Produzione — Prerequisiti e Fase 1: anagrafiche di base

Stato: **approvata e in produzione dal 25/09/2026** (migrazioni 0015–0019, copia del database in `/data/backups/cantina-20260925-130712-before-0015.db`). Capacità e lettura dei fornitori confermate.

Decisioni applicate (Fase 0, 25/09/2026): DP1–DP12, DP14, DP15, DP17. Restano:
- **DP13** aperta (la chiedi all'agronomo);
- **DP16 e DP18** rimandate all'onboarding.

---

## 1. Cosa c'è

### Prerequisiti

| # | Cosa | Dove |
|---|---|---|
| P1 | **Eventi v2:** ogni evento porta la versione dello schema e chi ha fatto l'azione (DP2). Gli eventi già scritti restano versione 1 | `migrations/0015_events_v2.js`, `lib/events.js` (`emit`) |
| P2 | **Ora italiana:** data operativa, conversione da ora italiana a UTC (anche al cambio dell'ora), campagna vitivinicola (DP6) | `lib/time.js` |
| P3 | **Capacità per ruolo dentro Produzione** (DP4). Chi può scrivere cosa: <br>• Vigneto: agronomo <br>• Vitigni: agronomo o enologo <br>• Cantina e Protocolli: enologo <br>• Denominazioni, soglie, stabilimenti, parametri, mappa SIAN: enologo o responsabile qualità <br>Chi ha il workspace ma nessuna capacità consulta soltanto; «sola lettura» non scrive mai; chiave master e utenti senza ruolo possono tutto, come oggi | `roles.capabilities` (`0016`), `lib/security.js` (`PRD_CAPABILITIES`), `server.js` (`capabilitiesFor`, API dei ruoli, `/api/admin/me`), `modules/prd/common.js` (`CAN`) |
| P4 | **Oggetti di costo della Produzione:** tipi parcella, ordine di lavoro, imbottigliamento (DP3). La tabella è stata ricostruita senza perdere i collegamenti. Da Finance non si creano a mano | `migrations/0017_cost_objects_v2.js`, `lib/migrations.js` (`disableForeignKeys`), `modules/finance.js` |
| P5 | **Soglie configurabili «da validare»** (DP12): 22 soglie di partenza, ognuna con fonte, regole collegate e domanda del questionario. Un valore cambiato torna da validare; la convalida registra chi e quando | `prd_config` (`0016`), `modules/prd/config.js` |
| P6 | **Testi centralizzati** (DP10) | `modules/prd/i18n.js` (server), `public/js/prd-i18n.js` (schermate) |
| P7 | **Unità a schermo in Impostazioni** (DP17): volumi (hl/L), pesi (q/kg), superfici (ha/m²), zuccheri (°Babo/°Brix). Nel database restano ml, g, m² | Impostazioni → Customizations → Produzione; `server.js` (`ENUM_SETTINGS`) |
| P8 | **Ogni regola ha il suo test:** un test legge `regole.md` e fallisce se una regola delle fasi consegnate non ha un test con il suo ID | `test/prd-prerequisiti.test.js` |

### Fase 1 — anagrafiche

**Produzione → Vigneto:**
- **Vigneti e parcelle:**
  - *vigneti*: località, biologico, ente certificatore, descrizione per le visite;
  - *parcelle*: vitigno, clone, portinnesto, impianto, sesto, ceppi, allevamento, esposizione, altitudine, biologico (vuoto = come il vigneto), idoneità alle denominazioni. Le particelle catastali si collegano con la superficie vitata e il codice dell'unità vitata dello schedario (DP14); la superficie della parcella è la somma;
  - *particelle catastali*: superficie catastale, già vitata, libera.
- **Mezzi e fitofarmaci:**
  - attrezzature con la scadenza del controllo funzionale;
  - fitofarmaci con numero di registrazione, sostanze attive, dose massima, carenza, rientro, applicazioni massime, ammissibilità in biologico, articolo di magazzino.

**Produzione → Cantina:**
- **Vasi e barrique:**
  - elenco con filtri per luogo e tipo e capacità totale;
  - scheda del vaso con il **codice QR**: dal telefono la fotocamera apre la scheda;
  - stampa delle etichette QR, del singolo vaso o di quelli selezionati;
  - dismissione con motivo e riattivazione;
  - per barrique, tonneau e botti: tonnelleria (anche dal CRM), rovere, foresta, grana, tostatura, acquisto, costo, vita utile, passaggi già fatti;
  - i luoghi di cantina (tinaia, bottaia, cantina spumanti…).
- **Protocolli:**
  - 5 modelli di partenza (bianco, rosso, rosato, base spumante, metodo classico) con i passi descritti nella specifica;
  - i parametri obiettivo restano vuoti per l'enologo;
  - editor dei passi con riordino, parametri come «nome: valore», facoltativi, duplicazione.

**Produzione → Configurazione (Denominazioni e soglie):**
- vitigni (6 di partenza);
- denominazioni (6 di partenza) con le **regole del disciplinare** a validità, non precaricate: vanno prese dai testi;
- parametri di analisi (20 di partenza, con unità e decimali);
- stabilimenti (codice ICQRF, regime, deposito fiscale);
- campagne (la corrente si crea da sola);
- **mappa delle operazioni SIAN** (vuota, con la convalida del consulente);
- **soglie da validare**.

**Impostazioni:**
- Ruoli e permessi: colonna «Capacità in Produzione», attiva solo per i ruoli con il workspace;
- Customizations → Produzione: unità a schermo.

## 2. Migrazioni

| Versione | Tabelle nuove | Tabelle **esistenti** toccate |
|---|---|---|
| `0015_events_v2` | — | `domain_events`: + `schema_version`, + `actor` |
| `0016_prd_access` | `prd_config` (+ 22 soglie) | `roles`: + `capabilities` |
| `0017_cost_objects_v2` | — | `cost_objects` **ricostruita** con 3 tipi in più; i collegamenti delle 10 tabelle che la usano sono verificati prima del commit |
| `0018_prd_vineyard_master` | `grape_varieties`, `appellations`, `appellation_rules`, `vineyards`, `cadastral_parcels`, `vineyard_parcels`, `parcel_cadastral_links`, `parcel_appellation_eligibility`, `equipment`, `phyto_products`, `analysis_parameters` | — |
| `0019_prd_cellar_master` | `establishments`, `wine_campaigns` (+ campagna corrente e precedente), `cellar_locations`, `vessels`, `barrels`, `winemaking_protocols` (+ 5), `protocol_steps` (+ 67), `sian_operation_map` | — |

- Tutte hanno il `down`, e sono state provate su una copia del database locale: su, giù, di nuovo su, integrità a posto, collegamenti agli oggetti di costo conservati.
- Tutte le tabelle hanno `created_at`/`created_by`/`updated_at`/`updated_by`; le anagrafiche si archiviano (`archived_at`), non si cancellano.
- Nuova opzione del runner, `disableForeignKeys`: per le migrazioni che ricostruiscono una tabella, spegne le chiavi esterne prima della transazione e controlla i riferimenti prima del commit.

## 3. Eventi

- **Nessun evento nuovo in questa fase:** le anagrafiche non hanno effetti su altri moduli.
- È cambiata la **busta** di tutti gli eventi: versione e autore (P1). Il catalogo con il contratto v1 resta [`eventi.md`](eventi.md).

## 4. Regole e test

| Regola | Test | Esito |
|---|---|---|
| PRD-A01 superfici vitate ≤ superficie della particella | creazione e modifica; superficie della particella ridotta; parcelle archiviate e riattivate | ✓ |
| PRD-A02 parcella con attività nella campagna aperta non si archivia | controllo registrato dalle fasi successive (`registerParcelArchiveGuard`), simulato nel test | ✓ (vedi nota) |
| PRD-A03 codice univoco, capacità > 0, QR; vaso non vuoto non si dismette | codice anche con maiuscole diverse, capacità zero, QR diversi e ricerca per QR, stato «pieno» non impostabile a mano | ✓ (vedi nota) |
| PRD-A04 barrique dismessa solo vuota, storia chiusa | piena rifiutata, vuota dismessa con la storia chiusa (`registerBarrelRetireHook`) | ✓ (vedi nota) |
| PRD-A05 regola di disciplinare scaduta non vale dopo, resta per lo storico | regole per data e per menzione, storico, date incoerenti, quota di vitigno senza vitigno | ✓ |

**Nota su A02, A03, A04.** Interventi, conferimenti, contenuto dei vasi e passaggi delle barrique nascono nelle Fasi 2, 3 e 5. Qui ci sono i controlli e i punti in cui le fasi successive si agganciano; il test simula l'attività e il vaso pieno. Nelle fasi che li creano i test useranno dati veri.

Altri test della fase:
- parcelle (vitigno, denominazioni, biologico ereditato, anno d'impianto, codice univoco);
- protocolli (passi, parametri, duplicazione);
- attrezzature (scadenza del controllo), fitofarmaci (numero di registrazione univoco), mappa SIAN (convalida e nuova convalida dopo una modifica).

Prerequisiti:
- eventi v2;
- ora italiana (mezzanotte, Capodanno, ora legale);
- capacità (sola lettura, agronomo, enologo, senza workspace, chiave master);
- capacità salvate sul ruolo;
- oggetti di costo;
- soglie;
- unità;
- ogni regola ha il suo test.

**Esito: 143 test, 143 superati** (17 nuovi).

## 5. Punti toccati nei moduli esistenti

| Dove | Cosa |
|---|---|
| `lib/events.js` → `emit` | versione e autore, facoltativi |
| `lib/migrations.js` | transazione con chiavi esterne spente per le ricostruzioni |
| `lib/security.js` | gruppo di API `prd` (workspace Produzione); **i fornitori si leggono anche dalla Produzione** (tonnellerie, laboratori, terzisti) |
| `server.js` | capacità dei ruoli, `/api/admin/me`, unità in `/api/admin/settings`, registrazione del modulo |
| `modules/finance.js`, `portal-finance.js` | i 3 tipi di Produzione si vedono negli elenchi ma non si creano a mano |
| `public/portal.html` | menu Produzione (gruppi Ordini, Vigneto, Cantina, Configurazione), pannelli, apertura dal QR, matrice dei ruoli, Customizations |
| `public/js/portal-ui.js` → `openPortalLink` | link interni al vaso |

**Le pagine di Produzione che c'erano restano uguali** (dashboard, riepiloghi, righe d'ordine), solo sotto il gruppo «Ordini».

## 6. Decisioni prese in autonomia

- **Valori di partenza modificabili:**
  - vitigni e denominazioni che mi hai confermato;
  - parametri di analisi d'uso comune;
  - protocolli dai processi della specifica.
- **Regole di disciplinare non precaricate:** un numero di resa sbagliato produrrebbe controlli sbagliati; vanno prese dai testi ufficiali.
- **Import CSV di parcelle, vasi e barrique:** spostato nella procedura di **onboarding** (DP18), come mi hai chiesto. Anche l'import della mappa SIAN va lì.
- **QR:**
  - libreria `qrcode-generator` (MIT, 56 kB, nessuna chiamata di rete, verificata) in `public/js/vendor/`;
  - il codice contiene l'indirizzo della scheda del vaso: si legge con la fotocamera del telefono, senza lettore nel browser.
- **Stato dei vasi:** a mano solo «vuoto», «da lavare» e «in manutenzione». «Pieno» lo scriverà il giornale di cantina; «dismesso» viene dalla dismissione, che chiede il motivo. Un vaso riattivato torna «da lavare».
- **Scadenza del controllo funzionale delle irroratrici:** 36 mesi di partenza, **da validare** (soglia `equipment_inspection_valid_months`).
- **Numeri all'italiana:** «14.000» è quattordicimila, «2,5» è due e mezzo, anche nelle API.
- **Cartina delle parcelle:** la geometria (GeoJSON) si salva già; la mappa arriverà più avanti.

## 7. Decisioni aperte per te

1. **DP13 — annata agraria o campagna** per il vigneto (domanda VIG-11 all'agronomo). Serve **prima della Fase 2**: decide come contare le applicazioni massime dei fitofarmaci e come nascono gli oggetti di costo delle parcelle.
2. **Capacità:** va bene la matrice del § 1 (P3)? Per esempio, i vitigni li possono scrivere sia l'agronomo sia l'enologo.
3. **Lettura dei fornitori dalla Produzione:** è un'estensione di un permesso esistente, confermala.
4. **Pagina da campo per tablet e smartphone** (DP9): ha senso a partire dalla Fase 2 (trattamenti in vigneto). In questa fase le anagrafiche si gestiscono dal portale.

## 8. Soglie da validare

Le 22 soglie sono in Produzione → Denominazioni e soglie → Soglie da validare, e nel foglio «Soglie da validare» del questionario per la cantina (`docs/Domande-cantina.xlsx`). Tutte partono **da validare**.
