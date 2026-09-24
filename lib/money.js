// Importi e quantità come interi a precisione fissa: mai numeri in virgola mobile nei calcoli.
//
// Convenzioni (decisione D10):
//   importi            centesimi di euro          (×100)
//   costi unitari      decimillesimi di euro       (×10.000)  es. 23,4567 €/h = 234567
//   quantità driver    millesimi                   (×1.000)   es. 12,5 ha = 12500
//   quote ripartizione parti per milione           (×1.000.000)
//
// Regola di arrotondamento delle ripartizioni: ogni quota è troncata verso lo zero e il residuo
// va all'ultima quota, così la somma delle quote è sempre esattamente il totale.
const PPM = 1_000_000;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

// Divide total (intero, anche negativo) in parti proporzionali ai pesi (interi ≥ 0, somma > 0).
function allocate(total, weights) {
  if (!weights.length) throw new Error('Nessuna destinazione.');
  if (weights.some(w => !Number.isInteger(w) || w < 0)) throw new Error('I pesi devono essere interi non negativi.');
  const T = BigInt(total);
  const W = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (W <= 0n) throw new Error('La somma dei pesi deve essere positiva.');
  const parts = weights.map(w => (T * BigInt(w)) / W); // la divisione BigInt tronca verso lo zero
  parts[parts.length - 1] += T - parts.reduce((s, p) => s + p, 0n);
  return parts.map(Number);
}

// Quota di w su W in parti per milione, arrotondata al più vicino (solo per mostrarla/registrarla:
// gli importi si calcolano con allocate(), non da questa quota).
function sharePpm(w, W) {
  const num = BigInt(w) * BigInt(PPM) * 2n + BigInt(W);
  return Number(num / (2n * BigInt(W)));
}

// "23,4567" / "23.4567" / 23.4567 → intero con `scale` decimali (234567 con scale 4).
// Rifiuta più decimali di quelli ammessi invece di arrotondarli in silenzio.
function parseDecimal(value, scale, { allowNegative = false } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const s = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const m = s.match(/^(-)?(\d+)(?:\.(\d*))?$/);
  if (!m) throw new Error(`Numero non valido: ${value}`);
  const [, neg, int, frac = ''] = m;
  if (neg && !allowNegative) throw new Error(`Il valore non può essere negativo: ${value}`);
  if (frac.length > scale) throw new Error(`Troppi decimali (massimo ${scale}): ${value}`);
  const n = BigInt(int + frac.padEnd(scale, '0')) * (neg ? -1n : 1n);
  if (n > MAX || n < -MAX) throw new Error(`Valore troppo grande: ${value}`);
  return Number(n);
}

// 234567, 4 → "23.4567" (stringa, per le API; l'interfaccia la formatta all'italiana).
function formatDecimal(intValue, scale) {
  const neg = intValue < 0;
  const digits = String(Math.abs(intValue)).padStart(scale + 1, '0');
  const out = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return neg ? `-${out}` : out;
}

module.exports = { PPM, allocate, sharePpm, parseDecimal, formatDecimal };
