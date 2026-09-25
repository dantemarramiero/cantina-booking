# Contabilità generale — catalogo degli eventi

Stato: **proposta** (Fase G0). Nessun evento è ancora implementato.

Gli eventi servono a **far sapere agli altri moduli** cosa è successo in contabilità (Magazzino, Cespiti, Commerciale, notifiche). Non servono a scrivere la contabilità stessa: righe contabili, righe IVA, scadenze e movimenti analitici di una registrazione nascono **nella stessa transazione** della conferma, come chiede il brief.

---

## 1. Convenzioni

Le stesse di oggi (`lib/events.js`), con la busta v2 in arrivo con Produzione (`0015_events_v2`).

| Aspetto | Regola |
|---|---|
| Nome | `oggetto.azione_al_passato`, in inglese e `snake_case`, come `stock.issue_reversed` o `timesheet.month_approved` |
| Emissione | `events.emit()` dentro `events.transaction()`, nella stessa transazione del documento (outbox). Se la transazione fallisce l'evento non esiste |
| Consegna | `events.dispatch()` dopo il commit (anche ogni minuto dallo scheduler) |
| Idempotenza | ogni consumer elabora un evento una volta sola: vincolo unico `(consumer, event_id)` in `event_consumptions`. In più, ogni effetto scritto da un consumer ha una **chiave di idempotenza** sul suo documento (es. `journal_entries.idem_key`, `stock_movements.idem_key`) |
| Nome del consumer | `modulo.cosa-fa`, come `finance.ore-lavorate` |
| Busta | `id`, `type`, `source_table`, `source_id`, `payload`, `created_at`, **`schema_version`** (1), **`actor`** (utente, «Chiave master» o «Sistema») |
| Unità nei payload | importi in **centesimi**, aliquote in **punti base** (2200 = 22%), quote in **ppm**, quantità in **millesimi**; date `AAAA-MM-GG` in ora italiana, istanti in ISO UTC |
| Storni | uno storno non cancella l'evento originale: ne emette uno nuovo che lo cita (`reversed_event_id` o l'id del documento stornato) |
| Versioni | un cambiamento incompatibile del payload è una versione nuova dello stesso evento; i consumer della versione precedente continuano a funzionare |
| Dati personali | nei payload solo id e codici, mai IBAN, codici fiscali o importi delle retribuzioni per dipendente |

---

## 2. Eventi emessi — G1, motore contabile

| Evento | Quando | Consumer → effetto | Contenuto essenziale |
|---|---|---|---|
| `journal_entry.confirmed` | conferma di una registrazione (manuale o automatica) | Notifiche (registrazioni automatiche da rivedere); Finance → Analitica: nessuna scrittura, i movimenti sono già nati nella transazione; eventuale avviso se il mese ha una cascata in simulazione | `entry_id`, `fiscal_year`, `journal_number`, `registration_date`, `document_date`, `vat_period`, `origin` e id del documento d'origine, `party_id`, `vat_register_id`, `vat_protocol`, totale Dare, numero di righe analitiche e totale analitico per centro |
| `journal_entry.reversed` | conferma di uno storno | come sopra; i moduli d'origine (fatture, paghe, ammortamenti) riportano il loro documento allo stato giusto | `entry_id` stornata, `reversal_entry_id`, `reason`, `origin` |
| `accounting_period.closed` | passaggio a «chiuso IVA» o «chiuso» | Tutti gli emittenti di documenti contabili: rifiutano le nuove scritture con data nel periodo (sostituisce `period.closed` del catalogo di v3) | `period`, `from_status`, `to_status` |
| `accounting_period.reopened` | riapertura con permesso dedicato | Notifiche all'amministrazione | `period`, `from_status`, `to_status`, `reason` |
| `coge.integrity_failed` | il controllo notturno trova una registrazione sbilanciata o righe analitiche che non quadrano | Notifiche (anomalia bloccante) | elenco di `entry_id` con la differenza in centesimi |

## 3. Eventi emessi — G2, ciclo passivo

| Evento | Quando | Consumer → effetto | Contenuto essenziale |
|---|---|---|---|
| `supplier_invoice.received` | una fattura (un `FatturaElettronicaBody`) è salvata e letta | Notifiche (nuova fattura da contabilizzare, solo se non confermata in automatico) | `invoice_id`, `sdi_id`, canale (`sdi`, `upload`, `zip`), `document_type_code`, `supplier_id` (o nullo), `total_cents`, `sdi_received_at` |
| `supplier_invoice.duplicate_discarded` | la stessa fattura arriva una seconda volta | Notifiche | `sdi_message_id`, `duplicate_of_invoice_id`, chiave di deduplica usata |
| `supplier_invoice.supplier_unknown` | P.IVA e codice fiscale non trovati in `suppliers` | Notifiche a chi può creare fornitori | `invoice_id`, `proposal_id` |
| `supplier_invoice.iban_mismatch` | IBAN della fattura diverso da quello dell'anagrafica | Notifiche a `coge_responsabile` (possibile frode o variazione) | `invoice_id`, `supplier_id`. L'IBAN non viaggia nell'evento |
| `supplier_invoice.iban_confirmed` | un utente autorizzato decide sull'IBAN | Scadenzario: le scadenze tornano pagabili | `invoice_id`, `decision` (`conferma_una_volta`, `aggiorna_anagrafica`, `rifiuta`) |
| `supplier_invoice.confirmed` | la registrazione della fattura è confermata (a mano o in automatico). Stesso nome del catalogo di v3 | **Magazzino** `stock.carico-da-fattura`: proposta di carico valorizzato per le righe con materia prima mappata (mai carico automatico). **Cespiti** `coge.proposta-cespite` (G6): proposta di scheda per le righe su conti di immobilizzazione. Notifiche | `invoice_id`, `entry_id`, `supplier_id`, `document_type_code`, righe `[{ line_id, account_id, raw_item_id, quantity_milli, amount_cents, cost_center_id, is_fixed_asset }]` |
| `supplier_invoice.credit_note_applied` | una nota di credito (TD04) confermata riduce o chiude la partita della fattura collegata | Scadenzario; Magazzino (eventuale reso da proporre) | `credit_note_id`, `invoice_id`, importo applicato, quota per riga |
| `supplier_invoice.reversed` | storno della registrazione di una fattura | Magazzino: la proposta di carico non ancora confermata sparisce; quella confermata resta e va stornata dal Magazzino con il suo motivo | `invoice_id`, `entry_id`, `reversal_entry_id` |
| `self_invoice.drafted` | nasce in bozza il documento di integrazione o l'autofattura (TD16–TD19) | Notifiche: da controllare e inviare | `sales_invoice_id`, `document_type_code`, `supplier_invoice_id` |
| `td29.due` | job quotidiano: una fattura irregolare o mancante si avvicina al termine di comunicazione | Notifiche | `report_id`, scadenza |

## 4. Eventi emessi — G3–G7 (da dettagliare nelle fasi)

| Evento | Fase | Quando | Consumer → effetto |
|---|---|---|---|
| `sales_invoice.sent` | G3 | fattura attiva inviata a SDI | — |
| `sales_invoice.delivered` | G3 | ricevuta di consegna: la registrazione diventa confermata con protocollo e partita (sostituisce `invoice.confirmed` di v3, che non ha consumer) | Commerciale (stato dell'ordine «fatturato»), Analitica (ricavo sul centro del canale, già scritto nella transazione) |
| `sales_invoice.not_delivered` | G3 | mancata consegna | Notifiche: avvisare il cliente |
| `sales_invoice.rejected` | G3 | scarto SDI: la fattura torna modificabile, stesso numero e data | Notifiche con la scadenza per il reinvio |
| `daily_receipts.posted` | G3 | registrati i corrispettivi di un giorno | — |
| `receivable.collected` | G3–G4 | incasso di una partita cliente, anche parziale (nome di v3) | Commerciale: `orders.payment_status` derivato; provvigioni se maturano all'incasso |
| `payable.paid` | G4 | pagamento di una partita fornitore | Scadenzario ritenute (F24 del mese dopo) |
| `stripe.payout_reconciled` | G3–G4 | payout Stripe abbinato al movimento bancario (nome di v3) | Scadenzario, Generale (commissioni) |
| `bank_transaction.stale` | G4 | movimento non riconciliato da più di N giorni | Notifiche, anomalie |
| `vat_settlement.confirmed` | G5 | liquidazione di un periodo | Periodi: passaggio a «chiuso IVA» |
| `plafond.warning`, `plafond.exceeded` | G5 | utilizzo del plafond oltre la soglia di avviso o oltre il plafond | Notifiche; blocco delle nuove dichiarazioni d'intento |
| `conservation_package.outcome` | G5 | esito del versamento in conservazione | Notifiche se rifiutato |
| `fixed_asset.proposed` | G6 | proposta di scheda cespite da una fattura | Notifiche |
| `depreciation.run_confirmed` | G6 | ammortamenti di un periodo registrati | — |
| `closing_adjustments.reversed` | G6 | storno automatico degli assestamenti all'apertura del periodo | — |
| `payroll.imported` | G6 | riepilogo paghe importato e registrato | Finance → Analitica: calcolo del conguaglio standard/effettivo (Fase 4) |
| `coge_coan.reconciliation_failed` | G7 | il raccordo di un periodo ha una differenza non spiegata | Notifiche; blocco della chiusura |
| `fiscal_year.closed`, `fiscal_year.opened` | G7 | chiusura e riapertura dell'esercizio | Tutti gli emittenti |

---

## 5. Eventi consumati dalla contabilità generale

| Evento | Esiste? | Uso |
|---|---|---|
| `stock.issued`, `stock.received`, `stock.adjusted`, `stock.issue_reversed` | sì (Magazzino, `modules/stock.js:142`) | **Non** dalla CoGe: il costo del venduto e i consumi vanno in analitica con la Fase 4. La CoGe legge il valore delle rimanenze alla data (`valuation`) alla chiusura |
| `timesheet.month_approved`, `timesheet.adjusted` | sì (People) | Non dalla CoGe: il costo standard del personale è della Fase 4. In G6.3 la CoGe marca le righe paghe «analitica da timesheet» |
| `allocation.run_confirmed`, `allocation.run_cancelled` | sì (Finance) | Nessun consumer: la conferma di una registrazione controlla direttamente se il mese è ribaltato (COG-M07) |
| `order.status_changed` | **no** | G3 e G6: ordini evasi da fatturare e fatture da emettere. Da aggiungere in `PATCH /api/admin/orders/:id` (`server.js:3101`), in modo additivo |
| `stripe.checkout_completed` | **no** | G3: incassi di prenotazioni e ritiri. Da aggiungere nel webhook (`server.js:1732`), insieme all'idempotenza delle prenotazioni (COG-X05) |
| `lot.bottled` e gli altri eventi di Produzione | proposti (Produzione) | Nessun uso diretto: passano dalla Fase 4 |

## 6. Idempotenza e storni: casi da provare

- Lo stesso evento consegnato due volte a un consumer non genera due proposte di carico né due schede cespite (`event_consumptions` + chiave d'idempotenza `fattura-riga:<id>`).
- Le registrazioni automatiche (Stripe, paghe, ammortamenti, assestamenti) hanno `idem_key` unico: `stripe-payout:<id>`, `payroll:<import_id>`, `depr:<run_id>`, `adj-reverse:<adjustment_id>`. Rieseguire un job non duplica nulla.
- Il webhook e il polling SDI possono segnalare lo stesso documento: `sdi_messages.provider_message_id` è unico, quindi il secondo arrivo non crea nulla.
- Lo storno di una registrazione emette `journal_entry.reversed`; i consumer compensano **esattamente** quanto avevano fatto per la conferma originale, senza ricalcolare con i dati di oggi.
