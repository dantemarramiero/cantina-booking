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

## Come continuare questo changelog

Ad ogni nuova funzionalità o modifica rilevante, aggiungi una voce sotto la data corrente (nuova sezione `## AAAA-MM-GG — Titolo breve` se è un giorno nuovo). Tienilo breve: cosa è cambiato e perché, non il dettaglio implementativo (quello lo racconta git).
