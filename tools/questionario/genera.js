// Genera (o aggiorna) il questionario per la cantina. Se il file esiste già, le colonne compilate
// dalla cantina (risposte, chi, data, stato, note) si conservano; le risposte date in chat arrivano da
// answers.json e si applicano solo alle voci indicate.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { Q, SOGLIE, FOGLI, DECISIONI } = require('./domande-data');

const OUT = process.argv[2] || path.join(__dirname, '..', '..', 'docs', 'Domande-cantina.xlsx');
const answers = fs.existsSync(path.join(__dirname, 'answers.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'answers.json'), 'utf8')) : {};
const WINE = 'FF3F181E', CREAM = 'FFF4EDE2', YELLOW = 'FFFFF6D5', GREEN = 'FFDCEFD9', ORANGE = 'FFFBE3C8', GREY = 'FFEFEFEF';
const today = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' });

const text = v => {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return '';
  }
  return String(v);
};

// Legge dal file esistente le colonne compilabili, per ID.
async function readExisting() {
  const kept = {};
  if (!OUT || !fs.existsSync(OUT)) return kept;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(OUT);
  wb.eachSheet(ws => {
    const head = ws.getRow(1).values.map(text);
    const idCol = head.indexOf('ID');
    if (idCol < 1) return;
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const id = text(row.getCell(idCol).value).trim();
      if (!id) return;
      kept[`${ws.name}|${id}`] = Object.fromEntries(head.map((h, i) => [h, text(row.getCell(i).value)]).filter(([h]) => h));
    });
  });
  return kept;
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.height = 30;
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WINE } };
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
}
function styleBody(ws, editable, from = 2) {
  ws.eachRow((row, n) => {
    if (n < from) return;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
      if (editable.includes(col)) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
    });
  });
}
function listValidation(ws, col, from, to, values) {
  for (let r = from; r <= to; r++) ws.getCell(r, col).dataValidation = { type: 'list', allowBlank: true, showErrorMessage: true, errorTitle: 'Valore non valido', error: `Scegli tra: ${values.join(', ')}`, formulae: [`"${values.join(',')}"`] };
}
function statusColors(ws, lastCol, statusCol, n, done, doubt, parked) {
  const L = ws.getColumn(statusCol).letter;
  const ref = `A2:${ws.getColumn(lastCol).letter}${n + 1}`;
  ws.addConditionalFormatting({ ref, rules: [
    { type: 'expression', priority: 1, formulae: [`$${L}2="${done}"`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } } } },
    { type: 'expression', priority: 2, formulae: [`$${L}2="${doubt}"`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: ORANGE } } } },
    ...(parked ? [{ type: 'expression', priority: 3, formulae: [`$${L}2="${parked}"`], style: { font: { color: { argb: 'FF888888' } }, fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREY } } } }] : []),
  ] });
}
const page = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
// Valore finale di una colonna compilabile: risposta data in chat > valore nel file > predefinito.
const pick = (sheet, id, col, key, def = '') => {
  const a = answers[id];
  if (a && a[key] != null) return a[key];
  const k = kept[`${sheet}|${id}`];
  return k && k[col] ? k[col] : def;
};

let kept = {};
(async () => {
  kept = await readExisting();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MyWinery';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // ── Istruzioni ──
  const wi = wb.addWorksheet('Istruzioni', { properties: { tabColor: { argb: WINE } }, pageSetup: { ...page, orientation: 'portrait' } });
  wi.getColumn(1).width = 4; wi.getColumn(2).width = 110;
  const lines = [
    ['title', 'Domande per il gestionale — Cantina Marramiero'],
    ['sub', `Versione del ${today}. Raccoglie le informazioni che servono per configurare il gestionale: produzione (vigneto, cantina, imbottigliamento, registro), magazzino, personale e amministrazione.`],
    ['h', 'Come si compila'],
    ['p', '1. Nel foglio «Domande» filtra la colonna «Chi risponde» per vedere le domande che ti riguardano.'],
    ['p', '2. Scrivi nella colonna gialla «Risposta». Se la risposta è un file o un documento, scrivi il nome del file o dove trovarlo.'],
    ['p', '3. Compila «Risposto da» e «Data».'],
    ['p', '4. Cambia lo «Stato» dal menu a tendina: «Risposta data» quando hai risposto, «Da chiarire» se hai un dubbio (scrivilo nelle «Note»). La riga si colora da sola.'],
    ['p', '5. Non cambiare la colonna «ID»: serve per caricare le risposte nel gestionale.'],
    ['p', '6. Se non sai rispondere, lascia vuoto e scrivi nelle «Note» chi potrebbe saperlo.'],
    ['h', 'Priorità'],
    ['p', 'Alta: serve nelle prossime settimane (anagrafiche di vigneto e cantina, registro dei trattamenti). Media: serve nei prossimi mesi. Bassa: quando c\'è tempo.'],
    ['h', 'Gli altri fogli'],
    ['p', "«Dati per l'onboarding»: anteprima dei dati che serviranno (parcelle, vasi, barrique, vini in cantina, materiali…). I modelli Excel da compilare arriveranno con la procedura di onboarding: per ora non serve preparare niente. Le domande con stato «Nell'onboarding» si risolvono lì."],
    ['p', '«Soglie da validare»: valori di partenza dei controlli (fermentazioni, SO2, tempi sui lieviti…). Li rivedono l\'enologo, l\'agronomo, l\'RSPP e il consulente: scrivete il valore giusto in «Valore confermato».'],
    ['p', '«Riepilogo»: a che punto siamo, per area e per persona. Si aggiorna da solo.'],
    ['p', '«Decisioni software»: riservato a Dante, non serve compilarlo in cantina.'],
    ['h', 'Quando avete finito'],
    ['p', 'Rimandate il file a Dante. Anche un file compilato a metà va bene: le risposte si caricano un po\' alla volta.'],
  ];
  lines.forEach(([kind, t], i) => {
    const c = wi.getCell(i + 2, 2);
    c.value = t;
    c.alignment = { wrapText: true, vertical: 'top' };
    if (kind === 'title') c.font = { bold: true, size: 18, color: { argb: WINE } };
    if (kind === 'sub') c.font = { italic: true, size: 11, color: { argb: 'FF555555' } };
    if (kind === 'h') { c.font = { bold: true, size: 13, color: { argb: WINE } }; wi.getRow(i + 2).height = 26; }
    if (kind === 'p') c.font = { size: 11 };
  });

  // ── Domande ──
  const wd = wb.addWorksheet('Domande', { properties: { tabColor: { argb: 'FFB8860B' } }, views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }], pageSetup: page });
  wd.columns = [
    { header: 'ID', width: 9 }, { header: 'Area', width: 18 }, { header: 'Domanda', width: 58 }, { header: 'Perché serve', width: 40 },
    { header: 'Esempio / possibili risposte', width: 32 }, { header: 'Chi risponde', width: 18 }, { header: 'Priorità', width: 10 },
    { header: 'Serve per', width: 22 }, { header: 'Risposta', width: 48 }, { header: 'Risposto da', width: 18 }, { header: 'Data', width: 12 },
    { header: 'Stato', width: 15 }, { header: 'Note', width: 36 },
  ];
  const S = 'Domande';
  for (const [id, area, q, why, ex, who, prio, forWhat] of Q) {
    wd.addRow([id, area, q, why, ex, who, prio, forWhat,
      pick(S, id, 'Risposta', 'risposta'), pick(S, id, 'Risposto da', 'da'), pick(S, id, 'Data', 'data'),
      pick(S, id, 'Stato', 'stato', 'Da chiedere'), pick(S, id, 'Note', 'note')]);
  }
  styleHeader(wd); styleBody(wd, [9, 10, 11, 12, 13]);
  wd.autoFilter = { from: 'A1', to: 'M1' };
  listValidation(wd, 12, 2, Q.length + 1, ['Da chiedere', 'Chiesta', 'Risposta data', 'Da chiarire', "Nell'onboarding"]);
  listValidation(wd, 7, 2, Q.length + 1, ['Alta', 'Media', 'Bassa']);
  statusColors(wd, 13, 12, Q.length, 'Risposta data', 'Da chiarire', "Nell'onboarding");
  wd.eachRow((row, n) => { if (n > 1 && text(row.getCell(7).value) === 'Alta') row.getCell(7).font = { bold: true, color: { argb: 'FFB00020' } }; });

  // ── Fogli da inviare ──
  const wf = wb.addWorksheet("Dati per l'onboarding", { properties: { tabColor: { argb: 'FF2E7D32' } }, views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }], pageSetup: page });
  wf.columns = [
    { header: 'ID', width: 9 }, { header: 'Dati', width: 26 }, { header: 'Colonne minime', width: 70 }, { header: 'Chi lo prepara', width: 18 },
    { header: 'Serve per', width: 24 }, { header: 'Priorità', width: 10 }, { header: 'Stato', width: 16 }, { header: 'Note', width: 40 },
  ];
  const F = "Dati per l'onboarding";
  for (const [id, name, cols, who, forWhat, prio] of FOGLI) {
    wf.addRow([id, name, cols, who, forWhat, prio, pick(F, id, 'Stato', 'stato', 'Da preparare'), pick(F, id, 'Note', 'note')]);
  }
  styleHeader(wf); styleBody(wf, [7, 8]);
  wf.autoFilter = { from: 'A1', to: 'H1' };
  listValidation(wf, 7, 2, FOGLI.length + 1, ['Da preparare', 'In preparazione', 'Pronto']);
  statusColors(wf, 8, 7, FOGLI.length, 'Pronto', 'In preparazione');

  // ── Soglie da validare ──
  const wsg = wb.addWorksheet('Soglie da validare', { properties: { tabColor: { argb: 'FF1565C0' } }, views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }], pageSetup: page });
  wsg.columns = [
    { header: 'ID', width: 9 }, { header: 'Soglia', width: 42 }, { header: 'Valore proposto', width: 36 }, { header: 'Regola', width: 10 },
    { header: 'Fonte da verificare', width: 32 }, { header: 'Chi valida', width: 18 }, { header: 'Valore confermato', width: 32 },
    { header: 'Validato da', width: 18 }, { header: 'Data', width: 12 }, { header: 'Stato', width: 15 }, { header: 'Note', width: 32 },
  ];
  const G = 'Soglie da validare';
  for (const [id, name, val, rule, src, who] of SOGLIE) {
    wsg.addRow([id, name, val, rule, src, who, pick(G, id, 'Valore confermato', 'valore'), pick(G, id, 'Validato da', 'da'), pick(G, id, 'Data', 'data'),
      pick(G, id, 'Stato', 'stato', 'Da validare'), pick(G, id, 'Note', 'note')]);
  }
  styleHeader(wsg); styleBody(wsg, [7, 8, 9, 10, 11]);
  wsg.autoFilter = { from: 'A1', to: 'K1' };
  listValidation(wsg, 10, 2, SOGLIE.length + 1, ['Da validare', 'Validata', 'Da modificare']);
  statusColors(wsg, 11, 10, SOGLIE.length, 'Validata', 'Da modificare');

  // ── Riepilogo (formule: si aggiorna da solo) ──
  const wr = wb.addWorksheet('Riepilogo', { properties: { tabColor: { argb: 'FF6A1B9A' } }, pageSetup: { ...page, orientation: 'portrait' } });
  wr.columns = [{ width: 28 }, { width: 12 }, { width: 14 }, { width: 13 }, { width: 16 }, { width: 13 }, { width: 12 }];
  const n = Q.length + 1;
  const block = (startRow, title, colLetter, keys) => {
    wr.getCell(startRow, 1).value = title;
    wr.getCell(startRow, 1).font = { bold: true, size: 13, color: { argb: WINE } };
    const h = startRow + 1;
    ['', 'Domande', 'Con risposta', 'Da chiarire', "Nell'onboarding", 'Mancanti', '% fatto'].forEach((t, i) => { wr.getCell(h, i + 1).value = t || (colLetter === 'B' ? 'Area' : 'Chi risponde'); });
    wr.getRow(h).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WINE } }; });
    keys.forEach((k, i) => {
      const r = h + 1 + i;
      const rng = `Domande!$${colLetter}$2:$${colLetter}$${n}`, st = `Domande!$L$2:$L$${n}`;
      wr.getCell(r, 1).value = k;
      wr.getCell(r, 2).value = { formula: `COUNTIF(${rng},A${r})` };
      wr.getCell(r, 3).value = { formula: `COUNTIFS(${rng},A${r},${st},"Risposta data")` };
      wr.getCell(r, 4).value = { formula: `COUNTIFS(${rng},A${r},${st},"Da chiarire")` };
      wr.getCell(r, 5).value = { formula: `COUNTIFS(${rng},A${r},${st},"Nell'onboarding")` };
      wr.getCell(r, 6).value = { formula: `B${r}-C${r}-E${r}` };
      wr.getCell(r, 7).value = { formula: `IF(B${r}-E${r}=0,0,C${r}/(B${r}-E${r}))` };
      wr.getCell(r, 7).numFmt = '0%';
      wr.getRow(r).eachCell(c => { c.border = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } }; });
    });
    const t = h + 1 + keys.length;
    wr.getCell(t, 1).value = 'Totale';
    for (const [col, L] of [[2, 'B'], [3, 'C'], [4, 'D'], [5, 'E'], [6, 'F']]) wr.getCell(t, col).value = { formula: `SUM(${L}${h + 1}:${L}${t - 1})` };
    wr.getCell(t, 7).value = { formula: `IF(B${t}-E${t}=0,0,C${t}/(B${t}-E${t}))` };
    wr.getCell(t, 7).numFmt = '0%';
    wr.getRow(t).eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } }; });
    return t + 2;
  };
  const areas = [...new Set(Q.map(q => q[1]))];
  const people = [...new Set(Q.map(q => q[5]))].sort((a, b) => a.localeCompare(b));
  let next = block(1, 'Per area', 'B', areas);
  next = block(next, 'Per persona', 'F', people);
  wr.getCell(next, 1).value = "Dati per l'onboarding pronti";
  wr.getCell(next, 1).font = { bold: true };
  // Nelle formule un nome di foglio con l'apostrofo va tra apici singoli, con l'apostrofo raddoppiato.
  wr.getCell(next, 2).value = { formula: `COUNTIF('Dati per l''onboarding'!$G$2:$G$${FOGLI.length + 1},"Pronto")&" su ${FOGLI.length}"` };
  wr.getCell(next + 1, 1).value = 'Soglie validate';
  wr.getCell(next + 1, 1).font = { bold: true };
  wr.getCell(next + 1, 2).value = { formula: `COUNTIF('Soglie da validare'!$J$2:$J$${SOGLIE.length + 1},"Validata")&" su ${SOGLIE.length}"` };

  // ── Decisioni software (per Dante) ──
  const wx = wb.addWorksheet('Decisioni software', { properties: { tabColor: { argb: 'FF757575' } }, views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }], pageSetup: page });
  wx.columns = [{ header: 'ID', width: 7 }, { header: 'Tema', width: 24 }, { header: 'Proposta', width: 70 }, { header: 'Decisione', width: 40 }, { header: 'Data', width: 12 }, { header: 'Note', width: 36 }];
  const X = 'Decisioni software';
  for (const [id, theme, prop] of DECISIONI) wx.addRow([id, theme, prop, pick(X, id, 'Decisione', 'decisione'), pick(X, id, 'Data', 'data'), pick(X, id, 'Note', 'note')]);
  styleHeader(wx); styleBody(wx, [4, 5, 6]);
  wx.eachRow((row, n) => { if (n > 1) row.eachCell(c => { if (!c.fill || c.fill.fgColor?.argb !== YELLOW) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }; }); });

  await wb.xlsx.writeFile(OUT);
  // Le risposte della chat si applicano una volta sola: poi il file Excel resta la fonte, così una risposta
  // scritta più tardi in cantina non viene mai sovrascritta. Lo storico resta in answers-applicate.json.
  if (Object.keys(answers).length) {
    const logPath = path.join(__dirname, 'answers-applicate.json');
    const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];
    log.push({ applicate_il: new Date().toISOString(), risposte: answers });
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
    fs.writeFileSync(path.join(__dirname, 'answers.json'), '{}\n');
  }
  const answered = Q.filter(q => pick(S, q[0], 'Stato', 'stato', 'Da chiedere') === 'Risposta data').length;
  console.log(`scritto ${OUT}: ${Q.length} domande (${answered} con risposta), ${FOGLI.length} fogli, ${SOGLIE.length} soglie, ${DECISIONI.length} decisioni`);
})().catch(e => { console.error(e); process.exit(1); });
