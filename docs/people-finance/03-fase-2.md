# People e Finance — Fase 2: People

Stato: **in corso, in locale** (non ancora in produzione). La fase è divisa in blocchi:

| Blocco | Contenuto | Stato |
|---|---|---|
| 2A | Fascicolo: dati personali, rapporto di lavoro, retribuzione, competenze, documenti cifrati, scadenzario con notifiche | completato |
| 2B | Sicurezza (D.Lgs. 81/08): formazione, requisiti per mansione, idoneità sanitaria, DPI, infortuni, deroghe | completato |
| 2C | Assenze: richieste e approvazioni, contatori, periodi bloccati, disponibilità per l'Enoturismo | da fare |
| 2D | Presenze: ore per squadra, proposte da prenotazioni e fiere, stati del mese, rettifiche, export, controlli bloccanti | da fare |
| 2E | Self-service, onboarding e offboarding, dotazioni, richieste di modifica, cedolini in blocco, modello dati del recruiting | da fare |

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
