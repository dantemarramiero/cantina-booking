# People e Finance — Fase 2: People

Stato: **completata**. I blocchi 2A–2D sono in produzione dal 24/09/2026; il 2E è in locale, in attesa di conferma. La fase è divisa in blocchi:

| Blocco | Contenuto | Stato |
|---|---|---|
| 2A | Fascicolo: dati personali, rapporto di lavoro, retribuzione, competenze, documenti cifrati, scadenzario con notifiche | in produzione |
| 2B | Sicurezza (D.Lgs. 81/08): formazione, requisiti per mansione, idoneità sanitaria, DPI, infortuni, deroghe | in produzione |
| 2C | Assenze: richieste e approvazioni, contatori, periodi bloccati, disponibilità per l'Enoturismo | in produzione |
| 2D | Presenze: ore per squadra, proposte da prenotazioni e fiere, stati del mese, rettifiche, export, controlli bloccanti | in produzione |
| 2E | Self-service, onboarding e offboarding, dotazioni, richieste di modifica, cedolini in blocco, modello dati del recruiting | completato, in locale |

Valutazione e disciplinare sono rimandati, come concordato.

---

## 2A — Fascicolo del dipendente

### Cosa c'è

**Scheda del dipendente a pagina intera** (People → Dipendenti → clic su una persona). Ha sei sezioni.

- **Organizzazione.** Contiene:
  - i dati di Fase 1;
  - chi approva;
  - l'orario contrattuale;
  - il costo orario standard.
- **Dati personali** (livello *personale*). Contiene:
  - l'anagrafica: codice fiscale e IBAN, entrambi controllati;
  - la residenza, il domicilio e i contatti personali;
  - le taglie per i DPI;
  - i contatti di emergenza;
  - i documenti d'identità e i permessi di soggiorno. Per il permesso la scadenza è obbligatoria.
- **Rapporto di lavoro**, con due parti.
  - *Contratto* (livello *personale*):
    - ogni cambiamento è una **nuova versione** con la sua decorrenza, mai una modifica. I cambiamenti sono proroga, trasformazione, variazione di mansione o livello, cessazione;
    - la nuova versione eredita i campi non toccati;
    - sede, centro e responsabile vengono copiati dalla scheda Organizzazione per lo storico.
  - *Retribuzione* (livello *retributivo*):
    - si registra una RAL oppure una paga oraria, più superminimo, indennità e benefit, con decorrenza;
    - il sistema **propone il costo orario standard** con la formula costo annuo × (1 + oneri) / (ore settimanali × 52);
    - la proposta si conferma con un clic e diventa il costo orario usato da Finance.
- **Competenze** (livello *personale*):
  - lingue, titoli di studio, esperienze, qualifiche di settore, competenze operative;
  - le lingue sono codici (it, en, de…), perché serviranno all'Enoturismo per assegnare le visite.
- **Documenti.** Tutto il fascicolo documentale:
  - ogni tipo ha il suo livello di riservatezza, la conservazione in anni e l'indicazione se il dipendente lo vede;
  - sono già caricati 15 tipi: contratto, cedolino, CU, idoneità sanitaria, attestato di formazione, consegna DPI e altri;
  - ogni documento ha le versioni;
  - i file sono cifrati sul disco e si aprono con un link firmato che scade dopo 10 minuti.
- **Scadenze.** Quelle di questo dipendente nei prossimi 12 mesi.

**Scadenzario** (People → Scadenze):
- raccoglie in un'unica vista permessi di soggiorno, documenti d'identità, fine dei contratti a termine, fine del periodo di prova e documenti con scadenza;
- si filtra per periodo, tipo, sede e squadra;
- dal blocco 2B vi entrano anche formazione, visite mediche e DPI.

**Campanella delle notifiche** nella barra in alto, per tutti gli utenti:
- un job quotidiano avvisa alle soglie di preavviso (60, 30 e 7 giorni, configurabili) e alla scadenza;
- gli avvisi vanno a HR, al responsabile e al dipendente, se hanno l'accesso al portale;
- ogni voce avvisa una sola volta per soglia;
- dalla notifica si apre direttamente la scheda del dipendente.

**Configurazione** (People → Configurazione). Riunisce:
- sedi e festività (come in Fase 1);
- le **mansioni** (11 di partenza);
- le **soglie di preavviso**;
- la **percentuale di oneri** usata per proporre il costo orario (predefinita 30%).

**Conservazione dei documenti:**
- ogni documento riceve la data oltre la quale andrebbe eliminato, calcolata dagli anni di conservazione del suo tipo;
- un job quotidiano segnala ad HR quelli scaduti;
- non cancella mai nulla da solo.

### Migrazioni

| Versione | Cosa |
|---|---|
| `0009_hr_file` | Tabelle:<br>• `job_roles` (+ 11 mansioni)<br>• `employee_personal` (codice fiscale univoco)<br>• `emergency_contacts`<br>• `identity_documents`<br>• `employment_contracts` (versionati, `UNIQUE(employee_id, version)`)<br>• `compensations`<br>• `employee_skills`<br>• `hr_document_types` (+ 15 tipi)<br>• `hr_documents`<br>• `sensitive_access_log` |

Ha il `down`.

### Archivio cifrato dei documenti

- **Algoritmo e formato.** I file sono cifrati con AES-256-GCM e salvati in `DATA_DIR/hr-files/<uuid>.bin`, cioè sul volume, fuori dal database. Nel file ci sono, in ordine, IV, tag e testo cifrato.
- **Integrità.** Il database tiene l'impronta SHA-256 dell'originale. Un file alterato non si apre.
- **Chiave.** Viene dalla variabile **`HR_FILES_KEY`**: 32 byte in esadecimale o base64.
  - In locale, senza la variabile, si usa una chiave di sviluppo salvata in `DATA_DIR/.hr-files-dev-key`, esclusa da git.
  - **Su Railway, senza la variabile, i documenti HR sono disattivati** (risposta 503). Tutto il resto funziona.
- **Accessi sanitari.** Ogni apertura di un documento di livello *sanitario* finisce nel registro accessi (`/hr/sensitive-access-log`).

### Eventi di dominio aggiunti

| Evento | Emittente | Consumer | Effetto |
|---|---|---|---|
| `employee.role_changed` | Nuova versione del contratto con mansione diversa | *nessuno per ora* (2B: nuova formazione obbligatoria per la mansione) | payload: dipendente, mansione di prima e di dopo, decorrenza |

### Logica di business (QUANDO/ALLORA) e test

Tutti i test di questa sezione sono nel file `hr-file`.

| Regola | Test |
|---|---|
| QUANDO chi non ha il livello *personale* legge o scrive i dati personali ALLORA 403, e la scheda non li contiene | dati personali |
| QUANDO il codice fiscale o l'IBAN non sono validi, oppure il codice fiscale è di un altro dipendente ALLORA rifiuto | dati personali |
| QUANDO un permesso di soggiorno non ha scadenza ALLORA rifiuto | permesso di soggiorno |
| QUANDO un permesso di soggiorno è scaduto ALLORA la scadenza è segnata come bloccante e il dipendente ha un problema bloccante per l'inserimento delle ore | permesso di soggiorno |
| QUANDO si registra un cambiamento di contratto ALLORA nasce una nuova versione. La precedente resta invariata e la nuova eredita i campi non indicati | contratti versionati |
| QUANDO un contratto a termine non ha data di fine ALLORA rifiuto | contratti versionati |
| QUANDO la decorrenza è prima della versione in vigore ALLORA rifiuto | contratti versionati |
| QUANDO la nuova versione cambia la mansione ALLORA evento `employee.role_changed` | contratti versionati |
| QUANDO chi non ha il livello *retributivo* legge o registra la retribuzione ALLORA 403 | retribuzione |
| QUANDO si registra una retribuzione ALLORA il registro attività non riporta importi | retribuzione |
| QUANDO c'è una retribuzione in vigore ALLORA si propone il costo orario esatto. Esempio: 30.000 € a 40 h e 30% di oneri fa 18,7500 €/h | retribuzione |
| QUANDO si inserisce una lingua ALLORA è un codice di due lettere, senza doppioni | lingue |
| QUANDO si carica un documento ALLORA sul disco c'è solo il file cifrato | documenti |
| QUANDO il file cifrato è alterato ALLORA non si apre | documenti |
| QUANDO si elimina un documento ALLORA si elimina anche il file | documenti |
| QUANDO chi non ha il livello del tipo prova a caricare, vedere o scaricare un documento ALLORA rifiuto | documenti |
| QUANDO il dipendente guarda il proprio fascicolo ALLORA vede solo i tipi a lui visibili | documenti |
| QUANDO si apre un documento sanitario ALLORA l'accesso è registrato | documenti |
| QUANDO una scadenza raggiunge una soglia di preavviso o scade ALLORA notifica a HR, al responsabile e al dipendente, una sola volta per soglia | scadenzario |
| QUANDO si impostano soglie fuori da 1–365 giorni ALLORA rifiuto | soglie |
| QUANDO un documento supera il periodo di conservazione ALLORA segnalazione ad HR, e il documento resta | conservazione |
| QUANDO si carica o si elimina un documento del fascicolo ALLORA servono il livello *personale* e quello del tipo, anche per i tipi di livello *base* | documenti; il dipendente vede i propri dati |
| QUANDO il dipendente apre la propria scheda ALLORA vede i propri dati personali e i documenti a lui visibili. Non li modifica e non vede quelli degli altri | il dipendente vede i propri dati |
| QUANDO si apre una notifica di scadenza ALLORA si apre la scheda del dipendente sulla sezione Scadenze | scadenzario |
| QUANDO un dipendente ha un fascicolo (contratti, retribuzioni, documenti) ALLORA non si elimina, si disattiva. Senza dati si elimina | `hr-safety` · non si elimina |
| QUANDO chi chiede le scadenze non ha il livello *personale* ALLORA vede solo le proprie e quelle dei collaboratori | `hr-safety` · chi vede l'idoneità |

Esito a fine 2A: **65 test, 65 superati** (10 nuovi). Le ultime due regole sono state aggiunte con il blocco 2B.

### Punti toccati nei moduli esistenti

- **Barra in alto del portale:** la campanella delle notifiche.
- **People:** la scheda del dipendente passa da finestra a pagina intera; nel menu arriva **Scadenze**; «Sedi e festività» diventa **Configurazione**.
- **Server:** all'avvio viene indicato lo stato dell'archivio cifrato («Documenti HR»).

### Decisioni prese in autonomia

- **Classificazione dei dati:**
  - dati anagrafici, contatti personali, IBAN, taglie, documenti d'identità, contratto e competenze sono *personale*;
  - la retribuzione è *retributivo*;
  - i documenti hanno il livello del loro tipo (per esempio idoneità sanitaria = *sanitario*, cedolino = *retributivo*).
- **Il dipendente vede i propri dati** (tranne i disciplinari) e i documenti dei tipi segnati come «visibile al dipendente». Il suo self-service arriva col blocco 2E.
- **Archivio:** volume di Railway cifrato con la nostra chiave, invece di un Bucket S3. Si può spostare su un Bucket più avanti senza cambiare il formato.
- **Una scadenza che conta per le ore** (permesso di soggiorno, fine del contratto a termine) è «bloccante». Il blocco vero scatta con le presenze del blocco 2D.
- Il **costo orario proposto** è solo una proposta: diventa effettivo solo quando qualcuno lo conferma.

### Da fare prima di andare in produzione

- Impostare **`HR_FILES_KEY`** su Railway (32 byte casuali).
  - Va conservata anche fuori da Railway: **se si perde, i documenti non si possono più aprire**.
  - È una modifica di configurazione: la faccio solo su tua conferma.

---

## 2B — Sicurezza sul lavoro (D.Lgs. 81/08)

### Cosa c'è

**Sezione Sicurezza della scheda del dipendente.** Contiene:
- **la formazione richiesta dalla mansione**, con lo stato di ogni corso: valido, in scadenza, scaduto o mancante;
- **il registro dei corsi**: data, ore, ente e attestato allegato. La scadenza si calcola dalla periodicità del tipo di corso, oppure la si indica a mano;
- **l'idoneità alla mansione** (livello *sanitario*):
  - giudizio del medico competente, limitazioni, fine della non idoneità temporanea e prossima visita, con lo storico;
  - le mansioni e le operazioni incompatibili con le limitazioni;
  - **nessuna diagnosi**;
- **i DPI consegnati**: tipo, taglia (presa dalla scheda se non indicata), quantità, verbale firmato, data di sostituzione e restituzione;
- **le deroghe** del responsabile sicurezza;
- **le attività aperte**, per esempio la visita per cambio mansione;
- **gli infortuni** della persona.

La sezione si carica solo quando la si apre, perché la lettura dell'idoneità viene registrata.

**People → Sicurezza.** Due viste:
- **Conformità**, per ogni persona:
  - formazione mancante, scaduta o in scadenza;
  - visita medica;
  - idoneità, solo per chi può vederla;
  - attività aperte.
- **Infortuni e quasi-infortuni**:
  - di ognuno si registrano data, ora, luogo, operazione in corso, dinamica, giorni di prognosi, denuncia INAIL (numero e data) e misure adottate;
  - i quasi-infortuni si registrano anche senza una persona coinvolta.

**Controllo di assegnabilità.** Dice se una persona può lavorare a una data su un'operazione o in una mansione.
- **Blocchi:**
  - permesso di soggiorno o contratto scaduti;
  - giudizio di non idoneità;
  - abilitazione richiesta dall'operazione mancante o scaduta, senza deroga valida.
- **Avvisi:**
  - limitazioni incompatibili;
  - deroga in uso;
  - non idoneità temporanea terminata senza una nuova visita.

Lo usano le presenze e l'inserimento a squadra (blocco 2D). Il controllo si può chiedere anche dalle API (`/hr/employees/:id/assignment-check`). Ne hanno diritto:
- HR con il livello *personale*;
- il responsabile;
- il caposquadra, per la sua squadra;
- il dipendente stesso.

**Configurazione → Sicurezza.** Qui si impostano:
- i **tipi di corso** con periodicità e ore modificabili. Sono già caricati 16 corsi:
  - formazione generale e specifica per rischio;
  - preposto, dirigente, RLS;
  - primo soccorso, antincendio;
  - trattori, carrello, spazi confinati (DPR 177/2011), fitosanitari;
  - HACCP, PLE, lavori in quota;
- **per ogni mansione**: la formazione obbligatoria e se è soggetta a sorveglianza sanitaria;
- le **operazioni che richiedono un'abilitazione**, cioè gli oggetti di costo di tipo «operazione»;
- i **DPI**, 12 di partenza, con la periodicità di sostituzione;
- i **responsabili della sicurezza**, gli unici che concedono deroghe, e il **medico competente**.

**Scadenzario.** Si aggiungono queste voci:
- formazione e abilitazioni in scadenza;
- formazione **mancante** per la mansione;
- visita medica in scadenza, oppure mancante se la mansione è soggetta a sorveglianza;
- DPI da sostituire;
- attività aperte.

### Migrazioni

| Versione | Cosa |
|---|---|
| `0010_safety` | Tabelle:<br>• `training_types` (+ 16)<br>• `job_role_trainings` (requisiti di partenza per le 11 mansioni)<br>• `operation_trainings`<br>• `trainings`<br>• `medical_visits`<br>• `medical_restrictions`<br>• `ppe_types` (+ 12)<br>• `ppe_deliveries`<br>• `incidents`<br>• `safety_waivers`<br>• `hr_tasks`<br>Colonna nuova: `job_roles.medical_surveillance` |

Ha il `down`.

### Eventi di dominio

| Evento | Emittente | Consumer | Effetto |
|---|---|---|---|
| `employee.role_changed` (del blocco 2A) | Nuova versione del contratto con mansione diversa | `hr-safety.role-changed` | Se la mansione è soggetta a sorveglianza, crea l'attività «Visita medica per cambio mansione», una sola per evento. Notifica HR e responsabile con l'elenco della formazione da fare. La formazione mancante entra da sola nello scadenzario. |
| `incident.recorded` | Registrazione di un infortunio o quasi-infortunio | *nessuno per ora* (2C: crea l'assenza «Infortunio» collegata) | payload: evento, tipo, dipendente, data, giorni di prognosi, numero INAIL |
| `incident.updated` | Modifica dell'evento (prognosi, INAIL) | *nessuno per ora* (2C: aggiorna l'assenza collegata) | come sopra |

### Logica di business (QUANDO/ALLORA) e test

Tutti i test di questa sezione sono nel file `hr-safety`.

| Regola | Test |
|---|---|
| QUANDO si registra un corso senza scadenza ALLORA si calcola dalla periodicità del tipo, che si configura. Un corso nel futuro è rifiutato | formazione |
| QUANDO chi non ha il livello *personale* registra un corso ALLORA 403 | formazione |
| QUANDO la mansione richiede un corso ALLORA per ogni dipendente risulta valido, in scadenza, scaduto o mancante. Il mancante entra nello scadenzario come «mancante» | requisiti per mansione |
| QUANDO un corso non più richiesto è scaduto ALLORA esce dallo scadenzario | requisiti per mansione |
| QUANDO la mansione è soggetta a sorveglianza e non c'è visita ALLORA la visita mancante è nello scadenzario | requisiti per mansione |
| QUANDO si assegna una persona a un'operazione che richiede un'abilitazione e lei non ce l'ha o l'ha scaduta ALLORA blocco con messaggio chiaro | operazione con abilitazione |
| QUANDO il responsabile sicurezza registra una deroga motivata e la mansione la consente ALLORA l'assegnazione passa con un avviso | operazione con abilitazione |
| QUANDO la deroga la registra chi non è responsabile sicurezza, oppure la mansione non la consente, oppure manca il motivo ALLORA rifiuto | operazione con abilitazione |
| QUANDO la deroga è revocata ALLORA di nuovo blocco | operazione con abilitazione |
| QUANDO un dipendente ha un giudizio con limitazioni ALLORA l'assegnazione a mansioni od operazioni incompatibili mostra un avviso (le altre no) | idoneità |
| QUANDO il giudizio è «non idoneo», anche temporaneo, ALLORA l'assegnazione è bloccata | idoneità |
| QUANDO finisce l'inidoneità temporanea ALLORA non blocca più e avvisa che manca la nuova visita | idoneità |
| QUANDO si usa il giudizio per rispondere a un controllo ALLORA l'accesso è registrato | idoneità |
| QUANDO si registra un giudizio ALLORA il registro attività non lo contiene | idoneità |
| QUANDO un utente accede a dati di livello *sanitario* ALLORA l'accesso è registrato nel log. Vale per il responsabile e per il dipendente stesso | chi vede l'idoneità |
| QUANDO HR senza livello *sanitario* o un collega apre la sicurezza ALLORA niente giudizio, o 403 | chi vede l'idoneità |
| QUANDO il responsabile guarda scadenze e conformità ALLORA vede sé e i suoi collaboratori, non gli altri | chi vede l'idoneità |
| QUANDO la visita medica è scaduta ALLORA il dipendente compare in anomalia nello scadenzario e il responsabile riceve notifica | visita scaduta |
| QUANDO cambia la mansione ALLORA si ricalcolano i requisiti e si propone la visita per cambio mansione | cambio mansione |
| QUANDO si registra la visita per cambio mansione ALLORA l'attività si chiude | cambio mansione |
| QUANDO si consegna un DPI ALLORA la sostituzione si calcola dalla sua periodicità e la taglia viene dalla scheda | DPI |
| QUANDO un DPI è restituito ALLORA esce dallo scadenzario | DPI |
| QUANDO si registra un infortunio ALLORA serve il dipendente e parte l'evento `incident.recorded`. L'assenza collegata arriva col blocco 2C | infortuni |
| QUANDO c'è un numero INAIL ALLORA serve la data della denuncia | infortuni |
| QUANDO si registra un quasi-infortunio ALLORA la persona è facoltativa | infortuni |
| Calendario: aggiungere mesi si ferma all'ultimo giorno del mese | addMonths |

Esito: **76 test, 76 superati** (11 nuovi del blocco 2B).

### Punti toccati nei moduli esistenti

- **Eliminazione di un dipendente:**
  - i moduli ora dicono se ha dati da conservare (fascicolo, sicurezza);
  - in quel caso si disattiva invece di eliminarlo.

  Prima un'eliminazione cancellava a cascata il fascicolo e lasciava i file cifrati orfani sul disco.
- **Scadenzario del blocco 2A.** Chi non ha il livello *personale* vede solo le proprie scadenze e quelle dei collaboratori. Prima le vedeva chiunque avesse il workspace People.
- **Mansioni** (Configurazione): nella finestra ci sono formazione obbligatoria e sorveglianza sanitaria.
- **Finance → Oggetti di costo**: nessun cambiamento. Le operazioni esistenti diventano selezionabili come «operazioni che richiedono un'abilitazione».

### Decisioni prese in autonomia

- **Periodicità di partenza.** Seguono gli accordi Stato-Regioni e i decreti più diffusi, ma sono dati modificabili: vanno verificate con l'RSPP.
- **Requisiti di partenza per mansione.** Per esempio: cantiniere = generale, specifica rischio alto, spazi confinati, HACCP, carrello. Anche la sorveglianza sanitaria di partenza (6 mansioni operative) va confermata dal documento di valutazione dei rischi.
- **«Assegnazione a mansioni incompatibili».** Il blocco e l'avviso valgono per l'assegnazione al lavoro (ore, squadre, operazioni), non per il cambio di mansione nel contratto: spostare una persona non idonea su un'altra mansione dev'essere possibile.
- **Idoneità fuori dai blocchi generali.** La non idoneità non compare tra i «problemi bloccanti» della scheda, che vede anche HR senza livello *sanitario*. Blocca attraverso il controllo di assegnabilità, che registra ogni volta l'accesso.
- **Il caposquadra** può chiedere se le persone della sua squadra sono assegnabili: riceve blocchi e avvisi con il minimo necessario, non la scheda sanitaria.
- **Il responsabile vede anche le scadenze** di documenti e contratto dei collaboratori, oltre a quelle di sicurezza, perché la regola sulle notifiche lo prevede per permessi di soggiorno e contratti a termine.
- **Visita per cambio mansione solo se la nuova mansione è soggetta a sorveglianza.** Altrimenti non si crea l'attività.
- **Deroghe:** durata massima 12 mesi, motivo obbligatorio, revocabili.
- **Infortuni e documentazione:** livello *personale*. La documentazione sanitaria dell'infortunio va nei documenti di tipo «Documentazione infortunio», livello *sanitario*.

---

## 2C — Assenze

### Cosa c'è

**People → Assenze.** Tre viste:
- **Da decidere**: le richieste da approvare e le comunicazioni da prendere in visione. Ognuno vede solo quelle che tocca a lui decidere.
- **Elenco**: le assenze del mese, filtrabili per tipo e stato.
- **Contatori**: per ogni persona il residuo di ferie, ROL ed ex festività, con goduto, pianificato e ferie arretrate.

**Nuova assenza.** Si prende a giorno intero, a mezza giornata (mattina o pomeriggio) oppure a ore. Prima di inviare si vede un'anteprima con:
- i giorni lavorativi coperti e il consumo;
- chi deciderà;
- gli avvisi (residuo insufficiente, periodo di blocco).

**I giorni lavorativi** vengono dall'orario contrattuale e dalle festività della sede del dipendente. Senza orario si usa lun-ven, 8 ore.

**I flussi:**
- *con approvazione* (ferie, ROL, permessi…): bozza → richiesta → approvata o rifiutata, con motivo obbligatorio → (annullata);
- *con comunicazione* (malattia, infortunio, maternità, lutto…): comunicata → presa visione. È valida subito. Per la malattia il protocollo del certificato è obbligatorio.

**Chi decide:**
- il responsabile del dipendente;
- se a chiedere è il responsabile stesso (per sé o per un collaboratore), si sale di un livello;
- dopo N giorni di attesa (predefinito 3) la richiesta passa al delegato. Senza delegato passa all'ufficio del personale;
- l'ufficio del personale (livello *personale*) può sempre decidere;
- nessuno approva la propria assenza.

**I contatori** non sono memorizzati: si calcolano ogni volta dalle assenze.
- **Maturato**: la spettanza annua, mensile (la quota matura a fine mese) o tutta a inizio anno.
- **Riporto**: il residuo dell'anno prima. La prima volta si indica un saldo iniziale.
- **Goduto** e **pianificato**: le assenze valide, già iniziate oppure future.
- **In attesa**: le richieste ancora da decidere.
- **Residuo** = riporto + maturato − goduto.

Le richieste oltre il residuo sono rifiutate oppure ammesse con avviso: si sceglie in Configurazione.

**Ferie arretrate:**
- si consumano dalle più vecchie;
- quelle di un anno vanno godute entro il 30/06 del secondo anno successivo;
- entrano nello scadenzario.

**Periodi di blocco** (es. vendemmia). Valgono per tutti, per una sede o per una squadra, e hanno due modalità:
- *avviso*: la richiesta passa e il responsabile vede il periodo nella notifica;
- *divieto*: la richiesta è rifiutata.

Malattia e comunicazioni non sono toccate.

**Sezione Assenze della scheda**: contatori dell'anno con le spettanze modificabili (livello *personale*), ferie arretrate e storico.

**Enoturismo.** L'operatore è collegato al dipendente tramite l'utente del portale.
- **Assegnare** a una prenotazione un operatore con un'assenza valida in quell'orario è rifiutato. Il messaggio dice che è assente, non il motivo.
- **Nel menu** della prenotazione l'operatore compare come «(assente)» e non si può scegliere.
- **Se la prenotazione è in una lingua che l'operatore non parla**, l'assegnazione passa con un avviso. Le lingue vengono dalle competenze del fascicolo.
- **Prenotazioni già assegnate** a chi diventa assente: l'Enoturismo riceve una notifica e la prenotazione mostra il conflitto.
- **Prenotazione manuale**: se l'operatore non si può assegnare, la prenotazione resta creata e un messaggio lo dice. Prima si rischiava di crearla due volte.

**Visita di rientro.** Quando finisce un'assenza per motivi di salute di oltre 60 giorni continuativi (certificati consecutivi = un unico periodo), si crea l'attività «Visita medica di rientro». Vale per le mansioni soggette a sorveglianza sanitaria.

**Infortunio → assenza.** Quando si registra un infortunio con prognosi, si crea l'assenza «Infortunio» collegata:
- parte dal giorno dopo e dura quanto la prognosi;
- porta il numero INAIL;
- se cambia la prognosi, cambiano le date.

### Migrazioni

| Versione | Cosa |
|---|---|
| `0011_absences` | Tabelle:<br>• `absence_types` (+ 13 tipi)<br>• `absence_block_periods`<br>• `absences` (con il collegamento all'infortunio, univoco)<br>• `absence_allowances`<br>Colonna nuova: `hr_tasks.dedupe_key` (univoca) |

Ha il `down`.

### Eventi di dominio

| Evento | Emittente | Consumer | Effetto |
|---|---|---|---|
| `absence.approved` | Approvazione di una richiesta | `enoturismo.absence-conflicts` | Notifica all'Enoturismo le prenotazioni già assegnate alla persona in quell'orario |
| `absence.communicated` | Comunicazione (malattia, infortunio…) | `enoturismo.absence-conflicts-communicated` | come sopra |
| `absence.cancelled` | Annullamento di un'assenza valida | *nessuno per ora* (2D) | payload: assenza, dipendente, date, tipo |
| `incident.recorded` (del blocco 2B) | Registro infortuni | `hr-absences.incident-absence` | Crea l'assenza «Infortunio» collegata, con il numero INAIL |
| `incident.updated` (del blocco 2B) | Registro infortuni | `hr-absences.incident-absence-update` | Aggiorna date e numero INAIL dell'assenza collegata |

**Ganci nella stessa transazione.** Quando un'assenza diventa valida (approvata o comunicata) o viene annullata, il modulo chiama i ganci registrati dentro la transazione. Le presenze (2D) li useranno per generare e togliere le righe. Se un gancio rifiuta (es. mese chiuso), l'operazione non avviene.

### Logica di business (QUANDO/ALLORA) e test

Tutti i test di questa sezione sono nel file `hr-absences`.

| Regola | Test |
|---|---|
| QUANDO si calcola un'assenza ALLORA contano i giorni con orario > 0 che non sono festività della sede. Mezza giornata = ½ giorno; le ore in minuti | giorni lavorativi |
| QUANDO si chiede un'assenza ALLORA la decide il responsabile, avvisato con una notifica | richiesta → approvazione |
| QUANDO è approvata ALLORA il contatore passa da «in attesa» a «pianificato» e il dipendente è avvisato | richiesta → approvazione |
| QUANDO il dipendente prova ad approvare la propria assenza, o un collega prova a decidere ALLORA 403. Il rifiuto vuole un motivo | richiesta → approvazione |
| QUANDO il richiedente è il responsabile ALLORA l'approvazione sale di un livello. Vale anche se inserisce per un collaboratore | sale di un livello |
| QUANDO si chiede per una persona che non è sé stessi né un collaboratore ALLORA 403 | sale di un livello |
| QUANDO passano i mesi ALLORA le ferie maturano. Il riporto è il residuo dell'anno prima | contatori |
| QUANDO una richiesta supera il residuo ALLORA è rifiutata, oppure ammessa con avviso se configurato | contatori |
| QUANDO restano ferie di anni passati ALLORA si consumano dalla più vecchia e scadono il 30/06 del secondo anno successivo | ferie arretrate |
| QUANDO una richiesta cade in un periodo di blocco ALLORA avviso al responsabile, oppure divieto se il periodo lo prevede. La malattia non è toccata | periodo di blocco |
| QUANDO è comunicata una malattia con protocollo ALLORA è subito valida (i ganci delle presenze partono) e il responsabile riceve notifica | malattia |
| QUANDO manca il protocollo ALLORA rifiuto | malattia |
| QUANDO una richiesta attende oltre N giorni ALLORA passa al delegato. Il job è idempotente e il delegato può decidere solo dopo il passaggio | delegato |
| QUANDO un'assenza approvata è annullata ALLORA il contatore torna com'era e parte l'evento | annullamento |
| QUANDO un gancio rifiuta (es. mese chiuso) ALLORA niente cambia | annullamento |
| QUANDO l'assenza non è ancora iniziata ALLORA la annulla anche il dipendente | annullamento |
| QUANDO due assenze si sovrappongono ALLORA rifiuto. Mattina e pomeriggio dello stesso giorno sono ammessi | sovrapposte |
| QUANDO termina un'assenza per salute di oltre 60 giorni continuativi ALLORA si crea l'attività «visita medica di rientro», una volta sola | 60 giorni |
| QUANDO si registra un infortunio ALLORA si crea l'assenza Infortunio collegata e il numero INAIL resta associato | infortunio |
| QUANDO cambia la prognosi ALLORA cambiano le date dell'assenza | infortunio |
| QUANDO un operatore ha un'assenza approvata e una prenotazione assegnata nello stesso orario ALLORA si segnala il conflitto in Enoturismo | Enoturismo |
| QUANDO si prova ad assegnare un operatore assente ALLORA rifiuto | Enoturismo |
| QUANDO si assegna un operatore a una prenotazione in una lingua che non parla ALLORA avviso in Enoturismo | Enoturismo |
| QUANDO un dipendente ha assenze registrate ALLORA non si elimina | non si elimina |

Esito: **90 test, 90 superati** (14 nuovi del blocco 2C).

### Punti toccati nei moduli esistenti

- **Enoturismo, API:**
  - `PATCH /api/admin/bookings/:id` rifiuta un operatore assente (409) e restituisce gli avvisi sulla lingua;
  - `GET /api/admin/bookings` aggiunge `operator_conflict` e `operator_warning`;
  - nuova `GET /api/admin/operators/availability`.
- **Enoturismo, admin:** la finestra della prenotazione mostra disponibilità e conflitti, e gli errori di assegnazione ora compaiono (prima fallivano in silenzio). Anche la prenotazione manuale gestisce il rifiuto dell'operatore.
- **Permessi.** Le API delle assenze sono aperte a chi ha fatto l'accesso: ognuno chiede le proprie e il responsabile decide anche senza il workspace People. Chi vede e chi decide lo controlla il modulo.
- **Campanella:** i link delle notifiche aprono anche la sottosezione (es. Assenze) e le pagine fuori dal portale (admin dell'Enoturismo).

### Decisioni prese in autonomia

- **Un'assenza conta nell'anno in cui inizia.** Una ferie a cavallo di capodanno consuma il contatore dell'anno di partenza.
- **Il saldo iniziale vale solo per il primo anno.** Negli anni successivi il riporto si calcola sempre dall'anno prima.
- **Mezza giornata:** mattina fino alle 13:00, pomeriggio dalle 13:00. Serve per il confronto con gli orari delle visite.
- **Lingua:** l'avviso scatta solo se il fascicolo ha almeno una lingua. Conviene registrare anche la lingua madre (es. «it»).
- **Visita di rientro solo per le mansioni con sorveglianza sanitaria**, come la visita per cambio mansione.
- **L'infortunio parte dal giorno dopo l'evento.** Il giorno dell'infortunio si considera lavorato.
- **Approvazione e comunicazione aggiornano subito il contatore**, perché è calcolato. Non c'è un saldo da tenere allineato.

---

## 2D — Presenze

### Cosa c'è

**People → Presenze.** Il riepilogo del mese mostra, per ogni persona visibile:
- stato del mese;
- ore lavorate, assenze e orario;
- giorni scoperti;
- conflitti;
- proposte in attesa.

Chi vede solo sé stesso va direttamente al proprio foglio.

**Foglio presenze del mese**, giorno per giorno. Ogni giorno mostra:
- l'orario contrattuale (festività della sede escluse);
- le ore registrate con centro, oggetto di costo, tipo d'ora e origine;
- le assenze;
- la differenza con l'orario.

Inoltre il foglio ha:
- i totali per tipo d'ora, per assenza e per centro, e le giornate lavorate;
- i conflitti da risolvere;
- le proposte da confermare;
- lo storico delle rettifiche.

**Righe di ore.**
- **Tempo:** un blocco inizio-fine nello stesso giorno, a passi configurabili di 15, 30 o 60 minuti (predefinito 60). Tipo d'ora: ordinaria, straordinaria, notturna o festiva.
- **Imputazione:** su un centro di costo foglia e attivo (per il vigneto, la particella) e facoltativamente su un oggetto di costo (operazione, lotto…). Si può anche ripartire lo stesso blocco su più centri.
- **Sovrapposizioni:** niente sovrapposizioni con altre ore. Se il giorno è coperto da un'assenza, le ore sono rifiutate.
- **Avviso:** oltre l'orario con ore ordinarie.

**Controlli bloccanti su ogni riga.** Riusano il controllo di assegnabilità del blocco 2B. Bloccano:
- permesso di soggiorno o contratto scaduti;
- non idoneità;
- abilitazione richiesta dall'operazione mancante o scaduta. Con una deroga la riga passa con un avviso.

Le limitazioni incompatibili passano con un avviso, e il responsabile riceve una notifica.

**Ore di squadra.**
- Il caposquadra registra ore, particella e operazione per chi c'era, in una sola azione.
- È tutto o niente: se qualcuno è bloccato non si registra nulla, e il messaggio dice chi e perché.

**Righe proposte, mai inserite da sole.**
- **Dalle prenotazioni confermate** assegnate all'operatore collegato alla persona:
  - centro «Enoturismo — visite» (o «eventi» per gli eventi);
  - oggetto = l'esperienza, se esiste l'oggetto di costo.
- **Dalle fiere di cui la persona è responsabile**, una proposta per ogni giorno:
  - centro «Fiere»;
  - oggetto = la fiera.

Si confermano o si scartano, una volta per giorno. Le operazioni di Produzione arriveranno quando quel modulo le registrerà per persona.

**Stati del mese** (per dipendente): aperto → inviato → approvato.
- **Invio:** il dipendente o il responsabile invia al responsabile (un livello più su se invia il responsabile stesso).
- **Decisione:** chi approva può rimandare indietro con una nota, oppure approvare. Non si approva il proprio mese, e servono i conflitti risolti.
- **Dopo l'approvazione** il mese è chiuso: le correzioni si fanno con una **rettifica**, che:
  - ha un motivo obbligatorio;
  - annulla righe (restano visibili, barrate) e ne aggiunge con origine «rettifica»;
  - può annullare un'assenza del mese chiuso.

**Assenze → presenze, nella stessa transazione.**
- Quando un'assenza diventa valida (approvata, o comunicata come la malattia), si generano le righe dei giorni lavorativi.
- Se in quei giorni c'erano già ore, le ore restano e si crea un **conflitto**, con notifica al responsabile.
- Se l'assenza è annullata, le righe si tolgono.
- Se il mese è approvato, approvazione e annullamento sono bloccati e serve una rettifica.

**Finance.** Quando un mese è approvato o rettificato, le ore approvate per centro diventano i valori del driver «Ore lavorate» di quel mese. Se la cascata del mese è già confermata, i valori non cambiano e Finance riceve un avviso.

**Export per il consulente del lavoro.** CSV con separatore «;» e virgola decimale, da aprire in Excel, con una riga per persona e giorno:
- colonne configurabili: codice fiscale, nome, tipo di contratto, giornata lavorata (per le giornate degli OTD), ore per tipo, assenza e ore di assenza, centri;
- solo i mesi approvati;
- serve il livello *personale*, perché contiene il codice fiscale.

**Scheda del dipendente → Presenze.** Riepilogo degli ultimi tre mesi: stato, ore ordinarie e straordinarie, assenze, giornate.

**Configurazione → Presenze.** Passo degli orari, centri per le proposte (visite, eventi, fiere) e colonne dell'export.

### Migrazioni

| Versione | Cosa |
|---|---|
| `0012_timesheet` | Tabelle:<br>• `timesheet_months`<br>• `timesheet_adjustments`<br>• `timesheet_entries` (con origine, collegamento all'assenza, squadra, prenotazione o fiera di provenienza, rettifica)<br>• `timesheet_allocations`<br>• `timesheet_conflicts`<br>• `timesheet_proposal_decisions` |

Ha il `down`.

### Eventi di dominio

| Evento | Emittente | Consumer | Effetto |
|---|---|---|---|
| `timesheet.month_approved` | Approvazione del mese | `finance.ore-lavorate` | Ricalcola i valori del driver «Ore lavorate» del mese dalle ore approvate per centro. Se la cascata è confermata, non scrive e avvisa Finance |
| `timesheet.adjusted` | Rettifica | `finance.ore-lavorate-adjusted` | come sopra |
| `absence.cancelled` | Rettifica che annulla un'assenza | *nessuno per ora* | payload: assenza, dipendente, date, rettifica |

Ganci del blocco 2C: i consumer delle presenze generano e tolgono le righe di assenza **dentro** la transazione di approvazione, comunicazione o annullamento.

### Logica di business (QUANDO/ALLORA) e test

Tutti i test di questa sezione sono nel file `hr-timesheet`.

| Regola | Test |
|---|---|
| QUANDO si registrano ore ALLORA orari a passi della granularità, niente turni oltre la mezzanotte, niente sovrapposizioni. La ripartizione deve fare la durata del blocco | righe |
| QUANDO si imputano ore a un centro non foglia o disattivo ALLORA rifiuto | righe |
| QUANDO un'assenza è approvata ALLORA si generano le righe dei giorni lavorativi (orario e festività della sede), si aggiorna il contatore e si notifica, in un'unica transazione | assenza approvata |
| QUANDO le righe generate si sovrappongono a ore esistenti ALLORA l'approvazione procede, le righe manuali restano e si crea una segnalazione di conflitto | assenza approvata |
| QUANDO si registrano ore su un giorno di assenza ALLORA rifiuto | assenza approvata |
| QUANDO la generazione delle righe fallisce (mese chiuso) ALLORA l'approvazione non avviene | se l'inserimento fallisce |
| QUANDO un'assenza approvata è annullata ALLORA si rimuovono le righe generate e si ripristina il contatore | assenza approvata |
| QUANDO il mese è chiuso ALLORA l'annullamento è bloccato e si fa con una rettifica | mese chiuso |
| QUANDO è comunicata una malattia con protocollo ALLORA entra subito nelle presenze | malattia |
| QUANDO il mese è approvato ALLORA si chiude ed emette `timesheet.month_approved`. Il driver «Ore lavorate» di Finance riceve le ore per centro | mese |
| QUANDO il mese è chiuso ALLORA le righe si correggono solo con una rettifica tracciata, che aggiorna Finance | mese |
| QUANDO la cascata del mese è confermata ALLORA Finance non cambia e riceve un avviso | mese |
| QUANDO ci sono conflitti tra ore e assenze ALLORA il mese non si approva finché non sono risolti | conflitti |
| QUANDO si imputano ore a un'operazione che richiede un'abilitazione e il dipendente non ce l'ha ALLORA blocco con messaggio chiaro. Con la deroga del responsabile sicurezza passa con avviso | controlli bloccanti |
| QUANDO un permesso di soggiorno è scaduto ALLORA segnalazione bloccante sull'inserimento ore | controlli bloccanti |
| QUANDO il giudizio è «non idoneo» ALLORA le ore sono bloccate | controlli bloccanti |
| QUANDO ci sono limitazioni incompatibili ALLORA avviso e notifica al responsabile | controlli bloccanti |
| QUANDO si assegna una squadra a un'operazione che richiede un'abilitazione e qualcuno non ce l'ha ALLORA blocco con l'elenco di chi, e nessuna ora registrata | squadra |
| QUANDO la squadra non è la sua ALLORA 403 | squadra |
| QUANDO una prenotazione confermata è assegnata all'operatore, o la persona è responsabile di una fiera, ALLORA si propone una riga. Mai inserita da sola: si conferma o si scarta | proposte |
| QUANDO si cerca il responsabile di una fiera ALLORA l'abbinamento per nome è unico, senza badare a ordine, maiuscole e accenti. Con gli omonimi nessun abbinamento | proposte |
| QUANDO si esporta ALLORA solo i mesi approvati, giornate lavorate, virgola decimale. Serve il livello *personale*; il download passa da link firmato | export |
| QUANDO un dipendente ha presenze ALLORA non si elimina | non si elimina |
| QUANDO si elimina un centro con ore imputate ALLORA rifiuto: il centro è in uso | non si elimina |

Esito: **102 test, 102 superati** (12 nuovi del blocco 2D).

### Punti toccati nei moduli esistenti

- **Finance:**
  - un centro con ore imputate risulta «usato», quindi non si elimina e non diventa un aggregato;
  - nuova funzione per scrivere i valori calcolati di un driver, che rispetta il blocco della cascata confermata.
- **Enoturismo e Commerciale:** nessun cambiamento. Prenotazioni e fiere sono solo lette per le proposte.
- **Permessi:** le API delle presenze sono aperte a chi ha fatto l'accesso. Ognuno registra le proprie ore, il caposquadra quelle della squadra, e i controlli li fa il modulo.

### Decisioni prese in autonomia

- **Responsabile delle fiere per nome.** Nelle fiere il responsabile è un testo libero, e la regola vieta nuovi collegamenti per stringa. La lettura è quindi isolata in una funzione testata, che abbina solo un nome unico. In futuro conviene un collegamento vero al dipendente nel modulo Fiere.
- **Durata delle proposte.** Visite e eventi durano quanto l'esperienza, arrotondata al passo. Le fiere durano l'orario del giorno, 8 ore se non c'è orario, dalle 9.
- **Tutto o niente per le squadre.** Registrare le ore solo per una parte della squadra, in silenzio, sarebbe peggio di un rifiuto chiaro.
- **Righe di assenza senza centro di costo.** Il driver «Ore lavorate» conta solo le ore lavorate.
- **Le assenze approvate prima di questo blocco non hanno righe.** In produzione non ce n'erano: i blocchi 2C e 2D sono stati pubblicati insieme.
- **Un mese «inviato»** lo corregge solo chi lo approva. Un mese «approvato» non si riapre: solo rettifiche.

---

## 2E — Self-service e servizi

### Cosa c'è

**«Il mio spazio»** (voce in basso nel menu, per ogni utente collegato a una scheda dipendente, anche senza il workspace People):
- **I miei dati:**
  - il proprio fascicolo in lettura (niente dati disciplinari);
  - la **richiesta di modifica** di IBAN, residenza, domicilio, contatti personali, taglie e contatti di emergenza. È controllata subito (per esempio un IBAN sbagliato è rifiutato) e si applica solo dopo l'approvazione di HR. Una richiesta alla volta, ritirabile.
- **Documenti:** cedolini, CU, attestati e gli altri tipi visibili al dipendente, da scaricare con un link firmato.
- **Ferie e permessi:** saldi, ferie arretrate, le proprie richieste, nuova richiesta.
- **Presenze:** il proprio foglio del mese, con l'invio al responsabile.
- **Dotazioni:** ciò che ha in consegna.

**People → Richieste.** HR vede ogni richiesta con il valore di prima e quello proposto, e la approva o la rifiuta con un motivo. Il dipendente riceve una notifica. Nel registro attività finiscono i nomi dei campi, non i valori.

**Scheda del dipendente → Ingresso e uscita:**
- **Onboarding e offboarding.** Si avviano da checklist configurabili per tipo di contratto (vince quella specifica, altrimenti quella generale). Ogni voce ha una **verifica automatica** dai dati:
  - dati personali completi, documento caricato, formazione valida;
  - visita medica (o «non necessaria» se la mansione non la prevede);
  - DPI e dotazioni consegnati, accesso al portale;
  - dotazioni restituite, cessazione registrata, presenze del mese di uscita approvate.

  La spunta resta manuale. La checklist si conclude solo con tutte le voci obbligatorie fatte.
- **Offboarding concluso.** Il dipendente diventa non attivo e, con l'evento `employee.offboarded`:
  - l'accesso al portale è disattivato e le sessioni revocate;
  - l'operatore dell'Enoturismo è disattivato, non cancellato.
- **Dotazioni:** chiavi, badge, telefono, PC, tablet, auto, abbigliamento, con consegna e restituzione.

**People → Dipendenti → Carica cedolini.**
- Caricamento in blocco di cedolini o CU.
- Ogni file si abbina al dipendente con il codice fiscale nel **nome del file** o nel **testo del PDF**, leggendo anche i flussi compressi. Si accettano anche i codici omocodici.
- Si abbina solo quando non c'è ambiguità (corretto il 25/09, prima della pubblicazione):
  - se il codice è nel nome del file, deve essere di un dipendente e comparire anche nel documento, quando il testo si legge;
  - il documento non deve contenere i codici di altri dipendenti;
  - senza codice nel nome, il documento deve contenere un solo codice fiscale di persona. Il codice dell'azienda (per una ditta individuale, quello del titolare) non conta.
  - Una CU con familiari a carico, un PDF con più cedolini o un collega senza codice registrato restano quindi **da abbinare**: si caricano dalla scheda del dipendente.
- I file non abbinati o già caricati restano fuori, con il motivo.
- I dipendenti ricevono una notifica.

**People → Dipendenti → Stagionali.** Per chi ha avuto contratti stagionali o a termine: le campagne lavorate (dal-al, mansione) e se è da richiamare.

**Recruiting (solo modello dati, senza schermate).**
- **Candidati:** posizione, stato della selezione, consenso privacy e data di cancellazione (predefinita a 12 mesi dal consenso). Il CV è cifrato come gli altri documenti.
- **Conversione in dipendente:** nome, contatti, codice fiscale e CV passano al fascicolo, senza reinserirli.
- **Cancellazione automatica:** un job quotidiano cancella i candidati non assunti oltre la data, file del CV compreso.

### Migrazioni

| Versione | Cosa |
|---|---|
| `0013_people_services` | Tabelle:<br>• `employee_assets`<br>• `personal_change_requests`<br>• `checklist_templates` e `checklist_template_items` (+ una checklist di ingresso da 9 voci e una di uscita da 5)<br>• `employee_checklists` e `employee_checklist_items` (un solo percorso aperto per tipo)<br>• `job_positions`<br>• `candidates`<br>• `candidate_documents` |

Ha il `down`.

### Eventi di dominio

| Evento | Emittente | Consumer | Effetto |
|---|---|---|---|
| `employee.offboarded` | Conclusione dell'offboarding | `portal.deactivate-access` (server) | Disattiva l'utente del portale, revoca le sessioni, disattiva l'operatore dell'Enoturismo e lo registra nel registro attività |

### Logica di business (QUANDO/ALLORA) e test

Tutti i test di questa sezione sono nel file `hr-services`.

| Regola | Test |
|---|---|
| QUANDO il dipendente chiede una modifica dei dati ALLORA è controllata subito e si applica solo dopo l'approvazione di HR | self-service |
| QUANDO c'è già una richiesta aperta ALLORA non se ne apre un'altra | self-service |
| QUANDO il dipendente prova ad approvare la propria richiesta ALLORA rifiuto | self-service |
| QUANDO HR decide una richiesta ALLORA vede prima e dopo e il dipendente è avvisato | self-service |
| QUANDO si registra una richiesta di modifica ALLORA il registro attività contiene i campi ma non i valori | self-service |
| QUANDO il dipendente senza il workspace People apre il suo spazio ALLORA vede i propri dati | self-service |
| QUANDO il dipendente chiede il fascicolo di altri (o il proprio fuori dal self-service) ALLORA rifiuto | self-service |
| QUANDO il dipendente scarica un documento visibile a lui ALLORA lo ottiene anche senza il workspace People | scarica i propri cedolini |
| QUANDO un collega prova a scaricarlo ALLORA 403 | scarica i propri cedolini |
| QUANDO si registra la restituzione di una dotazione prima della consegna ALLORA rifiuto | dotazioni |
| QUANDO il dipendente prova a registrare dotazioni ALLORA 403 | dotazioni |
| QUANDO si avvia un onboarding ALLORA vince la checklist del tipo di contratto e le verifiche seguono i dati | onboarding |
| QUANDO restano voci obbligatorie aperte ALLORA la checklist non si conclude | onboarding |
| QUANDO si conclude l'offboarding ALLORA l'accesso al portale è disattivato (sessioni revocate) e l'operatore corrispondente viene disattivato, non cancellato | offboarding |
| QUANDO si caricano cedolini in blocco ALLORA ognuno si abbina per codice fiscale nel nome o nel testo del PDF, solo se unico. I doppioni e i non abbinati restano fuori con il motivo | cedolini in blocco |
| QUANDO si caricano cedolini in blocco ALLORA i dipendenti sono avvisati e servono i livelli *personale* e *retributivo* | cedolini in blocco |
| QUANDO si guardano gli stagionali ALLORA si vedono le campagne lavorate e l'indicazione da richiamare | stagionali |
| QUANDO un candidato dà il consenso ALLORA ha una data di cancellazione | recruiting |
| QUANDO la data di cancellazione è passata e il candidato non è assunto ALLORA il job lo cancella, CV compreso | recruiting |
| QUANDO un candidato è convertito in dipendente ALLORA i dati e il CV passano al fascicolo | recruiting |
| QUANDO un dipendente ha dotazioni, checklist o richieste ALLORA non si elimina | non si elimina |

Esito: **111 test, 111 superati** (9 nuovi del blocco 2E).

Revisione prima della pubblicazione (25/09/2026): 3 test in più, 12 per il blocco 2E, in `hr-services`.

| Regola | Test |
|---|---|
| QUANDO un file di cedolini è ambiguo (familiari a carico, più cedolini, nome e contenuto discordi, codici di altri dipendenti) ALLORA non si abbina a nessuno; il codice dell'azienda non conta; i codici omocodici si accettano | abbinamenti ambigui |
| QUANDO un utente senza il workspace People chiede un documento HR ALLORA ottiene solo i propri documenti visibili al dipendente, anche se il suo ruolo ha i livelli di accesso | download senza People |
| QUANDO si approva una modifica dei contatti di emergenza ALLORA restano quelli di prima per il confronto | contatti di emergenza |

### Punti toccati nei moduli esistenti

- **Menu del portale:** nuova voce «Il mio spazio», per tutti.
- **Permessi:**
  - self-service aperto a chi ha fatto l'accesso;
  - il download dei documenti HR passa dai link firmati anche senza il workspace People. Il controllo di livello e di visibilità resta sul server;
  - senza il workspace People si scaricano solo i **propri** documenti visibili al dipendente, anche se il ruolo ha livelli di accesso (corretto il 25/09).
- **Utenti del portale:** l'offboarding li disattiva con la stessa logica di Impostazioni → Utenti (sessioni revocate, operatore disattivato).

### Decisioni prese in autonomia

- **Cosa si può chiedere di cambiare dal self-service:** IBAN, residenza, domicilio, contatti, taglie e contatti di emergenza. Codice fiscale e dati di nascita no: serve un documento.
- **Le verifiche automatiche delle checklist suggeriscono, non spuntano.** Chi segue la persona conferma.
- **Offboarding concluso = dipendente non attivo.** Il fascicolo resta per la conservazione.
- **Recruiting senza schermate**, come chiesto («solo modello dati ora»). Le API ci sono già.

---

## Riepilogo della Fase 2 e decisioni aperte

### Cosa serve ancora da voi

1. **Dominio `prenotazioni.marramiero.it`:** configurato su Railway il 15/09 ma mai verificato, oggi non risolve. Chi gestisce il DNS di marramiero.it deve aggiungere due record:
   - `CNAME prenotazioni → je8kvimb.up.railway.app`
   - `TXT _railway-verify.prenotazioni → railway-verify=70cb5c8a4116fbc83c1e4a512399293bd130f3d796800b6a04017197dc91603e`
2. **Copia della chiave `HR_FILES_KEY`:** è impostata su Railway. Copiatela da Railway (servizio → Variables) in un posto sicuro fuori da Railway, per esempio un gestore di password. Senza la chiave i documenti HR non si aprono.
3. **Da verificare con l'RSPP e il medico competente:**
   - periodicità dei corsi;
   - formazione obbligatoria per mansione;
   - mansioni soggette a sorveglianza sanitaria;
   - periodicità dei DPI.

   Sono tutti dati modificabili da People → Configurazione.
4. **Da decidere con il consulente del lavoro:**
   - colonne dell'export delle presenze;
   - spettanze di ferie, ROL ed ex festività per contratto;
   - saldo iniziale alla data di avvio.
5. **Ruoli:**
   - creare i ruoli con People (livello *personale* per l'ufficio del personale; *retributivo* per amministrazione e direzione; *sanitario* per il responsabile sicurezza);
   - indicare i responsabili sicurezza (Configurazione).

   Oggi vedono tutto solo la chiave master e gli utenti senza ruolo.
6. **Fiere:** il responsabile è un testo libero. Un collegamento vero al dipendente, nel modulo Fiere, renderebbe le proposte delle presenze più affidabili degli abbinamenti per nome.

### Rimandati

- **Valutazione e sviluppo, disciplinare** (2.0.9): rimandati come concordato. Le note del responsabile, escluse dal self-service, arriveranno con loro.
- **Operazioni di Produzione nelle proposte delle presenze:** quando il modulo Produzione registrerà le operazioni per persona.
- **Foto del dipendente** (2.0.1): non ancora gestita.
- **Schermate del recruiting.**
