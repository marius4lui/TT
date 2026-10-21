-- Exercise groups are never production groups. Keep their reservation even after
-- the owning account is deleted so later webhooks cannot enter normal training.
CREATE TABLE practice_groups(
  id TEXT PRIMARY KEY,
  owner_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  group_jid TEXT UNIQUE,
  subject TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'creating',
  version INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'stopped',
  expires_at INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE practice_attendance(
  group_id TEXT NOT NULL REFERENCES practice_groups(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  sender_jid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(group_id,version,sender_jid)
);
ALTER TABLE outbox_jobs ADD COLUMN practice_id TEXT REFERENCES practice_groups(id);
ALTER TABLE outbox_jobs ADD COLUMN practice_version INTEGER;
CREATE INDEX practice_messages ON outbox_jobs(practice_id,practice_version,provider_id);

-- Prevent accidental live activation even through future/alternate code paths.
CREATE TRIGGER practice_not_live_insert BEFORE INSERT ON groups
WHEN NEW.active=1 AND EXISTS(SELECT 1 FROM practice_groups WHERE group_jid=NEW.jid)
BEGIN SELECT RAISE(ABORT,'practice_group_reserved'); END;
CREATE TRIGGER practice_not_live_update BEFORE UPDATE OF active ON groups
WHEN NEW.active=1 AND EXISTS(SELECT 1 FROM practice_groups WHERE group_jid=NEW.jid)
BEGIN SELECT RAISE(ABORT,'practice_group_reserved'); END;
CREATE TRIGGER practice_no_live_binding BEFORE UPDATE OF group_jid ON practice_groups
WHEN EXISTS(SELECT 1 FROM groups WHERE jid=NEW.group_jid AND active=1)
 OR EXISTS(SELECT 1 FROM training_sessions WHERE group_jid=NEW.group_jid)
BEGIN SELECT RAISE(ABORT,'live_group_reserved'); END;

CREATE TRIGGER practice_delete_identity BEFORE DELETE ON users
BEGIN
  DELETE FROM practice_attendance WHERE sender_jid=OLD.jid
    OR sender_jid IN (SELECT jid FROM identity_aliases WHERE user_id=OLD.id);
END;
