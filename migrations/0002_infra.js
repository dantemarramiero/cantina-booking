// Infrastruttura comune a People e Finance (prerequisiti P3–P6 della Fase 0):
// - portal_sessions: sessioni con scadenza al posto della chiave d'accesso fissa;
// - domain_events / event_consumptions / event_failures: eventi di dominio con consumer idempotenti;
// - audit_log: registro di chi ha fatto cosa, con lo stato prima e dopo;
// - notifications: notifiche nel portale (user_id NULL = amministratori con chiave master);
// - job_runs: storico dei job periodici.
// Tutte le date sono stringhe ISO 8601 scritte dall'applicazione.
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE portal_sessions (
        id           INTEGER PRIMARY KEY,
        token_hash   TEXT NOT NULL UNIQUE,
        user_id      INTEGER REFERENCES portal_users(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        ip           TEXT,
        user_agent   TEXT
      );
      CREATE INDEX idx_portal_sessions_user ON portal_sessions(user_id);

      CREATE TABLE domain_events (
        id           INTEGER PRIMARY KEY,
        type         TEXT NOT NULL,
        source_table TEXT,
        source_id    INTEGER,
        payload      TEXT NOT NULL DEFAULT '{}',
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_domain_events_type ON domain_events(type, id);

      CREATE TABLE event_consumptions (
        id           INTEGER PRIMARY KEY,
        consumer     TEXT NOT NULL,
        event_id     INTEGER NOT NULL REFERENCES domain_events(id),
        processed_at TEXT NOT NULL,
        UNIQUE (consumer, event_id)
      );

      CREATE TABLE event_failures (
        id              INTEGER PRIMARY KEY,
        consumer        TEXT NOT NULL,
        event_id        INTEGER NOT NULL REFERENCES domain_events(id),
        attempts        INTEGER NOT NULL DEFAULT 1,
        last_error      TEXT,
        last_attempt_at TEXT NOT NULL,
        UNIQUE (consumer, event_id)
      );

      CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY,
        at          TEXT NOT NULL,
        user_id     INTEGER REFERENCES portal_users(id) ON DELETE SET NULL,
        actor       TEXT NOT NULL,
        action      TEXT NOT NULL,
        entity      TEXT,
        entity_id   TEXT,
        before_json TEXT,
        after_json  TEXT,
        ip          TEXT
      );
      CREATE INDEX idx_audit_log_entity ON audit_log(entity, entity_id);
      CREATE INDEX idx_audit_log_at ON audit_log(at);

      CREATE TABLE notifications (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER REFERENCES portal_users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT,
        link       TEXT,
        dedupe_key TEXT,
        created_at TEXT NOT NULL,
        read_at    TEXT
      );
      CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
      CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(COALESCE(user_id, 0), dedupe_key) WHERE dedupe_key IS NOT NULL;

      CREATE TABLE job_runs (
        id          INTEGER PRIMARY KEY,
        job         TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        status      TEXT NOT NULL,
        detail      TEXT
      );
      CREATE INDEX idx_job_runs_job ON job_runs(job, started_at);
    `);
  },
  down(db) {
    db.exec(`
      DROP TABLE job_runs;
      DROP TABLE notifications;
      DROP TABLE audit_log;
      DROP TABLE event_failures;
      DROP TABLE event_consumptions;
      DROP TABLE domain_events;
      DROP TABLE portal_sessions;
    `);
  },
};
