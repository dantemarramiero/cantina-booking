// Copia giornaliera dei dati fuori dal volume, su un bucket S3 (AWS o compatibile).
//
// Una volta al giorno (la prima subito dopo l'avvio):
// - db/AAAA/MM/cantina-AAAAMMGG-HHMMSS.db.gz: copia coerente del database (VACUUM INTO, anche a server
//   acceso), compressa;
// - files/<cartella>/<file>: foto, cataloghi, allegati e documenti HR (questi già cifrati con
//   HR_FILES_KEY) che non sono ancora nel bucket o sono cambiati. Il bucket non perde nulla: un file
//   cancellato dal portale resta nel bucket, e la scadenza delle copie la decide la regola di ciclo di
//   vita del bucket.
// I file già caricati sono annotati in offsite_backup_files (percorso, dimensione, data di modifica).
//
// Configurazione: S3_BUCKET, AWS_REGION (o S3_REGION), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY;
// facoltative S3_PREFIX (default "cantina/") e S3_ENDPOINT (servizi compatibili, test). Senza bucket il
// job non viene registrato. Nessuna dipendenza: la firma delle richieste (AWS Signature V4) è qui sotto.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const FILE_DIRS = ['uploads', 'catalogs', 'hr-files', 'fair-attachments', 'crm-attachments'];

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// Codifica RFC 3986 di un segmento di percorso, come la vuole la firma S3.
const encodeSegment = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// Firma AWS Signature V4. headers: nomi in minuscolo, host compreso. Restituisce l'intestazione Authorization.
function signV4({ method, path: canonicalPath, query = '', headers, payloadHash, region, service, accessKeyId, secretAccessKey, amzDate }) {
  const names = Object.keys(headers).map(h => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map(n => `${n}:${String(lower[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, canonicalPath, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function configFromEnv(env = process.env) {
  if (!env.S3_BUCKET) return null;
  const cfg = {
    bucket: env.S3_BUCKET,
    region: env.S3_REGION || env.AWS_REGION || 'eu-south-1',
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    prefix: env.S3_PREFIX ?? 'cantina/',
    endpoint: env.S3_ENDPOINT ? env.S3_ENDPOINT.replace(/\/+$/, '') : null,
  };
  if (!cfg.accessKeyId || !cfg.secretAccessKey) throw new Error('S3_BUCKET è impostato ma mancano AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.');
  return cfg;
}

function createS3Client(cfg, { fetchImpl = fetch } = {}) {
  // Con S3_ENDPOINT indirizzo "path-style" (endpoint/bucket/chiave), altrimenti l'host virtuale di AWS.
  function target(key) {
    const encodedKey = key.split('/').map(encodeSegment).join('/');
    if (cfg.endpoint) {
      const u = new URL(cfg.endpoint);
      const p = `${u.pathname.replace(/\/$/, '')}/${encodeSegment(cfg.bucket)}/${encodedKey}`;
      return { url: `${u.origin}${p}`, host: u.host, path: p };
    }
    const host = `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
    return { url: `https://${host}/${encodedKey}`, host, path: `/${encodedKey}` };
  }

  async function putObject(key, body, contentType = 'application/octet-stream') {
    const { url, host, path: p } = target(key);
    const payloadHash = sha256(body);
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const headers = {
      host,
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'x-amz-server-side-encryption': 'AES256',
    };
    headers.authorization = signV4({ method: 'PUT', path: p, headers, payloadHash, region: cfg.region, service: 's3', accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, amzDate });
    delete headers.host; // la imposta fetch, uguale a quella firmata
    const res = await fetchImpl(url, { method: 'PUT', headers, body });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
      throw new Error(`S3 ${res.status}${code ? ` ${code}` : ''} su ${key}`);
    }
  }

  return { putObject };
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && !entry.name.startsWith('.')) yield full;
  }
}

function createOffsiteBackup({ db, dataDir, client, prefix = '' }) {
  let inFlight = null;

  async function backupDatabase(now) {
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cantina-offsite-')), 'cantina.db');
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const gz = zlib.gzipSync(fs.readFileSync(tmp));
      const key = `${prefix}db/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/cantina-${stamp}.db.gz`;
      await client.putObject(key, gz, 'application/gzip');
      return { key, bytes: gz.length };
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }

  async function backupFiles() {
    const known = db.prepare('SELECT size, mtime_ms FROM offsite_backup_files WHERE path = ?');
    const mark = db.prepare(`INSERT INTO offsite_backup_files (path, size, mtime_ms, uploaded_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, uploaded_at = excluded.uploaded_at`);
    let uploaded = 0;
    for (const sub of FILE_DIRS) {
      for (const full of walk(path.join(dataDir, sub))) {
        const rel = path.relative(dataDir, full).split(path.sep).join('/');
        const st = fs.statSync(full);
        const mtime = Math.floor(st.mtimeMs);
        const prev = known.get(rel);
        if (prev && prev.size === st.size && prev.mtime_ms === mtime) continue;
        await client.putObject(`${prefix}files/${rel}`, fs.readFileSync(full));
        mark.run(rel, st.size, mtime, new Date().toISOString());
        uploaded++;
      }
    }
    return uploaded;
  }

  // Una sola copia alla volta: se il job ripartisse mentre la precedente è ancora in corso, aspetta quella.
  function run(now = new Date()) {
    if (inFlight) return inFlight.then(() => 'copia già in corso');
    inFlight = (async () => {
      const dbCopy = await backupDatabase(now);
      const files = await backupFiles();
      return `database ${(dbCopy.bytes / 1024).toFixed(0)} KB in ${dbCopy.key}, ${files} file caricati`;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { run };
}

module.exports = { signV4, configFromEnv, createS3Client, createOffsiteBackup, FILE_DIRS };
