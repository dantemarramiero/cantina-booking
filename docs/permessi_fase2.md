# Organigramma & matrice permessi — Fase 2: report del Gate 2

Stato: **Gate 2, in attesa di approvazione.**
Branch `permessi-organigramma`, allineato a `main` del 27/09 (Timesheet personale compreso). **Non è in produzione.**

## Cosa è stato fatto

1. **Un solo controllo sul server.** `authAdmin` e i link firmati chiedono `authz.canRoute()`, che legge i permessi effettivi; la mappa dei workspace non decide più.
   - `hasAccessLevel()` (livelli HR) e `capabilitiesFor()` (capacità di Produzione) sono tradotti in permessi.
   - Nessun modulo legge più `roles.workspaces`, `access_levels` o `capabilities` per decidere un accesso.
   - I workspace mostrati nel menu vengono dai ruoli che l'utente ha oggi (`authz.rolesOf`): l'interfaccia nasconde, il server blocca.
   - `hasWorkspace()` è stato eliminato. L'unico uso rimasto (download dei documenti HR) chiede `people.dipendenti.leggi`.
2. **Route chiuse** (individuate nell'audit):
   - **cataloghi PDF** (Q7): niente più download pubblico. Dal portale `GET /api/admin/catalogs/:id/download` con link firmato; dall'area agenti `GET /api/agent/:token/catalogs/:id/download`;
   - **conferma del ritiro con QR**: serve una sessione del portale con `enoturismo.ritiri.scrivi`. Chi scansiona il QR senza accesso vede un login del personale; la sessione resta su quel dispositivo, quello del negozio, finché scade.
3. **Agenti (R2):**
   - al login ricevono una **sessione con scadenza** (`agent_sessions`, migrazione `0031`, 12 h di inattività / 7 giorni), al posto del token fisso;
   - il token fisso non vale più per entrare;
   - nuova password, token rigenerato o logout chiudono le sessioni;
   - login con blocco dopo troppi tentativi.
   - L'agente vede solo i dati assegnati a lui: le query filtrano già `agent_id` in SQL (scope `assigned` per costruzione).
4. **Utenti (regola 20, R8):** `DELETE /api/admin/portal-users/:id` ora **disattiva**. La riga, l'operatore collegato e lo storico restano, le sessioni si chiudono, nel registro va `portal_user.deactivated`.
5. **Assenze (R4, regola 23):** la visibilità (sé stesso, collaboratori, pratiche da decidere) è nella query, prima del `LIMIT 500`. Il test dimostra il bug con il codice vecchio (fallisce) e la correzione con quello nuovo (passa).
6. **Operatori delle visite:** impostazione `operators_selection` (`tutti` di default, oppure `permesso`). Con `permesso` sono selezionabili solo gli utenti con `enoturismo.visite.conduce`. L'API espone `selectable` e l'Admin Enoturismo lo usa nelle scelte.

## File toccati

| File | Cosa |
|---|---|
| `server.js` | controllo con `can()`; helper dei livelli e delle capacità; `staffWith()` per il ritiro; cataloghi; sessioni agenti; utenti disattivati; operatori |
| `lib/security.js` | `createSessions` riusabile per un'altra tabella (agenti) |
| `lib/authz.js` | `rolesOf()` |
| `migrations/0031_agent_sessions.js` | nuova (`up`/`down`) |
| `modules/hr-file.js` | download documenti: permesso invece del workspace |
| `modules/hr-absences.js` | visibilità nella query |
| `public/portal.html` | catalogo con link firmato; testo di "rimuovi utente" |
| `public/agent.html` | link del catalogo con la sessione |
| `public/index.html` | login del personale per confermare il ritiro (IT/EN) |
| `public/admin.html` | operatori selezionabili |
| `test/authz-enforcement.test.js` | nuovo, 8 test |
| `README.md`, `CHANGELOG.md` | aggiornati |

## Test

`npm test`: **188 su 188**. Il test di parità della Fase 1 resta verde e adesso confronta il vecchio controllo con quello che decide davvero.

**Verifica nel browser:** su un server locale, con una copia del database.
- La pagina del QR mostra il login del personale; dopo l'accesso l'ordine risulta ritirato.
- Portale, Admin Enoturismo e area agenti si caricano senza errori in console.

**Nota:** un test HR già esistente ("cambio mansione…", `hr-safety.test.js`) è fallito una volta su tre esecuzioni complete. Da solo passa sempre, e non tocca codice di questa fase: sembra instabile. Da guardare a parte.

## Regole quando/allora coperte

| # | Regola | Test |
|---|---|---|
| 20 | utente disattivato: operatore e storico restano | ✔ |
| 21 | l'agente vede solo i propri clienti | ✔ (più sessione, scadenza, revoca) |
| 22 | senza permesso: 403 e nessun dato parziale | ✔ |
| 23 | filtro di visibilità in SQL | ✔ (assenze, con 520 righe di altri) |
| — | il server decide con `can()` (una concessione nominativa apre solo l'API concessa) | ✔ |
| — | cataloghi, conferma del ritiro, operatori per permesso | ✔ |

Coperte in Fase 1: 4, 9, 10, 12, 16, 17, 18, 19, 28.

## Diff delle route

| Route | Prima | Adesso |
|---|---|---|
| `GET /api/catalogs/:id/download` | pubblica | **rimossa** (404) |
| `GET /api/admin/catalogs/:id/download` | — | nuova, `commerciale.cataloghi.leggi`, anche con link firmato |
| `GET /api/agent/:token/catalogs/:id/download` | — | nuova, sessione agente |
| `POST /api/pickup-orders/verify/:token/pickup` | bastava il token del QR | sessione del personale + `enoturismo.ritiri.scrivi` |
| `POST /api/agent/login` | restituiva il token fisso | restituisce una sessione; blocco dopo troppi tentativi |
| `POST /api/agent/:token/logout` | — | nuova |
| `/api/agent/:token/*` | token fisso | solo sessione valida (401 altrimenti, prima 404) |
| `DELETE /api/admin/portal-users/:id` | cancellava la riga | disattiva |
| `GET /api/admin/hr/absences` | filtro dopo `LIMIT 500` | filtro nella query |
| `GET /api/admin/operators` | — | in più il campo `selectable` |

Tutte le altre route danno lo stesso esito di prima (test di parità).

## Proposta (non implementata): unificare gli agenti nel portale

Oggi gli agenti hanno un login separato (`agents`, `agent_sessions`). La proposta:
- ogni agente diventa un utente del portale (`portal_users`) con un ruolo "Agente": `crm.clienti.*`, `commerciale.ordini.*` e gli altri permessi necessari, con **scope `assigned`**;
- `customers.agent_id`, `importers.agent_id` e `orders.agent_id` restano il legame, letto da `scopeFilter` come colonna `assigned`.

In cambio si ha un solo login, una sola sessione, l'organigramma con una sezione "Rete commerciale esterna", deleghe e registro attività anche per gli agenti. Il costo: migrare credenziali e ID, e riscrivere `agent.html` sulle API del portale. Va fatto quando si rifà l'area agenti, non prima.

## Deviazioni dal piano e perché

- **Le regole "sé stesso / responsabile / caposquadra" dei moduli HR restano nei moduli.** Sono regole sul record, non sul workspace, e oggi dipendono da `employees.manager_id`. Con la decisione Q3 il responsabile verrà dall'organigramma pubblicato (Fase 3). Spostarle ora in `can()` vorrebbe dire farlo due volte. Nel frattempo il filtro delle assenze è corretto in SQL.
- **Destinatari delle notifiche** (`workspaceUsers`): non è un controllo di accesso e legge ancora i workspace dei ruoli. Si allinea in Fase 3, insieme ai ruoli multipli per posizione.
- **L'opzione degli operatori** si imposta dall'API delle impostazioni. L'interruttore in Customizations arriva con la UI della Fase 4.

## Domande per Dante

1. **Deploy:** la Fase 2 cambia comportamenti visibili (agenti da riloggare, ritiro con login, cataloghi). Visto che il gestionale non è usato, propongo di **pubblicarla ora**, dopo la revisione obbligatoria: unione in `main`, `npm test`, `railway up`. Così la Fase 3 parte da ciò che è in produzione. Procedo?
2. **Test instabile:** lo segno come attività separata o lo guardo io prima del deploy?

⛔ **GATE 2** — attendo "approvato Fase 2".
