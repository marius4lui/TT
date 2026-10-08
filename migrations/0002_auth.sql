ALTER TABLE users ADD COLUMN reminders_updated_at INTEGER NOT NULL DEFAULT 0;
CREATE TABLE bootstrap (
  id INTEGER PRIMARY KEY CHECK(id=1),
  state TEXT NOT NULL CHECK(state IN ('pending','reserved','completed','closed')),
  code_hash TEXT,
  expires_at INTEGER NOT NULL,
  reserved_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reservation_event_id TEXT,
  completed_at INTEGER
);
CREATE TABLE admin_invites (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  request_event_id TEXT NOT NULL UNIQUE,
  claim_event_id TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_role TEXT NOT NULL DEFAULT 'admin' CHECK(grant_role IN ('admin','owner')),
  candidate_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','used','rejected')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  browser_hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  claim_event_id TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','confirmed','used','rejected')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  exchange_hash TEXT UNIQUE
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE UNIQUE INDEX consent_event_purpose ON consents(event_id,purpose);
CREATE TABLE auth_receipts(event_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, claim INTEGER NOT NULL DEFAULT 1 CHECK(claim=1));
-- Enforce the last-owner invariant for all callers, including account deletion.
CREATE TRIGGER roles_keep_last_owner_delete BEFORE DELETE ON roles
WHEN OLD.role='owner' AND (SELECT COUNT(*) FROM roles WHERE role='owner')=1
BEGIN SELECT RAISE(ABORT,'last_owner'); END;
CREATE TRIGGER roles_keep_last_owner_update BEFORE UPDATE OF role ON roles
WHEN OLD.role='owner' AND NEW.role!='owner' AND (SELECT COUNT(*) FROM roles WHERE role='owner')=1
BEGIN SELECT RAISE(ABORT,'last_owner'); END;
