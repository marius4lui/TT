ALTER TABLE outbox_jobs ADD COLUMN lease_token TEXT;
ALTER TABLE inbox_events ADD COLUMN lease_token TEXT;
CREATE INDEX messages_session ON messages(session_id,kind);
CREATE INDEX membership_user ON memberships(user_id,active);
CREATE INDEX audit_created ON audit_log(created_at);
