CREATE TABLE group_requests (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  requester_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK(source IN ('link','membership')),
  invite_code TEXT,
  group_jid TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','joining','approved','rejected','uncertain')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX group_requests_pending ON group_requests(status,expires_at);
CREATE TABLE group_approval_commits (
  request_id TEXT PRIMARY KEY REFERENCES group_requests(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  claimed INTEGER NOT NULL CHECK(claimed=1),
  created_at INTEGER NOT NULL
);
