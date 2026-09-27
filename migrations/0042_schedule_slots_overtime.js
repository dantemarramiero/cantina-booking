// Orario con le fasce (pausa pranzo) e straordinari da approvare.
//
// work_schedule_slots: le fasce di ogni giorno dell'orario contrattuale (es. 08:00–12:00 e 13:00–17:00), con la
//   stessa decorrenza di work_schedules. La pausa è lo spazio tra due fasce: il Timesheet la usa per la
//   «Giornata tipo» e per toglierla dalle fasce che la coprono. Se un giorno non ha fasce vale solo il monte ore.
// timesheet_entries.overtime_status: le ore di straordinario valgono solo dopo l'approvazione del responsabile
//   (da_approvare → approvato o rifiutato, con il motivo). Quelle già registrate si considerano approvate.
module.exports = {
  up(db) {
    db.exec(`
      CREATE TABLE work_schedule_slots (
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        valid_from  TEXT NOT NULL,
        weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
        start_time  TEXT NOT NULL,
        end_time    TEXT NOT NULL,
        PRIMARY KEY (employee_id, valid_from, weekday, start_time),
        CHECK (end_time > start_time)
      );
      ALTER TABLE timesheet_entries ADD COLUMN overtime_status TEXT CHECK (overtime_status IS NULL OR overtime_status IN ('da_approvare', 'approvato', 'rifiutato'));
      ALTER TABLE timesheet_entries ADD COLUMN overtime_decided_at TEXT;
      ALTER TABLE timesheet_entries ADD COLUMN overtime_decided_by TEXT;
      ALTER TABLE timesheet_entries ADD COLUMN overtime_note TEXT;
      UPDATE timesheet_entries SET overtime_status = 'approvato' WHERE hour_type = 'straordinaria';
    `);
  },
  down(db) {
    db.exec(`
      ALTER TABLE timesheet_entries DROP COLUMN overtime_note;
      ALTER TABLE timesheet_entries DROP COLUMN overtime_decided_by;
      ALTER TABLE timesheet_entries DROP COLUMN overtime_decided_at;
      ALTER TABLE timesheet_entries DROP COLUMN overtime_status;
      DROP TABLE work_schedule_slots;
    `);
  },
};
