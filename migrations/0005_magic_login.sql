ALTER TABLE auth_sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
UPDATE auth_sessions SET last_seen_at=authenticated_at;
CREATE TABLE auth_magic_links (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL UNIQUE,
  requested_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','used','revoked')),
  exchange_hash TEXT UNIQUE,
  registered_on_exchange INTEGER NOT NULL DEFAULT 0 CHECK(registered_on_exchange IN (0,1))
);
CREATE INDEX magic_user_state ON auth_magic_links(user_id,state);
CREATE INDEX magic_expiry ON auth_magic_links(expires_at);
CREATE TABLE owner_transfers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','rejected','revoked')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK(owner_id!=candidate_id)
);
CREATE INDEX owner_transfer_candidate ON owner_transfers(candidate_id,state,expires_at);
