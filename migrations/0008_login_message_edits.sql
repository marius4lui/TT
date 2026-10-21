ALTER TABLE outbox_jobs ADD COLUMN target_message_id TEXT;
CREATE INDEX outbox_provider_message ON outbox_jobs(provider_id,chat_jid);
