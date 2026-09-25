# Questionario per la cantina

Genera e aggiorna `docs/Domande-cantina.xlsx`, il file di domande da girare in cantina. Contiene:
- le domande per la configurazione del gestionale;
- l'anteprima dei dati per l'onboarding;
- le soglie da validare;
- il riepilogo;
- le decisioni sul software.

- **Prima volta:** `npm install` in questa cartella.
- **Nuove domande:** si aggiungono in `domande-data.js`. Un ID non si riusa mai.
- **Risposte arrivate in chat:** si scrivono in `answers.json` per ID (`risposta`, `da`, `data`, `stato`, `note`; per le decisioni `decisione`), poi si lancia `npm run genera`. Si applicano una volta sola: poi finiscono in `answers-applicate.json` e `answers.json` torna vuoto.
- **File compilato dalla cantina:** si copia al posto di `docs/Domande-cantina.xlsx` (stesso nome) e si lancia `npm run genera`. Le risposte scritte nel file restano; le domande nuove si aggiungono.
