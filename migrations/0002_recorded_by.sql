-- Name typed on the phone. Used when the site runs without logins (AUTH_MODE=open),
-- where readings have no user_id.
ALTER TABLE readings ADD COLUMN recorded_by TEXT;
