CREATE TABLE command_receipts (
  event_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  guard INTEGER NOT NULL CHECK(guard=1)
);
CREATE INDEX command_receipts_created ON command_receipts(created_at);
