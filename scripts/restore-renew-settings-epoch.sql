-- Gives the settings change log of a restored dump a new epoch. The caches of
-- the pool can hold settings rows newer than the dump; on the next apply each
-- pool sees another epoch, drops every settings cache and starts from the
-- current version. A dump taken before the change log has no epoch table: the
-- migration that creates it writes a new epoch, so nothing is to be done.
-- Run by cmd_restore of scripts/cell.sh after restore-end-sessions.sql;
-- server/test/settings-change-log.e2e-spec.ts runs the same file.
do $$
begin
  if to_regclass('settings_change_epoch') is not null then
    update settings_change_epoch set epoch = gen_random_uuid();
    raise notice 'settings change log: new epoch';
  else
    raise notice 'settings change log: no epoch table, the migration writes one';
  end if;
end
$$;
