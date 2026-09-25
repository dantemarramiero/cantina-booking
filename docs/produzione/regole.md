# Produzione — regole di business (QUANDO/ALLORA) e test

Stato: **catalogo iniziale** (Fase 0). Nessuna regola è ancora implementata.

- Ogni regola avrà almeno un test di integrazione, con l'ID nel nome: `test('PRD-C01 …')`.
- Un test automatico controllerà che ogni regola di una fase consegnata abbia il suo test.
- Alla consegna di ogni fase si aggiungono il nome del test e l'esito.
- Le soglie indicate come «config» sono in `prd_config` con un valore predefinito **da validare** (DP12).
- Il testo di ogni regola è pronto da copiare nel database Notion «Logiche di business».

Legenda dei file di test previsti:

| Prefisso | File |
|---|---|
| A | `test/prd-anagrafiche.test.js` |
| V | `test/prd-vigneto.test.js` |
| H | `test/prd-vendemmia.test.js` |
| C | `test/prd-cantina.test.js` |
| B, M | `test/prd-affinamento.test.js` |
| P | `test/prd-imbottigliamento.test.js` |
| S | `test/prd-compliance.test.js` |
| F | `test/prd-finance.test.js` |
| X | `test/regression.test.js` |

---

## Logiche esistenti da validare (Fase 0)

| ID | Regola | Stato |
|---|---|---|
| PRD-X01 | QUANDO si crea una riga d'ordine (import, manuale, agente) ALLORA lo stato di produzione è «da produrre» | esistente, senza test |
| PRD-X02 | QUANDO si cambia lo stato da Produzione → Righe ordine ALLORA cambia solo quello, senza traccia | esistente, senza test |
| PRD-X03 | QUANDO una riga è «completato» ALLORA conta come bottiglie spedite nelle dashboard Commerciale e Home | esistente, senza test; da rivedere (DP7) |
| PRD-X04 | QUANDO un ordine diventa «evaso» ALLORA le bottiglie escono dal magazzino, qualunque sia lo stato di produzione | Fase 3 di Magazzino, testato (`stock`) |
| PRD-X05 | Il widget «Bottiglie da produrre» conta i prodotti distinti con righe aperte, non le bottiglie | esistente; etichetta da correggere |
| PRD-X06 | QUANDO una giacenza scende sotto soglia ALLORA email (se c'è un provider), nessun evento | esistente; evento da aggiungere |

## Fase 1 — Anagrafiche

| ID | Regola | Note |
|---|---|---|
| PRD-A01 | QUANDO si crea o modifica una parcella ALLORA la somma delle superfici vitate sulla stessa particella catastale non supera la superficie della particella; altrimenti rifiuto | Serve l'elenco delle particelle con la superficie (DP14) |
| PRD-A02 | QUANDO si archivia una parcella con interventi o conferimenti nella campagna aperta ALLORA rifiuto | «Campagna aperta» = non chiusa; in vendemmia possono esserlo due |
| PRD-A03 | QUANDO si crea un vaso ALLORA codice univoco, capacità > 0, codice QR generato; un vaso con contenuto non si dismette | — |
| PRD-A04 | QUANDO si dismette una barrique ALLORA deve essere vuota e la sua storia dei passaggi si chiude | — |
| PRD-A05 | QUANDO una regola di disciplinare è scaduta ALLORA non vale per le operazioni con data successiva, ma resta valida per lo storico | — |

## Fase 2 — Vigneto

| ID | Regola | Note |
|---|---|---|
| PRD-V01 | QUANDO si conferma un trattamento ALLORA sono obbligatori: parcella, data/ora, prodotto con n. di registrazione, avversità, dose/ha, quantità totale, superficie trattata, esecutore, attrezzatura; ne manca uno → rifiuto | — |
| PRD-V02 | QUANDO l'esecutore non ha un patentino fitosanitario valido alla data (People) ALLORA non può essere esecutore | Controllo **bloccante senza deroghe** (vedi mappa integrazioni, `assignmentCheck`) |
| PRD-V03 | QUANDO la dose/ha supera la massima del prodotto ALLORA rifiuto | Dose massima dall'anagrafica del prodotto |
| PRD-V04 | QUANDO le applicazioni del prodotto superano il massimo configurato ALLORA rifiuto | Conteggio **per anno solare**, non per campagna (DP13) |
| PRD-V05 | QUANDO la parcella è bio o in conversione e il prodotto non è ammesso in bio ALLORA rifiuto | — |
| PRD-V06 | QUANDO si conferma un trattamento ALLORA fine carenza = data + giorni di carenza, fine rientro = fine trattamento + ore di rientro; con più trattamenti vale la data più lontana | Date in ora italiana (DP6) |
| PRD-V07 | QUANDO si pianifica un intervento manuale durante il tempo di rientro ALLORA avviso bloccante che richiede conferma esplicita con motivazione (DPI), tracciata | — |
| PRD-V08 | QUANDO un trattamento è registrato oltre N giorni dall'esecuzione ALLORA è segnalato come registrazione tardiva | config: N = 30 |
| PRD-V09 | QUANDO l'attrezzatura ha il controllo funzionale scaduto ALLORA si conferma, ma resta segnalato come non conforme | — |
| PRD-V10 | QUANDO un'idoneità contiene la limitazione «no esposizione fitofarmaci» ALLORA la persona non può essere esecutore | Limitazione collegata all'operazione «Trattamento fitosanitario»; oggi in People è solo un avviso: serve la modalità bloccante |
| PRD-V11 | QUANDO un intervento confermato va corretto ALLORA storno e nuovo intervento; lo storno di un trattamento ricalcola carenza e rientro | — |

## Fase 3 — Vendemmia, conferimenti, lotti

| ID | Regola | Note |
|---|---|---|
| PRD-H01 | QUANDO si conferma un conferimento ALLORA parcella, data/ora e peso netto (lordo − tara > 0) sono obbligatori; il lotto riceve la composizione per annata, vitigno, parcella e denominazione, ponderata sui grammi | — |
| PRD-H02 | QUANDO la parcella ha una carenza attiva alla data del conferimento ALLORA rifiuto, salvo conferma motivata del responsabile qualità, che blocca il lotto fino all'esito analitico | — |
| PRD-H03 | QUANDO i kg della parcella nell'annata superano resa max/ha × superficie per la DO rivendicata ALLORA l'eccedenza è evidenziata, con proposta di separarla in un lotto a designazione inferiore; la DO non si rivendica sull'eccedenza | Resa dal disciplinare (`appellation_rules`) |
| PRD-H04 | QUANDO si registra pressatura o svinatura ALLORA si calcola la resa di trasformazione; oltre il massimo del disciplinare il lotto va in avviso con proposta di declassamento | — |
| PRD-H05 | QUANDO una fermentazione inizia fuori dalla finestra ALLORA rifiuto, salvo tipologia esente (presa di spuma, frizzanti, passiti) o dichiarazione registrata | config: 15/7 → 31/12 |
| PRD-H06 | QUANDO un lotto nasce da più conferimenti ALLORA `lot.created` riporta i grammi per parcella | Contratto v1 |
| PRD-H07 | QUANDO si storna un conferimento ALLORA si stornano a cascata solo le operazioni successive che dipendono da esso, se non ancora trasmesse al SIAN; altrimenti rifiuto con istruzioni per lo storno manuale guidato | — |

## Fase 4 — Cantina

| ID | Regola | Note |
|---|---|---|
| PRD-C01 | QUANDO un'operazione porterebbe un vaso sotto zero o oltre la capacità ALLORA rifiuto | Nucleo del motore in Fase 3 (DP15) |
| PRD-C02 | QUANDO si inserisce un'operazione retrodatata ALLORA si rivalida la timeline successiva di vasi e lotti coinvolti; al primo volume negativo o oltre capacità, rifiuto con l'indicazione del conflitto | Limite: chiusura della campagna |
| PRD-C03 | QUANDO un'operazione è confermata ALLORA non si modifica; si corregge con storno (che ricrea lo stato precedente) e nuova operazione, con autore e motivazione | Nucleo in Fase 3 |
| PRD-C04 | QUANDO si registra un travaso ALLORA uscito = entrato + calo dichiarato; una differenza non dichiarata oltre tolleranza → rifiuto | config: tolleranza; nucleo in Fase 3 |
| PRD-C05 | QUANDO si assemblano lotti ALLORA la composizione è la media ponderata sui volumi (1.000.000 ppm, arrotondamento documentato) e si emette `lot.blended` con i volumi | Arrotondamento: resto alla quota con la parte decimale più alta, a parità la prima in ordine |
| PRD-C06 | QUANDO la quota di un vitigno o di un'annata scende sotto soglia ALLORA il lotto perde il diritto a indicarli e l'utente lo vede prima di confermare | config: 85% |
| PRD-C07 | QUANDO si assemblano lotti con denominazioni diverse ALLORA si propone la designazione compatibile più bassa, da confermare dall'enologo | — |
| PRD-C08 | QUANDO si conferma un'aggiunta enologica ALLORA il prodotto (con il lotto del materiale) si scarica dal registro di magazzino e la dose per hl si calcola sul volume del lotto alla data | Richiede la Fase 3 di Magazzino pubblicata |
| PRD-C09 | QUANDO il prodotto enologico non è ammesso per un lotto bio, o la dose cumulata supera il limite ALLORA rifiuto | config per prodotto |
| PRD-C10 | QUANDO l'acidificazione cumulata nella campagna supera il limite ALLORA rifiuto | config: 4 g/l in acido tartarico |
| PRD-C11 | QUANDO si registra un arricchimento senza dichiarazione preventiva valida collegata al lotto ALLORA rifiuto | — |
| PRD-C12 | QUANDO in fermentazione la densità non cala oltre la soglia per N ore ALLORA allarme di possibile arresto | config: 48 h |
| PRD-C13 | QUANDO la temperatura di fermentazione esce dal range del protocollo ALLORA allarme | — |
| PRD-C14 | QUANDO acidità volatile o SO2 totale superano la soglia di attenzione ALLORA allarme; oltre il limite legale il lotto si blocca da solo | config per categoria |
| PRD-C15 | QUANDO si registra un calo o una perdita ALLORA si emette `lot.loss` con volume e causale | Contratto v1 |
| PRD-C16 | QUANDO si completa un task di un ordine di lavoro ALLORA le sue operazioni si scrivono in ordine e in modo atomico; se una fallisce, nessuna è scritta e il task resta aperto con l'errore | — |
| PRD-C17 | QUANDO un task richiede l'ingresso in spazio confinato ALLORA lo assegna e completa solo personale con i requisiti DPR 177/2011 validi, nel numero minimo configurato | config: numero minimo; controllo bloccante in People |
| PRD-C18 | QUANDO un vaso si svuota ALLORA diventa «vuoto da lavare» e non si riempie senza l'evento di igiene richiesto dal suo tipo | — |
| PRD-C19 | QUANDO un lotto è bloccato ALLORA sono ammessi solo trattamento, analisi, calo e sblocco; lo sblocco richiede enologo o responsabile qualità e motivazione | — |
| PRD-C20 | QUANDO l'inventario fisico di un vaso differisce dal contabile ALLORA la rettifica richiede la causale ed esce come `lot.loss` (o carico di rettifica) di tipo «rettifica inventariale» | — |

## Fase 5 — Affinamento e metodo classico

| ID | Regola | Note |
|---|---|---|
| PRD-B01 | QUANDO un gruppo di barrique non riceve colmatura da più giorni della frequenza ALLORA compare tra le «colmature in ritardo» | config per luogo/tipologia |
| PRD-B02 | QUANDO si colma con vino di un altro lotto ALLORA la composizione si aggiorna pro quota e il vino esce dal lotto d'origine | — |
| PRD-B03 | QUANDO una barrique si svuota ALLORA si emette `barrel.occupancy_closed` (lotto, volume medio, giorni); al passaggio successivo i passaggi aumentano di uno | Contratto v1 |
| PRD-B04 | QUANDO una barrique raggiunge la vita utile ALLORA si propone la dismissione, senza bloccare | config: passaggi o anni |
| PRD-B05 | QUANDO una barrique resta vuota oltre N giorni senza solforazione o conservazione ALLORA allarme | config: N |
| PRD-B06 | QUANDO si imbottiglia con una menzione che richiede un tempo minimo in legno o di affinamento non raggiunto ALLORA rifiuto con quella menzione | Tempi dal disciplinare |
| PRD-M01 | QUANDO si conferma un tiraggio ALLORA il lotto diventa «spumante in elaborazione», nasce la catasta (bottiglie, data, zucchero), escono i materiali della distinta e si emette `lot.tirage` | — |
| PRD-M02 | QUANDO si sbocca prima del tempo minimo sui lieviti ALLORA rifiuto | config: 9 mesi, per tipologia/menzione |
| PRD-M03 | QUANDO si conferma una sboccatura ALLORA sboccate + perse ≤ bottiglie della catasta; la liqueur esce dal suo lotto; si registrano le perdite; si calcola lo zucchero residuo e si assegna la categoria di dosaggio; si emette `lot.disgorged` | Categorie da tabella UE, config |
| PRD-M04 | QUANDO la categoria calcolata non coincide con quella prevista per il prodotto ALLORA l'etichettatura è bloccata finché l'enologo non conferma o corregge | — |
| PRD-M05 | QUANDO un controllo di catasta registra una pressione sotto il minimo della categoria ALLORA la catasta è non conforme | config per categoria |
| PRD-M06 | QUANDO un controllo registra bottiglie rotte ALLORA le bottiglie della catasta diminuiscono e si emette `lot.loss` con causale «rottura» | — |

## Fase 6 — Imbottigliamento, etichettatura, confezionamento

| ID | Regola | Note |
|---|---|---|
| PRD-P01 | QUANDO si pianifica un imbottigliamento ALLORA la distinta si verifica sulla giacenza alla data prevista, considerando gli altri pianificati; i materiali non sostituibili mancanti bloccano, quelli sostituibili avvisano | — |
| PRD-P02 | QUANDO manca un'analisi pre-imbottigliamento completa e recente ALLORA rifiuto | config: parametri e giorni |
| PRD-P03 | QUANDO il lotto è bloccato ALLORA non si imbottiglia | — |
| PRD-P04 | QUANDO si chiude un imbottigliamento ALLORA volume uscito = bottiglie × formato + perdite (entro tolleranza); escono i materiali effettivi; entrano le bottiglie come nude o finite con il lotto d'imbottigliamento; si emette `lot.bottled`; nasce la riga SIAN | Contratto v1 |
| PRD-P05 | QUANDO si genera un lotto d'imbottigliamento ALLORA il codice è univoco e collegato a lotto di vino, imbottigliamento, data e (spumanti) sboccatura | DP11 |
| PRD-P06 | QUANDO si etichetta ALLORA le nude del lotto diminuiscono, il finito per SKU + variante + lotto aumenta dello stesso numero, escono i materiali della variante e nasce la riga SIAN dell'etichettatura | DP5 |
| PRD-P07 | QUANDO il prodotto richiede contrassegni di Stato ALLORA l'etichettatura richiede le serie usate e distrutte; usati + distrutti quadrano con le bottiglie e le serie disponibili | — |
| PRD-P08 | QUANDO si confeziona un ordine ALLORA escono gli imballi della distinta per quell'ordine e ogni riga spedita ha i lotti d'imbottigliamento (FIFO modificabile, somma = quantità spedita) | Si aggancia allo scarico degli ordini evasi (Fase 3) |
| PRD-P09 | QUANDO un ordine confermato chiede un prodotto non disponibile finito ma disponibile nudo (stesso vino e annata) ALLORA si propone un ordine di etichettatura collegato alla riga | Solo dopo il via su DP7 |
| PRD-P10 | QUANDO si genera la bozza e-label ALLORA gli allergeni derivati dalle aggiunte sono «obbligatori in etichetta fisica» e non si spostano solo nella pagina QR | — |
| PRD-P11 | QUANDO l'imbottigliamento è di un terzista ALLORA il fornitore è obbligatorio e l'imbottigliamento è un oggetto di costo per la fattura passiva | DP3 |

## Fase 7 — Compliance

| ID | Regola | Note |
|---|---|---|
| PRD-S01 | QUANDO si conferma un'operazione ALLORA nasce la riga SIAN; senza codice mappato va in «errore mappatura» e l'operazione compare tra le anomalie (resta valida) | Mappa da popolare con il consulente |
| PRD-S02 | QUANDO una riga non trasmessa è a meno di N giorni lavorativi dalla scadenza ALLORA allarme; scaduta ALLORA allarme rosso ed email ai responsabili | config: N; scadenza dal regime dello stabilimento |
| PRD-S03 | QUANDO un'operazione è già trasmessa ALLORA la correzione genera una riga di storno e una nuova, mai una modifica | — |
| PRD-S04 | QUANDO la campagna è chiusa ALLORA nessuna operazione con data in quella campagna si registra, si storna o si modifica, da nessun modulo | — |
| PRD-S05 | QUANDO si chiede la tracciabilità di un lotto d'imbottigliamento ALLORA si ottengono i lotti antenati fino ai conferimenti, le parcelle con i trattamenti, le aggiunte con il lotto del prodotto, i materiali con il lotto del fornitore e, in avanti, le righe spedite con cliente e quantità | Obiettivo: pochi secondi |
| PRD-S06 | QUANDO si esporta il quaderno di campagna ALLORA ogni trattamento confermato compare una volta sola e gli stornati non compaiono | Per anno solare (DP13); formato QDCA da verificare |
| PRD-S07 | QUANDO la giacenza contabile per designazione non coincide con la somma dei vasi ALLORA la quadratura segnala la differenza e blocca la chiusura finché non si rettifica con motivo | — |

## Fase 8 — Finance end-to-end

| ID | Regola | Note |
|---|---|---|
| PRD-F01 | QUANDO lo stesso evento arriva due volte a Finance ALLORA i movimenti analitici non si duplicano | `event_consumptions` |
| PRD-F02 | QUANDO un'operazione con effetto di costo è stornata ALLORA si emette `lot.reversed` e Finance compensa esattamente l'effetto originale | Contratto v1 |
| PRD-F03 | QUANDO si chiude un imbottigliamento ALLORA `lot.bottled` basta a Finance per trasferire il costo alle bottiglie, senza leggere tabelle di Produzione | Contratto v1 |
| PRD-F04 | QUANDO un periodo analitico è chiuso in Finance ALLORA le operazioni con effetto di costo e data in quel periodo sono rifiutate | Coerente con la regola di Finance |
