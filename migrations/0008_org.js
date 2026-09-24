// Organigramma e dipendenti (nucleo minimo della Fase 1; il fascicolo HR completo è la Fase 2).
// - sites: sedi, con il giorno del santo patrono (Pescara: 10 ottobre, San Cetteo).
// - holidays: festività ricorrenti (MM-DD) o di un solo anno (data); site_id NULL = nazionali.
//   Pasqua e Pasquetta si calcolano, non si salvano.
// - employees: portal_user_id facoltativo (gli stagionali spesso non hanno accesso al portale);
//   il collegamento agli operatori dell'Enoturismo passa da lì, senza toccare la tabella operators.
// - work_schedules: minuti di lavoro contrattuali per giorno della settimana, con decorrenza.
// - teams / team_members: squadre con caposquadra (vendemmia, lavori in vigneto).
// - employee_hourly_costs: costo orario standard (euro × 10.000) con decorrenza; livello
//   "retributivo". La validità di un costo finisce dove inizia il successivo.
const NATIONAL = [
  ['01-01', 'Capodanno'], ['01-06', 'Epifania'], ['04-25', 'Festa della Liberazione'], ['05-01', 'Festa del Lavoro'],
  ['06-02', 'Festa della Repubblica'], ['08-15', 'Ferragosto'], ['11-01', 'Ognissanti'], ['12-08', 'Immacolata Concezione'],
  ['12-25', 'Natale'], ['12-26', 'Santo Stefano'],
];

module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE sites (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        address     TEXT,
        city        TEXT,
        province    TEXT,
        patron_day  TEXT,
        patron_name TEXT,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE holidays (
        id        INTEGER PRIMARY KEY,
        site_id   INTEGER REFERENCES sites(id) ON DELETE CASCADE,
        name      TEXT NOT NULL,
        month_day TEXT,
        date      TEXT,
        CHECK ((month_day IS NULL) <> (date IS NULL))
      );
      CREATE INDEX idx_holidays_site ON holidays(site_id);

      CREATE TABLE employees (
        id             INTEGER PRIMARY KEY,
        first_name     TEXT NOT NULL,
        last_name      TEXT NOT NULL,
        job_title      TEXT,
        work_email     TEXT,
        work_phone     TEXT,
        portal_user_id INTEGER UNIQUE REFERENCES portal_users(id) ON DELETE SET NULL,
        site_id        INTEGER REFERENCES sites(id),
        cost_center_id INTEGER REFERENCES cost_centers(id),
        manager_id     INTEGER REFERENCES employees(id),
        delegate_id    INTEGER REFERENCES employees(id),
        active         INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_employees_manager ON employees(manager_id);

      CREATE TABLE work_schedules (
        id          INTEGER PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        valid_from  TEXT NOT NULL,
        weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
        minutes     INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
        UNIQUE (employee_id, valid_from, weekday)
      );

      CREATE TABLE teams (
        id                 INTEGER PRIMARY KEY,
        name               TEXT NOT NULL UNIQUE,
        leader_employee_id INTEGER REFERENCES employees(id),
        active             INTEGER NOT NULL DEFAULT 1,
        created_at         TEXT NOT NULL
      );
      CREATE TABLE team_members (
        team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        PRIMARY KEY (team_id, employee_id)
      );

      CREATE TABLE employee_hourly_costs (
        id               INTEGER PRIMARY KEY,
        employee_id      INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        cost_per_hour_e4 INTEGER NOT NULL CHECK (cost_per_hour_e4 >= 0),
        valid_from       TEXT NOT NULL,
        note             TEXT,
        created_at       TEXT NOT NULL,
        created_by       TEXT,
        UNIQUE (employee_id, valid_from)
      );
    `);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO sites (name, city, province, patron_day, patron_name, created_at) VALUES ('Sede principale', 'Pescara', 'PE', '10-10', 'San Cetteo', ?)").run(now);
    const insert = db.prepare('INSERT INTO holidays (site_id, name, month_day) VALUES (NULL, ?, ?)');
    for (const [md, name] of NATIONAL) insert.run(name, md);
  },
  down(db) {
    db.exec(`
      DROP TABLE employee_hourly_costs;
      DROP TABLE team_members;
      DROP TABLE teams;
      DROP TABLE work_schedules;
      DROP TABLE employees;
      DROP TABLE holidays;
      DROP TABLE sites;
    `);
  },
};
