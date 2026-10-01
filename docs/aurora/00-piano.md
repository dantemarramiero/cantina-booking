# Database su Aurora PostgreSQL — piano

Stato: **proposta, non approvata (01/10/2026)**. Nessuna modifica al codice in questa fase. Decisione consigliata: prima il trasferimento su **EC2 + SQLite** con la copia giornaliera su S3 (Linear CAN-5, `deploy/aws/README.md`); Aurora solo come progetto separato, se e quando serve.

Base dell'analisi: repository al commit `e0e590c` più la copia su S3 (branch `claude/magical-lamport-wa45s3`).

## Perché è un lavoro grosso

Aurora è un server di database compatibile con PostgreSQL o MySQL. L'app è scritta per SQLite: un file letto direttamente dal processo, con l'API **sincrona** di `node:sqlite` (`DatabaseSync`). Passare ad Aurora non è una copia dei dati, è la riscrittura del modo in cui il codice parla col database.

Misure sul codice (`server.js`, `lib/`, `modules/`, `scripts/`, `migrations/`):

| Cosa | Quante |
|---|---|
| Query (`.prepare(`) | 1.287 |
| Istruzioni di schema (`db.exec(`) | 238 |
| File che usano il database | 51 (circa 14.000 righe) |
| `datetime(` / `date(` / `strftime(` / `julianday(` | 86 / 28 / 4 / 2 |
| `lastInsertRowid` | 107 |
| `INSERT OR IGNORE` / `INSERT OR REPLACE` | 16 / 1 |
| Colonne `AUTOINCREMENT` | 92 |
| Trigger con `RAISE(ABORT)`, `PRAGMA`, `VACUUM INTO` | 2, 6, 4 |
| Migrazioni | 43 |
| Test (avviano l'app su un file SQLite temporaneo) | 212 |

Con Aurora ogni query passa dalla rete e diventa asincrona (`await`): cambia quasi ogni funzione che legge o scrive dati, e ogni API che le chiama.

## Fase 0 — Decidere (1 giorno)

1. Scrivere **perché** serve Aurora. Motivi validi: più server dell'app insieme, failover automatico, database gestito con ripristino a un istante preciso. Se il motivo è «un database sicuro su AWS», EC2 + SQLite + copia su S3 lo dà già, a una frazione del costo.
2. Scegliere **Aurora PostgreSQL**, non MySQL: è più vicino all'SQL già scritto (`ON CONFLICT`, `CHECK`, trigger, indici parziali).
3. Stimare il costo con l'AWS Pricing Calculator. Aurora Serverless v2 al minimo (0,5 ACU) gira sempre, più storage e I/O: diverse volte il costo di un piccolo server Lightsail. **RDS PostgreSQL** (non Aurora) costa meno e richiede la stessa identica riscrittura.

## Fase 1 — Infrastruttura AWS (2–3 giorni)

1. **Rete (VPC):** due subnet private in due zone di disponibilità per il database, una subnet pubblica per il server dell'app.
2. **Security group:** il database accetta la porta 5432 **solo** dal security group del server dell'app, mai da internet.
3. **Cluster Aurora PostgreSQL:**
   - Serverless v2, 0,5–2 ACU, regione `eu-south-1`;
   - cifratura attiva (KMS) e protezione dalla cancellazione;
   - backup automatici conservati 14–35 giorni;
   - Performance Insights attivo.
4. **Secrets Manager** per utente e password del database: mai nel codice né in file `.env` nel repository.
5. **Server dell'app** nella stessa rete: vale il piano di `deploy/aws/`. Lightsail raggiunge Aurora solo con il VPC peering; EC2 qui è più semplice.
6. **Un secondo cluster piccolo di «staging»** per le prove.

## Fase 2 — Riscrittura dello strato dati (la parte grossa: settimane)

1. Aggiungere il driver `pg` e un nuovo `lib/db.js` con il pool di connessioni e le funzioni `one`, `all`, `run`, `transaction`. Una transazione deve usare sempre la stessa connessione: la si può portare con `AsyncLocalStorage`.
2. Rendere **`async`** ogni funzione che usa i dati e ogni handler Express, con la gestione degli errori. Lo scheduler accetta già job asincroni (copia su S3); servono anche il dispatch degli eventi (`events.transaction`) e i job di ogni modulo.
3. Scrivere **un nuovo schema PostgreSQL** uguale allo schema finale di oggi. Le 43 migrazioni non si portano una per una: la nuova serie di migrazioni riparte da lì.
4. Tradurre l'SQL:

   | SQLite | PostgreSQL |
   |---|---|
   | segnaposto `?` | `$1, $2…` |
   | `INTEGER PRIMARY KEY AUTOINCREMENT` | `GENERATED ALWAYS AS IDENTITY` |
   | `lastInsertRowid` | `INSERT … RETURNING id` |
   | `INSERT OR IGNORE` / `OR REPLACE` | `ON CONFLICT DO NOTHING` / `DO UPDATE` |
   | `datetime('now','localtime')`, `date()`, `strftime()`, `julianday()` | `now()`, `AT TIME ZONE 'Europe/Rome'`, `to_char()`, aritmetica sulle date |
   | trigger con `RAISE(ABORT, …)` | funzioni PL/pgSQL con `RAISE EXCEPTION` |
   | `PRAGMA foreign_keys`, migrazioni che ricostruiscono le tabelle | non servono |
   | `ALTER TABLE` dentro `try {}` | `ADD COLUMN IF NOT EXISTS` |
   | `LIKE` (non distingue maiuscole in ASCII) | `ILIKE` |

5. PostgreSQL è **più severo**:
   - confrontare testo e numeri è un errore;
   - `GROUP BY` deve elencare ogni colonna selezionata;
   - un testo che non è una data valida non entra in una colonna di date.

   Per limitare le modifiche, all'inizio le date restano testo e i booleani 0/1.
6. **Togliere ciò che Aurora sostituisce:** le copie `VACUUM INTO` prima delle migrazioni e la parte database della copia su S3 (ci pensano gli snapshot di Aurora e AWS Backup). I **file** (foto, cataloghi, documenti HR) non vanno in Aurora: restano su disco, oppure passano anch'essi su S3 se si vogliono più server dell'app.
7. **Più server dell'app?** I job periodici hanno bisogno di un lock (advisory lock di PostgreSQL) per non girare due volte.
8. **Test:** tutti i 212 contro un PostgreSQL vero (Docker in locale e in CI), finché passano tutti.
9. **Prestazioni:** ogni query costa un viaggio in rete (circa 1 ms) invece di microsecondi. Trovare i cicli che fanno una query per riga e riscriverli in una query sola.

## Fase 3 — Spostare i dati (1–2 giorni, provati prima)

1. Esportare una copia coerente di `cantina.db` (come in `deploy/aws/README.md`, sezione 3).
2. Creare lo schema in Aurora e caricare i dati con **pgloader** (legge SQLite direttamente) o con uno script dedicato.
3. Riallineare i contatori degli id (`setval` su ogni colonna identity), perché le righe nuove non si scontrino con quelle esistenti.
4. **Controllare:**
   - il numero di righe di ogni tabella, SQLite contro Aurora;
   - le somme di controllo delle tabelle chiave (prenotazioni, ordini, movimenti di magazzino, timesheet);
   - la validità delle chiavi esterne.

## Fase 4 — Prova generale su staging (1–2 settimane)

1. Caricare una copia vera nel cluster di staging e collegarci un'app di staging.
2. Provare a mano ogni modulo:
   - prenotazioni, con Stripe in modalità test;
   - Commerciale, Magazzino e Produzione;
   - People / HR, compresa l'apertura dei documenti HR (stessa `HR_FILES_KEY`);
   - accessi, ruoli e permessi;
   - portale agenti.
3. Misurare le pagine lente e correggerle.
4. Ripetere tutta la Fase 3 almeno due volte e annotare quanto dura.

## Fase 5 — Passaggio (una sera)

1. Annunciare la finestra di manutenzione, mettere il sito in manutenzione, fare l'export finale.
2. Caricare e verificare come nella Fase 3, collegare l'app ad Aurora, avviarla.
3. Prova veloce, riapertura del sito, poi qualche giorno di controllo su log e metriche.
4. **Ripiego:** l'ultimo file SQLite e il vecchio server restano intatti. Tornare indietro vuol dire ricollegare l'app a quelli; i dati inseriti dopo il passaggio andrebbero ricopiati a mano.

## Fase 6 — Dopo

1. Allarmi CloudWatch su CPU/capacità, connessioni, storage ed errori.
2. **Provare un ripristino** da uno snapshot di Aurora in un cluster nuovo: un backup mai ripristinato è un'ipotesi.
3. Rivedere il costo dopo il primo mese.

## Impegno e raccomandazione

Stima indicativa: Fase 2 **4–8 settimane** per uno sviluppatore, e lì sta quasi tutto il rischio (si tocca ogni modulo). Fasi 1, 3 e 4: altre 2–3 settimane. È un progetto a sé, non un passo del trasferimento.

1. **Adesso:** trasferimento su **EC2 + SQLite** con la **copia giornaliera su S3** (già scritta e provata). Il sito è su AWS in pochi giorni, con le copie fuori dal server.
2. **Più avanti, solo se serve:** la riscrittura per Aurora (o RDS PostgreSQL, più economico) come progetto separato, per esempio quando servono più server o l'alta disponibilità.
