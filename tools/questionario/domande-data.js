// Catalogo delle domande per la cantina. Ogni voce: [id, area, domanda, perché serve, esempio, chi risponde, priorità, serve per]
const Q = [
  // ── Azienda ──
  ['AZ-01', 'Azienda', 'Chi sono i referenti di ogni area (enologo, agronomo, responsabile qualità, capo cantina, magazzino, amministrazione)? Nome ed email.', 'Il software manda a loro approvazioni, avvisi e scadenze.', 'Enologo: Mario Rossi, m.rossi@…', 'Direzione', 'Alta', 'Portale'],
  ['AZ-02', 'Azienda', "L'enologo è interno o un consulente esterno? Deve poter entrare nel portale?", 'Assemblaggi, aggiunte e sblocchi dei lotti li approva l\'enologo.', 'Interno / esterno con accesso / esterno senza accesso', 'Direzione', 'Alta', 'Produzione – anagrafiche'],
  ['AZ-03', 'Azienda', 'Che dispositivi userete in cantina e in vigneto?', 'Decide come costruire le schermate e cosa deve funzionare senza rete.', 'iPad, tablet Android, smartphone aziendali, smartphone personali', 'Direzione', 'Alta', 'Produzione – anagrafiche'],
  ['AZ-04', 'Azienda', "C'è copertura internet (Wi-Fi o 4G) in cantina, in bottaia e nei vigneti? Dove manca?", 'Dove manca il segnale le registrazioni si salvano come bozza sul dispositivo e partono dopo.', 'Cantina sì, bottaia no, vigneto X debole', 'Cantiniere', 'Media', 'Produzione – vigneto'],
  ['AZ-05', 'Azienda', 'Come preferite vedere le quantità a schermo: litri o ettolitri? chili o quintali? °Babo o °Brix?', 'I dati si salvano sempre precisi; cambia solo come si vedono.', 'hl, kg, °Babo', 'Enologo', 'Alta', 'Produzione – anagrafiche'],
  ['AZ-06', 'Azienda', 'Qualcuno userà il software in inglese?', 'Testi da preparare anche in inglese.', 'No / Sì, l\'enologo consulente', 'Direzione', 'Bassa', 'Portale'],

  // ── Registro SIAN e dichiarazioni ──
  ['SIA-01', 'Registro SIAN', 'Chi tiene oggi il registro telematico SIAN: voi, un CAA, un consulente o un altro software?', 'Il software non deve mai trasmettere al SIAN in parallelo a chi lo fa già.', 'Consulente Studio X / CAA / software Y / noi dal portale SIAN', 'Amministrazione', 'Alta', 'Produzione – registro SIAN'],
  ['SIA-02', 'Registro SIAN', 'Se un software o un servizio trasmette già al SIAN: quale? Deve continuare a farlo lui?', 'Stabilisce se il nostro software prepara solo i dati da passare o, più avanti, trasmette.', 'Nome del software o del servizio', 'Amministrazione', 'Alta', 'Produzione – registro SIAN'],
  ['SIA-03', 'Registro SIAN', 'Quanti stabilimenti avete con codice ICQRF? Quali sono i codici?', 'C\'è un registro per stabilimento: vasi e operazioni si collegano al loro stabilimento.', '1 stabilimento, codice …', 'Amministrazione', 'Alta', 'Produzione – anagrafiche'],
  ['SIA-04', 'Registro SIAN', 'Siete in regime ordinario o in deroga (sotto i 1000 hl l\'anno, da uve prevalentemente proprie)?', 'Cambiano le scadenze: entro il giorno lavorativo dopo / il terzo, oppure 30 giorni.', 'Ordinario / Deroga 30 giorni', 'Consulente SIAN/CAA', 'Alta', 'Produzione – registro SIAN'],
  ['SIA-05', 'Registro SIAN', 'Siete deposito fiscale (accise)?', 'Cambiano obblighi e documenti.', 'Sì / No', 'Amministrazione', 'Media', 'Produzione – registro SIAN'],
  ['SIA-06', 'Registro SIAN', 'Quanti ettolitri e quante bottiglie producete in un anno, circa?', 'Conferma il regime e dimensiona il registro.', '1.200 hl, 150.000 bottiglie', 'Direzione', 'Media', 'Produzione – registro SIAN'],
  ['SIA-07', 'Registro SIAN', 'Chi prepara la dichiarazione di vendemmia e produzione (30/11) e quella di giacenza (31/7)? Con quali dati?', 'Il software può preparare i prospetti già compilati.', 'Il consulente, dai nostri Excel', 'Amministrazione', 'Media', 'Produzione – registro SIAN'],
  ['SIA-08', 'Registro SIAN', "Potete farvi dare dal consulente l'elenco dei codici operazione SIAN che usate più spesso?", 'Ogni operazione di cantina va abbinata al suo codice SIAN: non va inventato.', 'Elenco o file del consulente', 'Consulente SIAN/CAA', 'Media', 'Produzione – registro SIAN'],
  ['SIA-09', 'Registro SIAN', 'Vendete o comprate vino sfuso?', 'Lo sfuso viaggia con documenti MVV: il software fornisce i dati del lotto.', 'No / Sì, a …', 'Direzione', 'Bassa', 'Produzione – registro SIAN'],
  ['SIA-10', 'Registro SIAN', 'Come numerate i documenti giustificativi citati nel registro (DDT, fatture, documenti interni)?', 'Ogni riga del registro indica il suo documento.', 'DDT n. 123/2026', 'Amministrazione', 'Bassa', 'Produzione – registro SIAN'],

  // ── Denominazioni e prodotti ──
  ['DEN-01', 'Denominazioni e prodotti', 'Quali denominazioni producete (DOCG, DOC, IGT, varietali, generici) e con quali vini?', 'Designazione dei lotti, rese massime e regole del disciplinare.', "Montepulciano d'Abruzzo DOC: Inferi; Trebbiano d'Abruzzo DOC: Altare", 'Enologo', 'Alta', 'Produzione – anagrafiche'],
  ['DEN-02', 'Denominazioni e prodotti', 'Quali denominazioni richiedono i contrassegni di Stato (fascette)? Chi ve li fornisce? Come registrate serie usate e distrutte?', 'Etichettatura e quadratura delle fascette.', 'Nessuna / DOCG X: fascette dal Consorzio', 'Enologo', 'Media', 'Produzione – imbottigliamento'],
  ['DEN-03', 'Denominazioni e prodotti', 'Quali menzioni usate (Riserva, Superiore, Vigna…) e su quali vini?', 'Il software controlla i tempi minimi in legno e di affinamento.', 'Inferi: Riserva', 'Enologo', 'Media', 'Produzione – affinamento'],
  ['DEN-04', 'Denominazioni e prodotti', 'Avete i disciplinari aggiornati delle vostre denominazioni? Potete mandarli?', 'Rese, vitigni e tempi minimi diventano regole del software.', 'PDF dei disciplinari', 'Enologo', 'Media', 'Produzione – anagrafiche'],
  ['DEN-05', 'Denominazioni e prodotti', 'Elenco completo delle etichette: vino, annata, formato, codice interno (SKU), codice EAN.', 'Oggi i prodotti nel software non hanno codice né formato.', 'Inferi 2019, 0,75 L, SKU INF19-075, EAN …', 'Commerciale', 'Alta', 'Magazzino'],
  ['DEN-06', 'Denominazioni e prodotti', 'Chi assegna i codici prodotto (SKU)? Con che regola?', 'I codici collegano imbottigliamento, magazzino e vendite.', 'Sigla vino + annata + formato', 'Direzione', 'Alta', 'Magazzino'],
  ['DEN-07', 'Denominazioni e prodotti', 'Quali formati usate (0,375 / 0,75 / 1,5 / 3 L / altri)?', 'Imbottigliamenti e materiali per formato.', '0,75 e 1,5', 'Enologo', 'Media', 'Produzione – imbottigliamento'],
  ['DEN-08', 'Denominazioni e prodotti', 'Avete varianti di etichetta per paese, lingua o importatore (retroetichette)? Quali?', "L'ordine indica la variante; l'etichettatura scarica i materiali giusti.", 'Retro USA, retro Giappone per l\'importatore X', 'Commerciale', 'Media', 'Produzione – imbottigliamento'],
  ['DEN-09', 'Denominazioni e prodotti', "Quando indicate annata o vitigno in etichetta applicate la regola dell'85%? Ci sono eccezioni?", 'Il software avvisa quando un assemblaggio fa perdere il diritto a indicarli.', "Sì, 85%", 'Enologo', 'Media', 'Produzione – cantina'],

  // ── Vigneto ──
  ['VIG-01', 'Vigneto', 'Quanti vigneti e quante parcelle gestite? Come le chiamate oggi (nomi o codici)?', 'È la base: ogni intervento e ogni conferimento parte da una parcella.', '3 vigneti, 25 parcelle, codici V1-P01…', 'Agronomo', 'Alta', 'Produzione – anagrafiche'],
  ['VIG-02', 'Vigneto', 'Avete lo schedario viticolo aggiornato e i dati catastali (comune, foglio, particella, subalterno, superficie)?', 'Superfici vitate, rese per ettaro, dichiarazione di vendemmia.', 'Sì, dal fascicolo aziendale / dal CAA', 'Agronomo', 'Alta', 'Produzione – anagrafiche'],
  ['VIG-03', 'Vigneto', 'Una parcella può stare su più particelle catastali? E una particella può contenere più parcelle?', 'Decide come collegare parcelle e catasto.', 'Sì, la parcella X è su 2 particelle', 'Agronomo', 'Alta', 'Produzione – anagrafiche'],
  ['VIG-04', 'Vigneto', 'Siete biologici certificati o in conversione, anche solo su una parte dei vigneti? Con quale ente?', 'Il software blocca i prodotti non ammessi in biologico su quelle parcelle.', 'Certificati su tutto (ente …) / in conversione sul vigneto X / no', 'Agronomo', 'Alta', 'Produzione – vigneto'],
  ['VIG-05', 'Vigneto', 'Avete altre certificazioni (SQNPI, Equalitas, VIVA…)?', 'Possono chiedere registrazioni in più.', 'No / Equalitas', 'Direzione', 'Bassa', 'Produzione – vigneto'],
  ['VIG-06', 'Vigneto', 'Come registrate oggi i trattamenti (quaderno di carta, Excel, software, CAA)? Chi li scrive?', 'Dal 1/1/2027 il registro dei trattamenti sarà solo elettronico; quelli del 2026 vanno convertiti entro il 31/12/2026.', 'Quaderno di carta compilato dal trattorista', 'Agronomo', 'Alta', 'Produzione – vigneto'],
  ['VIG-07', 'Vigneto', 'Chi esegue i trattamenti? Hanno il patentino fitosanitario valido? Fino a quando?', 'Il software accetta come esecutore solo chi ha il patentino valido alla data.', '2 trattoristi, patentino fino al 2028', 'Agronomo', 'Alta', 'Produzione – vigneto'],
  ['VIG-08', 'Vigneto', "Elenco delle irroratrici e delle attrezzature, con la data dell'ultimo controllo funzionale.", 'Un trattamento con un\'attrezzatura non controllata viene segnalato.', 'Atomizzatore X, controllo marzo 2025', 'Agronomo', 'Alta', 'Produzione – vigneto'],
  ['VIG-09', 'Vigneto', 'Quali fitofarmaci usate? (nome, n. di registrazione, dose massima, carenza, rientro, n. massimo di applicazioni, ammesso in bio)', 'Controlli su dosi, giorni di carenza e tempi di rientro.', 'Modello «Fitofarmaci» dell’onboarding', 'Agronomo', 'Alta', 'Produzione – vigneto'],
  ['VIG-10', 'Vigneto', 'I fitofarmaci li gestite a magazzino (carichi e scarichi)?', 'Se sì, ogni trattamento scarica il prodotto dal magazzino.', 'Sì / No', 'Agronomo', 'Media', 'Produzione – vigneto'],
  ['VIG-11', 'Vigneto', 'Il numero massimo di applicazioni di un prodotto lo contate per anno solare?', 'La campagna (1/8–31/7) spezza in due la stagione dei trattamenti: proponiamo di contare per anno solare.', 'Sì, per anno solare', 'Agronomo', 'Alta', 'Produzione – vigneto'],
  ['VIG-12', 'Vigneto', 'Quali analisi di maturazione fate (zuccheri, acidità, pH, malico, peso acini, APA, maturità fenolica, sanità)? Ogni quanto e chi le fa?', 'Curve di maturazione per parcella e previsione della vendemmia.', '°Babo, acidità e pH ogni 5 giorni da fine agosto', 'Enologo', 'Media', 'Produzione – vigneto'],
  ['VIG-13', 'Vigneto', 'Quali valori obiettivo usate per decidere quando vendemmiare (base spumante, bianco, rosso)?', 'Previsione della data di vendemmia.', 'Base spumante: 17-18 °Brix, acidità > 8 g/l', 'Enologo', 'Media', 'Produzione – vigneto'],
  ['VIG-14', 'Vigneto', 'Oltre ai trattamenti, quali interventi volete registrare (potature, lavorazioni, concimazioni, irrigazioni, sfalci, diradamenti…)?', 'Storico per parcella e costi di vigneto.', 'Tutti / solo concimazioni e potature', 'Agronomo', 'Media', 'Produzione – vigneto'],
  ['VIG-15', 'Vigneto', 'Quali concimi usate (prodotto, titolo NPK, dosi)?', 'Registro delle concimazioni.', '…', 'Agronomo', 'Bassa', 'Produzione – vigneto'],
  ['VIG-16', 'Vigneto', 'Fate irrigazione di soccorso? Su quali parcelle?', 'Registro degli interventi.', 'No', 'Agronomo', 'Bassa', 'Produzione – vigneto'],

  // ── Vendemmia ──
  ['VEN-01', 'Vendemmia', 'La vendemmia 2026 è finita, in corso o appena iniziata?', 'Decide se registrarla da zero o partire dai vini già in cantina.', 'In corso, finisce a metà ottobre', 'Enologo', 'Alta', 'Produzione – vendemmia e lotti'],
  ['VEN-02', 'Vendemmia', 'Vendemmia manuale o meccanica? Con che cassette (capacità) e quante squadre?', 'Conferimenti e ore delle squadre.', 'Manuale, cassette da 18 kg, 2 squadre', 'Agronomo', 'Media', 'Produzione – vendemmia e lotti'],
  ['VEN-03', 'Vendemmia', 'Avete una pesa? Rilascia uno scontrino numerato?', 'Il conferimento registra lordo, tara, netto e il numero dello scontrino.', 'Pesa a ponte con scontrino numerato', 'Cantiniere', 'Media', 'Produzione – vendemmia e lotti'],
  ['VEN-04', 'Vendemmia', 'Cosa annotate oggi a ogni conferimento (parcella, peso, zuccheri, stato sanitario, destinazione)?', 'Campi della schermata di conferimento.', 'Parcella, peso, °Babo', 'Cantiniere', 'Media', 'Produzione – vendemmia e lotti'],
  ['VEN-05', 'Vendemmia', 'Tenete separate le frazioni di pressatura (fiore, seconda, torchiato)?', 'Ogni frazione diventa un lotto a sé.', 'Sì, fiore e torchiato', 'Enologo', 'Media', 'Produzione – vendemmia e lotti'],
  ['VEN-06', 'Vendemmia', 'Sottoprodotti (vinacce, raspi, fecce): a chi vanno e con quale documento?', 'Registro e sostenibilità.', 'Vinacce alla distilleria X con DDT', 'Cantiniere', 'Bassa', 'Produzione – vendemmia e lotti'],

  // ── Cantina ──
  ['CAN-01', 'Cantina', 'Come sono divisi gli spazi della cantina (tinaia, bottaia, cantina spumanti, magazzino)?', 'Mappa della cantina.', 'Tinaia, bottaia interrata, magazzino', 'Cantiniere', 'Alta', 'Produzione – anagrafiche'],
  ['CAN-02', 'Cantina', 'Elenco dei vasi: codice, tipo, materiale, capacità, termocondizionamento, posizione.', 'Anagrafica dei vasi e codici QR da attaccare.', 'Modello «Vasi» dell’onboarding', 'Cantiniere', 'Alta', 'Produzione – anagrafiche'],
  ['CAN-03', 'Cantina', 'Elenco delle barrique e dei legni: tonnelleria, rovere, tostatura, capacità, anno e costo di acquisto, passaggi già fatti.', 'Storia di ogni legno e ammortamento per passaggio.', 'Modello «Barrique» dell’onboarding', 'Cantiniere', 'Alta', 'Produzione – anagrafiche'],
  ['CAN-04', 'Cantina', 'Come numerate oggi i lotti di vino?', 'Il codice del lotto nel software segue la vostra numerazione.', '24MON01', 'Enologo', 'Alta', 'Produzione – vendemmia e lotti'],
  ['CAN-05', 'Cantina', 'Vini in cantina oggi: per ogni vaso, vino, annata, volume, vitigni con percentuale, denominazione.', 'Punto di partenza della cantina nel software.', 'Modello «Vini in cantina» dell’onboarding', 'Enologo', 'Alta', 'Produzione – vendemmia e lotti'],
  ['CAN-06', 'Cantina', 'Quali passi seguite di solito per bianco, rosso, rosato e base spumante (protocolli)?', 'Protocolli modificabili: il software suggerisce il passo successivo.', 'Bianco: pressatura soffice, decantazione a freddo, …', 'Enologo', 'Media', 'Produzione – cantina'],
  ['CAN-07', 'Cantina', 'Durante la fermentazione cosa misurate (densità, temperatura), ogni quanto e chi?', 'Curve di fermentazione e allarmi di arresto.', '2 volte al giorno, il cantiniere', 'Enologo', 'Media', 'Produzione – cantina'],
  ['CAN-08', 'Cantina', 'Prodotti enologici usati (lieviti, batteri, enzimi, solfiti, bentonite, chiarificanti…): elenco e fornitori. Ne tracciate lotto e scadenza?', 'Ogni aggiunta scarica il magazzino; lotto e scadenza servono alla tracciabilità.', 'Modello «Prodotti enologici» dell’onboarding', 'Enologo', 'Media', 'Produzione – cantina'],
  ['CAN-09', 'Cantina', 'Laboratorio analisi: interno, esterno o entrambi? Quale? In che formato arrivano i referti (PDF, CSV)?', 'Caricare le analisi senza ricopiarle a mano.', 'Esterno, laboratorio X, PDF', 'Enologo', 'Alta', 'Produzione – vigneto'],
  ['CAN-10', 'Cantina', "Quali analisi servono prima dell'imbottigliamento, e quanti giorni prima al massimo?", "Il software blocca l'imbottigliamento senza analisi recenti.", 'Alcol, SO2, acidità volatile, stabilità; entro 30 giorni', 'Enologo', 'Media', 'Produzione – imbottigliamento'],
  ['CAN-11', 'Cantina', 'Pulizia dei vasi: cosa registrate (lavaggio, sanificazione, solforazione) e con quali prodotti?', 'Un vaso vuoto non si riempie senza la pulizia registrata.', 'Lavaggio e sanificazione con …', 'Cantiniere', 'Media', 'Produzione – cantina'],
  ['CAN-12', 'Cantina', 'Quali vasi richiedono che una persona entri dentro (spazi confinati)? Qual è la vostra procedura (quante persone)?', 'Solo personale abilitato e nel numero minimo previsto.', 'Vasche inox oltre 50 hl: 2 persone', 'Responsabile qualità', 'Media', 'Produzione – cantina'],
  ['CAN-13', 'Cantina', 'Ogni quanto misurate fisicamente i volumi nei vasi (inventario di cantina)?', 'Differenze registrate come rettifiche con la causale.', 'A fine campagna', 'Cantiniere', 'Bassa', 'Produzione – cantina'],
  ['CAN-14', 'Cantina', 'Chi approva assemblaggi, aggiunte e cambi di denominazione? Serve una seconda firma?', 'Permessi nel software.', "L'enologo, nessuna seconda firma", 'Direzione', 'Media', 'Produzione – cantina'],
  ['CAN-15', 'Cantina', 'Ogni quanto colmate le barrique?', 'Elenco delle colmature in ritardo.', 'Ogni 15 giorni', 'Cantiniere', 'Bassa', 'Produzione – affinamento'],

  // ── Metodo classico ──
  ['SPU-01', 'Metodo classico', 'Producete metodo classico? Quanti tiraggi all\'anno e quante bottiglie?', 'Cataste, remuage e sboccature.', 'Sì, 1 tiraggio, 10.000 bottiglie / No', 'Enologo', 'Alta', 'Produzione – affinamento'],
  ['SPU-02', 'Metodo classico', 'Remuage e sboccatura: interni o conto terzi? Pupitre o giropallet? À la glace o à la volée?', 'Operazioni da registrare e costi dei terzisti.', 'Giropallet interno, sboccatura conto terzi', 'Enologo', 'Media', 'Produzione – affinamento'],
  ['SPU-03', 'Metodo classico', 'Tempo minimo sui lieviti per ciascuno spumante (e menzione).', 'Il software rifiuta una sboccatura fatta troppo presto.', '24 mesi per il millesimato', 'Enologo', 'Media', 'Produzione – affinamento'],
  ['SPU-04', 'Metodo classico', "Come preparate la liqueur d'expédition e quali dosaggi usate (pas dosé, extra brut, brut…)?", 'Calcolo dello zucchero residuo e della categoria di dosaggio.', 'Brut, 8 g/l', 'Enologo', 'Media', 'Produzione – affinamento'],
  ['SPU-05', 'Metodo classico', 'Scrivete la data di sboccatura in etichetta?', "Resta collegata al lotto d'imbottigliamento.", 'Sì / No', 'Enologo', 'Bassa', 'Produzione – affinamento'],
  ['SPU-06', 'Metodo classico', 'Come identificate le cataste di bottiglie sui lieviti e dove sono?', 'Codici QR e posizioni delle cataste.', 'Per data di tiraggio, gabbie numerate', 'Cantiniere', 'Media', 'Produzione – affinamento'],

  // ── Imbottigliamento ──
  ['IMB-01', 'Imbottigliamento', 'Imbottigliatrice vostra o imbottigliatore mobile/terzista? Quale?', "Se è un terzista, l'imbottigliamento riceve il costo della sua fattura.", 'Mobile, ditta X', 'Enologo', 'Alta', 'Produzione – imbottigliamento'],
  ['IMB-02', 'Imbottigliamento', "Come numerate oggi i lotti d'imbottigliamento (il codice stampato in bottiglia)?", 'Il lotto è obbligatorio per legge ed è il collegamento verso i clienti.', 'L2426801', 'Enologo', 'Alta', 'Produzione – imbottigliamento'],
  ['IMB-03', 'Imbottigliamento', 'Materiali per ogni vino e formato: bottiglia, tappo, capsula, gabbietta, etichetta, retroetichetta, cartone.', 'Consumo dei materiali e fabbisogni degli imbottigliamenti pianificati.', 'Modello «Distinte materiali» dell’onboarding', 'Magazzino', 'Media', 'Produzione – imbottigliamento'],
  ['IMB-04', 'Imbottigliamento', 'Bottiglie nude (non etichettate): quante, per quanto tempo e dove le tenete?', 'Giacenza dei semilavorati.', 'Inferi resta nudo 12 mesi in bottaia', 'Cantiniere', 'Media', 'Produzione – imbottigliamento'],
  ['IMB-05', 'Imbottigliamento', "Etichettatura differita: chi la fa, quando, e come la registrate oggi?", "Per legge l'etichettatura differita si registra ogni volta.", "All'arrivo dell'ordine, il magazziniere", 'Magazzino', 'Media', 'Produzione – imbottigliamento'],
  ['IMB-06', 'Imbottigliamento', 'Registrate il lotto del fornitore dei tappi?', 'Serve per le indagini in caso di sentore di tappo.', 'Sì / No', 'Magazzino', 'Media', 'Produzione – imbottigliamento'],
  ['IMB-07', 'Imbottigliamento', "Cartoni, casse e confezioni regalo: chi decide l'imballo di un ordine, e quando?", 'Gli imballi si scaricano per ordine, alla spedizione.', 'Il magazziniere alla spedizione', 'Magazzino', 'Media', 'Produzione – imbottigliamento'],
  ['IMB-08', 'Imbottigliamento', "Usate già l'etichetta elettronica (ingredienti via QR)? Con quale servizio?", 'Bozza degli ingredienti dalle aggiunte registrate.', 'No / Sì, servizio X', 'Enologo', 'Bassa', 'Produzione – imbottigliamento'],

  // ── Magazzino ──
  ['MAG-01', 'Magazzino', 'Elenco materie prime (materiali secchi e prodotti enologici): codice, nome, unità, fornitore, scorta minima.', 'Oggi il magazzino materie prime nel software è vuoto.', 'Modello «Materiali» dell’onboarding', 'Magazzino', 'Alta', 'Magazzino'],
  ['MAG-02', 'Magazzino', 'In che unità contate i materiali (pezzi, grammi, millilitri, chili)?', 'Il registro conta in unità intere: si usano grammi e millilitri invece di chili e litri.', 'Tappi a pezzi, bentonite in grammi', 'Magazzino', 'Media', 'Magazzino'],
  ['MAG-03', 'Magazzino', 'Giacenza di bottiglie oggi, per vino, annata e formato.', 'Punto di partenza del magazzino nel software.', 'Modello «Giacenze bottiglie» dell’onboarding', 'Magazzino', 'Alta', 'Magazzino'],
  ['MAG-04', 'Magazzino', 'Costo per bottiglia di ogni vino e annata, e delle materie prime.', 'Valore del magazzino e margini. Si compila nel foglio dei costi scaricato dal software.', 'Inferi 2019: 6,40 €', 'Amministrazione', 'Media', 'Magazzino'],
  ['MAG-05', 'Magazzino', 'Chi deve ricevere gli avvisi di scorta bassa?', 'Notifiche nel portale ed email.', 'Magazziniere per le materie prime, commerciale per le bottiglie', 'Magazzino', 'Bassa', 'Magazzino'],
  ['MAG-06', 'Magazzino', 'Fate inventari fisici del magazzino? Ogni quanto?', 'Inventari con rettifiche.', 'Una volta l\'anno, a luglio', 'Magazzino', 'Bassa', 'Magazzino'],

  // ── Commerciale ──
  ['COM-01', 'Commerciale', "Quando un ordine si considera «confermato»: appena inserito o quando passa «in lavorazione»?", "Da lì parte la proposta di etichettatura se mancano bottiglie etichettate.", 'Quando passa in lavorazione', 'Commerciale', 'Media', 'Produzione – imbottigliamento'],
  ['COM-02', 'Commerciale', "Oggi qualcuno aggiorna lo stato di produzione delle righe d'ordine? Deve restare manuale?", "Più avanti il software potrà aggiornarlo da solo con l'etichettatura.", 'Nessuno / il magazziniere', 'Commerciale', 'Media', 'Commerciale'],
  ['COM-03', 'Commerciale', 'Le «bottiglie spedite» nelle dashboard devono contare gli ordini evasi?', 'Oggi contano le righe segnate «completato», anche se non ancora spedite.', 'Sì, gli ordini evasi', 'Commerciale', 'Media', 'Commerciale'],
  ['COM-04', 'Commerciale', "Alla spedizione annotate quali lotti d'imbottigliamento vanno a ogni cliente?", 'È la base per un eventuale richiamo del prodotto.', 'No / Sì, sul DDT', 'Magazzino', 'Media', 'Produzione – imbottigliamento'],

  // ── Personale e sicurezza ──
  ['PER-01', 'Personale e sicurezza', 'Chi deve vedere cosa nel portale? Ruoli per ufficio (Commerciale, Cantina, Magazzino, Amministrazione, Direzione).', 'Oggi non ci sono ruoli: tutti vedono tutto.', 'Cantina: Produzione e Magazzino', 'Direzione', 'Alta', 'Portale'],
  ['PER-02', 'Personale e sicurezza', 'Chi sono il responsabile della sicurezza (RSPP) e i preposti?', 'Deroghe e controlli di sicurezza.', 'RSPP: Studio X', 'Direzione', 'Media', 'People'],
  ['PER-03', 'Personale e sicurezza', 'RSPP: periodicità dei corsi, formazione obbligatoria per mansione, DPI e loro sostituzione.', 'Scadenzario della formazione (i valori di partenza sono già nel software, da verificare).', 'Verifica dei valori già inseriti', 'RSPP', 'Media', 'People'],
  ['PER-04', 'Personale e sicurezza', 'Medico competente: quali mansioni sono soggette a sorveglianza sanitaria?', 'Scadenze delle visite.', 'Cantiniere, trattorista, …', 'Medico competente', 'Media', 'People'],
  ['PER-05', 'Personale e sicurezza', "Consulente del lavoro: quali colonne vuole nell'export mensile delle presenze?", 'Export mensile senza ricopiare nulla.', 'Tracciato del consulente', 'Consulente del lavoro', 'Media', 'People'],
  ['PER-06', 'Personale e sicurezza', 'Consulente del lavoro: spettanze di ferie, ROL ed ex festività per contratto, e saldi iniziali.', 'Contatori delle assenze corretti.', 'CCNL operai agricoli: …', 'Consulente del lavoro', 'Media', 'People'],
  ['PER-07', 'Personale e sicurezza', 'Squadre di vendemmia e potatura: chi ne fa parte e chi è il caposquadra?', 'Il caposquadra inserisce le ore di tutta la squadra.', 'Squadra A: caposquadra X', 'Agronomo', 'Media', 'People'],
  ['PER-08', 'Personale e sicurezza', 'Per ogni fiera, quale dipendente ne è responsabile?', 'Proposte delle ore più affidabili.', '…', 'Commerciale', 'Bassa', 'People'],

  // ── Amministrazione e costi ──
  ['AMM-01', 'Amministrazione e costi', 'I costi di vigneto li volete per parcella? Parcella come «oggetto di costo» (proposto) o un centro di costo per ogni parcella?', 'Oggi c\'è un centro «P101 Vigneto — particella 1».', 'Oggetto di costo per parcella', 'Amministrazione', 'Media', 'Finance'],
  ['AMM-02', 'Amministrazione e costi', 'Il commercialista vuole il costo medio ponderato continuo per le rimanenze, o quello di periodo (mensile)?', 'Metodo di valorizzazione del magazzino.', 'Continuo', 'Commercialista', 'Media', 'Finance'],
  ['AMM-03', 'Amministrazione e costi', 'Chi è il commercialista? Gli serve un accesso o un export periodico?', 'Export per la contabilità.', 'Studio X, export mensile', 'Amministrazione', 'Bassa', 'Finance'],

  // ── Sistemi e accessi ──
  ['SIS-01', 'Sistemi e accessi', 'Chi gestisce il DNS di marramiero.it? Servono 2 record per prenotazioni.marramiero.it.', 'Il dominio delle prenotazioni oggi non funziona.', 'Provider X, persona Y', 'Dante', 'Alta', 'Portale'],
  ['SIS-02', 'Sistemi e accessi', 'La chiave HR_FILES_KEY è stata copiata in un gestore di password?', 'Senza quella chiave i documenti HR non si aprono più.', 'Sì / No', 'Dante', 'Alta', 'People'],
  ['SIS-03', 'Sistemi e accessi', 'Quando cambiamo la chiave master (in passato è finita nei log)?', 'Sicurezza degli accessi.', 'Data', 'Dante', 'Alta', 'Portale'],
  ['SIS-04', 'Sistemi e accessi', 'Il backup del volume Railway è attivo?', 'Database e allegati stanno su un solo volume.', 'Sì / No', 'Dante', 'Alta', 'Portale'],
  ['SIS-05', 'Sistemi e accessi', 'Quale servizio email usiamo per gli avvisi (Gmail o Resend)?', 'Oggi in produzione non parte nessuna email.', 'Resend con il dominio marramiero.it', 'Dante', 'Media', 'Portale'],
  ['SIS-06', 'Sistemi e accessi', 'Quando attiviamo i pagamenti Stripe?', 'Prenotazioni e ritiri online pagati.', '…', 'Dante', 'Bassa', 'Enoturismo'],
];

// Soglie di partenza da far validare (config «da validare»): [id, soglia, valore proposto, regola, fonte da verificare, chi valida]
const SOGLIE = [
  ['SOG-01', 'Finestra in cui sono ammesse le fermentazioni', '15/7 → 31/12 (salvo deroghe)', 'PRD-H05', 'Normativa nazionale; deroghe da disciplinare', 'Consulente SIAN/CAA'],
  ['SOG-02', 'Acidificazione registrabile senza dichiarazione preventiva', '4 g/l in acido tartarico', 'PRD-C10', 'Normativa sulle pratiche enologiche', 'Enologo'],
  ['SOG-03', 'Quota minima per indicare annata o vitigno', '85%', 'PRD-C06', "Normativa sull'etichettatura", 'Enologo'],
  ['SOG-04', 'Arresto di fermentazione', 'Densità ferma per 48 ore (calo minimo da definire)', 'PRD-C12', 'Pratica di cantina', 'Enologo'],
  ['SOG-05', 'Trattamento registrato in ritardo', 'Oltre 30 giorni dall\'esecuzione', 'PRD-V08', 'Normativa sul registro dei trattamenti', 'Agronomo'],
  ['SOG-06', 'Tempo minimo sui lieviti (metodo classico)', '9 mesi, per tipologia e menzione', 'PRD-M02', 'Disciplinari e normativa UE', 'Enologo'],
  ['SOG-07', 'Tolleranza di un travaso senza calo dichiarato', '0,5% del volume', 'PRD-C04', 'Pratica di cantina', 'Enologo'],
  ['SOG-08', 'SO2 totale: soglia di attenzione e limite, per categoria', 'Da tabella (fermi, spumanti, biologico, zuccheri residui)', 'PRD-C14', 'Normativa UE sulle pratiche enologiche', 'Enologo'],
  ['SOG-09', 'Acidità volatile: soglia di attenzione e limite', 'Da tabella per bianchi, rosati e rossi', 'PRD-C14', 'Normativa UE sulle pratiche enologiche', 'Enologo'],
  ['SOG-10', 'Categorie di dosaggio degli spumanti', 'Tabella UE (pas dosé … dolce) con tolleranza', 'PRD-M03', "Normativa UE sull'etichettatura degli spumanti", 'Enologo'],
  ['SOG-11', 'Pressione minima per categoria di spumante', 'Da tabella', 'PRD-M05', 'Normativa UE', 'Enologo'],
  ['SOG-12', 'Resa massima di uva per ettaro', 'Dal disciplinare di ogni DO; vini generici 30 t/ha (40 dove previsto)', 'PRD-H03', 'Disciplinari, normativa nazionale', 'Agronomo'],
  ['SOG-13', 'Resa massima di trasformazione uva → vino', 'Dal disciplinare di ogni DO', 'PRD-H04', 'Disciplinari', 'Enologo'],
  ['SOG-14', "Analisi prima dell'imbottigliamento", 'Parametri da definire, entro 30 giorni', 'PRD-P02', 'Pratica di cantina', 'Enologo'],
  ['SOG-15', 'Frequenza delle colmature', 'Ogni 14 giorni', 'PRD-B01', 'Pratica di cantina', 'Enologo'],
  ['SOG-16', 'Barrique vuota senza solforazione', 'Allarme dopo 21 giorni', 'PRD-B05', 'Pratica di cantina', 'Enologo'],
  ['SOG-17', 'Vita utile di una barrique', '5 passaggi', 'PRD-B04', 'Pratica di cantina', 'Enologo'],
  ['SOG-18', 'Spazi confinati: persone abilitate presenti', 'Almeno 2', 'PRD-C17', 'DPR 177/2011, documento di valutazione dei rischi', 'RSPP'],
  ['SOG-19', 'Scadenze del registro SIAN', 'Ordinario: entrate entro il giorno lavorativo dopo, uscite entro il terzo; deroga: 30 giorni', 'PRD-S02', 'DM 293/2015', 'Consulente SIAN/CAA'],
  ['SOG-20', 'Avviso prima della scadenza SIAN', '1 giorno lavorativo prima', 'PRD-S02', '—', 'Amministrazione'],
];

// Fogli di dati da farsi mandare: [id, foglio, colonne minime, chi lo prepara, serve per, priorità]
const FOGLI = [
  ['FOG-01', 'Parcelle', 'codice, nome, vigneto, vitigno, clone, portinnesto, anno d\'impianto, sesto (cm × cm), n. ceppi, forma di allevamento, esposizione, altitudine, superficie vitata m², DO idonee, biologico', 'Agronomo', 'Produzione – anagrafiche', 'Alta'],
  ['FOG-02', 'Particelle catastali', 'comune, foglio, particella, subalterno, superficie catastale m², parcelle che contiene con la superficie vitata, codice unità vitata dello schedario', 'Agronomo', 'Produzione – anagrafiche', 'Alta'],
  ['FOG-03', 'Vasi', 'codice, tipo (inox, cemento, tino, botte, anfora, autoclave…), materiale, capacità in litri, luogo, termocondizionato sì/no, spazio confinato sì/no', 'Cantiniere', 'Produzione – anagrafiche', 'Alta'],
  ['FOG-04', 'Barrique e legni', 'codice, tonnelleria, origine del rovere, foresta, grana, tostatura, capacità in litri, data d\'acquisto, costo, passaggi già fatti', 'Cantiniere', 'Produzione – anagrafiche', 'Alta'],
  ['FOG-05', 'Vini in cantina oggi', 'vaso, codice lotto, vino, annata, volume in litri, vitigni con %, denominazione, stato (mosto, vino, base spumante, sui lieviti…)', 'Enologo', 'Produzione – vendemmia e lotti', 'Alta'],
  ['FOG-06', 'Fitofarmaci', 'nome commerciale, n. di registrazione, sostanza attiva, dose massima per ettaro, unità, giorni di carenza, ore di rientro, n. massimo di applicazioni l\'anno, ammesso in biologico', 'Agronomo', 'Produzione – vigneto', 'Alta'],
  ['FOG-07', 'Trattamenti 2026', 'il registro dei trattamenti di quest\'anno così com\'è (foto del quaderno, Excel o export)', 'Agronomo', 'Produzione – vigneto', 'Alta'],
  ['FOG-08', 'Attrezzature', 'nome, tipo, targa o matricola, data dell\'ultimo controllo funzionale (irroratrici)', 'Agronomo', 'Produzione – vigneto', 'Alta'],
  ['FOG-09', 'Prodotti enologici', 'nome, tipo (lievito, batteri, enzima, solfiti, bentonite…), fornitore, unità, lotto e scadenza tracciati sì/no', 'Enologo', 'Produzione – cantina', 'Media'],
  ['FOG-10', 'Materiali secchi', 'codice, nome (bottiglie, tappi, capsule, gabbiette, etichette, cartoni…), unità, fornitore, scorta minima, giacenza di oggi', 'Magazzino', 'Magazzino', 'Alta'],
  ['FOG-11', 'Etichette e prodotti finiti', 'vino, annata, formato, SKU, EAN, varianti di etichetta', 'Commerciale', 'Magazzino', 'Alta'],
  ['FOG-12', 'Distinte materiali', 'per ogni vino e formato: materiali e quantità per bottiglia, separati tra imbottigliamento, etichettatura e confezionamento', 'Magazzino', 'Produzione – imbottigliamento', 'Media'],
  ['FOG-13', 'Giacenze bottiglie', 'vino, annata, formato, etichettate o nude, lotto d\'imbottigliamento, quantità', 'Magazzino', 'Magazzino', 'Alta'],
  ['FOG-14', 'Fornitori', 'tonnellerie, vetro, tappi, etichette, prodotti enologici, laboratori, terzisti: ragione sociale, P.IVA, contatti, categoria', 'Amministrazione', 'Produzione – anagrafiche', 'Media'],
  ['FOG-15', 'Dipendenti e squadre', 'nome, mansione, squadra, caposquadra, patentino fitosanitario (scadenza), formazione spazi confinati (scadenza)', 'Amministrazione', 'People', 'Media'],
  ['FOG-16', 'Analisi di maturazione degli anni passati', 'parcella, data, zuccheri, acidità, pH e gli altri parametri che misurate', 'Enologo', 'Produzione – vigneto', 'Bassa'],
];

// Decisioni sul software (per Dante): [id, tema, proposta]
const DECISIONI = [
  ['DP1', 'Database', 'Restare su SQLite (come deciso il 24/09), valori analitici come interi × 10.000'],
  ['DP2', 'Eventi', 'Contratto v1 con Finance (docs/produzione/eventi.md); versione e autore su ogni evento'],
  ['DP3', 'Oggetti di costo', 'Nuovi tipi parcella, ordine di lavoro, imbottigliamento; lotto collegato al lotto di vino (si ricostruisce la tabella)'],
  ['DP4', 'Permessi', 'Capacità per ruolo dentro Produzione: enologo, cantiniere, capo squadra, agronomo, responsabile qualità, sola lettura'],
  ['DP5', 'Magazzino', 'Lotti e scadenze delle materie prime, semilavorati, giacenza per variante e lotto; colonne aggiunte alla 0014 prima di pubblicarla'],
  ['DP6', 'Fuso orario', 'Ora italiana per Produzione; correzione a parte per i moduli esistenti'],
  ['DP7', 'Stato di produzione delle righe', 'Per ora manuale; in Fase 6 automatico solo con il via; «bottiglie spedite» dagli ordini evasi'],
  ['DP8', 'Varianti di etichetta', 'Catalogo delle varianti; la riga d\'ordine resta testo e si abbina'],
  ['DP9', 'Schermate', 'Gestione nel portale + pagina di campo per tablet e smartphone; QR letti con la fotocamera; stampe HTML; bozze offline in vigneto'],
  ['DP10', 'Testi', 'Dizionario italiano centralizzato per Produzione, pronto per l\'inglese'],
  ['DP11', 'Codici dei lotti', 'Seguire la numerazione attuale (vedi CAN-04, IMB-02); proposta 26-PEC-03 e L2626801'],
  ['DP12', 'Configurazione normativa', 'Tabella prd_config con valori «da validare» (foglio Soglie da validare)'],
  ['DP13', 'Annata agraria', 'Per il vigneto: anno di vendemmia e anno solare; la campagna 1/8–31/7 per cantina e registro'],
  ['DP14', 'Parcelle e catasto', 'Elenco delle particelle con superficie e collegamento parcella ↔ particella'],
  ['DP15', 'Ordine delle fasi', 'Nucleo del motore delle operazioni già nella Fase 3'],
  ['DP16', 'Apertura della cantina', 'I vini oggi in cantina come punto di partenza, invece di ricostruire la vendemmia 2026'],
  ['DP17', 'Unità di misura', 'Unità a schermo personalizzabili in Impostazioni (volumi, pesi, zuccheri); si salva sempre in ml e g'],
  ['DP18', 'Onboarding', 'Procedura dedicata con modelli Excel standard che la cantina compila, separata dalle Impostazioni; da progettare più avanti'],
];

module.exports = { Q, SOGLIE, FOGLI, DECISIONI };
