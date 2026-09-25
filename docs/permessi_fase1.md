# Organigramma & matrice permessi — Fase 1: report del Gate 1

Stato: **Gate 1, in attesa di approvazione.**
Branch `permessi-organigramma`, in un worktree separato (`cantina-booking-permessi`): la sessione della Produzione sta lavorando in parallelo su `server.js` e non va disturbata. **Non è in produzione.**
Decisioni applicate: quelle del Gate 0 (`docs/audit_permessi.md`, "Decisioni di Dante").

## Cosa è stato fatto

1. **Modello dati** (migrazione `0030_authz_org`, reversibile).

   | Area | Tabelle |
   |---|---|
   | Struttura | `org_units` (+ closure table `org_unit_paths`), `positions`, `position_assignments` |
   | Permessi | `permissions`, `role_permissions` (con scope), `position_roles`, `user_grants`, `delegations`, `effective_permissions` |
   | Separazione dei compiti | `sod_rules` (seed di 4 regole) |
   | `roles` | nuove colonne `description`, `is_system`, `updated_at` |

2. **Catalogo dei permessi** nel codice (`lib/permissions.js`): **115 codici**, copiati all'avvio nella tabella `permissions`.
   - Uno `.leggi` e uno `.scrivi` per ogni gruppo di API di oggi.
   - Le 5 capacità di Produzione.
   - I livelli HR: `people.dati_personali.leggi`, più 5 sensibili.
   - I codici di organigramma, deleghe, operatori e SoD.
3. **Resolver** (`lib/authz.js`):
   - `can(req, codice, risorsa?)`: tutti gli scope (`all`, `unit`, `unit_subtree`, `own`, `assigned`);
   - `canRoute(req, metodo, path)`: il permesso di una chiamata HTTP;
   - `scopeFilter(req, codice, colonne)`: frammento SQL per filtrare le liste;
   - `explain(utente, codice)`: la base di "Perché posso?";
   - cache in memoria per utente, svuotata al login e a ogni ricalcolo.
4. **Permessi effettivi**: tabella materializzata, ricalcolata in tre momenti:
   - quando cambiano ruoli o utenti;
   - all'avvio;
   - ogni ora, con il job `authz.recompute`, così concessioni e deleghe iniziano e scadono da sole.
5. **Migrazione a parità**:
   - ogni ruolo riceve i permessi equivalenti ai suoi workspace, al livello "personale" e alle capacità;
   - i livelli sensibili del ruolo (retributivo, sanitario, disciplinare) diventano **concessioni nominative** per ogni utente del ruolo, con motivazione "Migrazione dal ruolo X";
   - chi non aveva un ruolo riceve il ruolo di sistema **"Accesso completo"**;
   - ogni utente ha una posizione sua nell'unità **"Da classificare"**, con il suo ruolo.
6. **Decisione Q2, già attiva:**
   - senza ruolo = nessun modulo (resta solo il proprio profilo);
   - un ruolo assegnato o di sistema non si cancella (409, con i nomi degli utenti a cui è assegnato).
7. **Allineamento dal vivo:** finché l'accesso lo decide `lib/security.js` (fino alla Fase 2), creare o modificare ruoli e utenti da Impostazioni aggiorna in automatico permessi, posizione e concessioni.

## File toccati

| File | Cosa |
|---|---|
| `lib/permissions.js` | nuovo: catalogo, route → permesso, equivalenza con i ruoli di oggi |
| `lib/authz.js` | nuovo: resolver, ricalcolo, closure table, migrazione dei dati |
| `migrations/0030_authz_org.js` | nuova migrazione (`up`/`down`) |
| `server.js` | resolver collegato; ricalcolo orario; "senza ruolo = nessun accesso"; blocco del delete dei ruoli; allineamento su ruoli e utenti; cache svuotata al login |
| `test/authz.test.js` | nuovo, 10 test |
| `test/security.test.js` | l'asserzione "senza ruolo = accesso completo" diventa "senza ruolo = 403" (decisione Q2) |
| `test/migrations.test.js` | il DB minimo del test ha le colonne `roles.name` e `portal_users.role_id` che la 0030 usa |
| `README.md`, `CHANGELOG.md` | aggiornati |

## Test

`npm test`: **154 su 154** (144 esistenti + 10 nuovi).

**Test di parità (regola 28).**
1. Annulla la migrazione 0030.
2. Crea 18 ruoli "come oggi" (ogni workspace da solo, combinazioni, tutti i livelli, capacità compresa `sola_lettura`) e utenti senza ruolo, attivi e disattivati.
3. Riapplica la 0030.
4. Confronta, per **ogni utente × ogni API protetta** (tutte le route con `authAdmin`), il vecchio `canAccess()` con `canRoute()`.
5. Fa lo stesso per ogni livello di riservatezza e ogni capacità.

Esito: **0 differenze su circa 9.000 controlli**. Verifica anche che la seconda esecuzione non cambi nulla (idempotenza).

**Prova sui dati veri:** ho applicato la migrazione a una copia del database locale. L'unico utente, che era senza ruolo, riceve "Accesso completo": 96 permessi dal ruolo + 3 concessioni nominative sensibili.

## Regole quando/allora coperte

| # | Regola | Test |
|---|---|---|
| 4 | niente cicli nella gerarchia (closure table + CHECK) | ✔ |
| 9 | `unit_subtree`: sottoalbero sì, unità sorelle no | ✔ (resolver e SQL) |
| 10 | un permesso sensibile non si associa a un ruolo | ✔ (trigger su insert e update) |
| 12 | nessun sensibile ereditato con `unit_subtree` | ✔ (stesso trigger, più esclusione nel ricalcolo) |
| 16 | la delega scade da sola | ✔ (e non passa i permessi sensibili né quelli che il delegante non ha) |
| 17 | concessione senza motivazione non si salva | ✔ (CHECK nel DB) |
| 18 | dipendente senza account: nodo sì, permessi no | ✔ |
| 19 | account creato: eredita i permessi della posizione | ✔ |
| 23 | filtro di scope in SQL | ✔ per `scopeFilter` (l'uso nelle liste arriva in Fase 2) |
| 28 | parità della migrazione | ✔ |

Le altre regole appartengono alle fasi 2–5.

## Diff delle route

**Nessuna route cambia comportamento**, con un'eccezione voluta: gli utenti **senza ruolo** ora ricevono 403 su tutti i moduli (Q2). Chi era senza ruolo al momento della migrazione ha "Accesso completo", quindi l'effetto riguarda solo gli utenti creati d'ora in poi senza ruolo.

In più, `DELETE /api/admin/roles/:id` risponde 409 se il ruolo è assegnato o è di sistema.

## Deviazioni dal piano e perché

- **Migrazione `0030`, non `0020`:** la Produzione ha già una `0020` non committata. Il runner applica comunque tutte le migrazioni mancanti.
- **`position_assignments` ha sia `employee_id` sia `portal_user_id`** (almeno uno dei due): chi ha un account ma non è un dipendente (per esempio un consulente) deve comunque poter avere una posizione.
- **`positions.legacy_portal_user_id`** identifica la posizione creata dalla migrazione per un utente, anche quando l'organigramma la sposterà. Serve all'allineamento con i ruoli finché la Fase 2 non lo elimina.
- **`user_grants.source_role_id`** distingue le concessioni nate dalla migrazione, che l'allineamento aggiunge e toglie, da quelle fatte a mano, che non tocca mai.
- **`org_units.team_id`** collega un'unità "squadra temporanea" alla squadra di People (decisione Q3).
- **`sola_lettura`** non diventa un permesso: vuol dire "nessuna capacità", così i permessi restano solo additivi.
- **Gli scope `unit` / `unit_subtree` si danno solo tramite posizione**, perché serve un'unità di riferimento. Le concessioni nominative hanno solo `all`, `own` e `assigned`.
- **Il test di parità non copre ancora le regole "sé stesso / responsabile / caposquadra"** scritte nei moduli HR (R10). Vengono sostituite in Fase 2, con i test HR esistenti che devono restare verdi.

## Domande per Dante

1. **Unione con la Produzione.** Prima di andare in produzione il branch va unito al lavoro della Produzione, che è ancora non committato. Lo faccio io quando quella sessione ha committato, oppure preferisci gestirlo tu?
2. **Deploy.** Non ho fatto deploy (la regola è rivedere prima di `railway up`). Visto che il gestionale non è usato, vuoi che vada in produzione alla fine della Fase 2, insieme al passaggio a `can()` su tutte le route?

⛔ **GATE 1** — attendo "approvato Fase 1".
