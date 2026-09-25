// Ora italiana per le date operative (Produzione): si salva in UTC, ma la data di un'operazione, le
// scadenze, le campagne vitivinicole e le finestre normative si calcolano in Europe/Rome.
// Il server su Railway gira in UTC: tra mezzanotte e l'una (le due d'estate) la data UTC è ancora ieri.
const TZ = 'Europe/Rome';
const pad = n => String(n).padStart(2, '0');

const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function romeParts(d = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
}
// Data italiana (AAAA-MM-GG) di un istante.
function romeDate(d = new Date()) {
  const p = romeParts(d instanceof Date ? d : new Date(d));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
// Data e ora italiane (AAAA-MM-GGTHH:MM) di un istante.
function romeDateTime(d = new Date()) {
  const p = romeParts(d instanceof Date ? d : new Date(d));
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
// Scarto dell'ora italiana da UTC in minuti (60 d'inverno, 120 d'estate) in un istante.
function romeOffsetMinutes(d) {
  const p = romeParts(d);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}
// Da data e ora scritte in ora italiana ("2026-09-25T14:30" o "2026-09-25") all'istante UTC in ISO.
// Nell'ora che manca al cambio dell'ora legale si va avanti di un'ora, come fanno gli orologi.
function romeToUtc(local) {
  const m = String(local || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) throw new Error(`Data e ora non valide: ${local}`);
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1).map(v => (v == null ? 0 : +v));
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = naive - romeOffsetMinutes(new Date(naive)) * 60000;
  t = naive - romeOffsetMinutes(new Date(t)) * 60000;
  return new Date(t).toISOString();
}
// Campagna vitivinicola: dal 1° agosto al 31 luglio. La data è una data italiana (AAAA-MM-GG).
function campaignOf(date) {
  const [y, m] = String(date).split('-').map(Number);
  const start = m >= 8 ? y : y - 1;
  return { label: `${start}/${start + 1}`, starts_on: `${start}-08-01`, ends_on: `${start + 1}-07-31` };
}
// Giorni tra due date AAAA-MM-GG (b − a).
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) - Date.UTC(...a.split('-').map((v, i) => (i === 1 ? v - 1 : +v)))) / 86400000);
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

module.exports = { TZ, romeDate, romeDateTime, romeToUtc, romeOffsetMinutes, campaignOf, daysBetween, addDays, addMonths };
