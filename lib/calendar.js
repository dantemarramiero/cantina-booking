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
//   patronDay: 'MM-DD' del santo patrono della sede (es. Pescara '10-10'), opzionale.
// Restituisce un array ordinato di { date, name, kind } (kind: nazionale, sede, patrono, mobile).
function holidaysForYear(year, { entries = [], patronDay = null, patronName = 'Santo patrono' } = {}) {
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
  if (patronDay) put(`${year}-${patronDay}`, patronName, 'patrono');
  return [...map.values()].sort((x, y) => x.date.localeCompare(y.date));
}

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

module.exports = { easterSunday, addDays, weekday, holidaysForYear, MONTH_DAY, DATE, PERIOD };
