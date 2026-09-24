# People e Finance — Fase 2: People

Stato: **in corso, in locale** (non ancora in produzione). La fase è divisa in blocchi:

| Blocco | Contenuto | Stato |
|---|---|---|
| 2A | Fascicolo: dati personali, rapporto di lavoro, retribuzione, competenze, documenti cifrati, scadenzario con notifiche | completato |
| 2B | Sicurezza (D.Lgs. 81/08): formazione, requisiti per mansione, idoneità sanitaria, DPI, infortuni, deroghe | da fare |
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

Esito: **64 test, 64 superati** (9 nuovi del blocco 2A).

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
