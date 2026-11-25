-- Gives the settings change log of a restored dump a new epoch. The caches of
-- the pool can hold settings rows newer than the dump; on the next apply each
-- pool sees another epoch, drops every settings cache and starts from the
-- current version. A dump taken before the change log has no epoch table: the
-- migration that creates it writes a new epoch, so nothing is to be done.
-- The table is in the settings schema; a dump taken before the settings moved
-- there has it in public, until the migration of the next boot moves it.
-- Run by cmd_restore of scripts/cell.sh after restore-end-sessions.sql;
-- server/test/settings-change-log.e2e-spec.ts runs the same file.
do $$
declare
  epoch_table regclass := coalesce(
    to_regclass('settings.settings_change_epoch'),
    to_regclass('public.settings_change_epoch'));
begin
  if epoch_table is not null then
    execute format('update %s set epoch = gen_random_uuid()', epoch_table);
    raise notice 'settings change log: new epoch';
  else
    raise notice 'settings change log: no epoch table, the migration writes one';
  end if;
end
$$;
