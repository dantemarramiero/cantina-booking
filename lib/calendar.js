// Calendario: festività nazionali, Pasqua e Pasquetta (calcolate), patrono e festività di sede.
// Le date sono stringhe 'YYYY-MM-DD'; i giorni della settimana vanno da 1 (lunedì) a 7 (domenica).

// Domenica di Pasqua (algoritmo gregoriano anonimo, Meeus/Jones/Butcher).
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(date) {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

// Festività di un anno per una sede.
//   entries: righe della tabella holidays valide per la sede (nazionali con site_id NULL + quelle
//            della sede), ciascuna con month_day ('MM-DD', ogni anno) oppure date ('YYYY-MM-DD').
//   patronDay: 'MM-DD' del santo patrono della sede (es. Pescara '10-10'), opzionale; oppure
//   patronDate: la data 'YYYY-MM-DD' già calcolata per l'anno (patrono ricavato dal comune).
// Restituisce un array ordinato di { date, name, kind } (kind: nazionale, sede, patrono, mobile).
function holidaysForYear(year, { entries = [], patronDay = null, patronDate: patronOn = null, patronName = 'Santo patrono' } = {}) {
  const map = new Map();
  const put = (date, name, kind) => { if (!map.has(date)) map.set(date, { date, name, kind }); };
  const easter = easterSunday(year);
  put(easter, 'Pasqua', 'mobile');
  put(addDays(easter, 1), "Lunedì dell'Angelo", 'mobile');
  for (const e of entries) {
    const kind = e.site_id == null ? 'nazionale' : 'sede';
    if (e.month_day) put(`${year}-${e.month_day}`, e.name, kind);
    else if (e.date && e.date.startsWith(`${year}-`)) put(e.date, e.name, kind);
  }
  for (const h of nationalByYear(year)) put(h.date, h.name, 'nazionale');
  if (patronDay) put(`${year}-${patronDay}`, patronName, 'patrono');
  else if (patronOn) put(patronOn, patronName, 'patrono');
  return [...map.values()].sort((x, y) => x.date.localeCompare(y.date));
}

// Festività nazionali che dipendono dall'anno: San Francesco d'Assisi è di nuovo festa dal 2026
// (legge 151/2025). Si calcolano qui, così gli anni prima non cambiano.
function nationalByYear(year) {
  return year >= 2026 ? [{ date: `${year}-10-04`, name: "San Francesco d'Assisi" }] : [];
}

// Giorno del santo patrono da una regola in italiano, com'è scritta nell'elenco dei comuni:
//   «10 ottobre», «1° maggio», «primo settembre», «terza domenica di settembre», «ultima domenica di agosto»,
//   «martedì dopo Pasqua», «lunedì di Pentecoste», «Ascensione», «Corpus Domini».
// Restituisce 'YYYY-MM-DD', oppure null se la regola non si capisce (allora il patrono va indicato a mano).
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const WEEKDAY_NAMES = { lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6, domenica: 7 };
const ORDINALS = { primo: 1, prima: 1, secondo: 2, seconda: 2, terzo: 3, terza: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5, ultimo: -1, ultima: -1, penultimo: -2, penultima: -2 };
const pad = n => String(n).padStart(2, '0');
function nthWeekday(year, month, wd, n) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= last; d++) { const date = `${year}-${pad(month)}-${pad(d)}`; if (weekday(date) === wd) days.push(date); }
  return (n > 0 ? days[n - 1] : days[days.length + n]) || null;
}
function patronDate(rule, year) {
  const r = String(rule || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[°º]/g, '').replace(/\s+/g, ' ').trim();
  if (!r) return null;
  const mi = m => MONTHS.indexOf(m) + 1;
  let m = r.match(/^(\d{1,2}|primo) (\w+)$/);
  if (m && mi(m[2])) {
    const day = m[1] === 'primo' ? 1 : Number(m[1]);
    if (day > new Date(Date.UTC(year, mi(m[2]), 0)).getUTCDate()) return null;
    return `${year}-${pad(mi(m[2]))}-${pad(day)}`;
  }
  m = r.match(/^(\w+) (\w+) (?:(?:di|del mese di) )?(\w+)$/);
  if (m && ORDINALS[m[1]] && WEEKDAY_NAMES[m[2]] && mi(m[3])) return nthWeekday(year, mi(m[3]), WEEKDAY_NAMES[m[2]], ORDINALS[m[1]]);
  // «lunedì successivo alla terza domenica di settembre», «il lunedì dopo l'ultima domenica di agosto»
  m = r.match(/^(?:il )?(?:primo )?lunedi (?:successivo|dopo) (?:alla |all'|la |l')(\w+) domenica (?:di|del mese di) (\w+)$/);
  if (m && ORDINALS[m[1]] && mi(m[2])) { const d = nthWeekday(year, mi(m[2]), 7, ORDINALS[m[1]]); return d && addDays(d, 1); }
  const easter = easterSunday(year);
  m = r.match(/^(\w+) domenica dopo (?:la )?(pasqua|pentecoste)$/);
  if (m && ORDINALS[m[1]] > 0) return addDays(easter, (m[2] === 'pasqua' ? 0 : 49) + 7 * ORDINALS[m[1]]);
  const fromEaster = { pasqua: 0, 'domenica di pasqua': 0, 'venerdi santo': -2, 'lunedi di pasqua': 1, 'lunedi dopo pasqua': 1, 'primo lunedi dopo pasqua': 1, 'primo martedi dopo pasqua': 2,
    'secondo lunedi dopo pasqua': 8, "lunedi dopo l'ottava di pasqua": 8, 'quindici giorni dopo pasqua': 15, 'domenica di pentecoste': 49, 'lunedi dopo la pentecoste': 50,
    "domenica dopo l'ascensione": 42, 'domenica dopo pentecoste': 56, "lunedi dell'angelo": 1, pasquetta: 1, 'martedi dopo pasqua': 2, 'mercoledi dopo pasqua': 3,
    ascensione: 39, pentecoste: 49, 'lunedi di pentecoste': 50, 'lunedi dopo pentecoste': 50, 'martedi di pentecoste': 51, 'martedi dopo pentecoste': 51,
    'santissima trinita': 56, 'corpus domini': 60 };
  if (fromEaster[r] !== undefined) return addDays(easter, fromEaster[r]);
  return null;
}

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// Aggiunge n mesi a una data AAAA-MM-GG; se il giorno non esiste nel mese d'arrivo si ferma
// all'ultimo giorno del mese (31/01 + 1 mese = 28 o 29/02).
function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12), tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

module.exports = { easterSunday, addDays, addMonths, weekday, holidaysForYear, nationalByYear, patronDate, MONTH_DAY, DATE, PERIOD };
