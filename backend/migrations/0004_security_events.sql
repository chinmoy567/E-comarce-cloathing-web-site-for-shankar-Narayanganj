-- 0005_security_events.sql — spec 04
-- Read-only operational view over audit_logs for security-event alerting
-- (11-security-hardening §11.9). No new table for rate-limit counters — those
-- live in the limiter store (spec 04 open question 1), not in Postgres.
-- Forward-only: never edit this file after it has been applied.
--
-- The migration runner wraps this file in BEGIN/COMMIT, so no transaction
-- control appears here.

CREATE OR REPLACE VIEW security_events AS
SELECT id, action, entity_type, entity_id, actor_user_id, actor_type, new_value, request_id, created_at
FROM audit_logs
WHERE action IN ('auth_failure', 'rate_limit_rejected', 'csrf_failure', 'permission_denied');
