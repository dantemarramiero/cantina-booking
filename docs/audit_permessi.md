# Organigramma & matrice permessi — Fase 0: audit

Stato: **Gate 0, in attesa di approvazione**. Nessuna modifica a codice o schema.
Base: repository `cantina-booking`, **working tree** del 25/09/2026. È il commit `60c331c` più il lavoro non committato sulla Produzione: `modules/prd/`, migrazioni `0015`–`0019`, la regola `prd` e `suppliers` per produzione in `lib/security.js`. Le 93 route `prd/*` e le capacità PRD **non sono ancora in produzione**.
Prompt di riferimento: `prompt_organigramma_permessi_v1.md`.
Appendice A (inventario completo, 494 route): [`audit_permessi_route.md`](audit_permessi_route.md).

**In sintesi.** Il prompt presuppone un sistema più indietro di quello reale.
- Il controllo dei permessi lato server **c'è già**: una mappa centrale in `lib/security.js` applicata da `authAdmin` a tutte le `/api/admin/*`.
- Esistono già dipendenti, gerarchia responsabile/delegato, squadre, centri di costo, `audit_log` e `sensitive_access_log`.
- Oggi i permessi hanno **tre assi**: workspace, livelli di riservatezza HR e capacità di Produzione. Più una quarta regola implicita, "sé stesso / responsabile / caposquadra", scritta nei moduli HR.

Il nuovo modello deve assorbire tutti e quattro. Il test di parità deve coprirli tutti, non solo i workspace.

---

## 1. Database reale

**SQLite in produzione, nessun Postgres.** Non c'è ambiguità nel codice, ma c'è una discrepanza con il prompt.

| Evidenza | Dove |
|---|---|
| `const { DatabaseSync } = require('node:sqlite')`, API sincrona | `server.js` |
| File `/data/cantina.db` sul volume Railway (`DB_PATH` / `RAILWAY_VOLUME_MOUNT_PATH`) | README, `.env.example` |
| Sintassi SQLite: `datetime('now','localtime')`, `INSERT OR IGNORE`, `lastInsertRowid`, `ALTER TABLE … DROP COLUMN` | `server.js`, `migrations/` |
| Nessun servizio Postgres nel progetto Railway `cantina-marramiero` | audit People/Finance, 24/09 |
| Runner di migrazioni interno `migrations/NNNN_*.js` con `up`/`down`, backup automatico, tabella `schema_migrations` (ultima: `0019_prd_cellar_master`) | `lib/migrations.js` |

**La decisione è già presa: D1-A** (`docs/people-finance/00-fase-0-audit-e-piano.md`). Si resta su SQLite, con SQL portabile nelle tabelle nuove. Il passaggio a Postgres sarà un progetto a sé.

**Proposta:** non mi fermo qui, ma chiedo conferma esplicita (domanda **Q1**).

Conseguenza per la Fase 1: la gerarchia si fa con una **closure table** `org_unit_paths` (niente `ltree`, che è solo di Postgres). La closure table è portabile e si interroga con un semplice `JOIN`.

---

## 2. Mappa di autenticazione

| Meccanismo | Login | Credenziale in uso | Scadenza | Dove si legge il ruolo |
|---|---|---|---|---|
| **Chiave master** (`ADMIN_PASSWORD`) | `POST /api/admin/session` (throttle: 10 errori in 15 min per IP) | token di sessione in header `x-admin-key` (nel DB solo l'hash) | 12 h di inattività, 7 giorni massimo | `portal_sessions.user_id = NULL` → `req.isMasterKey` → **accesso completo** |
| **Utenti del portale** | `POST /api/portal-users/login` (scrypt) + reset password via email | come sopra (`portal_sessions`) | come sopra; revocata a disattivazione, cambio password e offboarding | `authAdmin` → `req.portalUser.role_id` → `permittedWorkspacesFor` / `accessLevelsFor` / `capabilitiesFor` (`server.js:1325-1358`), **una query su `roles` per ogni chiamata** |
| **Link firmati** (download ed export) | `GET /api/admin/signed-url` | `?sid&exp&sig` HMAC legato alla sessione, 10 min | 10 min | come la sessione di origine; la regola del workspace è ricontrollata sia alla firma sia all'uso |
| **Agenti** | `POST /api/agent/login` (scrypt) | `agents.token` **fisso**, restituito al login e usato **nel path** `/api/agent/:token/...` | **nessuna** | nessun ruolo: `authAgent` imposta `req.agent`, le query filtrano `agent_id = ?` |
| **Pubblico** | — | token QR per i ritiri (`pickup_token`), firma Stripe per `/api/webhook` | — | — |

`portal_users.access_key` esiste ancora nello schema, viene generata alla creazione ma **non è più accettata** per entrare. È una colonna morta.

Regola implicita da conoscere: **un utente senza ruolo ha accesso completo**, come la chiave master (`permittedWorkspacesFor` → `null`). Vedi il rischio **R1**.

---

## 3. Inventario dei controlli di accesso

Totale: **494 coppie metodo+path**. Tutte le righe sono nell'Appendice A.

| Protezione | Route | Note |
|---|---|---|
| `authAdmin` + regola workspace da `API_WORKSPACES` | 463 | Tutte le `/api/admin/*`. **Nessuna** `/api/admin/*` è senza `authAdmin`. La regola vince per specificità (`gruppo/sottogruppo`, poi `gruppo`); un gruppo senza regola → 403. |
| … di cui con controlli inline in più nel modulo | 134 HR, 93 PRD | HR: livelli + sé stesso/responsabile/caposquadra. PRD: `requireCap` sulle scritture. |
| … di cui con workspace `*` (chiunque sia entrato) | 34 in `hr/*` + `me`, `home`, `notifications`, `settings` (GET), `option-lists` (GET)… | Nelle `hr/*` con `*` l'accesso reale lo decide **solo** il modulo. |
| `authAgent` | 12 | `/api/agent/:token/*` |
| Pubbliche (sito, login, webhook) | 19 | 2 da segnalare, sotto. |

### Come si controlla oggi, per asse

| Asse | Dati | Dove si controlla | Granularità |
|---|---|---|---|
| Workspace | `roles.workspaces` JSON (8: enoturismo, commerciale, produzione, magazzino, crm, people, finance, impostazioni) | **centralizzato**: `canAccess()` in `authAdmin` | per gruppo di API × lettura (GET) / scrittura (il resto) |
| Livelli di riservatezza HR | `roles.access_levels` (base, personale, retributivo, sanitario, disciplinare) | **inline**: `hasAccessLevel()` in `hr*.js` (55 punti) e `server.js` (7) | per campo o documento |
| Capacità Produzione | `roles.capabilities` (enologo, cantiniere, capo_squadra, agronomo, responsabile_qualita, sola_lettura) | **inline**: `requireCap()` in `modules/prd/*` | per azione |
| Relazione | `employees.manager_id`, `delegate_id`, `teams.leader_employee_id`, `portal_user_id` | **inline**: `isSelf`, `isManagerOf`, `isTeamLeaderOf`, `visibleEmployeeIds` in `hr-file.js` e riusati | per record |

### Route da segnalare

- 🔴 **`GET /api/catalogs/:id/download` — nessun controllo.** È usata da `agent.html` e `portal.html` come link diretto: chiunque conosca l'URL scarica i PDF dei cataloghi (id sequenziali). Rischio basso se i cataloghi sono pubblici, altrimenti va chiusa (Q7).
- 🟠 **`POST /api/pickup-orders/verify/:token/pickup`** — basta il token del QR, senza login. Chi ha il link, **incluso il cliente stesso**, può segnare l'ordine come ritirato e scaricare il magazzino. È voluto (lo scansiona il personale senza login), ma andrebbe legato a una sessione interna o a un PIN del negozio.
- 🟠 **Filtro di visibilità fatto in JS dopo `LIMIT 500`** in `GET /api/admin/hr/absences` (`hr-absences.js:514-528`). Carica 500 righe e poi toglie quelle non visibili. Viola la regola 23 e con molti dati **un responsabile può non vedere le assenze dei suoi collaboratori**. Stesso schema da verificare negli altri elenchi HR (`visibleEmployeeIds` restituisce un `Set` in JS).

Nessuna route interna restituisce dati senza sessione.

---

## 4. Sincronizzazione `portal_users → operators`

- `syncOperatorForPortalUser(pu)` (`server.js:924`) inserisce o aggiorna `operators` con nome, email e `active` presi dall'utente.
- Viene chiamata:
  1. **a ogni avvio**, per tutti gli utenti (`server.js:935`);
  2. alla creazione e alla modifica di un utente (`POST`/`PATCH /api/admin/portal-users`).
- `deactivateOperatorForPortalUser` viene chiamata su `DELETE /api/admin/portal-users/:id` e sull'evento `employee.offboarded` (`server.js:5210`).

**Anomalia:** `DELETE /api/admin/portal-users/:id` **cancella davvero** la riga `portal_users`. L'operatore resta disattivato, ma `operators.portal_user_id` punta a un id che non esiste più. `sessions`, `audit_log` e `sensitive_access_log` hanno `ON DELETE SET NULL` e perdono l'autore. È in contrasto con la regola 20 ("l'operatore resta, lo storico è intatto"). Proposta: sostituirlo con una disattivazione in Fase 2.

Selezionabili nelle visite oggi: tutti gli operatori attivi, cioè tutti gli utenti attivi.

---

## 5. Ruoli esistenti in DB

⚠️ **Il dato di produzione non l'ho letto.** `railway ssh` richiede una chiave SSH registrata sull'account e non l'ho creata: è una modifica al tuo account.

Il DB locale (`cantina.db`, copia di sviluppo) non è rappresentativo:

| id | Ruolo | Workspace | Livelli | Capacità | Utenti |
|---|---|---|---|---|---|
| 2 | Commerciale | enoturismo, commerciale | — | — | 0 |

Locale: 1 utente, **attivo e senza ruolo** (= accesso completo), 0 dipendenti, 0 squadre, 4 operatori, 1 agente, 24 centri di costo.

Query read-only da lanciare in produzione. Può farlo Dante con `railway ssh`, oppure lo faccio io quando c'è una chiave SSH:

```js
// node -e "…" dentro il container: apre il DB in sola lettura
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.DB_PATH || '/data/cantina.db', { readOnly: true });
console.table(db.prepare(`SELECT r.id, r.name, r.workspaces, r.access_levels, r.capabilities,
  (SELECT COUNT(*) FROM portal_users p WHERE p.role_id = r.id AND p.active = 1) AS attivi FROM roles r`).all());
console.table(db.prepare(`SELECT COUNT(*) tot, SUM(active) attivi, SUM(role_id IS NULL AND active = 1) senza_ruolo_attivi FROM portal_users`).all());
console.table(db.prepare(`SELECT COUNT(*) dip, SUM(portal_user_id IS NOT NULL) con_account, SUM(manager_id IS NOT NULL) con_resp FROM employees`).all());
```

Il numero di **utenti attivi senza ruolo** in produzione è il dato più importante del Gate 0: sono tutti amministratori di fatto.

---

## 6. Proposta di catalogo permessi

**Principio:** la Fase 1 deve riprodurre gli accessi di oggi **esattamente**. Il catalogo iniziale quindi segue la granularità reale, cioè gruppo di API × lettura/scrittura. È di proposito più grezzo del prompt (`enoturismo.prenotazioni.modifica`).

Si raffina dopo la parità, spezzando un codice in più codici figli con il test di parità ancora verde.

Formato: `modulo.risorsa.azione`, con azione ∈ `leggi | scrivi` più le azioni specifiche.

### 6.1 Da `API_WORKSPACES`: 1:1 con le regole di oggi

| Modulo | Risorse (→ gruppi di API) | Codici |
|---|---|---|
| `enoturismo` | prenotazioni (`bookings`, `sync-payments`), esperienze, slot, codici_sconto, recensioni, newsletter, operatori, eventi (`venue-events`), cassa (`shop-sales`), ritiri (`pickup-orders`), statistiche (`stats`, `export`), degustazioni (`stock/tastings`) | `.leggi`, `.scrivi` per ciascuna |
| `commerciale` | ordini, prodotti, listini, cataloghi, news, fiere, obiettivi (`sales-targets`), aree_obiettivo, report (`commercial`) | idem |
| `crm` | clienti, agenti, importatori, fornitori, persone, attivita (`crm/*`: note, compiti, riunioni, email, allegati) | idem |
| `magazzino` | magazzino (`warehouse`, `magazzino`), registro (`stock`) | idem |
| `produzione` | riepilogo (`production`, `produzione`), prd (tutto `prd/*`) | idem |
| `people` | dipendenti, anagrafica (`hr/directory`), assenze, tipi_assenza, presenze, fascicolo_personale (`hr/me`), documenti | idem |
| `finance` | finance, centri_di_costo | idem |
| `impostazioni` | impostazioni, widget, liste, utenti, ruoli, wine_club, registro_attivita | idem |
| *(sempre)* | `me`, `my-profile`, `logout`, `signed-url`, `notifications`, `home` | nessun codice: basta la sessione |

Le letture condivise diventano **lo stesso codice concesso a più ruoli migrati**, non regole speciali. Esempio: `commerciale.ordini.leggi` va a chi oggi ha commerciale, magazzino, produzione o crm.

Il resolver non conosce più i workspace: li conosce solo la migrazione.

### 6.2 Da `roles.capabilities` (Produzione)

`produzione.prd.approva_enologo`, `produzione.prd.esegue_cantina`, `produzione.prd.caposquadra`, `produzione.prd.registra_vigneto`, `produzione.prd.qualita`.

`sola_lettura` non diventa un codice: è "avere `produzione.prd.leggi` e nessuna capacità". Da verificare nel dettaglio azione per azione su `requireCap` (19 punti).

### 6.3 Da `roles.access_levels`: permessi sensibili (`is_sensitive = true`)

| Livello di oggi | Codice |
|---|---|
| personale | `people.dati_personali.leggi` (sensibile? **Q4**) |
| retributivo | `people.retribuzioni.leggi` · `finance.paghe.leggi` |
| sanitario | `people.idoneita.leggi` |
| disciplinare | `people.disciplinare.leggi` |
| (documenti con livello) | `people.documenti_personali.leggi` |

### 6.4 Nuovi, per l'organigramma e il prompt

- `impostazioni.organigramma.leggi`, `.modifica`, `.pubblica`
- `impostazioni.permessi.concedi` (grant e deleghe)
- `enoturismo.visite.conduce` (filtro operatori)
- Codici SoD del seed che oggi **non hanno una route**: `finance.fornitori.crea`, `finance.pagamenti.approva`, `commerciale.sconti_extra.approva`, `magazzino.rettifiche.crea` / `.approva`, `people.presenze.inserisci_squadra` / `.approva`, `people.ferie.approva`.

Le regole SoD su codici senza route restano **inerti** finché le funzioni non esistono. Oggi, ad esempio, la rettifica di magazzino non ha un'approvazione separata.

### 6.5 Scope

Gli scope `own` / `assigned` / `unit_subtree` sostituiscono la logica di relazione scritta nei moduli:

| Scope | Sostituisce |
|---|---|
| `own` | `isSelf` |
| `unit_subtree` | `isManagerOf` |
| `assigned` | `isTeamLeaderOf` e l'`agent_id` degli agenti |

Oggi le relazioni vengono da `employees.manager_id`. Con l'organigramma verranno da posizioni e unità (vedi **Q3**).

---

## 7. Stack frontend e libreria per l'organigramma

- **Vanilla JS, nessun build step, nessun framework.** `portal.html` pesa 455 KB (CSS e JS inline) più 9 file in `public/js/portal-*.js` caricati con `<script src>`. Nessuna libreria esterna, nessun CDN.
- Drag & drop già presente: HTML5 nativo nel kanban di Magazzino. Non funziona su touch.
- Font Plus Jakarta Sans, accento `#3b6fe0`, tema chiaro (convenzioni del README).
- La sezione **Impostazioni → Ruoli e permessi** esiste già (`portal.html:1838`) come matrice ruoli × workspace. Il nuovo tab *Ruoli e permessi* la sostituisce.

| Opzione | Peso | Compatibilità | Valutazione |
|---|---|---|---|
| React Flow | — | richiede React | ❌ escluso: niente React, niente build |
| d3-org-chart | ~20 KB + **d3 v7 ~280 KB** | vanilla sì, ma rendering SVG e DnD non nativo (va scritto) | ❌ pesante; zoom ed export gratis, ma il DnD tra nodi e l'accessibilità da tastiera vanno costruiti comunque sopra un SVG |
| **SortableJS** | ~45 KB min (~15 KB gzip), 0 dipendenze | vanilla, **liste annidate**, touch e mobile, `group` per spostare tra liste | ✅ **proposta** |
| HTML5 nativo | 0 | già in uso | ⚠️ niente touch, nessun feedback durante il trascinamento su liste annidate |

**Proposta:** organigramma disegnato in **HTML/CSS** (alberi annidati `<ul>` con connettori in CSS, `transform: scale` per lo zoom, rami comprimibili), con **SortableJS** per il drag & drop.
- Copia nella repo: `public/js/vendor/sortable.min.js`, con versione e licenza MIT annotate. Coerente con "nessun CDN", e c'è già il precedente `public/js/vendor/qrcode-generator.js` (lavoro Produzione in corso).
- Il menu "Sposta in…" (obbligatorio per tastiera e mobile) chiama le **stesse** API della bozza, quindi il DnD è solo una scorciatoia.
- Export PDF: foglio di stile di stampa + `window.print()`, nessuna libreria.
- Export PNG: da decidere in Fase 4 (`html-to-image` ~10 KB, oppure solo PDF). Vedi **Q8**.

---

## 8. Rischi e domande aperte

### Rischi trovati

| # | Rischio | Gravità | Proposta |
|---|---|---|---|
| **R1** | **Utente senza ruolo = accesso completo.** `DELETE /api/admin/roles/:id` mette `role_id = NULL` a tutti gli utenti del ruolo: **cancellare un ruolo li promuove ad amministratori**. | Alta | Fase 1: la parità lo riproduce con un ruolo di sistema "Accesso completo" assegnato esplicitamente. Da lì in poi "senza ruolo = nessun permesso". Il fix del delete va subito in Fase 2 (**Q2**). |
| **R2** | Token agente fisso, senza scadenza, nel path dell'URL (finisce in log e cronologia). | Media | Fase 2: sessioni agente con scadenza come `portal_sessions`, mantenendo il login separato. |
| **R3** | Controlli di relazione e livello sparsi nei moduli (62 `hasAccessLevel`, 19 `requireCap`, `isSelf`/`isManagerOf` in 5 file). | Media | È il grosso del lavoro della Fase 2. Il test di parità deve coprire anche questi, non solo `canAccess` (vedi sotto). |
| **R4** | Filtri di visibilità in JS dopo `LIMIT` (§3). | Media | `scopeFilter()` in SQL, Fase 2. |
| **R5** | Il responsabile **oggi vede il giudizio di idoneità** dei collaboratori (`hr-safety.js:61`, `558`, con log in `sensitive_access_log`). La regola 12 del prompt lo vieta. | Decisione | **Q5** |
| **R6** | I livelli sensibili oggi **si assegnano a un ruolo** (`roles.access_levels`); la Fase 5 li vuole solo come grant nominativi. | Decisione | La migrazione trasformerebbe ogni livello sensibile di un ruolo in un `user_grant` per ogni utente del ruolo, con motivazione "Migrazione da ruolo X". Vedi **Q4**. |
| **R7** | Due fonti di verità sulla gerarchia: `employees.manager_id` (usata da assenze, presenze e approvazioni) e `positions.reports_to_position_id`. | Alta | **Q3** |
| **R8** | La cancellazione fisica degli utenti rompe lo storico (§4). | Media | Fase 2: solo disattivazione. |
| **R9** | La chiave master non ha un utente: nel diff e negli audit è "Chiave master"; la validazione anti-escalation va definita per lei. | Bassa | Resta superutente fuori dall'organigramma; non conta come "ultimo utente che può pubblicare" (**Q6**). |
| **R10** | Parità più ampia di "route × utente": per HR e PRD l'esito dipende dal **record**. Esempio: la stessa `GET /hr/absences/:id` è concessa o negata in base a chi è il dipendente. | Media | Il test di parità in Fase 1 confronta `canAccess` di oggi con `can()` su tutte le 494 route × ogni combinazione di ruolo. Le regole di relazione e livello si confrontano con una **batteria di scenari** (dipendente, responsabile, delegato, caposquadra, HR, estraneo) e vengono sostituite in Fase 2 con i test HR esistenti ancora verdi. |

### Cosa esiste già e si riusa (deviazioni dal piano del prompt)

| Il prompt dice | Realtà | Proposta |
|---|---|---|
| Creare `audit_log` (Fase 5) | esiste (`0002_infra`: `actor`, `action`, `entity`, `before_json`, `after_json`, `ip`) | si riusa così com'è |
| Creare `sensitive_access_log (resource_type, resource_id, permission_code)` | esiste con `employee_id`, `what` | si aggiungono colonne (`permission_code`, `resource_type`, `resource_id`), non una tabella nuova |
| `position_assignments.employee_id` con ripiego su `portal_users` | `employees` esiste (`0008_org`) con `portal_user_id` facoltativo (gli stagionali senza login ci sono già) | FK diretta a `employees`, nessun ripiego |
| `org_units.cost_center_id` nullable finché non c'è Finance | `cost_centers` esiste, con 4 livelli di cascata | FK reale da subito |
| Squadre temporanee come `org_units` | esistono `teams` / `team_members` con caposquadra, **senza date** | Q3 |
| Postgres (`ltree`) | SQLite | closure table |
| Migrazioni `up`/`down` numerate | runner esistente | si continua da `0020_*` |

### Domande per Dante

- **Q1 — Database.** Confermi SQLite (decisione D1-A del 24/09) anche per questo lavoro? Il prompt parla di Postgres come obiettivo.
- **Q2 — Utenti senza ruolo.** Dopo la migrazione, "senza ruolo" deve voler dire **nessun accesso**, con gli amministratori di oggi spostati su un ruolo di sistema "Accesso completo"? E correggo subito il delete dei ruoli (R1), anche prima della Fase 2?
- **Q3 — Gerarchia.** L'organigramma pubblicato diventa l'unica fonte e `employees.manager_id` / `delegate_id` si **ricalcolano** da posizioni e unità alla pubblicazione (così assenze e presenze continuano a funzionare senza toccarle)? Oppure restano modificabili a mano in People? E le squadre vendemmia: `teams` esistenti con date aggiunte, oppure `org_units` di tipo `squadra_temporanea` che sostituiscono `teams`?
- **Q4 — Livelli sensibili.** Va bene trasformare i livelli sensibili di oggi in grant nominativi (R6)? Il livello "personale" (anagrafica, contatti privati, orario) è sensibile o si può dare per ruolo? Nel prompt non è nell'elenco dei sensibili, ma oggi dà la visibilità su tutti i dipendenti.
- **Q5 — Idoneità al responsabile.** Oggi il responsabile vede il giudizio di idoneità dei collaboratori (serve per assegnare i lavori). Con la regola 12 non lo vedrebbe più. Toglierlo, o tenerlo come eccezione motivata (solo il giudizio, mai prescrizioni o note, con log)?
- **Q6 — Chiave master.** Resta un superutente fuori dall'organigramma, e non conta per la regola 5 ("ultimo utente che può pubblicare")?
- **Q7 — Cataloghi.** I PDF dei cataloghi sono pubblici? Se no, li porto sotto link firmati (portale) e sessione agente.
- **Q8 — Export PNG.** Serve davvero, o basta il PDF (stampa)?
- **Q9 — Dati di produzione.** Mi fai girare la query del §5 (oppure aggiungiamo una chiave SSH su Railway)? Mi serve prima di scrivere la migrazione di parità.

### Decisioni di Dante (25/09/2026)

| # | Decisione |
|---|---|
| Q1 | **SQLite.** Gerarchia con closure table, SQL portabile nelle tabelle nuove. |
| Q2 | **Senza ruolo = nessun accesso.** Chi oggi è amministratore di fatto riceve il ruolo di sistema "Accesso completo". Non si può cancellare un ruolo ancora assegnato: è la prima modifica dopo l'approvazione. |
| Q3 | **Comanda l'organigramma pubblicato.** Alla pubblicazione si ricalcolano `employees.manager_id` e `delegate_id`, che in People diventano di sola lettura ("da organigramma"). Le `teams` restano, con `valid_from` / `valid_to`; alla scadenza il caposquadra perde i permessi sulla squadra. Nell'organigramma compaiono come squadre temporanee. |
| Q4 | **retributivo, sanitario, disciplinare** → solo `user_grants` nominativi con motivazione. Migrazione: un grant per ogni utente che oggi li ha dal ruolo, motivazione "Migrazione dal ruolo X". **personale** → assegnabile per ruolo, mai ereditato per gerarchia (niente `unit_subtree`). |
| Q5 | Responsabile e caposquadra vedono solo lo stato **assegnabile / assegnabile con limitazioni / non assegnabile** dei propri collaboratori: niente giudizio completo, niente prescrizioni, ogni lettura in `sensitive_access_log`. Il giudizio completo solo con `people.idoneita.leggi` nominativo. È un'eccezione esplicita alla regola 12, da coprire con un test dedicato. |
| Q6 | La chiave master resta superutente fuori dall'organigramma. La pubblicazione è bloccata se lascia **zero utenti reali** con `impostazioni.organigramma.pubblica`. |
| Q7 | I cataloghi si chiudono: download solo con sessione del portale (link firmato) o sessione agente. La scelta prudente, perché i cataloghi per gli agenti possono contenere prezzi e condizioni. Portale e area agenti continuano a funzionare. |
| Q8 | Solo export PDF (foglio di stampa). PNG eventualmente dopo. |
| Q9 | Da decidere dopo la spiegazione. |

⛔ **GATE 0** — attendo "approvato Fase 0".
