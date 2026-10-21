CREATE TABLE session_presence (
  session_id TEXT NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('automatic','present','absent')),
  updated_at INTEGER NOT NULL,
  confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY(session_id,user_id)
);
-- Older RSVP records may already have been removed by the former 90-day retention.
INSERT OR IGNORE INTO settings(key,value)
VALUES('statistics_history_from',CAST((unixepoch('now') * 1000 - 90 * 86400000) AS TEXT));
