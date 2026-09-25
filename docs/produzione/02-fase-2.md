# Produzione — Fase 2: vigneto (interventi, trattamenti, analisi)

Stato: **consegnata in locale il 25/09/2026, da approvare.** Non è in produzione: la pubblico quando me lo chiedi, dopo la revisione e i test.

Decisioni applicate: DP13 come da proposta approvata, con i periodi **configurabili** in attesa dell'agronomo (VIG-11); DP9 (pagina da campo); DP17 (unità a schermo).

---

## 1. Cosa c'è

### Produzione → Vigneto → Interventi e trattamenti

Tre viste.

- **Interventi:**
  - elenco con filtri per parcella, tipo e stato; è anche lo **storico per parcella**;
  - 14 tipi, dalla potatura secca alla vendemmia;
  - un intervento vale per **più parcelle**, ognuna con la sua superficie lavorata;
  - poi esecutori, attrezzature, fase fenologica (BBCH) e note;
  - **trattamento:** avversità, volume d'acqua e meteo, e **uno o più prodotti** (miscela in botte) con dose per ettaro e quantità totale. Se la quantità non c'è, si propone dose × ettari;
  - **concimazione:** prodotto, titolo NPK, dose e quantità;
  - un intervento nasce **bozza**. La conferma fa tutti i controlli di legge (PRD-V01…V10) e dice tutto ciò che manca in una volta sola;
  - da confermato non si modifica: si **storna** con il motivo e si ricrea (V11). **Ripeti** crea una bozza uguale con la data di oggi.
- **Stato delle parcelle oggi**, per ogni parcella:
  - carenza attiva fino al…;
  - rientro fino al…;
  - ultimo trattamento;
  - interventi pianificati (le bozze con data futura).

  Un clic apre lo storico della parcella.
- **Registro dei trattamenti:**
  - per anno solare, una riga per trattamento × parcella × prodotto;
  - dati: data e ore, parcella con i riferimenti catastali, coltura, superficie, BBCH, avversità, prodotto con n. di registrazione e sostanze attive, dose, quantità, acqua, carenza e rientro con le date di fine, esecutori, attrezzature, meteo;
  - segnalazioni: registrazione tardiva e attrezzatura non conforme;
  - **CSV** (separatore «;», si apre in Excel) e **stampa**, che dal browser si salva come PDF. Il formato definitivo del quaderno è della Fase 7.

### Produzione → Vigneto → Analisi e maturazione

Tre viste.

- **Analisi:**
  - su parcella o su vaso, con data del campione, fonte (laboratorio interno o esterno, strumento, stima), laboratorio (dal CRM) e n. di rapporto;
  - valori come «< 0,5» accettati;
  - **import dal laboratorio** con il modello Excel da scaricare (xlsx o csv):
    - si controlla riga per riga e si importa **tutto o niente**;
    - si può provare senza importare;
    - gli errori escono con il numero di riga.
- **Curve di maturazione:**
  - per parcella e parametro, confronto tra le annate (fino a 4);
  - un grafico con legenda, etichette in fondo alle linee, valori al passaggio del mouse, e la tabella dei valori sotto il grafico.
- **Previsione di vendemmia:**
  - per parcella e destinazione (base spumante, bianco, rosato, rosso);
  - calcolo:
    - con i **valori obiettivo** configurati, una retta sugli ultimi campioni dell'annata dà il giorno in cui il valore entra nell'obiettivo («dal»);
    - se c'è un limite che il valore supererà, dà anche il giorno in cui ne esce («entro»). Esempio: l'acidità che scende sotto il minimo per la base spumante;
  - **la data scritta a mano vince sempre**, con una nota.

### Pagina da campo (`/campo.html`)

Per smartphone e tablet, installabile come app dal browser.

- **Accesso e uso:**
  - si entra con utente e password del portale; l'accesso dura finché l'app resta aperta, «Esci» toglie dal telefono anche le anagrafiche;
  - riaperta in vigneto senza rete e senza accesso, si lavora in bozza con i dati dell'ultimo aggiornamento; le bozze partono dopo l'accesso;
  - ogni bozza porta chi l'ha scritta: su un telefono condiviso quelle di un collega partono solo quando accede lui;
  - con la sessione scaduta al momento di salvare, la bozza resta sul telefono;
  - griglia dei tipi di intervento e «Ripeti» dell'ultimo intervento confermato;
  - parcelle con ricerca e con il segno della carenza o del rientro attivi;
  - esecutori, attrezzature, prodotti.
- **Senza rete:**
  - la bozza resta sul telefono e parte da sola quando torna la rete;
  - lo stesso invio due volte non crea due bozze;
  - se la rete cade a metà invio, la bozza resta in coda;
  - una bozza che il portale rifiuta (per esempio durante il rientro) resta in coda con il motivo: si **corregge** nel modulo o si **scarta**;
  - la superficie si scrive in ettari con la virgola o con il punto del telefono: «0.5» è mezzo ettaro;
  - **si conferma solo in linea**, perché i controlli di legge li fa il server;
  - sul telefono restano le anagrafiche e lo stato delle parcelle dell'ultimo aggiornamento.
- Durante il rientro chiede il motivo (DPI) prima di salvare (V07).

### People → Presenze

- **Proposte dagli interventi:** un intervento confermato **propone la riga** nelle presenze di ogni esecutore:
  - inizio e fine dall'intervento (o i minuti stimati, se ci sono);
  - il centro «ore di vigneto»;
  - l'**oggetto di costo della parcella per annata**, se l'intervento è su una sola parcella.

  Si accetta o si scarta come le proposte di prenotazioni e fiere. Una proposta accettata non torna; e un intervento stornato e rifatto non ripropone le ore già registrate.
- In Impostazioni delle presenze c'è il nuovo campo **«Centro per le ore di vigneto»** (partenza: P101).

### Magazzino

Se il fitofarmaco è collegato a un articolo di magazzino, la conferma del trattamento lo **scarica**:
- per parcella, in proporzione alla superficie;
- con l'oggetto di costo della parcella e la causale «consumo di produzione».

Lo storno del trattamento lo rimette. Le quote per parcella sommano sempre il totale. Vale solo per articoli in **grammi o millilitri** (vedi § 7).

## 2. Migrazioni

| Versione | Tabelle nuove | Tabelle **esistenti** toccate |
|---|---|---|
| `0020_prd_vineyard_ops` | `parcel_interventions`, `parcel_intervention_parcels`, `parcel_intervention_workers`, `parcel_intervention_equipment`, `phyto_treatment_details`, `phyto_treatment_products`, `fertilization_details`, `analyses`, `analysis_results`, `harvest_forecasts`, `parcel_cost_objects`, `timesheet_intervention_links` | `timesheet_proposal_decisions` **ricostruita**: la fonte ammette anche «intervento» (in SQLite il vincolo non si cambia altrimenti). Righe copiate uguali; chiavi esterne verificate prima del commit |

Dati di partenza:
- 3 soglie nuove in `prd_config`, tutte da validare:
  - `phyto_applications_period` = anno solare;
  - `harvest_year_start` = 1/11;
  - `harvest_targets`, vuota;
- l'oggetto di costo `OP-TRATT-FITO` («Trattamento fitosanitario», tipo operazione), collegato alla formazione «fitosanitari». È l'operazione su cui People controlla patentino e idoneità.

Come per la Fase 1:
- c'è il `down`, che toglie tabelle, soglie e decisioni «intervento» e rimette il vincolo di prima;
- tutto si registra in UTC, con data del lavoro, annata agraria e campagna calcolate in ora italiana;
- ogni scrittura va nel registro attività.

## 3. Eventi

Contratti nel catalogo [`eventi.md`](eventi.md), § 3.

| Evento | Quando | Consumer |
|---|---|---|
| `parcel.intervention_confirmed` | ogni intervento confermato | nessuno per ora (Dashboard, Finance) |
| `phyto.treatment_confirmed` | ogni trattamento confermato | `magazzino.scarico-fitofarmaci` |
| `parcel.intervention_reversed`, `phyto.treatment_reversed` | storno | `magazzino.storno-fitofarmaci` |

- Tutti portano `operation_id`.
- Le parcelle hanno l'oggetto di costo per annata, così Finance (Fase 8) non deve leggere le tabelle di Produzione.
- Carenza e rientro li calcola la conferma, nella stessa transazione. Non li calcola un consumer.

## 4. Regole e test

Tutte in `test/prd-vigneto.test.js`; il dettaglio di cosa prova ogni test è in [`regole.md`](regole.md).

| Regola | Esito |
|---|---|
| PRD-V01 campi di legge del trattamento | ✓ |
| PRD-V02 patentino valido alla data, senza deroghe | ✓ |
| PRD-V03 dose massima | ✓ |
| PRD-V04 applicazioni massime nel periodo | ✓ |
| PRD-V05 prodotti ammessi in biologico | ✓ |
| PRD-V06 fine carenza e fine rientro, la più lontana | ✓ |
| PRD-V07 rientro: conferma con motivo (DPI) | ✓ |
| PRD-V08 registrazione tardiva | ✓ |
| PRD-V09 attrezzatura non controllata: non conforme | ✓ |
| PRD-V10 limitazione del medico: non esecutore | ✓ |
| PRD-V11 storno e ricalcolo | ✓ |
| PRD-A02 (Fase 1) parcella con interventi nella campagna aperta non si archivia | ✓ ora con interventi veri |

**Revisione del codice.** Prima della consegna una revisione indipendente ha trovato 4 difetti gravi, 6 medi e alcuni minori, tutti corretti e con un test:
- **import CSV all'italiana:** «14,5» diventava 145 e «09/10» il 10 settembre. Ora il CSV si legge come testo, con la virgola decimale e il giorno prima del mese. Nell'anteprima si vedono i valori letti;
- **rientro (V07):** contavano anche i trattamenti successivi al lavoro. Ora contano solo quelli già iniziati;
- **patentino (V02):** dipendeva da un collegamento che in People si può togliere. Ora il patentino si richiede sempre, e senza l'operazione `OP-TRATT-FITO` il trattamento non si conferma;
- **idoneità (V10):** se la conferma falliva, la consultazione non restava nel registro degli accessi. Ora il registro si scrive fuori dalla transazione;
- **medi:**
  - «0.5» ettari letto come 5;
  - scarichi di magazzino arrotondati in eccesso;
  - prodotti rimasti su una bozza cambiata di tipo;
  - conferma di lavori futuri o con prodotti e attrezzature archiviati;
  - pagina da campo inutilizzabile riaperta senza rete, e bozze di un collega inviate a nome di un altro;
  - bozza «ripetuta» che non si eliminava;
- **minori:**
  - motivo DPI perso se la bozza andava in coda;
  - copie d'errore nella cache della pagina da campo;
  - ore riproposte dopo uno storno;
  - permesso controllato prima di ricevere il file;
  - formule nel CSV del registro.

Altri test della fase:
- registro dei trattamenti e CSV;
- conferma solo di lavori fatti, niente prodotti o attrezzature archiviati, cambio di tipo della bozza;
- bozze da campo: lo stesso invio due volte, «ripeti», eliminazione della bozza (anche di quella da cui ne è nata un'altra);
- proposte nelle presenze con l'oggetto di costo della parcella;
- scarico e storno di magazzino;
- analisi: import tutto o niente, curve, previsione.

Il controllo «ogni regola ha il suo test» ora copre le Fasi 1 e 2.

**Esito: 162 test, 162 superati** (18 nuovi).

Verificato anche nel browser:
- trattamento confermato dal portale;
- stato della parcella e registro;
- curve con i valori al passaggio del mouse;
- previsione;
- pagina da campo a larghezza telefono:
  - bozza senza rete e invio al ritorno della rete;
  - rete che cade a metà invio;
  - bozza rifiutata, corretta o scartata;
  - app riaperta senza rete e senza accesso;
  - bozza di un collega che resta in coda;
  - sessione scaduta al salvataggio.

  Non ho provato nel browser l'invio dopo l'accesso con un utente vero: non inserisco credenziali. Il flusso è lo stesso, già provato, dell'invio al ritorno della rete.

## 5. Punti toccati nei moduli esistenti

Tutti **aggiuntivi**: chi non usa la Produzione non vede differenze.

| Dove | Cosa |
|---|---|
| `modules/hr-safety.js` → `assignmentCheck` | opzione `strict`: la deroga del responsabile sicurezza non vale e la limitazione del medico sull'operazione **blocca** invece di avvisare. Opzione `requiredTrainingCodes`: abilitazioni richieste comunque, anche se il collegamento all'operazione cambia. Senza le due opzioni (tutto il resto di People) è come prima |
| `modules/hr-timesheet.js` | `registerProposalSource`: altri moduli possono aggiungere proposte di righe. Nuova impostazione `timesheet_vineyard_center` |
| `public/js/portal-people-timesheet.js` | campo «Centro per le ore di vigneto» nelle impostazioni delle presenze |
| `timesheet_proposal_decisions` | ricostruita per la fonte «intervento» (§ 2) |
| `server.js` | il modulo Produzione riceve `hrSafety` e `hrTimesheet` |
| `public/portal.html` | due voci nel gruppo Vigneto, i loro pannelli e i due script |

Il magazzino si usa solo dalle sue funzioni (`stock.move`, `stock.reverseWhere`): la Produzione non tocca le quantità.

## 6. Decisioni prese in autonomia

- **Più prodotti in un trattamento** (miscela in botte). Ogni prodotto ha i suoi controlli di dose, applicazioni e biologico; carenza e rientro sono quelli del prodotto più lungo.
- **Periodo delle applicazioni massime:** anno solare di partenza, oppure annata agraria o campagna, da Soglie da validare (DP13).
- **Annata agraria dal 1° novembre:** i lavori da novembre servono la vendemmia dell'anno dopo. Da lì nascono gli oggetti di costo delle parcelle (una per parcella e annata, creati alla prima conferma).
- **Rientro (V07):**
  - vale per gli interventi a mano, non per un trattamento;
  - il motivo si chiede prima di salvare la bozza e resta sull'intervento.
- **Carenza:** «fino al 10/10» vuol dire che dal 10/10 si può raccogliere. Da confermare in Fase 3 per il controllo del conferimento (PRD-H02).
- **Una bozza si elimina, un confermato no.** Lo storno chiede sempre il motivo.
- **Confermare vuol dire «fatto»:**
  - un intervento non ancora iniziato non si conferma, e un trattamento non ancora finito nemmeno (5 minuti di margine per l'orologio del telefono);
  - i lavori futuri si pianificano come bozze;
  - prodotti e attrezzature archiviati non si usano in una conferma.
- **Patentino fitosanitario:** richiesto sempre per i trattamenti, anche se in People si cambia il collegamento dell'operazione. Senza l'operazione `OP-TRATT-FITO` nessun trattamento si conferma.
- **Ore:**
  - le ore vere stanno nelle presenze; sull'intervento ci sono solo i minuti stimati;
  - con più parcelle la proposta non ha l'oggetto di costo, perché la ripartizione tra parcelle la decidi tu (§ 7). Dopo averla accettata, la riga si modifica e si ripartisce come ogni altra;
  - nessun debito da migrare: People c'era già.
- **Scarico di magazzino solo in g o ml:** il registro conta in unità intere, e un articolo in kg o litri perderebbe i decimali.
- **Pagina da campo:**
  - accesso con utente e password;
  - i dati restano sul telefono fino all'uscita;
  - la conferma solo in linea.
- **Import dal laboratorio:**
  - nel CSV la virgola è decimale e la data è giorno/mese/anno;
  - senza virgola il punto è decimale: «1.234» è un numero con i decimali, non mille;
  - nei campi del portale «14.000» resta quattordicimila;
  - l'anteprima mostra i valori letti prima di importare.
- **Mappa delle parcelle:** non c'è ancora; le parcelle si scelgono dall'elenco con ricerca.
- **Calendario:** non c'è la griglia del mese; l'elenco per data e lo stato delle parcelle fanno da calendario e storico. Se ti serve la vista mese la aggiungo.

## 7. Decisioni aperte per te

1. **Centro per le ore di vigneto:** parte da P101 «Vigneto — particella 1». Scegli quello giusto in People → Presenze → Impostazioni.
2. **Ore su più parcelle:** oggi la riga nasce senza oggetto di costo; lo si aggiunge, o si ripartisce tra le parcelle, modificando la riga accettata. In alternativa la proposta può già dividere le ore per superficie.
3. **DP13 con l'agronomo (VIG-11):** conferma anno solare e 1° novembre, o cambiali nelle soglie.
4. **Valori obiettivo per la previsione** (`harvest_targets`): li imposta l'enologo per destinazione. Per esempio base spumante: zuccheri ≥ …, acidità ≥ ….
5. **Fitofarmaci a magazzino (VIG-10):** li gestite a magazzino? Se sì, gli articoli vanno in grammi o millilitri.
6. **Formato del laboratorio (CAN-09):** con un rapporto vero adatto il modello di import.
7. **Scala degli zuccheri** (°Babo o °Brix) per le curve di partenza: domanda già nel questionario.
8. **Libreria Excel (`xlsx` 0.18.5):** ha due vulnerabilità note su file costruiti apposta (CVE-2023-30533, CVE-2024-22363). La usano anche l'import degli ordini e gli altri export, quindi l'aggiornamento (0.20.x, dal sito di SheetJS) va fatto a parte, con i test di tutti gli import. Te l'ho proposto come attività separata.
9. **Miscela in botte:** conferma che un trattamento con più prodotti vale come una applicazione per ciascun prodotto.

## 8. Da fare prima della pubblicazione

- La revisione è fatta (§ 4). Alla pubblicazione: `npm test` e un ultimo controllo del diff, con attenzione ai punti in People e Magazzino (§ 5).
- La pubblicazione applica la migrazione 0020 dopo la copia automatica del database.
