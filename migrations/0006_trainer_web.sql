ALTER TABLE training_series ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE training_exceptions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE exception_sessions (
  exception_id TEXT NOT NULL REFERENCES training_exceptions(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  cancelled_version INTEGER NOT NULL,
  PRIMARY KEY(exception_id,session_id)
);
CREATE TABLE trainer_summary_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  offset_minutes INTEGER NOT NULL DEFAULT 10 CHECK(offset_minutes BETWEEN 0 AND 120),
  include_absent INTEGER NOT NULL DEFAULT 1 CHECK(include_absent IN (0,1)),
  include_late INTEGER NOT NULL DEFAULT 1 CHECK(include_late IN (0,1)),
  include_counts INTEGER NOT NULL DEFAULT 1 CHECK(include_counts IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
ALTER TABLE outbox_jobs ADD COLUMN preference_version INTEGER;
CREATE INDEX exception_sessions_session ON exception_sessions(session_id);
