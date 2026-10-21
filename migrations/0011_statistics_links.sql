CREATE TABLE group_first_names(
  group_jid TEXT NOT NULL REFERENCES groups(jid) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(group_jid,user_id)
);
CREATE TABLE statistics_links(
  token_hash TEXT PRIMARY KEY,
  group_jid TEXT REFERENCES groups(jid) ON DELETE CASCADE,
  requester_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  practice_id TEXT REFERENCES practice_groups(id) ON DELETE CASCADE,
  practice_version INTEGER,
  months INTEGER NOT NULL CHECK(months IN (1,6,12)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK((group_jid IS NOT NULL AND requester_id IS NOT NULL AND practice_id IS NULL)
     OR (group_jid IS NULL AND requester_id IS NULL AND practice_id IS NOT NULL AND practice_version IS NOT NULL))
);
CREATE INDEX statistics_links_expiry ON statistics_links(expires_at);
