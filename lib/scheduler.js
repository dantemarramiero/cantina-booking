// Job periodici nello stesso processo (su Railway gira una sola istanza).
//
// Ogni minuto il tick esegue gli hook registrati (es. il dispatch degli eventi rimasti indietro)
// e i job "scaduti", cioè quelli la cui ultima esecuzione riuscita è più vecchia del loro
// intervallo. Ogni esecuzione di un job è registrata in job_runs. I job devono essere
// idempotenti: se girano due volte non producono effetti doppi.
const RETRY_MINUTES = 15;

function createScheduler(db, { log = console.error } = {}) {
  const jobs = [];
  const tickHooks = [];
  let timer = null;

  function register(name, everyMinutes, fn) {
    if (jobs.some(j => j.name === name)) throw new Error(`Job già registrato: ${name}`);
    jobs.push({ name, everyMinutes, fn });
  }
  function onTick(fn) { tickHooks.push(fn); }

  function lastRun(name) {
    return db.prepare('SELECT started_at, status FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 1').get(name) || null;
  }
  // Un job riuscito torna dopo il suo intervallo; uno fallito si riprova prima (al massimo dopo
  // RETRY_MINUTES), senza però rilanciarlo a ogni tick.
  function isDue(j, nowMs) {
    const last = lastRun(j.name);
    if (!last) return true;
    const wait = last.status === 'ok' ? j.everyMinutes : Math.min(j.everyMinutes, RETRY_MINUTES);
    return nowMs - Date.parse(last.started_at) >= wait * 60000;
  }

  function runDue(nowMs = Date.now()) {
    const ran = [];
    for (const j of jobs) {
      if (!isDue(j, nowMs)) continue;
      const id = db.prepare("INSERT INTO job_runs (job, started_at, status) VALUES (?, ?, 'running')").run(j.name, new Date(nowMs).toISOString()).lastInsertRowid;
      try {
        const detail = j.fn();
        db.prepare("UPDATE job_runs SET status = 'ok', finished_at = ?, detail = ? WHERE id = ?")
          .run(new Date().toISOString(), detail == null ? null : String(detail), id);
        ran.push(j.name);
      } catch (e) {
        db.prepare("UPDATE job_runs SET status = 'error', finished_at = ?, detail = ? WHERE id = ?").run(new Date().toISOString(), String(e.message).slice(0, 1000), id);
        log(`Job ${j.name} non riuscito: ${e.message}`);
      }
    }
    return ran;
  }

  function tick() {
    for (const hook of tickHooks) {
      try { hook(); } catch (e) { log(`Tick non riuscito: ${e.message}`); }
    }
    return runDue();
  }

  function start(tickMs = 60000) {
    if (timer) return;
    timer = setInterval(tick, tickMs);
    timer.unref();
  }
  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return { register, onTick, runDue, tick, start, stop };
}

module.exports = { createScheduler };
