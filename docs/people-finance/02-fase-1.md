# People e Finance — Fase 1: centri di costo a cascata, oggetti di costo, organigramma

Stato: **completata in locale, in attesa di conferma** (non ancora in produzione).

## Cosa c'è

**Finance** (workspace nuovo nel portale):
- **Centri di costo.** Albero padre/figlio per i report; livello di cascata sulle foglie (1 generali, 2 ausiliari, 3 produttivi, 4 commerciali). Struttura di partenza già caricata, tutta modificabile.
- **Oggetti di costo.** Annata, lotto, SKU, operazione, esperienza, fiera, progetto, evento, con collegamento vero a fiere, esperienze e bottiglie quando esistono.
- **Ribaltamenti.** Regole con validità per mese, a percentuali fisse oppure in proporzione a un driver.
- **Driver.** Valori del mese per ogni destinazione. Sono già caricati 11 driver standard: m², ore lavorate, ore macchina, analisi, kg uva, litri, hl × mese in affinamento, bottiglie, colli, ordini, fatturato.
- **Costi diretti.** Movimenti analitici manuali, con storni.
- **Cascata.** Simula, conferma, annulla, riesegui. Il report mostra costo diretto + quote ricevute per livello = costo pieno, per centro (con gli aggregati dell'albero) e per oggetto. C'è anche il dettaglio di ogni quota e lo storico delle esecuzioni.

**People** (workspace nuovo nel portale):
- **Dipendenti.** Accesso al portale facoltativo; sede, centro di costo, responsabile, delegato.
- **Chi approva.** Il responsabile attivo; se il responsabile diretto non è attivo si sale di livello. Poi il delegato.
- **Orario contrattuale.** Per giorno della settimana, con decorrenza (livello *personale*).
- **Costo orario standard.** Con storico di validità (livello *retributivo*).
- **Squadre.** Con caposquadra.
- **Sedi e festività.** Nazionali, della sede, patrono (Pescara: 10 ottobre, San Cetteo), Pasqua e Pasquetta calcolate.

**Permessi:**
- nuovi workspace `people` e `finance` nella matrice ruoli;
- colonna "Dati HR riservati" per dare a un ruolo i livelli personale, retributivo, sanitario, disciplinare (il livello *base* ce l'hanno tutti);
- l'elenco essenziale dei dipendenti (`/hr/directory`: nome, ruolo, sede, contatti aziendali) è visibile a tutti gli utenti interni;
- People può leggere l'elenco dei centri di costo (per assegnarli), ma non il resto di Finance.

## Migrazioni

| Versione | Cosa |
|---|---|
| `0003_authz` | `roles.access_levels` |
| `0004_cost_centers` | `cost_centers` + struttura di partenza (24 centri) |
| `0005_cost_objects` | `cost_objects` (FK a fiere, esperienze, bottiglie con `ON DELETE SET NULL`) |
| `0006_allocation` | `allocation_drivers` (+ 11 driver), `allocation_rules`, `allocation_rule_targets`, `driver_values`, `allocation_runs`, `allocation_entries` |
| `0007_analytic_entries` | `analytic_entries` (origine `manuale`; le origini automatiche arriveranno con la loro FK) |
| `0008_org` | `sites` (+ sede principale), `holidays` (+ 10 festività nazionali), `employees`, `work_schedules`, `teams`, `team_members`, `employee_hourly_costs` |

Tutte hanno il `down`. Verificato: si applicano su un database vuoto e si annullano fino alla baseline.

## Eventi di dominio aggiunti

| Evento | Emittente | Consumer | Effetto |
|---|---|---|---|
| `allocation.run_confirmed` | Finance → Cascata (conferma e riesecuzione) | *nessuno per ora* (Fase 4: analitica) | payload: periodo, id esecuzione, totale ribaltato |
| `allocation.run_cancelled` | Finance → Cascata (annullamento e riesecuzione) | *nessuno per ora* | payload: periodo, id esecuzione |

## Logica di business (QUANDO/ALLORA) e test

| Regola | Test |
|---|---|
| QUANDO si imputa un costo a un centro aggregato ALLORA rifiuto: solo le foglie ricevono costi | `finance` · struttura di partenza |
| QUANDO si imputa a un centro disattivato o fuori dal periodo di validità ALLORA rifiuto | `finance` · centro disattivato o fuori validità |
| QUANDO una regola punta a un centro dello stesso livello o di un livello precedente ALLORA rifiuto (niente cicli possibili) | `finance` · regole; `calc` · regole |
| QUANDO un centro generale o ausiliario ribalta su un oggetto di costo ALLORA rifiuto | `finance` · regole; `calc` · regole |
| QUANDO le percentuali fisse non fanno 100% ALLORA rifiuto (e anomalia bloccante se cambiano dopo) | `finance` · regole; `calc` · percentuali |
| QUANDO due regole dello stesso centro si sovrappongono nel tempo ALLORA rifiuto | `finance` · regole |
| QUANDO si esegue la cascata ALLORA ogni centro ribaltato chiude a zero e il totale quadra al centesimo | `calc` · saldo zero e quadratura; `finance` · cascata completa |
| QUANDO si ripartisce un importo ALLORA ogni quota è troncata e il resto va all'ultima (somma esatta) | `calc` · allocate |
| QUANDO manca il valore di un driver, o vale zero su tutte le destinazioni ALLORA anomalia bloccante e nessuna quota per quel centro | `calc` · driver mancante; `finance` · cascata completa |
| QUANDO un centro generale o ausiliario ha costi e nessuna regola valida ALLORA anomalia bloccante (commerciali e produttivi possono tenere il costo) | `calc` · senza regola |
| QUANDO si simula ALLORA nulla viene scritto | `finance` · cascata completa |
| QUANDO ci sono anomalie bloccanti ALLORA la conferma è rifiutata | `finance` · cascata completa |
| QUANDO una cascata è confermata ALLORA costi, valori dei driver e regole usate di quel mese non si modificano finché non la si annulla | `finance` · cascata completa |
| QUANDO si riesegue ALLORA quella precedente è annullata e sostituita nella stessa transazione; rieseguire due volte dà lo stesso risultato; se la nuova ha anomalie resta valida la vecchia | `finance` · cascata completa |
| QUANDO una regola è stata usata da una cascata confermata ALLORA non si modifica né si elimina: si chiude con una fine non precedente all'ultimo uso | `finance` · cascata completa |
| QUANDO un centro ha movimenti ALLORA non si elimina (si disattiva) e non può diventare un aggregato | `finance` · centro con movimenti |
| QUANDO si sposta un centro sotto un suo discendente ALLORA rifiuto (niente cicli nell'albero) | `finance` · centro con movimenti |
| QUANDO si elimina una fiera collegata a un oggetto di costo ALLORA l'eliminazione funziona come prima e l'oggetto resta senza collegamento | `finance` · oggetti collegati |
| QUANDO il responsabile di un dipendente non è attivo ALLORA approva il livello superiore; il delegato è quello del dipendente o del responsabile | `hr` · responsabile e delegato |
| QUANDO chiede un responsabile ALLORA approva il suo responsabile (un livello sopra) | `hr` · responsabile e delegato |
| QUANDO la scelta del responsabile creerebbe un ciclo ALLORA rifiuto | `hr` · responsabile e delegato |
| QUANDO si assegna a un dipendente un centro aggregato ALLORA rifiuto | `hr` · centro foglia |
| QUANDO un utente del portale è già collegato a un dipendente ALLORA non si collega a un secondo | `hr` · centro foglia |
| QUANDO chi non ha il livello *retributivo* chiede il costo orario ALLORA 403, e il dettaglio del dipendente non lo contiene; il registro attività non riporta importi | `hr` · costo orario |
| QUANDO chi non ha il livello *personale* modifica l'orario ALLORA 403 | `hr` · orario contrattuale |
| QUANDO si crea una squadra ALLORA il caposquadra ne fa parte | `hr` · squadre |
| Calendario: Pasqua e Pasquetta calcolate, patrono della sede, festività nazionali e di sede | `calc` · calendario; `hr` · calendario |
| Permessi: Finance solo col suo workspace; People legge solo l'elenco dei centri; elenco essenziale dei dipendenti per tutti | `finance` · permessi; `hr` · elenco essenziale |

Esito al 24/09/2026: **55 test, 55 superati** (21 nuovi di Fase 1, più i 34 di prerequisiti e regressione).

## Punti toccati nei moduli esistenti

- **Matrice ruoli** (Impostazioni → Ruoli e permessi): due colonne di workspace in più e la colonna "Dati HR riservati".
- **Menu dei workspace** e **barra mobile** (portale ed Enoturismo): People e Finance.
- **Fiere, esperienze, bottiglie**: nessun cambiamento di comportamento. Eliminarle funziona come prima; un oggetto di costo collegato perde solo il collegamento.
- **Operatori dell'Enoturismo**: invariati. Il dipendente si collega all'operatore tramite il suo utente del portale.

## Decisioni prese in autonomia

- **Costi diretti già in Fase 1** (tabella `analytic_entries`, origine "manuale"): la cascata ha bisogno di costi da ribaltare. La stessa tabella riceverà le origini automatiche nella Fase 4.
- I costi diretti **già imputati a un oggetto di costo** sono alla destinazione finale e non si ribaltano.
- **Livelli 3 e 4 senza regola** tengono il loro costo (sono finali); i livelli 1 e 2 senza regola, se hanno costi, sono un'anomalia bloccante.
- Le **quote registrate** (in ppm) servono per leggere il report. Gli importi si calcolano sempre dai pesi, con il resto sull'ultima quota.
- **Validità delle regole a mese** (AAAA-MM), come i periodi della cascata.
- **Report delle cascate confermate**: viene dalla loro fotografia, quindi non cambia se poi cambiano regole o anagrafiche.
- **Classificazione dei dati HR:**
  - orario contrattuale = *personale*;
  - costo orario = *retributivo*;
  - nome, ruolo, sede, contatti aziendali, centro di costo, responsabile e squadre = *base*.
- **Chiusura di una sede** (es. vendemmia) = festività della sede con data precisa.
- Un dipendente con collaboratori, squadre o costi orari **non si elimina: si disattiva**.

## Decisioni aperte

1. **Struttura di partenza dei centri:** il vigneto ha una sola particella d'esempio (`P101`). Vanno create le particelle vere (ettari, vitigno) e rinominati i centri commerciali secondo i vostri canali.
2. **Driver "ore lavorate"**: è segnato come calcolato da People, ma lo diventerà solo con i timesheet della Fase 2. Per ora si inserisce a mano come gli altri.
3. **Enoturismo per area**: il documento dice "enoturismo per area"; ho creato solo "visite" ed "eventi". Servono altre aree (es. degustazioni, ristorazione)?
4. **Chi deve vedere Finance**: oggi solo la chiave master, perché non ci sono ruoli. Conviene creare subito i ruoli (es. "Amministrazione" con Finance + People + dati retributivi)?
