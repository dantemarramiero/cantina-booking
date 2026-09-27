// Conteggio ferie: spettanze standard per contratto (CCNL e tipo), ratei con la soglia dei 15 giorni,
// part-time per ROL ed ex festività, saldo alla data dal cedolino, riporto all'anno dopo, eccezioni della persona.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');

let t;
test.before(async () => { t = await startApp(); });
test.after(() => t.close());

const emp = async (first, contract) => {
  const id = (await t.api('POST', '/api/admin/hr/employees', { first_name: first, last_name: 'Ferie' })).data.id;
  if (contract) {
    const r = await t.api('POST', `/api/admin/hr/employees/${id}/contracts`, contract);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  return id;
};
const bal = (id, counter, year, date) => t.hrAbsences.balance(id, counter, year, date);
const typeId = code => t.db.prepare('SELECT id FROM absence_types WHERE code = ?').get(code).id;

test('spettanza standard dal contratto: agricoltura OTI 26 giorni a ratei mensili; OTD zero; senza contratto niente', async () => {
  const oti = await emp('Olga', { effective_from: '2031-01-01', contract_type: 'OTI', ccnl: 'Operai agricoli e florovivaisti', hire_date: '2031-01-01' });
  let b = bal(oti, 'ferie', 2031, '2031-04-10');
  assert.deepEqual([b.source, b.plan, b.annual, b.accrued, b.projected], ['standard', 'Agricoltura — operai a tempo indeterminato', 26000, 6500, 26000], 'tre mesi finiti: 6,5 giorni');
  const otd = await emp('Oscar', { effective_from: '2031-01-01', contract_type: 'OTD', ccnl: 'Agricoltura', hire_date: '2031-01-01', end_date: '2031-10-31' });
  assert.equal(bal(otd, 'ferie', 2031, '2031-06-01').annual, 0, 'OTD: ferie in retribuzione (da verificare)');
  const none = await emp('Nadia');
  b = bal(none, 'ferie', 2031, '2031-06-01');
  assert.deepEqual([b.source, b.annual], [null, 0], 'senza contratto la spettanza va indicata');
});

test('nuovo assunto a metà anno: si contano i mesi con almeno 15 giorni di servizio; cessazione idem', async () => {
  const late = await emp('Luca', { effective_from: '2031-03-20', contract_type: 'OTI', ccnl: 'agricoltura', hire_date: '2031-03-20' });
  let b = bal(late, 'ferie', 2031, '2031-12-31');
  assert.equal(b.projected, Math.floor(26000 * 9 / 12), 'marzo ha 12 giorni di servizio: non matura; da aprile a dicembre sì');
  const early = await emp('Lina', { effective_from: '2031-03-10', contract_type: 'OTI', ccnl: 'agricoltura', hire_date: '2031-03-10' });
  assert.equal(bal(early, 'ferie', 2031, '2031-12-31').projected, Math.floor(26000 * 10 / 12), 'marzo con 22 giorni: matura');
  const out = await emp('Leo', { effective_from: '2031-01-01', contract_type: 'OTI', ccnl: 'agricoltura', hire_date: '2031-01-01', end_date: '2031-06-10' });
  assert.equal(bal(out, 'ferie', 2031, '2031-12-31').projected, Math.floor(26000 * 5 / 12), 'giugno con 10 giorni: non matura');
});

test('commercio: ferie, ROL ed ex festività; il part-time riduce le ore di permesso, non i giorni di ferie', async () => {
  const pt = await emp('Pia', { effective_from: '2031-01-01', contract_type: 'impiegato', ccnl: 'CCNL Terziario, distribuzione e servizi', hire_date: '2031-01-01', part_time_pct: 50 });
  assert.deepEqual([bal(pt, 'ferie', 2031, '2031-12-31').annual, bal(pt, 'rol', 2031, '2031-12-31').annual, bal(pt, 'ex_festivita', 2031, '2031-12-31').annual], [26000, 36 * 60, 16 * 60]);
});

test('già in forza: il residuo del cedolino fa da partenza; poi ratei e assenze; l\'anno dopo il riporto', async () => {
  const id = await emp('Rita', { effective_from: '2020-01-01', contract_type: 'OTI', ccnl: 'agricoltura', hire_date: '2020-01-01' });
  const r = await t.api('POST', `/api/admin/hr/employees/${id}/balance-anchors`, { as_of: '2026-05-31', ferie: '12,5', rol: '10', note: 'cedolino di maggio' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await t.api('POST', `/api/admin/hr/employees/${id}/balance-anchors`, { as_of: '2099-01-31', ferie: 1 })).status, 400, 'niente date future');
  // Ferie prese ad aprile (prima del cedolino) non contano due volte; quelle di luglio sì.
  t.db.prepare("INSERT INTO absences (employee_id, absence_type_id, start_date, end_date, part, amount, work_minutes, status, created_at, updated_at) VALUES (?, ?, '2026-04-14', '2026-04-15', 'giorno', 2000, 960, 'approvata', 'x', 'x')").run(id, typeId('ferie'));
  t.db.prepare("INSERT INTO absences (employee_id, absence_type_id, start_date, end_date, part, amount, work_minutes, status, created_at, updated_at) VALUES (?, ?, '2026-07-06', '2026-07-08', 'giorno', 3000, 1440, 'approvata', 'x', 'x')").run(id, typeId('ferie'));
  let b = bal(id, 'ferie', 2026, '2026-08-15');
  assert.deepEqual([b.anchor.as_of, b.opening, b.accrued, b.taken], ['2026-05-31', 12500, Math.floor(26000 * 2 / 12), 3000], 'giugno e luglio maturati, solo le ferie di luglio');
  assert.equal(b.remaining, 12500 + Math.floor(26000 * 2 / 12) - 3000);
  assert.equal(b.available, 12500 + Math.floor(26000 * 7 / 12) - 3000, 'fino a fine anno: da giugno a dicembre');
  const next = bal(id, 'ferie', 2027, '2027-01-15');
  assert.equal(next.opening, 12500 + Math.floor(26000 * 7 / 12) - 3000, 'il riporto è il residuo di fine 2026');
  const rol = bal(id, 'rol', 2026, '2026-08-15');
  assert.deepEqual([rol.opening, rol.accrued], [600, 0], 'ROL: 10 ore, nessuna spettanza standard in agricoltura');
  const listed = (await t.api('GET', `/api/admin/hr/employees/${id}/allowances?year=2026`)).data;
  assert.equal(listed.anchors.length, 2);
  assert.equal(listed.plan, 'Agricoltura — operai a tempo indeterminato');
});

test('eccezioni: la spettanza della persona vince sullo standard; le spettanze standard si modificano', async () => {
  const id = await emp('Ezio', { effective_from: '2031-01-01', contract_type: 'OTI', ccnl: 'agricoltura', hire_date: '2031-01-01' });
  await t.api('PUT', `/api/admin/hr/employees/${id}/allowances`, { counter: 'ferie', year: 2031, annual: '30', accrual: 'annuale' });
  let b = bal(id, 'ferie', 2031, '2031-02-01');
  assert.deepEqual([b.source, b.annual, b.accrued], ['persona', 30000, 30000]);
  const plans = (await t.api('GET', '/api/admin/hr/absence-plans')).data;
  const agri = plans.find(p => p.name.startsWith('Agricoltura — operai a tempo indeterminato'));
  assert.deepEqual(agri.contract_types, ['OTI']);
  assert.equal((await t.api('PATCH', `/api/admin/hr/absence-plans/${agri.id}`, { rol: '56' })).status, 200);
  const other = await emp('Elsa', { effective_from: '2031-01-01', contract_type: 'OTI', ccnl: 'agricoltura', hire_date: '2031-01-01' });
  assert.equal(bal(other, 'rol', 2031, '2031-12-31').annual, 56 * 60, 'ROL indicati dal consulente');
});

test('già in forza senza residuo: il saldo è «da allineare al cedolino» finché non si indica', async () => {
  const id = await emp('Alba', { effective_from: '2018-01-01', contract_type: 'OTI', ccnl: 'agricoltura', hire_date: '2018-01-01' });
  assert.equal(bal(id, 'ferie', 2026, '2026-09-01').to_align, true);
  await t.api('POST', `/api/admin/hr/employees/${id}/balance-anchors`, { as_of: '2026-08-31', ferie: '9' });
  assert.equal(bal(id, 'ferie', 2026, '2026-09-01').to_align, false);
  const fresh = await emp('Bice', { effective_from: '2031-02-01', contract_type: 'OTI', ccnl: 'agricoltura', hire_date: '2031-02-01' });
  assert.equal(bal(fresh, 'ferie', 2031, '2031-06-01').to_align, false, 'nuovo assunto: valgono le spettanze standard');
});
