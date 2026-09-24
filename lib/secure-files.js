// Archivio cifrato per i documenti HR (CV, contratti, cedolini, attestati, idoneità…).
//
// Ogni file è cifrato con AES-256-GCM (autenticato: un file alterato non si decifra) e salvato
// sul volume persistente con un nome casuale; nel database restano solo il nome, l'impronta
// SHA-256 del contenuto originale e i metadati. La chiave (32 byte, esadecimale o base64) sta
// nella variabile d'ambiente HR_FILES_KEY, mai nel database: chi copia il volume senza la
// chiave non legge i documenti.
//
// Formato del file: [12 byte IV][16 byte tag][testo cifrato].
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseKey(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const buf = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  if (buf.length !== 32) throw new Error('HR_FILES_KEY deve essere di 32 byte (64 caratteri esadecimali o base64).');
  return buf;
}

// Senza chiave configurata l'archivio resta spento (upload e download rispondono con un errore
// chiaro). In sviluppo locale, fuori da Railway, si usa una chiave generata e tenuta in un file
// accanto ai dati, così si può provare senza configurare nulla.
function resolveKey({ dataDir, env = process.env }) {
  const fromEnv = parseKey(env.HR_FILES_KEY);
  if (fromEnv) return { key: fromEnv, source: 'env' };
  if (env.RAILWAY_ENVIRONMENT || env.NODE_ENV === 'production') return { key: null, source: 'missing' };
  const devFile = path.join(dataDir, '.hr-files-dev-key');
  if (!fs.existsSync(devFile)) fs.writeFileSync(devFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return { key: parseKey(fs.readFileSync(devFile, 'utf8')), source: 'dev' };
}

function createSecureStore({ dir, key }) {
  if (key) fs.mkdirSync(dir, { recursive: true });
  const fileOf = storageKey => {
    if (!/^[0-9a-f-]{36}$/.test(storageKey)) throw new Error('Chiave di archivio non valida.');
    return path.join(dir, `${storageKey}.bin`);
  };
  const assertReady = () => {
    if (!key) throw Object.assign(new Error('Archivio documenti HR non configurato: manca la variabile HR_FILES_KEY.'), { status: 503 });
  };
  return {
    ready: !!key,
    save(buffer) {
      assertReady();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
      const storageKey = crypto.randomUUID();
      fs.writeFileSync(fileOf(storageKey), Buffer.concat([iv, cipher.getAuthTag(), enc]), { mode: 0o600 });
      return { storageKey, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
    },
    read(storageKey) {
      assertReady();
      const raw = fs.readFileSync(fileOf(storageKey));
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    },
    remove(storageKey) {
      try { fs.unlinkSync(fileOf(storageKey)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    },
  };
}

module.exports = { createSecureStore, resolveKey, parseKey };
