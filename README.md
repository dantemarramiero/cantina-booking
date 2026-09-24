# Cantina Booking — Marramiero

Piattaforma di prenotazione visite/esperienze in cantina **+ ERP interno** (commerciale, produzione, magazzino) per l'azienda vinicola Marramiero.

- **Sito pubblico**: prenotazione esperienze in cantina, pagamento via Stripe (opzionale)
- **Admin Enoturismo**: gestione prenotazioni, calendario, esperienze, codici sconto, recensioni, newsletter, operatori, CRM B2C
- **Portale ERP interno**: CRM B2B (agenti/clienti), listini, ordini, magazzino, produzione, news e cataloghi condivisi
- **Portale agenti**: area riservata per la rete vendita, con login proprio, per inserire ordini e consultare le proprie statistiche

## Stack

Node.js + Express, **`node:sqlite`** (nessun ORM, SQL diretto), pagine multi-file statiche senza build step (HTML+CSS+JS inline per pagina). Deploy su [Railway](https://railway.app).

## Struttura del progetto

```
server.js              Backend monolitico: schema DB, tutte le API REST
package.json
.env.example            Variabili d'ambiente di riferimento (copiare in .env)

public/
  index.html             Sito pubblico (prenotazione esperienze)
  admin.html             Admin Enoturismo (prenotazioni, calendario, CRM B2C...)
  portal.html             Portale ERP interno (Commerciale / Produzione / Magazzino)
  agent.html              Portale agenti (login proprio, ordini, storico, crediti...)
  css/, js/, img/         Asset del sito pubblico
  uploads/products/       Immagini prodotto caricate da admin (persistite su volume Railway in produzione)

catalogs/                Cataloghi PDF caricati da Commerciale (persistiti su volume Railway in produzione)
cantina.db               Database SQLite (creato automaticamente al primo avvio, mai in git)
```

Non c'è una cartella `routes/`, `models/` ecc.: è una scelta deliberata per un progetto di queste dimensioni (single-tenant, un solo sviluppatore/agente AI, niente build step). Se il progetto crescesse molto, il prossimo passo naturale sarebbe estrarre `server.js` (>2000 righe) in moduli per dominio (`routes/agents.js`, `routes/orders.js`, `db/schema.js`...).

## Setup locale

```bash
npm install
cp .env.example .env     # poi compila le variabili che ti servono
npm run dev               # nodemon, riavvio automatico
# oppure
npm start                 # produzione
```

Il server crea `cantina.db` automaticamente al primo avvio (SQLite, file singolo).

**Schema e migrazioni.** Le tabelle storiche sono create all'avvio da `server.js` (baseline `migrations/0001`). Ogni modifica nuova passa da una migrazione versionata in `migrations/NNNN_nome.js` (`up`/`down`), applicata da sola all'avvio in una transazione, dopo aver copiato il database in `backups/` (tiene le ultime 10 copie).
- `npm run migrate -- status`: elenco delle migrazioni applicate.
- `npm run migrate -- down`: annulla l'ultima (con copia di sicurezza).

**Test.** `npm test` avvia l'app su un database temporaneo e verifica:
- migrazioni, accessi e permessi;
- eventi di dominio e job;
- gli automatismi esistenti: Persone, contatti, magazzino, wine club, obiettivi.

Va lanciato prima di ogni deploy.

- Sito pubblico: `http://localhost:3000`
- Admin Enoturismo: `http://localhost:3000/admin.html`
- Portale ERP: `http://localhost:3000/portal.html`
- Portale agenti: `http://localhost:3000/agent.html`

## Autenticazione

Due modi di entrare, validi per `admin.html` e `portal.html`:

1. **Chiave amministratore** (`ADMIN_PASSWORD`, variabile d'ambiente): accesso master, utile come fallback e per il primo avvio.
2. **Utenti del portale** (tabella `portal_users`, gestiti da Impostazioni → Utenti del portale): username e password individuali, con **recupero password via email** (link di reset valido 1 ora). Il primo utente va creato con la chiave amministratore.

In entrambi i casi il login crea una **sessione**: il browser tiene solo un token, la chiave non viaggia più con ogni richiesta e non si accetta più negli URL (`?key=`).
- La sessione scade dopo 12 ore senza attività e comunque dopo 7 giorni.
- Si chiude al logout, quando l'utente viene disattivato e quando cambia la password.
- Dopo 10 tentativi sbagliati in 15 minuti dallo stesso indirizzo il login si blocca.

**Permessi per modulo** (ruoli in Impostazioni → Ruoli e permessi): sono controllati dal server su ogni API, non solo nell'interfaccia. La mappa "API → moduli che possono leggere/scrivere" è in `lib/security.js`. Gli utenti senza ruolo hanno accesso completo.

**Download ed export** (CSV, allegati CRM, foto delle fiere): passano da link firmati dal server, validi pochi minuti e legati alla sessione.

Accessi, modifiche a utenti, ruoli, impostazioni e Customizations finiscono nel **registro attività** (`GET /api/admin/audit-log`).

Il **portale agenti** (`agent.html`) ha un sistema separato: ogni agente ha username/password propri (generati alla creazione in CRM → Agenti), sessione persistita in `localStorage`.

## Variabili d'ambiente principali

Vedi `.env.example` per l'elenco completo. Le più importanti:

| Variabile | Obbligatoria | Note |
|---|---|---|
| `ADMIN_PASSWORD` | consigliata | Chiave amministratore master |
| `DB_PATH` | no | Path del file SQLite (in produzione: volume persistente Railway) |
| `RAILWAY_VOLUME_MOUNT_PATH` | no | Cartella dei dati persistenti (database, allegati, cataloghi, foto in `uploads/`, copie in `backups/`). Su Railway la imposta il volume. |
| `SIGNING_SECRET` | no | Segreto per firmare i link di download. Se manca, viene generato al primo avvio e conservato nel database. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | no | Senza queste, il checkout pubblico usa la modalità "richiesta di prenotazione" (nessun pagamento online) |
| `GMAIL_USER` + `GMAIL_PASS` oppure `RESEND_API_KEY` | no | Necessarie per: conferme prenotazione, avvisi scorte magazzino, **reset password utenti portale**. Senza provider configurato, le email vengono solo loggate in console. |

## Deploy (Railway)

Progetto Railway: **cantina-marramiero**, servizio: **cantina-booking**, ambiente: **production**.

```bash
railway up --service cantina-booking --environment production
```

- Dominio custom: `https://prenotazioni.marramiero.it`
- Dominio Railway (fallback): `https://cantina-booking-production.up.railway.app`
- Volume persistente montato su `/data` (`RAILWAY_VOLUME_MOUNT_PATH`): contiene `cantina.db` e dovrebbe contenere anche `catalogs/` e `public/uploads/products/` per sopravvivere ai redeploy (verificare in caso di problemi di persistenza immagini/PDF dopo un deploy).

## Moduli principali

- **Enoturismo (B2C)**: esperienze (galleria immagini, descrizione, prodotti in degustazione, durata, lingue, facility services, disponibilità ricorrente per-esperienza con generazione automatica slot), slot/calendario, prenotazioni, codici sconto, recensioni, newsletter, operatori, CRM visitatori (con tracciamento e-commerce/negozio fisico)
- **CRM (B2B, workspace top-level)**: tab Clienti / Agenti / Importatori / Fornitori, ognuno con pagina anagrafica in stile Zoho (Informazioni di base, Overview, Email — log manuale, Note, Allegati, Riunioni, Compiti, Affari, Ordini). Clienti/Importatori/Fornitori condividono lo stesso modello dati (contatti, indirizzi fatturazione/spedizione, dati business); Agenti hanno credenziali proprie per il portale ordini e provincie di competenza
- **Commerciale**: ordini, listini, import Excel, News e Catalogo (contenuti creati qui, visibili nel portale agenti)
- **Magazzino**: Kanban ordini (drag&drop tra Nuovo/In lavorazione/Sospeso/Evaso, sincronizzato con Commerciale), nota magazziniere per ordine (visibile a Commerciale e all'agente), prodotti finiti/materie prime con soglie e alert email
- **Produzione**: riepilogo per bottiglia/cliente/etichetta, righe ordine da produrre
- **Portale agenti**: dashboard performance, nuovo ordine, storico ordini, news, catalogo, recupero crediti (scadenze pagamento), venduto

## Convenzioni di sviluppo

- Migrazioni schema: sempre additive (`try { db.exec('ALTER TABLE ... ADD COLUMN ...') } catch {}`), mai distruttive
- Nessun framework frontend: HTML+CSS+JS vanilla per pagina, niente bundler
- Font: Bodoni Moda + Montserrat per il sito pubblico (brand Marramiero), Plus Jakarta Sans per gli strumenti interni (admin/portal/agent)
- Palette strumenti interni: tema chiaro, accento blu `#3b6fe0` — da non cambiare senza indicazione esplicita
