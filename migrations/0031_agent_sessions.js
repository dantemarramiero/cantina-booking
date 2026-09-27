// Sessioni del portale agenti (Fase 2 di docs/audit_permessi.md, rischio R2): al login l'agente riceve un
// token casuale che scade (12 ore di inattività, 7 giorni al massimo), come il portale interno. Il vecchio
// agents.token, fisso e senza scadenza, non vale più per entrare. Stesso schema di portal_sessions.
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE agent_sessions (
        id           INTEGER PRIMARY KEY,
        token_hash   TEXT NOT NULL UNIQUE,
        user_id      INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        ip           TEXT,
        user_agent   TEXT
      );
      CREATE INDEX idx_agent_sessions_agent ON agent_sessions(user_id);
    `);
  },
  down(db) {
    db.exec('DROP TABLE agent_sessions');
  },
};
