# Changelog — Cantina Booking Marramiero

Recap di tutto quello che è stato costruito, in ordine cronologico. Aggiornalo (o chiedimi di aggiornarlo) man mano che si aggiungono funzionalità, così resta la fonte di verità su "cosa c'è e da quando".

## 2026-09-15 — Piattaforma base + ERP

**Sito pubblico e admin Enoturismo**
- Piattaforma di prenotazione visite/esperienze in cantina, branding reale Marramiero (font Bodoni Moda + Montserrat, colore #3f181e)
- Admin: prenotazioni, calendario (vista settimana/giorno + generazione disponibilità ricorrente), esperienze, codici sconto, recensioni, newsletter, operatori
- CRM B2C: visitatori enoturismo con tracciamento ordini e-commerce vs negozio fisico, alert email a soglia scorte (edge-triggered)

**ERP interno (portale)**
- Workspace Commerciale / Produzione / Magazzino con sidebar contestuale
- CRM B2B: agenti (con provincie di competenza e link personale), clienti (anagrafica italiana completa: P.IVA, PEC, SDI, IBAN, listino assegnato)
- Ordini, import da Excel, listini, prodotti (bottiglie)
- Deploy iniziale su Railway (progetto `cantina-marramiero`, servizio `cantina-booking`)

**Redesign UX/UI**
- Da tema scuro a tema chiaro con sidebar + topbar, ispirato a librerie moderne (Almacis/shadcn)
- Workspace switcher in stile Zoho CRM: icone SVG professionali al posto delle emoji, font Plus Jakarta Sans, palette invariata (blu `#3b6fe0`)
- Redesign calendario ispirato a un vero gestionale B2B: toolbar con ricerca, salta a data, esporta CSV, filtri stato; card evento con badge stato e nota

## 2026-09-16 — Portale agenti, ERP avanzato, mobile

**Portale agenti con login proprio**
- Da link con token a **username + password** per ogni agente (generati alla creazione, con saluto "Benvenuto/Benvenuta" in base al genere)
- Sidebar multi-tab: Dashboard (performance, andamento mensile, top clienti), Nuovo ordine, Storico ordini, News, Catalogo, Recupero crediti (scadenze pagamento non saldate), Venduto

**Contenuti condivisi Commerciale ↔ Portale agenti**
- News e Catalogo (PDF) gestiti da Commerciale, visibili automaticamente a tutti gli agenti
- File PDF salvati sul volume persistente Railway (sopravvivono ai redeploy)

**Sconti e crediti**
- Codice sconto standard + percentuale per cliente, applicato automaticamente agli ordini creati dall'agente
- Scadenza pagamento calcolata dalle condizioni di pagamento del cliente; tracciamento stato pagamento per ordine

**Magazzino: Kanban ordini**
- Vista Kanban con drag & drop tra Nuovo / In lavorazione / Sospeso / Evaso, sincronizzata 1:1 con la lista Ordini di Commerciale (stessa tabella)
- Nota del magazziniere per ordine, visibile a Commerciale e all'agente (indicatore rosso)

**Utenti del portale interno**
- Da chiave amministratore unica a utenti individuali (nome, email, username, password) gestiti da Impostazioni
- Recupero password via email con link di reset (valido 1 ora)

**Responsive mobile/tablet**
- Menu hamburger con drawer laterale su admin/portal/agent (prima la sidebar spariva senza alternativa)
- Toolbar, form e modali impilati su schermi stretti
- Tabelle: font/padding ridotti e colonne meno critiche nascoste sotto i 640px, per ridurre al minimo lo scroll orizzontale

## 2026-09-16 (2) — Esperienze avanzate + CRM come workspace madre

**Esperienze (Enoturismo)**
- Modello esperienza esteso: galleria immagini, descrizione, prodotti in degustazione (selezionati dal catalogo Commerciale), durata, lingue disponibili, facility services, "cosa include"
- Disponibilità ricorrente spostata dentro ogni esperienza (pattern settimanale → generazione automatica slot su 90 giorni), al posto del generatore bulk separato
- Fix bug: apostrofi nei nomi (es. "L'Eredità...") rompevano il rendering dell'intera griglia esperienze; fix editing esperienza che non si apriva più
- Fix calendario: etichetta "08:00" tagliata in alto

**CRM come workspace top-level**
- CRM promosso da sotto-sezione di Commerciale a workspace principale (sidebar propria), con tab figlie: Clienti, Agenti, Importatori, Fornitori
- Nuove anagrafiche Importatori e Fornitori, stesso modello dati completo di Clienti (contatti, indirizzi fatturazione/spedizione, dati business)
- Pagina anagrafica in stile Zoho CRM per ogni record: Informazioni di base, Overview (ordini/fatturato), Email (log manuale, nessuna sincronizzazione Outlook per ora), Note, Allegati, Riunioni, Compiti, Affari, Ordini
- Fix: pagina anagrafica invisibile (mancava il posizionamento CSS), modali (riunioni/compiti/affari/email) nascosti dietro la pagina anagrafica (z-index), "Torna alla lista" che riportava al workspace sbagliato

## 2026-09-24 — Anagrafiche sincronizzate, Obiettivi, Customizations, basi per People e Finance

**Anagrafiche**
- Catena di distribuzione visibile da entrambi i lati: dall'importatore o distributore vedi i "Clienti riforniti".
- Una persona può essere referente di più aziende (clienti, importatori, agenti, fornitori), con un ruolo per ciascuna. I Fornitori usano gli stessi Contatti delle altre anagrafiche.
- La vecchia tabella clienti B2C non viene più scritta: tutto passa da Persone.

**Commerciale → Obiettivi**
- Schermata nuova (dal progetto MyWinery): obiettivi annuali in bottiglie ed euro per cantina, area e prodotto.
- Distribuzione mensile uniforme, stagionale (dalle vendite dell'anno prima) o manuale.
- Copia di un anno con crescita dei volumi e aumento dei prezzi.

**Impostazioni → Customizations**
- Regole, automatismi e liste divisi per modulo.
- Wine club automatico per soglie di spesa (negozio ed e-commerce, visite in cantina).
- Tipologie di cliente e ruoli del contatto modificabili; giorni per "cliente fermo" e finestra delle disponibilità configurabili.

**Prerequisiti per People e Finance** (vedi `docs/people-finance/`)
- Migrazioni versionate con copia di sicurezza automatica; test automatici (`npm test`).
- Accessi con sessioni che scadono al posto della chiave fissa. Chiave fuori dai log e dagli URL. Permessi per modulo controllati dal server. Link firmati per download ed export. Blocco dei login ripetuti.
- Registro attività; infrastruttura per eventi di dominio, notifiche e job periodici.
- Fix: le foto di prodotti ed esperienze ora stanno sul volume persistente (prima si perdevano a ogni deploy).

**People e Finance — Fase 1** (vedi `docs/people-finance/02-fase-1.md`)
- Workspace **Finance**:
  - centri di costo ad albero con livelli di cascata;
  - oggetti di costo, ribaltamenti con validità mensile, driver con valori del mese, costi diretti;
  - cascata per mese (simula, conferma, annulla, riesegui) con report del costo pieno, quadratura al centesimo e dettaglio delle quote.
- Workspace **People**:
  - dipendenti con responsabile e delegato, orario contrattuale, costo orario riservato, squadre;
  - sedi con santo patrono e calendario delle festività.
- Matrice ruoli: nuovi workspace e livelli di riservatezza per i dati HR.

**People — Fase 2, blocco 2A: fascicolo del dipendente** (vedi `docs/people-finance/03-fase-2.md`)
- Scheda del dipendente a pagina intera, con queste sezioni:
  - organizzazione;
  - dati personali e contatti di emergenza;
  - documenti d'identità e permessi di soggiorno;
  - contratto a versioni;
  - retribuzione, con la proposta del costo orario;
  - competenze e lingue;
  - documenti;
  - scadenze.
- Documenti HR cifrati sul volume:
  - riservatezza per tipo di documento;
  - link che scadono;
  - registro degli accessi ai documenti sanitari.
- Scadenzario HR con notifiche automatiche alle soglie di preavviso. Campanella delle notifiche nella barra in alto.
- People → Configurazione: sedi, festività, mansioni, soglie di preavviso, oneri.

**People — Fase 2, blocco 2B: sicurezza sul lavoro (D.Lgs. 81/08)**
- Formazione e abilitazioni con periodicità configurabile e requisiti per mansione. Lo stato è calcolato per ogni persona: valida, in scadenza, scaduta o mancante.
- Operazioni che richiedono un'abilitazione:
  - chi non l'ha valida non è assegnabile;
  - deroghe motivate del responsabile sicurezza, solo se la mansione lo consente.
- Idoneità del medico competente:
  - solo giudizio e limitazioni;
  - blocco se non idoneo, avviso con limitazioni incompatibili;
  - ogni lettura è registrata.
- DPI con sostituzione periodica. Registro di infortuni e quasi-infortuni con denuncia INAIL.
- Pagina People → Sicurezza con la conformità per persona. Le scadenze di sicurezza entrano nello scadenzario.
- Al cambio di mansione:
  - attività «visita medica per cambio mansione»;
  - avviso della formazione da fare.
- Fix:
  - un dipendente con fascicolo non si può più eliminare, prima perdeva i dati;
  - lo scadenzario mostra le scadenze altrui solo a chi ha il livello personale o è il responsabile.

**People — Fase 2, blocco 2C: assenze**
- Pagina People → Assenze con tre viste: da decidere, elenco del mese, contatori.
- Nuova assenza con anteprima dei giorni lavorativi, di chi decide e degli avvisi. Si prende a giorno intero, a mezza giornata o a ore.
- Approvazione:
  - decide il responsabile, un livello più su se a chiedere è il responsabile;
  - dopo N giorni passa al delegato.
- Malattia e infortunio: si comunicano e sono subito validi, poi si prendono in visione.
- Contatori ferie, ROL ed ex festività calcolati dalle assenze:
  - maturato, riporto, goduto, pianificato e residuo;
  - blocco o avviso oltre il residuo;
  - ferie arretrate nello scadenzario.
- Periodi di blocco (es. vendemmia), con avviso o divieto.
- Visita di rientro dopo oltre 60 giorni di assenza per salute. Infortunio registrato → assenza collegata con il numero INAIL.
- Enoturismo:
  - un operatore assente non si assegna a una visita;
  - avviso se non parla la lingua della prenotazione;
  - conflitti segnalati.
- Fix: nell'admin dell'Enoturismo gli errori di assegnazione dell'operatore ora compaiono; prima fallivano in silenzio.

**People — Fase 2, blocco 2D: presenze**
- Pagina People → Presenze:
  - riepilogo del mese per persona;
  - foglio presenze giorno per giorno: ore, assenze, differenza con l'orario, totali per tipo d'ora e per centro.
- Righe di ore:
  - a passi configurabili;
  - ripartizione su più centri (particelle) e oggetti di costo;
  - niente sovrapposizioni.
- Controlli bloccanti:
  - permesso o contratto scaduto, non idoneità, abilitazione mancante per l'operazione (con deroga: avviso);
  - limitazioni: avviso al responsabile.
- Ore di squadra dal caposquadra (tutto o niente). Righe proposte da prenotazioni assegnate e fiere, da confermare.
- Mese inviato → approvato; dopo, solo rettifiche tracciate con motivo.
- Le assenze valide generano le righe nella stessa transazione, con conflitti segnalati se c'erano già ore.
- Export CSV per il consulente del lavoro. Le ore approvate alimentano il driver «Ore lavorate» di Finance.

**Pubblicazione del 24/09/2026:** Fase 1 e blocchi 2A–2D in produzione.
- Migrazioni da 0003 a 0012, precedute da una copia automatica del database.
- Chiave `HR_FILES_KEY` impostata su Railway.

**People — Fase 2, blocco 2E: self-service e servizi**
- «Il mio spazio» per ogni dipendente con accesso al portale, anche senza il workspace People:
  - i propri dati, documenti (cedolini, CU, attestati), ferie e permessi, presenze, dotazioni;
  - richieste di modifica dei dati, che si applicano solo dopo l'approvazione di HR (pagina People → Richieste).
- Scheda → Ingresso e uscita:
  - checklist di onboarding e offboarding configurabili per tipo di contratto, con verifiche automatiche;
  - offboarding concluso: dipendente, accesso al portale e operatore disattivati (non cancellati);
  - dotazioni consegnate e restituite.
- Caricamento in blocco di cedolini e CU, abbinati per codice fiscale nel nome del file o nel testo del PDF.
- Elenco degli stagionali con le campagne lavorate e chi richiamare.
- Recruiting (solo modello dati): candidati con consenso privacy e cancellazione automatica, conversione in dipendente.

## 2026-09-25 — Magazzino valorizzato (Fase 3)

**Registro dei movimenti a costo medio ponderato** (dettagli in `docs/people-finance/04-fase-3.md`)
- Ogni carico e scarico è un movimento che non si modifica: le correzioni sono storni. Ogni movimento porta la giacenza e il valore dopo di sé.
- Costo medio ponderato continuo, al centesimo: quando la giacenza va a zero esce tutto il valore residuo.
- Collegato ai flussi di sempre, nella stessa transazione:
  - vendita in cassa;
  - ritiro online: impegno al pagamento, scarico al ritiro;
  - ordini B2B evasi, che ora scalano le bottiglie (solo quelli evasi dopo l'attivazione);
  - check-in delle visite: proposta di scarico dei vini in degustazione, da confermare, a carico dell'esperienza;
  - modifiche manuali della quantità, che diventano rettifiche con il motivo.
- Eventi `stock.issued`, `stock.issue_reversed`, `stock.received`, `stock.adjusted` con il costo, pronti per il costo del venduto della Fase 4.

**Magazzino → Registro e valore**
- Giacenze e valore, movimenti, carichi (acquisto, produzione) e scarichi (omaggi, degustazioni, consumi), degustazioni da confermare, inventari con rettifiche.
- Foglio Excel dei costi: si scarica, si compila e ricaricandolo valorizza la giacenza di oggi.
- Controlli: giacenze sotto zero, articoli senza costo, righe B2B senza prodotto e differenze con le quantità di sempre. Un job notturno le confronta e avvisa il Magazzino (passo B della transizione, circa 2 settimane prima di cambiare la fonte di verità).

**Cassa e CRM**
- «Annulla» in cassa non cancella più la vendita: resta segnata come annullata, con chi, quando e il motivo, e il magazzino viene stornato. Le vendite annullate non contano per il wine club.
- Fix:
  - il webhook di Stripe non scala più due volte le bottiglie se lo stesso evento arriva due volte;
  - il «Totale speso» della persona nel CRM contava anche visite non confermate e ritiri non pagati;
  - gli errori nella modifica di prodotti finiti e materie prime ora compaiono.

**People — correzioni al blocco 2E prima della pubblicazione**
- **Cedolini in blocco:** un file si abbina solo quando non c'è ambiguità.
  - Il codice fiscale nel nome del file deve comparire anche nel documento.
  - Il documento non deve contenere i codici di altri dipendenti.
  - Il codice dell'azienda (per una ditta individuale, quello del titolare) non conta.
  - Prima una CU con un familiare a carico, o un PDF con più cedolini, poteva finire alla persona sbagliata.
- Codici fiscali omocodici accettati.
- **Documenti HR:** chi non ha il workspace People scarica solo i propri documenti, anche se il suo ruolo ha livelli di accesso.
- **Richieste di modifica:** approvando nuovi contatti di emergenza, quelli di prima restano visibili nel confronto.

**Pubblicazione del 25/09/2026:** blocco 2E (con le correzioni), Fase 3 del magazzino e nuova sidebar in produzione. Migrazioni 0013 e 0014 applicate, precedute dalla copia automatica del database.

**Produzione — Fase 0 (solo documentazione)**
- Audit, decisioni e piano in `docs/produzione/`.
- Questionario per la cantina in `docs/Domande-cantina.xlsx`, aggiornabile con `tools/questionario`.

**Pubblicazione del 25/09/2026 (2):** prerequisiti e Fase 1 della Produzione in produzione, migrazioni 0015–0019.

**Produzione — prerequisiti e Fase 1: anagrafiche** (vedi `docs/produzione/01-prerequisiti-e-fase-1.md`)
- **Vigneto:**
  - vigneti;
  - parcelle con particelle catastali, unità vitate e idoneità alle denominazioni. La superficie vitata non supera mai quella della particella;
  - attrezzature con la scadenza del controllo funzionale;
  - fitofarmaci con dose massima, carenza e rientro.
- **Cantina:**
  - luoghi e vasi con il codice QR, che dal telefono apre la scheda del vaso, e le etichette da stampare;
  - barrique con tonnelleria, rovere, tostatura, costo e passaggi;
  - protocolli di vinificazione modificabili (5 di partenza).
- **Configurazione:**
  - vitigni;
  - denominazioni con le regole di disciplinare a validità;
  - parametri di analisi, stabilimenti, campagne;
  - mappa delle operazioni SIAN;
  - 22 soglie normative «da validare».
- **Permessi:** capacità per ruolo dentro Produzione (enologo, cantiniere, capo squadra, agronomo, responsabile qualità, sola lettura), in Impostazioni → Ruoli.
- **Unità a schermo** in Impostazioni → Customizations → Produzione (hl/L, q/kg, ha/m², °Babo/°Brix).
- **Infrastruttura:**
  - gli eventi portano la versione e l'autore;
  - date operative in ora italiana;
  - oggetti di costo per parcelle, ordini di lavoro e imbottigliamenti;
  - un test che richiede un test per ogni regola consegnata.

## Come continuare questo changelog

Ad ogni nuova funzionalità o modifica rilevante, aggiungi una voce sotto la data corrente (nuova sezione `## AAAA-MM-GG — Titolo breve` se è un giorno nuovo). Tienilo breve: cosa è cambiato e perché, non il dettaglio implementativo (quello lo racconta git).
