#!/usr/bin/env bash
#
# Run, back up and restore one data-region cell (doc/architecture.md 12.6a).
#
#   scripts/cell.sh compose <region> <docker compose args...>
#   scripts/cell.sh backup  <region> [--stop-writers]
#   scripts/cell.sh restore <region> <backup dir>
#   scripts/cell.sh --self-test
#
# The intl cell uses the root .env and server/.env, as before cells existed.
# Another cell uses cells/<region>/.env and cells/<region>/server/.env (both
# gitignored); its .env must say CELL=<region>. docker-compose.yml derives the
# project, the volume, the proxy network and the aliases from CELL, so a cell
# env file without the right CELL would compose the intl cell. This script
# refuses that before docker sees the file.
#
# backup writes <BACKUP_ROOT>/<project>-<UTC time>/ (default BACKUP_ROOT:
# $HOME/nexus-backups) with db.dump (pg_dump custom format), counts.txt (exact
# row count of each table), uploads.tar.gz, manifest and SHA256SUMS. Redis has
# no volume and holds no state to keep. Prometheus and Grafana data are not
# kept: the repository provisions the dashboards and alerts, and the metrics
# history starts again.
#
# restore works only on a host where the cell does not exist yet: it refuses
# when the database volume or a container of the cell is present. It restores
# the uploads, starts only the db, restores the dump and compares the row
# counts. Then it ends every session and every pending reset or email-change
# link of the dump, and sets JWT_MIN_IAT in the server env file of the cell to
# the restore time: a session revoked after the backup is a deleted row, and
# the dump would bring it back. It does not start the application: start it
# after the counts match.
#
set -euo pipefail

log() { printf '\n==> %s\n' "$*"; }
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

# env_value KEY FILE - the last value of KEY in an env file, quotes removed.
env_value() {
  local key="$1" file="$2"
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$file" \
    | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# set_env_value KEY VALUE FILE - replace each line of KEY in an env file with
# one KEY=VALUE line, and keep every other line.
set_env_value() {
  local key="$1" value="$2" file="$3" tmp
  tmp="$(mktemp "$file.XXXXXX")"
  chmod 600 "$tmp"
  {
    grep -v "^[[:space:]]*${key}[[:space:]]*=" "$file" || true
    printf '%s=%s\n' "$key" "$value"
  } > "$tmp"
  mv "$tmp" "$file"
}

# check_cell REGION ROOT - refuse an env layout that would compose the wrong
# cell. Prints nothing on success.
check_cell() {
  local region="$1" root="$2"
  [[ "$region" =~ ^[a-z]+$ ]] || die "region '$region' is not a region name"
  if [ "$region" = intl ]; then
    [ -z "$(env_value CELL "$root/.env")" ] \
      || die "$root/.env sets CELL; the intl cell runs with CELL unset"
    [ -z "$(env_value COMPOSE_PROJECT_NAME "$root/.env")" ] \
      || die "$root/.env sets COMPOSE_PROJECT_NAME; docker-compose.yml names the project"
    return 0
  fi
  local env_file="$root/cells/$region/.env"
  [ -f "$env_file" ] || die "$env_file not found"
  [ -f "$root/cells/$region/server/.env" ] || die "$root/cells/$region/server/.env not found"
  [ "$(env_value CELL "$env_file")" = "$region" ] \
    || die "$env_file must set CELL=$region"
  [ -z "$(env_value COMPOSE_PROJECT_NAME "$env_file")" ] \
    || die "$env_file sets COMPOSE_PROJECT_NAME; docker-compose.yml names the project"
  local port
  port="$(env_value CLIENT_HOST_PORT "$env_file")"
  [[ "$port" =~ ^[0-9]+$ ]] || die "$env_file must set CLIENT_HOST_PORT"
  [ "$port" != 4200 ] || die "$env_file: CLIENT_HOST_PORT 4200 belongs to the intl cell"
  for key in DB_NAME DB_USER DB_PASSWORD GRAFANA_ADMIN_PASSWORD; do
    [ -n "$(env_value "$key" "$env_file")" ] || die "$env_file must set $key"
  done
}

project_of() {
  if [ "$1" = intl ]; then echo nexus; else echo "nexus-$1"; fi
}

server_env_of() {
  if [ "$1" = intl ]; then echo server/.env; else echo "cells/$1/server/.env"; fi
}

proxy_network_of() {
  if [ "$1" = intl ]; then echo shared-network; else echo "nexus-$1-proxy"; fi
}

# The shell environment wins over an env file in compose, so a CELL or
# COMPOSE_PROJECT_NAME left in the shell would override the checks above.
cell_compose() {
  local region="$1"
  shift
  if [ "$region" = intl ]; then
    env -u CELL -u COMPOSE_PROJECT_NAME docker compose "$@"
  else
    env -u COMPOSE_PROJECT_NAME CELL="$region" \
      docker compose --env-file "cells/$region/.env" "$@"
  fi
}

db_env() {
  cell_compose "$1" exec -T db printenv "$2"
}

# Exact row count of each table, one "schema.table count" line, sorted.
exact_counts() {
  local region="$1" user="$2" db="$3"
  cell_compose "$region" exec -T db psql -U "$user" -d "$db" -At -c "
    select format('%s.%s %s', table_schema, table_name,
      (xpath('/row/c/text()', query_to_xml(
        format('select count(*) as c from %I.%I', table_schema, table_name),
        false, true, '')))[1]::text)
    from information_schema.tables
    where table_schema not in ('pg_catalog', 'information_schema')
      and table_type = 'BASE TABLE'
    order by table_schema, table_name"
}

# -a: during a restore the db container is created but not started yet.
db_image() {
  docker inspect -f '{{.Config.Image}}' "$(cell_compose "$1" ps -aq db)"
}

cmd_backup() {
  local region="$1" stop_writers="${2:-}"
  [ -z "$stop_writers" ] || [ "$stop_writers" = --stop-writers ] \
    || die "unknown option '$stop_writers'"
  local project
  project="$(project_of "$region")"
  [ -n "$(cell_compose "$region" ps -q --status running db)" ] \
    || die "the db of cell $region is not running"

  # Written under a .partial name and renamed at the end, so a failed backup
  # never looks complete.
  local final dir
  final="${BACKUP_ROOT:-$HOME/nexus-backups}/${project}-$(date -u +%Y%m%dT%H%M%SZ)"
  dir="${final}.partial"
  mkdir -p "$dir"
  chmod 700 "$dir"

  if [ -n "$stop_writers" ]; then
    log "Stopping the server of cell $region (no writes from here on)"
    cell_compose "$region" stop server
  fi

  local user db
  user="$(db_env "$region" POSTGRES_USER)"
  db="$(db_env "$region" POSTGRES_DB)"

  log "Row counts -> $dir/counts.txt"
  exact_counts "$region" "$user" "$db" > "$dir/counts.txt"

  log "Database dump -> $dir/db.dump"
  cell_compose "$region" exec -T db \
    pg_dump -U "$user" -d "$db" -Fc --no-owner --no-privileges > "$dir/db.dump"

  log "Uploads -> $dir/uploads.tar.gz"
  docker run --rm -v "${project}_uploads:/data:ro" --entrypoint tar "$(db_image "$region")" \
    -C /data -czf - . > "$dir/uploads.tar.gz"

  {
    echo "region=$region"
    echo "project=$project"
    echo "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "stopped_writers=$([ -n "$stop_writers" ] && echo yes || echo no)"
    echo "postgres=$(cell_compose "$region" exec -T db postgres --version)"
  } > "$dir/manifest"
  (cd "$dir" && sha256sum db.dump counts.txt uploads.tar.gz manifest > SHA256SUMS)
  mv "$dir" "$final"

  log "Backup complete: $final ($(du -sh "$final" | cut -f1))"
  if [ -n "$stop_writers" ]; then
    echo "The server of cell $region stays stopped. Start it again only if the cell does not move."
  fi
}

cmd_restore() {
  local region="$1" dir="${2:-}"
  [ -n "$dir" ] && [ -d "$dir" ] || die "usage: $0 restore <region> <backup dir>"
  local project volume
  project="$(project_of "$region")"
  volume="${project}_postgres_data_18"

  log "Checking the backup"
  (cd "$dir" && sha256sum -c --quiet SHA256SUMS) || die "SHA256SUMS does not match"
  [ "$(env_value region "$dir/manifest")" = "$region" ] \
    || die "the backup is of region '$(env_value region "$dir/manifest")', not '$region'"
  ! docker volume inspect "$volume" > /dev/null 2>&1 \
    || die "volume $volume exists: restore runs only on a host without cell $region"
  [ -z "$(cell_compose "$region" ps -aq)" ] \
    || die "containers of cell $region exist: restore runs only on a host without them"
  [ -f "$(server_env_of "$region")" ] || die "$(server_env_of "$region") not found"

  log "Creating the proxy network and the database volume"
  local network
  network="$(proxy_network_of "$region")"
  docker network inspect "$network" > /dev/null 2>&1 || docker network create "$network" > /dev/null
  docker volume create "$volume" > /dev/null

  log "Creating the containers of cell $region (none starts)"
  cell_compose "$region" create

  log "Restoring the uploads"
  docker run --rm -i -v "${project}_uploads:/data" --entrypoint tar "$(db_image "$region")" \
    -C /data -xzf - < "$dir/uploads.tar.gz"

  log "Starting the db only"
  cell_compose "$region" up -d --wait db

  local user db
  user="$(db_env "$region" POSTGRES_USER)"
  db="$(db_env "$region" POSTGRES_DB)"

  log "Restoring the database"
  cell_compose "$region" exec -T db \
    pg_restore -U "$user" -d "$db" --no-owner --no-privileges --exit-on-error < "$dir/db.dump"

  log "Comparing the row counts with the backup"
  local after
  after="$(mktemp)"
  exact_counts "$region" "$user" "$db" > "$after"
  if ! diff -u "$dir/counts.txt" "$after"; then
    rm -f "$after"
    die "row counts differ: do not start the cell. The db of cell $region still runs."
  fi
  rm -f "$after"
  echo "  OK: $(wc -l < "$dir/counts.txt") tables, every count matches"

  # One statement, so the sessions and the links end together or not at all.
  log "Ending the sessions and the pending one-time links of the backup"
  cell_compose "$region" exec -T db psql -U "$user" -d "$db" -v ON_ERROR_STOP=1 -At -c "
    with sessions as (delete from refresh_tokens returning 1),
    links as (
      update users set password_reset_token = null, password_reset_expires_at = null,
        pending_email = null, pending_email_token = null, pending_email_expires_at = null
      where password_reset_token is not null or pending_email_token is not null
      returning 1)
    select format('  %s refresh tokens deleted, %s users lost a pending link',
      (select count(*) from sessions), (select count(*) from links))"

  # The purpose tokens minted before the restore carry no session row, and
  # their single-use ledger was in the Redis of the old cell.
  local server_env min_iat
  server_env="$(server_env_of "$region")"
  min_iat="$(date +%s)"
  set_env_value JWT_MIN_IAT "$min_iat" "$server_env"
  echo "  JWT_MIN_IAT=$min_iat in $server_env"
  echo
  echo "Every user signs in again. A password, factor or email change made after"
  echo "$(env_value created "$dir/manifest") (the backup time) is reverted."
  echo "Next: scripts/cell.sh compose $region up -d --wait, then check it before any DNS change."
}

self_test() {
  local root failures=0
  root="$(mktemp -d)"
  trap 'rm -rf "$root"' RETURN

  expect() {
    local want="$1" name="$2"
    shift 2
    local got=pass
    ("$@") > /dev/null 2>&1 || got=refuse
    if [ "$got" != "$want" ]; then
      echo "cell: self-test FAILED: $name (want $want, got $got)" >&2
      failures=$((failures + 1))
    fi
  }

  good_ru() {
    mkdir -p "$root/cells/ru/server"
    : > "$root/cells/ru/server/.env"
    printf '%s\n' 'CELL="ru"' CLIENT_HOST_PORT=4201 DB_NAME=nexus DB_USER=nexus \
      DB_PASSWORD=secret GRAFANA_ADMIN_PASSWORD=secret > "$root/cells/ru/.env"
  }

  : > "$root/.env"
  expect pass "intl with no CELL" check_cell intl "$root"
  echo CELL=ru > "$root/.env"
  expect refuse "intl .env with CELL" check_cell intl "$root"
  echo COMPOSE_PROJECT_NAME=nexus > "$root/.env"
  expect refuse "intl .env with COMPOSE_PROJECT_NAME" check_cell intl "$root"

  expect refuse "ru with no env file" check_cell ru "$root"
  good_ru
  expect pass "ru with a complete env file" check_cell ru "$root"
  expect refuse "a region that is not a name" check_cell '../ru' "$root"
  sed -i 's/^CELL=.*/CELL=intl/' "$root/cells/ru/.env"
  expect refuse "ru env file with CELL=intl" check_cell ru "$root"
  good_ru
  sed -i '/^CELL=/d' "$root/cells/ru/.env"
  expect refuse "ru env file with no CELL" check_cell ru "$root"
  good_ru
  echo COMPOSE_PROJECT_NAME=nexus >> "$root/cells/ru/.env"
  expect refuse "ru env file with COMPOSE_PROJECT_NAME" check_cell ru "$root"
  good_ru
  sed -i 's/^CLIENT_HOST_PORT=.*/CLIENT_HOST_PORT=4200/' "$root/cells/ru/.env"
  expect refuse "ru env file with the intl port" check_cell ru "$root"
  good_ru
  sed -i 's/^DB_PASSWORD=.*/DB_PASSWORD=/' "$root/cells/ru/.env"
  expect refuse "ru env file with an empty DB_PASSWORD" check_cell ru "$root"
  good_ru
  rm "$root/cells/ru/server/.env"
  expect refuse "ru with no server env file" check_cell ru "$root"

  local env_file="$root/server.env"
  printf '%s\n' A=1 'JWT_MIN_IAT="5"' B=2 ' JWT_MIN_IAT = 6' > "$env_file"
  set_env_value JWT_MIN_IAT 9 "$env_file"
  expect pass "set_env_value replaces each line of the key" \
    test "$(cat "$env_file")" = "$(printf '%s\n' A=1 B=2 JWT_MIN_IAT=9)"
  printf 'A=1' > "$env_file"
  set_env_value JWT_MIN_IAT 9 "$env_file"
  expect pass "set_env_value appends to a file with no final newline" \
    test "$(cat "$env_file")" = "$(printf '%s\n' A=1 JWT_MIN_IAT=9)"

  [ "$failures" -eq 0 ] || exit 1
  echo "cell: self-test OK"
}

if [ "${1:-}" = --self-test ]; then
  self_test
  exit 0
fi

[ $# -ge 2 ] || die "usage: $0 {compose|backup|restore} <region> ... | --self-test"
command="$1"
region="$2"
shift 2

cd "$(dirname "$0")/.."
check_cell "$region" .

case "$command" in
  compose) cell_compose "$region" "$@" ;;
  backup) cmd_backup "$region" "$@" ;;
  restore) cmd_restore "$region" "$@" ;;
  *) die "unknown command '$command'" ;;
esac
