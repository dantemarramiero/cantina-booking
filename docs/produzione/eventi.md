# Produzione — catalogo degli eventi e contratto v1 con Finance

Stato: **proposta** (Fase 0), da approvare insieme alla decisione DP2.

Il contratto vale in due direzioni:
- Produzione lo rispetta quando emette;
- la Fase 4 di Finance (costo del lotto) lo usa come unica fonte, **senza leggere le tabelle di Produzione** (PRD-F03).

Un cambiamento incompatibile diventa una versione 2 dell'evento, e i consumer della versione 1 continuano a funzionare.

---

## 1. Busta comune

Ogni evento passa dall'outbox che esiste già (`domain_events`): si scrive nella stessa transazione dell'operazione e si consegna dopo il commit.

| Campo | Contenuto |
|---|---|
| `id` | id dell'evento (`domain_events.id`). È la **chiave di idempotenza**: ogni consumer lo elabora una volta sola (`event_consumptions`, vincolo unico consumer + evento) |
| `type` | es. `lot.blended` |
| `schema_version` | 1 (nuova colonna, DP2) |
| `actor` | chi ha confermato: utente del portale, «Chiave master» o «Sistema» (nuova colonna, DP2) |
| `created_at` | quando è stato registrato, in UTC |
| `payload.effective_at` | quando è successo davvero, in UTC. Può essere nel passato (retrodatazione fino alla chiusura della campagna). **Finance imputa il periodo sulla data effettiva** |
| `payload.operation_id` | l'operazione di cantina, l'intervento o l'imbottigliamento d'origine |

Unità in tutti i payload:
- volumi in **ml**, pesi in **g**, bottiglie in unità;
- quote di composizione in **ppm** (somma 1.000.000);
- valori analitici in × 10.000 (`_e4`).

Tutti interi.

---

## 2. Contratto v1 con Finance (effetto sul costo del lotto)

Finance tiene per ogni lotto il **costo accumulato** e il **volume**. Il costo al litro è costo ÷ volume. Le regole di calcolo stanno in Finance; Produzione fornisce i fatti.

Ogni evento con un volume porta anche il **volume del lotto prima dell'operazione**. Così Finance calcola la quota senza leggere le tabelle di Produzione.

### `lot.created`
Nasce un lotto: da conferimenti, da apertura della cantina, da separazione o da assemblaggio in un lotto nuovo.

| Campo | Contenuto |
|---|---|
| `lot_id`, `lot_code` | — |
| `cost_object_id` | l'oggetto di costo del lotto (tipo `lotto`, DP3) |
| `origin` | `harvest`, `opening`, `split`, `blend`, `purchase` |
| `vintage`, `physical_state`, `designation` | annata, stato fisico (uva, mosto, vino…), designazione |
| `volume_ml` o `weight_g` | quantità iniziale (l'uva in grammi) |
| `grapes_by_parcel` | per i conferimenti: `[{ parcel_id, harvest_year, cost_object_id, net_g }]`. Finance attribuisce il costo dell'uva come quota dei costi della parcella per kg (PRD-H06) |

Per `split` e `blend` il costo arriva dagli eventi `lot.split` e `lot.blended`, non da qui.

### `lot.blended`
Assemblaggio (taglio): più lotti d'origine in un lotto di destinazione, nuovo o esistente.

| Campo | Contenuto |
|---|---|
| `target_lot_id` | lotto risultante |
| `target_volume_before_ml` | 0 se il lotto è nuovo |
| `inputs` | `[{ lot_id, volume_ml, lot_volume_before_ml }]`: da ogni origine esce la quota `volume_ml ÷ lot_volume_before_ml` del suo costo |
| `loss_ml` | calo dell'operazione, a carico del lotto risultante |
| `output_volume_ml` | volume risultante = volume di prima + somma degli ingressi − calo |

### `lot.split`
Separazione di un lotto in più lotti (es. frazioni di pressatura, una quota declassata per resa, PRD-H03).

| Campo | Contenuto |
|---|---|
| `source_lot_id`, `source_volume_before_ml` | — |
| `outputs` | `[{ lot_id, volume_ml }]`: a ogni lotto la sua quota di costo sui volumi |
| `loss_ml` | — |

### `lot.loss`
Calo o perdita: il costo resta sul lotto e il volume scende, quindi il **costo al litro sale**.

| Campo | Contenuto |
|---|---|
| `lot_id`, `lot_volume_before_ml`, `volume_ml` | — |
| `cause` | `evaporazione`, `fecce`, `filtrazione`, `rottura`, `sboccatura`, `rettifica_inventariale`, `altro` |

Una rettifica inventariale **in aumento** usa lo stesso evento con `volume_ml` negativo e `cause = rettifica_inventariale` (PRD-C20).

### `lot.transferred`
Travaso o spostamento senza effetto sul costo. Serve per l'occupazione dei legni.

Campi: `lot_id`, `from_vessel_id`, `to_vessel_id`, `volume_ml`. Un eventuale calo emette anche `lot.loss`.

### `lot.tirage`
Tiraggio del metodo classico.

| Campo | Contenuto |
|---|---|
| `lot_id`, `lot_volume_before_ml`, `volume_ml` | vino messo in bottiglia |
| `bottling_run_id`, `cost_object_id` | l'imbottigliamento, anche come oggetto di costo |
| `stack_id`, `bottles`, `format_ml` | catasta creata |
| `liqueur_de_tirage` | `{ lot_id, volume_ml, sugar_g_l_e4 }` se la liqueur è un lotto |

I materiali (bottiglia, tappo a corona, bidule) passano da `stock.issued` con l'oggetto di costo dell'imbottigliamento.

### `lot.disgorged`
Sboccatura di una catasta, anche parziale.

| Campo | Contenuto |
|---|---|
| `stack_id`, `lot_id` | — |
| `bottles_disgorged`, `bottles_lost` | — |
| `volume_lost_ml` | emette anche `lot.loss` con `cause = sboccatura` |
| `liqueur_expedition` | `{ lot_id, lot_volume_before_ml, volume_ml }`: dal lotto della liqueur esce la sua quota di costo |
| `bottling_lot_id`, `disgorged_on` | — |

### `lot.bottled`
Chiusura di un imbottigliamento finale.

| Campo | Contenuto |
|---|---|
| `bottling_run_id`, `cost_object_id` | — |
| `lot_id`, `lot_volume_before_ml`, `volume_ml`, `loss_ml` | volume uscito = bottiglie × formato + perdite (PRD-P04) |
| `bottles_produced`, `bottles_rejected`, `format_ml` | — |
| `output` | `{ kind: unlabelled \| finished, product_id, sku, label_variant }`. Per le bottiglie nude, `product_id` è il vino di destinazione se già noto |
| `bottling_lot_id`, `bottling_lot_code` | — |
| `contractor_supplier_id` | se l'imbottigliamento è di un terzista (PRD-P11) |

Finance trasferisce il costo del lotto uscito, più i materiali dell'imbottigliamento (da `stock.issued`), sulle bottiglie del lotto d'imbottigliamento.

### `labelling.completed`
Da bottiglie nude a prodotto finito.

Campi: `labelling_run_id`, `bottling_lot_id`, `product_id`, `sku`, `label_variant`, `bottles`, `cost_object_id`.

Le etichette e le capsule passano da `stock.issued`. Il costo delle bottiglie nude passa al prodotto finito.

### `barrel.occupancy_closed`
Svuotamento di una barrique. Serve per l'ammortamento per passaggio.

Campi: `vessel_id`, `lot_id`, `filled_at`, `emptied_at`, `days`, `avg_volume_ml`, `use_number` (il numero di passaggi del legno).

### `lot.reversed`
Storno di un'operazione con effetto sul costo (PRD-F02).

| Campo | Contenuto |
|---|---|
| `reversed_event_id` | l'evento originale (`lot.blended`, `lot.loss`…) |
| `reversal_operation_id`, `original_operation_id` | — |
| `reason` | obbligatoria |

Finance compensa **esattamente** l'effetto registrato per l'evento originale: non ricalcola con i dati di oggi.

---

## 3. Altri eventi emessi da Produzione

| Evento | Quando | Consumer → effetto | Contenuto essenziale |
|---|---|---|---|
| `parcel.intervention_confirmed` | conferma di un intervento in vigneto | Dashboard; Finance solo per materiali non passati dal magazzino | intervento, tipo, parcelle con superficie, esecutori, mezzi |
| `phyto.treatment_confirmed` | conferma di un trattamento | Produzione (carenza e rientro), Compliance (quaderno), Magazzino (scarico del fitofarmaco se gestito a magazzino) | parcelle, prodotto con n. di registrazione, dose, quantità, fine carenza, fine rientro |
| `harvest.delivery_confirmed` | conferma di un conferimento | Produzione (lotto uva), Finance (kg per parcella) | parcella, annata agraria, squadra, peso netto, lotto |
| `lot.addition_confirmed` | aggiunta enologica | Magazzino (scarico → `stock.issued` con l'oggetto di costo del lotto), e-label (bozza ingredienti) | lotto, prodotto, lotto del materiale, quantità, dose per hl |
| `lot.analysis_recorded` | nuova analisi su un lotto, vaso o catasta | Allarmi (limiti, fermentazioni), imbottigliamento (prerequisiti) | soggetto, parametri, fuori soglia |
| `workorder.completed` | chiusura di un ordine di lavoro | People (verifica delle ore), Dashboard | ordine, task, esecutori |

## 4. Eventi consumati da Produzione

| Evento | Esiste? | Uso |
|---|---|---|
| `timesheet.month_approved`, `timesheet.adjusted` | sì (People) | Solo verifica di coerenza tra ore approvate e interventi o ordini di lavoro. Nessuna scrittura di costi |
| `timesheet.entry_approved` | **no** | Non serve: basta l'approvazione del mese |
| `stock.below_threshold` | **no**, oggi c'è solo l'email | Si aggiunge in `checkStockThreshold`, senza cambiare l'email. Avvisa sugli imbottigliamenti pianificati che usano quel materiale |
| `order.confirmed` | **no** | Proposta di etichettatura (PRD-P09), solo dopo il via sulla logica di `production_status` e sullo stato che vale come «confermato» (DP7) |
| `stock.issued`, `stock.issue_reversed` | sì (Magazzino) | Produzione non li consuma: li genera tramite il Magazzino |

## 5. Idempotenza e storni

- Un consumer che riceve due volte lo stesso evento non duplica nulla: vincolo unico `(consumer, event_id)` già in `event_consumptions`, più l'operazione idempotente del consumer (PRD-F01).
- Gli scarichi di magazzino generati da Produzione hanno una chiave d'idempotenza legata alla riga d'origine (es. `aggiunta:<id>`), come quelli della Fase 3.
- Uno storno non cancella l'evento originale: ne emette uno nuovo (`lot.reversed`, `stock.issue_reversed`).
