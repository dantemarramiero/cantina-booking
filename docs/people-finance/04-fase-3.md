# People e Finance — Fase 3: Magazzino, movimenti valorizzati

Stato: **completata, in locale** (in attesa di conferma per la pubblicazione). Design proposto e confermato il 25/09/2026. Della transizione in tre passi (§ 4) sono pronti i passi A e B; il passo C si fa dopo il periodo di verifica.

Serve alla contabilità analitica (Fase 4) per due cose: il **costo del venduto** e il **valore delle rimanenze**.

---

## 1. Com'era prima

- **Unica giacenza vera:** `warehouse_finished.quantity`, una riga per prodotto con collegamento vero a `products`.
  - Un prodotto senza riga è «non tracciato»: si vende sempre.
  - `products.stock_quantity` è una colonna rimasta dal passato: nessun codice la legge o la scrive. Esce solo nell'elenco prodotti del portale agenti, che fa `SELECT *`.
- **Materie prime** in `warehouse_raw`: codice libero, quantità intera, nessun collegamento ai prodotti.
- **Nessun registro dei movimenti e nessun costo:** né sui prodotti, né sulle materie prime, né sulle righe di vendita.

| Evento | Effetto prima della Fase 3 |
|---|---|
| Vendita in cassa | − quantità (anche sotto zero: il server non controlla) |
| «Annulla» vendita in cassa | + quantità, poi la vendita veniva **cancellata** |
| Ritiro online pagato (webhook Stripe) | − quantità, **senza controllare se l'aveva già fatto** |
| Ritiro online eliminato prima del ritiro | + quantità, poi cancellazione |
| Modifica in Magazzino | **sovrascriveva** la quantità: nessuna traccia della differenza |
| Ordine B2B evaso | **niente** |
| Produzione completata | **niente** |
| Check-in di una degustazione | **niente** |

---

## 2. Il modello

### Movimenti (`stock_movements`)

Una riga per ogni carico o scarico, **mai modificata né cancellata**: le correzioni sono storni.

| Campo | Contenuto |
|---|---|
| Articolo | `product_id` (prodotto finito) **oppure** `raw_item_id` (materia prima): due collegamenti veri, esattamente uno dei due |
| Luogo | `location_id` → `stock_locations` (per ora uno solo: «Cantina») |
| Data | data di registrazione |
| Tipo | `apertura`, `carico_acquisto`, `carico_produzione`, `scarico_vendita`, `scarico_degustazione`, `scarico_omaggio`, `consumo_produzione`, `rettifica_inventario`, `trasferimento`, `rivalutazione` |
| Quantità | in millesimi, con segno (+ carico, − scarico). Bottiglie e pezzi sono interi, ma così vanno bene anche litri e chili |
| Costo unitario | in € × 10.000 (4 decimali), come il costo orario |
| Valore | in centesimi, con segno |
| Saldo dopo | quantità e valore dell'articolo subito dopo il movimento: giacenza e costo medio si leggono senza ricalcoli |
| Origine | un collegamento vero per ogni documento: riga di vendita in cassa, riga di ritiro online, riga d'ordine B2B, prenotazione e proposta di degustazione, riga d'inventario, fornitore con numero e data del documento (acquisti, finché non arrivano le fatture passive della Fase 5). Se il documento viene eliminato resta la descrizione |
| Oggetto di costo | facoltativo: l'esperienza per le degustazioni, la fiera o il cliente per gli omaggi, il lotto per la produzione |
| Storno di | il movimento che annulla (uno storno al massimo per movimento) |
| Chiave di idempotenza | lo stesso evento non muove due volte (es. `vendita:<riga>`, `ritiro:<riga>`, `ordine:<riga>:<ciclo>`) |

### Valorizzazione: costo medio ponderato continuo

- **Per ogni articolo si tiene il valore della giacenza**, non solo il costo medio: così non si accumulano errori di arrotondamento.
- **Carico:** giacenza e valore crescono. Il nuovo costo medio è valore ÷ quantità. Una rettifica in aumento entra all'ultimo costo medio; l'apertura entra a zero.
- **Scarico:** esce una quota del valore proporzionale alla quantità. Quando la giacenza va a zero esce tutto il valore residuo, quindi **i conti quadrano al centesimo**.
- **Giacenza sotto zero** (vendita senza merce registrata): la parte oltre la giacenza è valorizzata all'ultimo costo medio e l'articolo va in anomalia.
- **Rivalutazione:** movimento a quantità zero che porta solo la differenza di valore. La usa il foglio dei costi.
- **Niente movimenti retrodatati:** un acquisto registrato in ritardo entra con la data di registrazione. Si evitano così ricalcoli a catena di scarichi già passati a Finance.

### Altre tabelle

- **Inventari** (`stock_counts`, `stock_count_lines`): si contano gli articoli e alla conferma il sistema crea le rettifiche per le differenze con la giacenza di quel momento. Ogni rettifica ha un motivo.
- **Impegni** (`stock_reservations`) per i ritiri online pagati: riducono il «disponibile» senza scaricare la merce.
- **Proposte di scarico in degustazione** (`stock_tasting_lines`): nascono dal check-in e si confermano con le quantità vere.
- **Righe B2B senza prodotto** (`stock_unmatched_lines`): righe d'ordine evase che non si possono scaricare, elencate tra le anomalie.

---

## 3. Collegamento con i flussi esistenti

| Flusso | Movimento |
|---|---|
| Vendita in cassa | `scarico_vendita` per ogni riga con prodotto tracciato, nella stessa transazione della vendita, + `stock.issued` con il ricavo della riga |
| «Annulla» vendita in cassa | la vendita **resta**, segnata come annullata con chi, quando e il motivo; storno dei movimenti. Non conta più per il wine club né per il «Totale speso» del CRM |
| Ritiro online pagato | **impegno**: il disponibile scende, la merce resta. Il webhook cambia lo stato solo se l'ordine era «in attesa di pagamento», quindi un evento ripetuto non impegna né manda email due volte |
| Ritiro online ritirato (dal link del cliente o dall'admin) | `scarico_vendita` + `stock.issued`; l'impegno diventa consumato |
| Ritiro online eliminato prima del ritiro | l'impegno si libera |
| Ordine B2B → evaso | `scarico_vendita` per ogni riga con prodotto tracciato + `stock.issued` con cliente, agente e canale. Le righe senza prodotto vanno in anomalia. Vale dagli ordini evasi dopo l'attivazione |
| Ordine B2B tolto da «evaso» | storno. Se torna «evaso» si scarica di nuovo, senza doppioni |
| Check-in di una prenotazione con vini in degustazione | **proposta** di `scarico_degustazione`: 1 bottiglia per vino ogni 6 ospiti (arrotondato per eccesso), modificabile per esperienza. Si conferma con le bottiglie aperte davvero, a carico dell'esperienza. Se si toglie il check-in, le proposte non ancora decise spariscono |
| Omaggi, degustazioni fuori dalle visite, consumi di produzione | scarico manuale da Magazzino → Registro e valore, con motivo obbligatorio e oggetto di costo facoltativo |
| Acquisti | `carico_acquisto` manuale con fornitore, documento e costo obbligatorio. In Fase 5 lo creerà la fattura passiva |
| Imbottigliamento | `carico_produzione` manuale con costo. In Fase 4 arriverà dal costo del lotto (evento `lot.bottled`) |
| Modifica della quantità in Magazzino | diventa una **rettifica** per la differenza, con il motivo chiesto all'utente |
| Nuova riga di magazzino | movimento di apertura con la quantità iniziale |
| Rimozione di una bottiglia dal magazzino | rettifica a zero, poi la riga si toglie. Il registro resta |
| Eliminazione di un prodotto o di una materia prima con movimenti | non ammessa |

---

## 4. Transizione in tre passi (senza rompere cassa e shop)

**Passo A — in parallelo. Pronto.**
- La migrazione crea il registro e un movimento di **apertura** per ogni articolo con giacenza, a costo zero. Il foglio dei costi lo valorizza (decisione 4).
- Ogni punto che cambia la giacenza scrive, **nella stessa transazione**, anche il movimento.
- Cassa, shop e Magazzino continuano a leggere `warehouse_finished.quantity`, che il registro aggiorna.
- Il webhook è idempotente.

**Passo B — verifica, circa 2 settimane. Pronto.**
- Il job `stock.reconcile`, ogni notte, confronta articolo per articolo la quantità di oggi con il disponibile del registro (giacenza − impegni).
- Ogni differenza diventa una notifica per chi ha il workspace Magazzino e compare in Registro e valore → Controlli.
- Si passa al passo C solo con zero differenze per l'intero periodo.

**Passo C — cambio della fonte di verità. Da fare dopo il passo B.**
- Cassa, shop, Magazzino e avvisi di scorta leggono il **saldo del registro** (meno gli impegni, per il disponibile).
- `warehouse_finished` tiene soglie ed email di avviso, e la sua quantità diventa una copia aggiornata solo dal registro. Più avanti si può togliere.
- `products.stock_quantity` si elimina, dopo aver verificato in produzione che non contenga dati utili.

**Tornare indietro** è possibile a ogni passo:
- il registro si aggiunge senza togliere nulla, e la migrazione ha il `down`;
- il cambio del passo C riguarda solo quale colonna si legge.

---

## 5. Cosa c'è

**Magazzino → Registro e valore** (nuova voce del menu):
- **Giacenze e valore:** per ogni articolo giacenza, impegnato, disponibile, costo medio e valore; totale delle rimanenze di oggi. Il valore a una data passata c'è già nelle API, per la Fase 4. Da qui partono i carichi e gli scarichi manuali.
- **Movimenti:** il registro, filtrabile per articolo (le API filtrano anche per tipo e periodo); ogni riga mostra la giacenza e il valore dopo il movimento. Solo i movimenti manuali si stornano da qui; quelli nati da vendite, ritiri e ordini si correggono dal documento.
- **Degustazioni:** le proposte del check-in da confermare o scartare.
- **Inventario:** conteggi in bozza, conferma con le rettifiche, annullo.
- **Foglio dei costi:** si scarica un Excel con tutti gli articoli, si compila la colonna del nuovo costo unitario e ricaricandolo si valorizza la giacenza di oggi. Le righe saltate hanno il motivo.
- **Controlli:** differenze con le quantità di sempre, giacenze sotto zero, articoli senza costo, righe B2B senza prodotto.

**Cassa (admin):** le vendite annullate restano nell'elenco con il badge «Annullata» e il totale barrato; l'annullo chiede il motivo.

**CRM → scheda della persona:** le vendite annullate compaiono barrate e non entrano nel totale speso.

---

## 6. Migrazioni

| Versione | Cosa |
|---|---|
| `0014_stock_ledger` | Tabelle:<br>• `stock_locations` (+ «Cantina»)<br>• `stock_movements`<br>• `stock_reservations`<br>• `stock_counts` e `stock_count_lines`<br>• `stock_tasting_lines`<br>• `stock_unmatched_lines`<br>Colonne:<br>• `shop_sales`: `cancelled_at`, `cancelled_by`, `cancel_reason`<br>• `experience_products`: `guests_per_bottle` (predefinito 6)<br>Dati: un movimento di apertura a costo zero per ogni prodotto e materia prima con giacenza |

Ha il `down`. Prima di applicarla il server fa la copia automatica del database, come per le altre.

## 7. Eventi di dominio

| Evento | Quando | Contenuto |
|---|---|---|
| `stock.issued` | ogni scarico valorizzato | movimento, articolo, quantità, **valore e costo unitario**, oggetto di costo, canale (negozio, dopo visita, dopo evento, ritiro online, B2B, degustazione, omaggio), documento (vendita, ritiro, ordine con cliente e agente, prenotazione con esperienza), ricavo della riga quando c'è |
| `stock.issue_reversed` | storno | come sopra, con segno opposto |
| `stock.received` | carichi e aperture | articolo, quantità, costo, fornitore o produzione |
| `stock.adjusted` | rettifiche e rivalutazioni | articolo, differenza, valore |

Per ora nessun consumer: la Fase 4 li userà per il costo del venduto (margine per ordine, cliente, agente, canale) e per il costo delle esperienze.

## 8. Logica di business (QUANDO/ALLORA) e test

Tutti i test di questa sezione sono nel file `stock`.

| Regola | Test |
|---|---|
| QUANDO si carica ALLORA il costo medio è valore ÷ quantità; QUANDO si scarica ALLORA esce una quota proporzionale del valore | costo medio ponderato |
| QUANDO lo scarico porta la giacenza a zero ALLORA esce tutto il valore residuo, al centesimo | costo medio ponderato |
| QUANDO si scarica oltre la giacenza ALLORA l'eccedenza vale l'ultimo costo medio e l'articolo va in anomalia | costo medio ponderato |
| QUANDO si registra una vendita in cassa ALLORA lo scarico è nella stessa transazione ed esce `stock.issued` con il costo | vendita in cassa |
| QUANDO si annulla una vendita in cassa ALLORA la vendita resta, segnata come annullata, e il magazzino è stornato; un secondo annullo è rifiutato | vendita in cassa |
| QUANDO una vendita è annullata ALLORA non conta per il wine club | wine club |
| QUANDO un ritiro online è pagato ALLORA la merce è impegnata una volta sola, anche se il webhook arriva due volte | ritiro online |
| QUANDO il cliente ritira ALLORA si scarica e l'impegno è consumato; QUANDO si elimina prima ALLORA l'impegno si libera | ritiro online |
| QUANDO un ordine B2B diventa evaso ALLORA si scarica con cliente e agente, senza doppioni | ordine B2B |
| QUANDO torna indietro ALLORA storno; QUANDO torna evaso ALLORA nuovo scarico | ordine B2B |
| QUANDO una riga evasa non ha prodotto ALLORA resta fuori ed è in anomalia | ordine B2B |
| QUANDO si cambia a mano la quantità in Magazzino ALLORA nasce una rettifica per la differenza, con il motivo | modifica manuale |
| QUANDO si conferma un inventario ALLORA le differenze con la giacenza del momento diventano rettifiche | inventario |
| QUANDO si fa il check-in di una visita con vini in degustazione ALLORA si propone 1 bottiglia per vino ogni 6 ospiti | degustazione |
| QUANDO si conferma la proposta ALLORA si scarica la quantità vera, a carico dell'esperienza | degustazione |
| QUANDO si ricarica il foglio dei costi ALLORA la giacenza di oggi vale quantità × costo | foglio dei costi |
| QUANDO si registra un carico senza costo ALLORA rifiuto; QUANDO un omaggio non ha motivo ALLORA rifiuto | carichi e scarichi manuali |
| QUANDO si prova a stornare un movimento nato da un documento ALLORA rifiuto | carichi e scarichi manuali |
| QUANDO registro e quantità coincidono ALLORA nessuna differenza; QUANDO la quantità cambia fuori dal registro ALLORA il job la segnala | riconciliazione |
| QUANDO un prodotto o una materia prima ha movimenti ALLORA non si elimina | non si elimina |

Esito: **123 test, 123 superati** (12 nuovi della Fase 3).

## 9. Punti toccati nei moduli esistenti

- **Cassa:** la vendita e lo scarico sono una transazione sola; «Annulla» non cancella più la vendita.
- **Webhook di Stripe:** idempotente (stato controllato prima di aggiornare, impegno unico per riga).
- **Ritiri online, ordini B2B, check-in delle prenotazioni, esperienze** (bottiglie per ospite): collegati al registro come in § 3.
- **Magazzino → Prodotti finiti e Materie prime:** la modifica della quantità chiede il motivo; gli errori ora compaiono (prima fallivano in silenzio).
- **Permessi:** il registro si legge da Magazzino, Commerciale, Enoturismo e Finance e si scrive da Magazzino; le degustazioni si confermano anche dall'Enoturismo (via API).
- **CRM:** il «Totale speso» della persona conta solo visite confermate, vendite non annullate e ritiri pagati. Prima contava tutto: era un errore già presente.

## 10. Decisioni

Confermate da voi il 25/09/2026:
1. **Ritiro online:** impegno al pagamento, scarico al ritiro.
2. **Ordini B2B evasi:** scalano la giacenza dagli ordini evasi dopo l'attivazione; le righe senza prodotto vanno in anomalia.
3. **«Annulla» in cassa:** la vendita resta, segnata come annullata, con lo storno del magazzino.
4. **Costi iniziali:** foglio Excel da compilare.

Prese da me, come proposto:
5. **Vendita in cassa senza merce:** ammessa come prima, con anomalia.
- Medio ponderato **continuo**.
- **Un solo luogo** «Cantina» (i trasferimenti sono già previsti per un secondo luogo).
- Suggerimento degustazione: 1 bottiglia per vino ogni 6 ospiti.
- Niente retrodatazioni.
- **Rivalutazione** come movimento a quantità zero, per valorizzare le aperture senza toccare la giacenza.
- Il **ricavo della riga** viaggia con `stock.issued`, così in Fase 4 il margine si calcola da un solo evento.

---

## Riepilogo della Fase 3 e decisioni aperte

### Cosa serve ancora da voi

1. **Pubblicazione:** il blocco 2E e la Fase 3 sono in locale. Si pubblicano solo quando lo chiedete.
2. **Foglio dei costi:** dopo la pubblicazione, scaricatelo da Magazzino → Registro e valore → Foglio dei costi, compilate il costo per bottiglia (per etichetta e annata) e delle materie prime e ricaricatelo. Fino ad allora il costo del venduto è zero e i margini non sono affidabili.
3. **Cambiamento visibile per il magazzino:** dalla pubblicazione gli ordini B2B evasi scalano le bottiglie. Conviene avvisare chi evade gli ordini.
4. **Righe d'ordine senza prodotto** (import da Excel): vanno abbinate a un prodotto perché escano dal magazzino. Le trovate in Controlli.
5. **Passo C:** dopo circa 2 settimane di controlli senza differenze, ditemelo e cambio la fonte di verità.

### Rimandati

- **Passo C** della transizione ed eliminazione di `products.stock_quantity`.
- **Carichi di produzione automatici dal costo del lotto:** Fase 4.
- **Carichi d'acquisto dalle fatture passive:** Fase 5.
- **Medio ponderato di periodo:** solo se lo chiede il commercialista.
- **Conferma delle degustazioni nel portale dell'Enoturismo:** oggi si fa da Magazzino (le API lo permettono già anche all'Enoturismo).
