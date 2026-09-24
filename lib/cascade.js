// Ribaltamento a cascata dei costi di un periodo (funzione pura, nessun accesso al database).
//
// Livelli: 1 generali → 2 ausiliari → 3 produttivi → 4 commerciali/finali. Un centro può ribaltare
// solo su centri di livello successivo (quindi la cascata non può avere cicli); i centri di
// livello 3 e 4 possono ribaltare anche su oggetti di costo.
//
// Ordine di esecuzione: livello, poi cascade_order, poi codice (deterministico).
// Il saldo di un centro da ribaltare = costi diretti del periodo senza oggetto di costo + quote
// ricevute dai livelli precedenti. I costi diretti già imputati a un oggetto di costo sono già
// alla destinazione finale e non si ribaltano.
//
// Ogni centro ribaltato chiude a zero: le quote si calcolano con allocate() (resto all'ultima
// quota), quindi quadrano al centesimo. Se manca un dato necessario (valore del driver, somma
// delle percentuali, livello) il centro non si ribalta e l'anomalia è bloccante: nessuna quota
// silenziosa.
const { allocate, sharePpm, PPM } = require('./money');

const LEVEL_NAMES = { 1: 'generale', 2: 'ausiliario', 3: 'produttivo', 4: 'commerciale' };

// input:
//   centers:      [{ id, code, name, cascade_level, cascade_order, active, is_leaf }]
//   objects:      [{ id, code, name, status }]
//   rules:        [{ id, source_center_id, driver_id, targets: [{ target_center_id, target_cost_object_id, share_ppm }] }]
//                 già filtrate per il periodo (al massimo una per centro)
//   drivers:      [{ id, code, name, unit }]
//   driverValues: [{ driver_id, target_center_id, target_cost_object_id, quantity_milli }]
//   directCosts:  [{ cost_center_id, cost_object_id, amount_cents }]
function computeCascade({ centers, objects = [], rules, drivers = [], driverValues = [], directCosts = [] }) {
  const centerById = new Map(centers.map(c => [c.id, c]));
  const objectById = new Map(objects.map(o => [o.id, o]));
  const driverById = new Map(drivers.map(d => [d.id, d]));
  const ruleBySource = new Map(rules.map(r => [r.source_center_id, r]));
  const qty = new Map(driverValues.map(v => [valueKey(v.driver_id, v.target_center_id, v.target_cost_object_id), v.quantity_milli]));
  const anomalies = [];
  const entries = [];

  const summary = new Map(centers.map(c => [c.id, { direct: 0, received: { 1: 0, 2: 0, 3: 0 }, allocated: 0 }]));
  const objSummary = new Map(objects.map(o => [o.id, { direct: 0, received: { 3: 0, 4: 0 } }]));
  const balance = new Map(centers.map(c => [c.id, 0]));
  let totalDirect = 0;

  for (const cost of directCosts) {
    totalDirect += cost.amount_cents;
    if (cost.cost_object_id != null) {
      if (!objSummary.has(cost.cost_object_id)) objSummary.set(cost.cost_object_id, { direct: 0, received: { 3: 0, 4: 0 } });
      objSummary.get(cost.cost_object_id).direct += cost.amount_cents;
    } else {
      summary.get(cost.cost_center_id).direct += cost.amount_cents;
      balance.set(cost.cost_center_id, balance.get(cost.cost_center_id) + cost.amount_cents);
    }
  }

  const label = c => `${c.code} ${c.name}`;
  const targetLabel = t => (t.target_center_id != null ? label(centerById.get(t.target_center_id) || { code: '?', name: `centro ${t.target_center_id}` })
    : `oggetto ${(objectById.get(t.target_cost_object_id) || { code: t.target_cost_object_id }).code}`);

  const order = centers.filter(c => c.is_leaf).sort((a, b) =>
    (a.cascade_level ?? 9) - (b.cascade_level ?? 9) || (a.cascade_order || 0) - (b.cascade_order || 0) || a.code.localeCompare(b.code));

  let step = 0;
  for (const c of order) {
    const bal = balance.get(c.id);
    const rule = ruleBySource.get(c.id);
    if (!c.cascade_level) {
      if (bal !== 0) anomalies.push(blocking('livello_mancante', `Il centro ${label(c)} ha costi ma nessun livello di cascata.`, { center_id: c.id }));
      continue;
    }
    if (!rule) {
      if (bal !== 0 && c.cascade_level <= 2) {
        anomalies.push(blocking('non_ribaltato', `Il centro ${label(c)} (${LEVEL_NAMES[c.cascade_level]}) ha costi nel periodo ma nessuna regola di ribaltamento valida.`, { center_id: c.id }));
      }
      continue;
    }
    if (bal === 0) continue;

    const problems = [];
    for (const t of rule.targets) {
      if (t.target_center_id != null) {
        const tc = centerById.get(t.target_center_id);
        if (!tc || !tc.is_leaf) problems.push(`${targetLabel(t)} non è un centro imputabile (serve una foglia)`);
        else if (!tc.active) problems.push(`${targetLabel(t)} è disattivato`);
        else if (!tc.cascade_level || tc.cascade_level <= c.cascade_level) problems.push(`${targetLabel(t)} non è di un livello successivo`);
      } else {
        const o = objectById.get(t.target_cost_object_id);
        if (!o) problems.push(`l'oggetto di costo ${t.target_cost_object_id} non esiste`);
        else if (c.cascade_level < 3) problems.push(`solo i centri produttivi e commerciali ribaltano su oggetti di costo (${targetLabel(t)})`);
      }
    }
    let weights;
    const driver = rule.driver_id != null ? driverById.get(rule.driver_id) : null;
    if (rule.driver_id == null) {
      weights = rule.targets.map(t => t.share_ppm ?? 0);
      const sum = weights.reduce((s, w) => s + w, 0);
      if (sum !== PPM) problems.push(`le percentuali fisse sommano a ${(sum / 10000).toLocaleString('it-IT')}% invece di 100%`);
    } else {
      weights = rule.targets.map(t => qty.get(valueKey(rule.driver_id, t.target_center_id, t.target_cost_object_id)));
      rule.targets.forEach((t, i) => {
        if (weights[i] == null) problems.push(`manca il valore del driver «${driver?.name || rule.driver_id}» per ${targetLabel(t)}`);
        else if (weights[i] < 0) problems.push(`il valore del driver «${driver?.name}» per ${targetLabel(t)} è negativo`);
      });
      if (!problems.length && weights.reduce((s, w) => s + w, 0) === 0) problems.push(`il driver «${driver?.name}» vale zero su tutte le destinazioni`);
    }
    if (!rule.targets.length) problems.push('la regola non ha destinazioni');
    if (problems.length) {
      anomalies.push(blocking('regola_non_applicabile', `Il centro ${label(c)} non si può ribaltare: ${problems.join('; ')}.`, { center_id: c.id, rule_id: rule.id }));
      continue;
    }

    const W = weights.reduce((s, w) => s + w, 0);
    const amounts = allocate(bal, weights);
    step++;
    rule.targets.forEach((t, i) => {
      entries.push({
        step, source_center_id: c.id, target_center_id: t.target_center_id ?? null, target_cost_object_id: t.target_cost_object_id ?? null,
        rule_id: rule.id, driver_id: rule.driver_id ?? null, base_quantity_milli: rule.driver_id != null ? weights[i] : null,
        share_ppm: sharePpm(weights[i], W), amount_cents: amounts[i],
      });
      if (t.target_center_id != null) {
        balance.set(t.target_center_id, balance.get(t.target_center_id) + amounts[i]);
        summary.get(t.target_center_id).received[c.cascade_level] += amounts[i];
      } else {
        if (!objSummary.has(t.target_cost_object_id)) objSummary.set(t.target_cost_object_id, { direct: 0, received: { 3: 0, 4: 0 } });
        objSummary.get(t.target_cost_object_id).received[c.cascade_level] += amounts[i];
      }
    });
    summary.get(c.id).allocated += bal;
    balance.set(c.id, 0);
  }

  const centerRows = centers.map(c => {
    const s = summary.get(c.id);
    const received = s.received[1] + s.received[2] + s.received[3];
    return { id: c.id, code: c.code, name: c.name, cascade_level: c.cascade_level, is_leaf: c.is_leaf,
      direct: s.direct, received: { ...s.received }, full_cost: s.direct + received, allocated: s.allocated, final: balance.get(c.id) };
  });
  const objectRows = [...objSummary.entries()].map(([id, s]) => {
    const o = objectById.get(id) || { code: String(id), name: '' };
    return { id, code: o.code, name: o.name, direct: s.direct, received: { ...s.received }, total: s.direct + s.received[3] + s.received[4] };
  });
  const totals = {
    direct: totalDirect,
    allocated: entries.reduce((s, e) => s + e.amount_cents, 0),
    remaining_on_centers: centerRows.reduce((s, r) => s + r.final, 0),
    on_objects: objectRows.reduce((s, r) => s + r.total, 0),
  };
  // Conservazione: niente si crea né si perde nel ribaltamento.
  if (totals.remaining_on_centers + totals.on_objects !== totals.direct) {
    anomalies.push(blocking('quadratura', `I totali non quadrano: ${totals.remaining_on_centers + totals.on_objects} invece di ${totals.direct} centesimi.`));
  }
  return { entries, anomalies, centers: centerRows, objects: objectRows, totals, blocking: anomalies.some(a => a.severity === 'blocking') };
}

function valueKey(driverId, centerId, objectId) {
  return centerId != null ? `${driverId}:c${centerId}` : `${driverId}:o${objectId}`;
}
function blocking(code, message, extra = {}) {
  return { severity: 'blocking', code, message, ...extra };
}

// Una regola può avere come destinazioni solo centri di livello successivo (niente cicli) o, se
// il centro d'origine è produttivo o commerciale, oggetti di costo. Restituisce l'elenco degli errori.
function validateRuleTargets(source, targets, centerById) {
  const errors = [];
  if (!source) return ['Centro d\'origine inesistente.'];
  if (!source.is_leaf) errors.push('Il centro d\'origine deve essere una foglia.');
  if (!source.cascade_level) errors.push('Il centro d\'origine non ha un livello di cascata.');
  if (!targets.length) errors.push('Indica almeno una destinazione.');
  const seen = new Set();
  for (const t of targets) {
    const key = t.target_center_id != null ? `c${t.target_center_id}` : `o${t.target_cost_object_id}`;
    if (seen.has(key)) errors.push('La stessa destinazione compare due volte.');
    seen.add(key);
    if ((t.target_center_id == null) === (t.target_cost_object_id == null)) { errors.push('Ogni destinazione è un centro oppure un oggetto di costo.'); continue; }
    if (t.target_center_id != null) {
      const tc = centerById.get(t.target_center_id);
      if (!tc) errors.push(`Centro destinazione ${t.target_center_id} inesistente.`);
      else if (!tc.is_leaf) errors.push(`${tc.code} non è imputabile: solo le foglie ricevono costi.`);
      else if (!tc.cascade_level || !source.cascade_level || tc.cascade_level <= source.cascade_level) {
        errors.push(`${tc.code} non è di un livello successivo a ${source.code}: si ribalta solo verso i livelli dopo.`);
      }
    } else if (source.cascade_level && source.cascade_level < 3) {
      errors.push('Solo i centri produttivi e commerciali possono ribaltare su oggetti di costo.');
    }
  }
  return [...new Set(errors)];
}

module.exports = { computeCascade, validateRuleTargets, LEVEL_NAMES };
