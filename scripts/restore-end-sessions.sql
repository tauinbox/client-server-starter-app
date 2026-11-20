-- Ends every session and every pending one-time link of a restored dump.
-- A revoked session is a deleted refresh_tokens row, so a dump taken before
-- the revoke brings it back; a reset or email-change link spent after the
-- backup would work again until its expiry. One statement, so the sessions and
-- the links end together or not at all.
-- Run by cmd_restore of scripts/cell.sh; server/test/cell-restore-end-sessions.e2e-spec.ts
-- runs the same file against the migrated schema.
with sessions as (delete from refresh_tokens returning 1),
links as (
  update users set password_reset_token = null, password_reset_expires_at = null,
    pending_email = null, pending_email_token = null, pending_email_expires_at = null
  where password_reset_token is not null or pending_email_token is not null
  returning 1)
select format('  %s refresh tokens deleted, %s users lost a pending link',
  (select count(*) from sessions), (select count(*) from links)) as summary;
