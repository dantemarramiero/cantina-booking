# Contabilità generale — regole di business (QUANDO/ALLORA) e test

Stato: **catalogo iniziale** (Fase G0). Nessuna regola è ancora implementata.

- Ogni regola avrà almeno un test di integrazione, con l'ID nel nome: `test('COG-M01 …')`.
- Il test di copertura (previsto con Produzione) controlla che ogni regola di una fase consegnata abbia il suo test.
- Alla consegna di ogni fase si aggiungono il nome del test e l'esito.
- Colonna **Origine**: *brief* = regola scritta nel prompt della contabilità generale; *vincolo* = una delle sette regole vincolanti; *derivata* = aggiunta da me in G0, da approvare.
- I valori indicati come «config» stanno in `coge_config` o in una tabella fiscale con validità, con il valore di partenza **da validare** con il commercialista.
- Il testo di ogni regola è pronto da copiare nel database Notion «Logiche di business».

Legenda dei file di test previsti:

| Prefisso | Area | File |
|---|---|---|
| V | vincoli trasversali | `test/coge-motore.test.js` (V01–V05, V07), `test/coge-fatturapa.test.js` (V06) |
| M | G1 — motore contabile | `test/coge-motore.test.js` |
| P | G2 — ciclo passivo | `test/coge-passivo.test.js`; parsing e P7M anche in `test/coge-fatturapa.test.js` |
| A | G3 — ciclo attivo | `test/coge-attivo.test.js` |
| T | G4 — tesoreria | `test/coge-tesoreria.test.js` |
| I | G5 — IVA e adempimenti | `test/coge-iva.test.js` |
| C | G6 — cespiti, competenza, paghe | `test/coge-cespiti.test.js` |
| R | G7 — raccordo e chiusura | `test/coge-chiusura.test.js` |
| X | logiche esistenti | `test/regression.test.js` |

---

## Logiche esistenti da validare (G0)

| ID | Regola | Stato |
|---|---|---|
| COG-X01 | QUANDO si crea un ordine ALLORA è «non pagato» e scade alla data dell'ordine + il primo numero trovato nei termini di pagamento del cliente | esistente, senza test; da sostituire con i termini strutturati (DT11) |
| COG-X02 | QUANDO si cambia lo stato di pagamento di un ordine ALLORA `paid_at` = adesso se «pagato», altrimenti vuoto; nessuna traccia, nessun parziale | esistente, senza test; diventa derivato in G3–G4 (DP7) |
| COG-X03 | QUANDO un ordine non è «pagato» ALLORA il totale conta come credito aperto nel portale agenti e nelle dashboard | esistente, senza test; test di regressione prima di G3 |
| COG-X04 | QUANDO si elimina un fornitore, un cliente, un importatore, un agente o una persona ALLORA il record sparisce | esistente; cambia con COG-M14 (DT10) |
| COG-X05 | QUANDO Stripe consegna due volte il pagamento di una prenotazione ALLORA l'uso del codice sconto si conta due volte e l'email parte due volte | **difetto esistente**; da correggere con COG-A09 |
| COG-X06 | QUANDO si registra un carico d'acquisto a mano ALLORA fornitore e documento sono testo, senza collegamento alla fattura | esistente, testato (`stock`); si affianca a COG-P18 |
| COG-X07 | QUANDO si cancella un costo diretto manuale in un mese non ribaltato ALLORA il movimento sparisce | esistente, testato (`finance`); resta per l'origine «manuale», vietato per le altre (COG-M03) |

## Vincoli trasversali

| ID | Regola | Origine | Test previsto |
|---|---|---|---|
| COG-V01 | QUANDO il controllo notturno trova una registrazione confermata con Dare ≠ Avere, o una riga contabile rilevante con righe analitiche che non la sommano, ALLORA anomalia bloccante con notifica e l'elenco delle registrazioni | vincolo 1 | il test altera una riga nel database e lancia il job |
| COG-V02 | QUANDO una registrazione è confermata ALLORA nessuna API la modifica o la cancella (righe, righe IVA, righe analitiche, testata): risposta 409 | vincolo 2 | una prova per ogni route di modifica e cancellazione |
| COG-V03 | QUANDO si conferma ALLORA numero del giornale (per esercizio) e protocollo IVA (per registro e anno) sono assegnati solo in quel momento, consecutivi e mai riutilizzati, anche dopo uno storno | vincolo 3 | conferma, storno, nuova conferma: numeri 1, 2, 3 |
| COG-V04 | QUANDO si conferma una registrazione ALLORA data di registrazione, data del documento e periodo IVA sono presenti; per le passive anche la data di ricezione SDI (o il motivo per cui manca); per le righe con competenza, inizio e fine | vincolo 4 | una prova per ogni campo mancante |
| COG-V05 | QUANDO cambia un valore fiscale (aliquota, indetraibilità, soglia del bollo) con una nuova data di validità ALLORA i documenti con data successiva usano il nuovo valore e quelli precedenti restano invariati | vincolo 5 | due validità dello stesso codice IVA |
| COG-V06 | QUANDO arriva un file di una versione del tracciato diversa da quella vigente ALLORA si legge con le regole della sua versione; QUANDO si genera un XML ALLORA è valido contro lo schema ufficiale della versione vigente | vincolo 6 | file di esempio in due versioni; validazione XSD nei test |
| COG-V07 | QUANDO si esporta giornale, mastrini, registri IVA, bilancio di verifica o partitari ALLORA i totali dell'export coincidono con quelli a schermo, in Excel e nel tracciato configurato | vincolo 7 | export e confronto dei totali |

## G1 — Motore contabile

| ID | Regola | Origine | Test previsto |
|---|---|---|---|
| COG-M01 | QUANDO si conferma una registrazione con Dare diverso da Avere ALLORA rifiuto | brief | sbilancio di 1 centesimo |
| COG-M02 | QUANDO si conferma una registrazione con una riga su conto rilevante per l'analitica senza centro di costo, o con ripartizione che non somma al 100%, ALLORA rifiuto con indicazione della riga | brief | riga senza centro; modello al 99%; messaggio con il numero di riga |
| COG-M03 | QUANDO si tenta di modificare o cancellare una registrazione confermata ALLORA rifiuto; è consentito solo lo storno, che crea una registrazione speculare collegata e storna anche i movimenti analitici collegati | brief | storno: righe invertite, `analytic_entries` inverse con `reverses_id`, somma per centro a zero |
| COG-M04 | QUANDO si conferma una registrazione con data in un periodo chiuso ALLORA rifiuto | brief | periodo «chiuso IVA» (solo registrazioni con righe IVA) e «chiuso» (tutte) |
| COG-M05 | QUANDO due utenti confermano contemporaneamente registrazioni sullo stesso registro IVA ALLORA ricevono protocolli consecutivi, senza duplicati né buchi | brief | due processi sullo stesso database, 400 conferme; più 50 conferme HTTP in parallelo con una che fallisce |
| COG-M06 | QUANDO si conferma una registrazione ALLORA mastrini, partitari e bilancio di verifica riflettono i nuovi saldi, derivati dalle righe e non da contatori aggiornati a parte | brief | saldi prima e dopo; nessuna tabella di saldi nello schema |
| COG-M07 | QUANDO si conferma una registrazione con righe analitiche in un mese la cui cascata è confermata ALLORA rifiuto: prima si annulla la cascata | derivata | coerente con `assertPeriodOpen` di Finance |
| COG-M08 | QUANDO una riga usa un conto che non è un sottoconto, o un conto collettivo senza soggetto del tipo giusto, ALLORA rifiuto | derivata | mastro; conto clienti senza cliente; conto fornitori con un cliente |
| COG-M09 | QUANDO una riga analitica usa un centro aggregato, disattivato o non valido alla data ALLORA rifiuto | derivata (riuso di `assertImputable`) | tre casi |
| COG-M10 | QUANDO si conferma ALLORA la somma delle righe analitiche di ogni riga è uguale all'importo della riga, al centesimo, con il resto sull'ultima quota | brief (G1.5) | ripartizione 45/25/20/10 di 100,01 € |
| COG-M11 | QUANDO si conferma una registrazione ALLORA le righe analitiche diventano movimenti analitici con origine «contabilità generale» nella stessa transazione; se un passo fallisce non resta nulla | brief (G1.5) | errore forzato dopo le righe: nessuna registrazione, nessun movimento, nessun numero consumato |
| COG-M12 | QUANDO la data di registrazione precede quella dell'ultima registrazione confermata dell'esercizio, o dell'ultimo protocollo del registro IVA, ALLORA rifiuto | derivata | numeri e date nello stesso ordine |
| COG-M13 | QUANDO si riapre un periodo chiuso ALLORA servono la capacità `coge_responsabile` e una motivazione; la riapertura è tracciata ed emette `accounting_period.reopened` | brief (G1.1) | senza capacità 403; senza motivo 400 |
| COG-M14 | QUANDO si elimina un'anagrafica (cliente, importatore, persona, fornitore, agente) collegata a un partitario con movimenti ALLORA rifiuto: si disattiva | derivata (DT10) | eliminazione con e senza movimenti |
| COG-M15 | QUANDO si applica un modello di ripartizione ALLORA vale quello in vigore alla data della riga e le sue quote fanno 100% | brief (G1.5) | due versioni del modello «Energia elettrica» |
| COG-M16 | QUANDO si conferma una registrazione con una causale che genera scadenze ALLORA nascono le partite aperte del soggetto, dalle condizioni di pagamento (rate, fine mese) | brief (G1.3) | 30/60 giorni fine mese |
| COG-M17 | QUANDO si storna una registrazione già stornata, o uno storno, ALLORA rifiuto | derivata | doppio storno |
| COG-M18 | QUANDO una registrazione ha righe IVA ALLORA imponibili e imposte quadrano con le righe contabili (IVA a credito o a debito per la parte detraibile, costo per l'indetraibile) | derivata | squadratura di 1 centesimo |
| COG-M19 | QUANDO si esegue la stampa definitiva del giornale di un periodo ALLORA la numerazione riprende dall'ultima pagina, il file è conservato e il periodo non si riapre senza COG-M13 | brief (G1.5) | due stampe consecutive |

## G2 — Ciclo passivo

| ID | Regola | Origine | Test previsto (file XML: § 10.3 del documento principale) |
|---|---|---|---|
| COG-P01 | QUANDO arriva una fattura già presente ALLORA viene scartata come duplicato e segnalata | brief | stesso identificativo SdI; senza identificativo, stessi P.IVA + tipo + numero + data (`td01-duplicata.xml`, `zip-portale-ade.zip`) |
| COG-P02 | QUANDO un file contiene più `FatturaElettronicaBody` ALLORA nasce una fattura per ciascuno, con la sua deduplica | derivata | `td01-lotto.xml` |
| COG-P03 | QUANDO arriva un P7M o un XML con codifica o versione diversa ALLORA si estrae e si legge correttamente, e si conserva l'originale | derivata | tre P7M, ISO-8859-1, BOM, versione precedente |
| COG-P04 | QUANDO il cessionario non è l'azienda ALLORA la fattura è «sospesa» con anomalia e non si contabilizza | brief (G2.2) | `td01-cessionario-errato.xml` |
| COG-P05 | QUANDO arriva una fattura di un fornitore sconosciuto ALLORA si propone il nuovo fornitore precompilato e la fattura resta «da contabilizzare»; il fornitore non si crea mai senza conferma | brief | `td01-fornitore-nuovo.xml`: nessun `suppliers` in più finché non si conferma |
| COG-P06 | QUANDO l'IBAN in fattura differisce dall'anagrafica ALLORA la fattura non è pagabile finché un utente autorizzato non conferma | brief | `td01-iban-diverso.xml`: scadenze non pagabili, esclusa dalla distinta; conferma solo con `coge_responsabile` |
| COG-P07 | QUANDO si legge una fattura ALLORA si salvano in forma strutturata cedente, cessionario, dati generali, dati collegati, righe con periodo, riepiloghi IVA, ritenute, cassa, bollo e dati di pagamento | brief (G2.2) | un test per ogni file di esempio, confronto con l'atteso |
| COG-P08 | QUANDO tutte le righe hanno una proposta da regola certa e il fornitore ha la conferma automatica abilitata ALLORA la registrazione viene confermata, con protocollo IVA, scadenze e movimenti analitici, in un'unica transazione | brief | `td01-base.xml` con regola certa; errore forzato: niente di tutto questo |
| COG-P09 | QUANDO una riga non ha proposta ALLORA la fattura resta in bozza e la riga compare nella coda «da classificare» | brief | fornitore senza regole né storico né categoria |
| COG-P10 | QUANDO l'utente corregge conto o centro di una riga proposta ALLORA gli viene offerto di salvare la regola, e le fatture successive dello stesso fornitore con la stessa descrizione ricevono la nuova proposta | brief | correzione, regola salvata, seconda fattura |
| COG-P11 | QUANDO arriva una nota di credito collegata a una fattura ALLORA la partita della fattura viene ridotta o chiusa e i movimenti analitici vengono stornati per quota | brief | `td04-totale.xml`, `td04-parziale.xml` |
| COG-P12 | QUANDO una riga ha competenza su più mesi ALLORA i movimenti analitici sono ripartiti per mese in proporzione ai giorni | brief | `td01-competenza.xml` (1/10–31/3, anno bisestile incluso) |
| COG-P13 | QUANDO una riga contiene IVA parzialmente indetraibile ALLORA la parte indetraibile va al costo con lo stesso centro di costo della riga | brief | `td01-indetraibile.xml` |
| COG-P14 | QUANDO arriva una fattura da fornitore UE per servizi o beni ALLORA si genera in bozza il documento di integrazione da inviare a SDI, collegato all'originale | brief | `ue-servizi`, `ue-beni`, `extraue-servizi`: TD17, TD18, TD19 in bozza, doppia annotazione IVA |
| COG-P15 | QUANDO arriva una nota di debito (TD05) o un acconto (TD02) ALLORA la nota si registra come una fattura; l'acconto apre un anticipo che la fattura di saldo storna | brief (G2.5) | `td05.xml`; `td02-acconto.xml` + `td01-saldo.xml` |
| COG-P16 | QUANDO una fattura ha una ritenuta d'acconto ALLORA la partita del fornitore è per il totale e la ritenuta si registra al pagamento, con la scadenza F24 del mese successivo | brief (G2.5) | `td01-ritenuta-cassa.xml`; il pagamento si prova in G4 (COG-T02) |
| COG-P17 | QUANDO una riga ha natura N6.x (reverse charge interno) ALLORA l'IVA si integra con doppia registrazione nel registro acquisti e vendite (o nel sezionale dedicato) | brief (G2.5) | `td01-n6-reverse.xml`: IVA a debito = IVA a credito detraibile |
| COG-P18 | QUANDO una riga corrisponde a una materia prima mappata ALLORA si propone il carico a magazzino valorizzato, collegato alla riga; la riga va su rimanenze/acquisti e non genera movimenti analitici (l'analitica è al consumo) | brief (G2.5) | `td01-materia-prima.xml`: proposta di carico, nessun movimento analitico |
| COG-P19 | QUANDO una riga va su un conto di immobilizzazione ALLORA la conferma propone la scheda cespite | brief (G2.5, G6) | `td01-immobilizzazione.xml`; la scheda arriva con G6 (COG-C01) |
| COG-P20 | QUANDO una fattura è irregolare o non è arrivata ALLORA si traccia la comunicazione TD29 con il suo termine, senza effetti sulla detrazione | brief (G2.5) | scadenza e avviso del job |
| COG-P21 | QUANDO si acquista senza IVA con dichiarazione d'intento ALLORA la fattura deve riportarne gli estremi e il plafond usato aumenta; senza estremi, anomalia | brief (G2.5) | `td01-dichiarazione-intento.xml` |
| COG-P22 | QUANDO si propone la contabilizzazione di una riga ALLORA le regole si applicano in ordine (riga, fornitore, storico, categoria, nessuna) e la proposta mostra la regola e l'affidabilità | brief (G2.4) | una fattura per ogni livello |
| COG-P23 | QUANDO si contabilizza una fattura ALLORA il periodo IVA proposto segue le regole di detrazione configurate (data di ricezione SDI, data di registrazione) e si sposta solo entro i limiti ammessi | brief (G2.6) | config: `vat_deduction_rules`, fattura di dicembre ricevuta a gennaio |
| COG-P24 | QUANDO le righe si raggruppano per conto + codice IVA + centro ALLORA resta il collegamento riga fattura → riga contabile → riga analitica | brief (G2.4) | 5 righe in 2 righe contabili, percorso inverso |
| COG-P25 | QUANDO una fattura cambia stato ALLORA segue ricevuta → da contabilizzare → in bozza → contabilizzata → pagata in parte → pagata, più sospesa e contestata; ogni cambio è tracciato | brief (G2.1) | transizioni non ammesse rifiutate |
| COG-P26 | QUANDO arriva un webhook con firma non valida ALLORA 401 e nulla si salva; QUANDO il webhook non arriva ALLORA il polling recupera il documento; il contenuto del webhook non si usa come dato | derivata | server finto del provider |
| COG-P27 | QUANDO si salva un file fiscale ALLORA sul disco c'è solo il file cifrato, con l'impronta nel database, e non esiste un'API che lo cancelli | derivata | lettura del disco; nessuna route di cancellazione |

## G3 — Ciclo attivo

| ID | Regola | Origine | Test previsto |
|---|---|---|---|
| COG-A01 | QUANDO una fattura attiva viene scartata da SDI ALLORA torna in stato modificabile con lo stesso numero, e la registrazione contabile resta sospesa fino al nuovo invio accettato | brief | notifica NS dal server finto |
| COG-A02 | QUANDO una fattura attiva viene consegnata ALLORA la registrazione diventa confermata con protocollo IVA e partita aperta | brief | ricevuta RC |
| COG-A03 | QUANDO una fattura ha righe esenti o non imponibili oltre la soglia del bollo ALLORA il bollo virtuale viene applicato e conteggiato per il versamento trimestrale | brief | config: soglia e importo del bollo |
| COG-A04 | QUANDO si emette una fattura senza IVA a un cliente esportatore abituale ALLORA gli estremi della sua dichiarazione d'intento devono essere validi e presenti, altrimenti blocco | brief | dichiarazione scaduta o assente |
| COG-A05 | QUANDO si registrano i corrispettivi di un giorno ALLORA una registrazione per giorno e aliquota, con il centro dal contesto della vendita; le vendite annullate non contano | brief (G3) | vendite in `negozio` e `post_visita`, una annullata |
| COG-A06 | QUANDO si registra un incasso Stripe ALLORA ricavo sul centro Enoturismo o e-commerce, commissione come costo, payout come giroconto verso la banca | brief (G3) | prenotazione e ritiro con commissione |
| COG-A07 | QUANDO una partita cliente si chiude, anche in parte, ALLORA lo stato di pagamento dell'ordine si aggiorna da solo | brief (G3) | incasso parziale e totale |
| COG-A08 | QUANDO una fattura attiva non viene consegnata ALLORA resta emessa, è disponibile nel cassetto fiscale del cliente e si avvisa il cliente | brief (G3) | ricevuta MC |
| COG-A09 | QUANDO Stripe consegna due volte lo stesso pagamento ALLORA nessun effetto doppio (sconto, email, incasso) | derivata (COG-X05) | doppio webhook |
| COG-A10 | QUANDO si emette una fattura in un sezionale ALLORA numero e data sono progressivi e cronologici nel sezionale e nell'anno | derivata | data anteriore all'ultima: rifiuto |

## G4 — Tesoreria

| ID | Regola | Origine | Test previsto |
|---|---|---|---|
| COG-T01 | QUANDO un movimento bancario viene abbinato a una o più partite ALLORA si genera la registrazione di incasso o pagamento, le partite si chiudono totalmente o parzialmente e lo stato di pagamento dei documenti si aggiorna | brief | un bonifico per più fatture; più bonifici per una fattura |
| COG-T02 | QUANDO un pagamento riguarda una fattura con ritenuta ALLORA la registrazione separa netto e ritenuta e genera la scadenza F24 | brief | fattura del professionista di COG-P16 |
| COG-T03 | QUANDO un movimento bancario resta non riconciliato oltre N giorni ALLORA compare in anomalia | brief | config: N |
| COG-T04 | QUANDO si prepara una distinta SEPA ALLORA entrano solo scadenze pagabili (IBAN confermato) e il file pain.001 è valido | derivata | scadenza con IBAN da confermare esclusa |
| COG-T05 | QUANDO si importa un estratto conto già importato ALLORA i movimenti non si duplicano | derivata | stesso file CAMT.053 due volte |

## G5 — IVA e adempimenti

| ID | Regola | Origine | Test previsto |
|---|---|---|---|
| COG-I01 | QUANDO si esegue la liquidazione di un periodo ALLORA il periodo passa a «chiuso IVA», nessuna nuova registrazione IVA può esservi imputata e si genera la registrazione del debito o credito | brief | liquidazione mensile e trimestrale (con maggiorazione config) |
| COG-I02 | QUANDO l'utilizzo del plafond supera la soglia di avviso ALLORA notifica all'amministrazione | brief | config: soglia |
| COG-I03 | QUANDO l'utilizzo del plafond supera il plafond ALLORA blocco delle nuove dichiarazioni d'intento emesse | brief | — |
| COG-I04 | QUANDO l'azienda (o un'attività) è nel regime dei produttori agricoli ALLORA l'IVA detraibile delle vendite si calcola con le percentuali di compensazione della tabella per prodotto | brief (G5) | config: percentuali da validare |
| COG-I05 | QUANDO si generano i pacchetti di conservazione di un periodo ALLORA ogni documento compare una volta con la sua impronta, e l'esito si traccia fino al rapporto di versamento | brief (G5) | pacchetto, esito rifiutato, nuovo invio |
| COG-I06 | QUANDO si chiude un trimestre ALLORA il bollo virtuale dovuto è il conteggio delle fatture del trimestre, con la scadenza di versamento | brief (G5) | config: importo e scadenze |

## G6 — Cespiti, competenza, paghe

| ID | Regola | Origine | Test previsto |
|---|---|---|---|
| COG-C01 | QUANDO si conferma una fattura con riga su conto di immobilizzazione ALLORA si propone la scheda cespite precompilata | brief | barrique di `td01-immobilizzazione.xml` |
| COG-C02 | QUANDO si esegue l'ammortamento di un periodo ALLORA si generano registrazione contabile e movimenti analitici sul centro del cespite, una sola volta per periodo | brief | doppia esecuzione |
| COG-C03 | QUANDO si apre un nuovo periodo ALLORA le scritture di assestamento del periodo precedente vengono stornate automaticamente | brief | rateo, risconto, fatture da ricevere |
| COG-C04 | QUANDO si importano le paghe del mese ALLORA la registrazione contabile viene creata e il conguaglio standard/effettivo viene calcolato; nessun movimento analitico aggiuntivo per le righe marcate «analitica da timesheet» | brief | richiede la Fase 4 di Finance |
| COG-C05 | QUANDO si calcola un ammortamento ALLORA coefficienti civilistici e fiscali sono distinti e presi dalla tabella in vigore | brief (G6.1) | config: coefficienti da validare |

## G7 — Raccordo e chiusura

| ID | Regola | Origine | Test previsto |
|---|---|---|---|
| COG-R01 | QUANDO si chiude un periodo analitico ALLORA il prospetto di raccordo deve avere differenza non spiegata pari a zero, altrimenti la chiusura è bloccata con l'elenco delle differenze | brief | un costo registrato solo in analitica |
| COG-R02 | QUANDO un conto rilevante per l'analitica ha importo in generale diverso dalla somma delle sue righe analitiche ALLORA compare in anomalia con le registrazioni responsabili | brief | squadratura introdotta a mano |
| COG-R03 | QUANDO si esegue la chiusura dell'esercizio con controlli preliminari non superati ALLORA blocco con elenco dei controlli falliti | brief | un controllo alla volta |
| COG-R04 | QUANDO si esegue la chiusura dell'esercizio ALLORA il totale dello stato patrimoniale di chiusura coincide con quello di riapertura nel nuovo esercizio, e le partite aperte sono riportate identiche | brief | esercizio completo di prova |
