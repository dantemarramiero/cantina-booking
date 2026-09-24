# People e Finance — Prerequisiti (P1–P7): consegna

Stato: **completato in locale, in attesa di conferma** (non ancora in produzione).
Decisioni D1–D10 della Fase 0 accettate il 24/09/2026.

## Cosa è stato fatto

| # | Prerequisito | Dove |
|---|---|---|
| P1 | Migrazioni versionate con baseline e copia di sicurezza prima di ogni migrazione | `lib/migrations.js`, `migrations/0001_baseline.js` (+ `.sql`), `migrations/0002_infra.js`, `scripts/migrate.js` |
| P2 | Test automatici su database temporaneo (`npm test`) | `test/*.test.js`, `test/helpers.js` |
| P3 | Sessioni con scadenza, permessi per modulo lato server, link firmati, blocco dei login ripetuti, chiave fuori da log e URL | `lib/security.js`, `authAdmin` in `server.js`, login di `portal.html` e `admin.html` |
| P4 | Eventi di dominio con outbox e consumer idempotenti | `lib/events.js` |
| P5 | Registro attività | `lib/audit.js`, `GET /api/admin/audit-log` |
| P6 | Notifiche nel portale e job periodici | `lib/notifications.js`, `lib/scheduler.js`, `GET/POST /api/admin/notifications` |
| P7 | Foto di prodotti ed esperienze sul volume persistente | `uploads/` in `DATA_DIR`, servita come `/uploads` |

## Migrazioni create

- `0001_baseline`: segna lo schema storico, 50 tabelle e 52 indici (fotografia in `0001_baseline.sql`). Non si annulla.
- `0002_infra`: `portal_sessions`, `domain_events`, `event_consumptions`, `event_failures`, `audit_log`, `notifications`, `job_runs`. Si annulla con `npm run migrate -- down`.

## Eventi di dominio

Per ora c'è solo l'infrastruttura: nessun modulo emette ancora eventi. Il catalogo della Fase 0 resta valido; i primi eventi arriveranno con la Fase 1 e la Fase 2.
Un evento si emette nella stessa transazione del documento (`events.transaction(() => { …; events.emit(tipo, …) })`) e si elabora con `events.dispatch()` dopo il commit. Il dispatch riparte anche da solo, ogni minuto.

## Regole QUANDO/ALLORA implementate, con il test che le verifica

| Regola | Test |
|---|---|
| QUANDO si entra con la chiave master ALLORA si crea una sessione; la chiave da sola (header o URL) non vale più | `security` · la chiave master si scambia con una sessione |
| QUANDO un utente fa login ALLORA riceve un token di sessione; la sua chiave fissa non vale più | `security` · la chiave fissa di un utente non vale più |
| QUANDO una sessione è inattiva da 12 ore, ha più di 7 giorni o si fa logout ALLORA non vale più | `security` · la sessione scade… |
| QUANDO un utente viene disattivato ALLORA le sue sessioni si chiudono subito | `security` · disattivare un utente… |
| QUANDO cambia o si reimposta la password ALLORA le altre sessioni si chiudono | coperto dal codice (`revokeUser`), test da aggiungere con l'email di reset |
| QUANDO un utente con ruolo chiama un'API di un modulo non suo ALLORA 403; gli elenchi di consultazione restano leggibili dove servono | `security` · i permessi per modulo sono controllati dal server |
| QUANDO si aggiunge una nuova API senza modulo assegnato ALLORA il test fallisce | `security` · ogni API del portale ha un modulo assegnato |
| QUANDO si scarica un export o un allegato ALLORA serve un link firmato, legato a percorso e sessione, che scade | `security` · i download passano da link firmati… |
| QUANDO ci sono 10 login sbagliati in 15 minuti dallo stesso indirizzo ALLORA blocco temporaneo | `security` · troppi tentativi… |
| QUANDO si accede o si modificano utenti, ruoli, impostazioni, Customizations ALLORA una riga nel registro attività, mai con password o hash | `security` · accessi e modifiche… |
| QUANDO il server parte con migrazioni in sospeso ALLORA copia del database e poi applicazione in ordine, ognuna in transazione | `migrations` · 5 test |
| QUANDO la transazione del documento fallisce ALLORA il suo evento non esiste | `platform` · evento in transazione annullata |
| QUANDO il dispatch gira più volte ALLORA ogni consumer elabora un evento una sola volta | `platform` · idempotenza |
| QUANDO un consumer fallisce ALLORA si annulla solo il suo lavoro, gli altri proseguono, si riprova al giro dopo (max 10 tentativi) | `platform` · consumer che fallisce |
| QUANDO un job fallisce ALLORA si riprova dopo 15 minuti, non a ogni minuto | `platform` · job fallito |
| QUANDO la stessa notifica ha la stessa chiave di deduplica ALLORA arriva una volta sola | `platform` · notifiche |
| Regressione: Persone uniche (email, telefono), contatti multi-azienda, scarico magazzino, wine club, copia obiettivi, liste protette, foto sul volume | `regression` · 8 test |

Esito al 24/09/2026: **31 test, 31 superati.**

## Punti toccati nei moduli esistenti

- **Tutte le API `/api/admin`**:
  - richiedono una sessione (non più la chiave);
  - rispettano i permessi del ruolo (`lib/security.js` → `API_WORKSPACES`);
  - in produzione oggi non ci sono utenti con ruolo, quindi per ora non cambia niente per nessuno.
- **Login di `portal.html` e `admin.html`**: la chiave master si scambia con una sessione; logout lato server.
- **Passaggio tra Enoturismo e portale**: senza chiave nell'URL; i vecchi link con `?key=` vengono ripuliti e portano al login.
- **Export CSV** (calendario, newsletter), **allegati CRM**, **foto delle fiere**: link firmati.
- **Foto**: caricate sul volume, non più in `public/uploads`. La foto prodotto già persa in produzione va ricaricata.
- **Log di avvio**: non stampano più la chiave.
- **Utenti, ruoli, impostazioni, wine club, liste**: scrivono nel registro attività.

## Decisioni prese in autonomia

- Durata delle sessioni: 12 ore di inattività, massimo 7 giorni.
- Blocco dei login: 10 tentativi in 15 minuti per indirizzo.
- Durata dei link firmati: 10 minuti per gli export, 30 minuti per foto e allegati mostrati in pagina.
- Job falliti riprovati dopo 15 minuti.
- Consumer riprovati fino a 10 volte, poi l'evento resta in `event_failures`.
- **Campanella delle notifiche**: l'API c'è, il pulsante arriva con la Fase 2, quando esisteranno le prime notifiche (una campanella sempre vuota confonderebbe).
- **Railway Bucket** (decisione D4): si crea con il fascicolo HR della Fase 2. Per le foto, pubbliche per natura, basta il volume che già esiste.
- La colonna `portal_users.access_key` resta nello schema ma non è più accettata.
- I **livelli di riservatezza** e i workspace `people` e `finance` arrivano con la migrazione `0003`, insieme ai primi dati HR (Fase 1–2), non prima.

## Decisioni aperte

1. Le durate delle sessioni vanno bene? Una cantina con il portale aperto tutto il giorno potrebbe preferire 24 ore.
2. **Backup del volume Railway**: da attivare o verificare dal pannello Railway. Le copie automatiche prima delle migrazioni stanno sullo stesso volume e non sostituiscono un backup esterno.
3. **Dopo il deploy tutti devono rifare il login**: le chiavi salvate nei browser non valgono più.
