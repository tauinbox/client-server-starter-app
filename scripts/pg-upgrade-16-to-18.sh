#!/usr/bin/env bash
#
# PostgreSQL 16 -> 18 gated logical migration (production VPS runbook).
#
# WHY this exists: a major Postgres version cannot read a data directory written
# by an older major. Swapping the image tag in docker-compose.yml while reusing
# the existing volume makes the db container unhealthy — or silently re-inits an
# empty cluster that the app's migrations happily populate, so the deploy looks
# "healthy" while every row is gone. This script does the safe path instead:
# logical dump from the live PG16 with the PG18 client, restore into a brand-new
# volume, verify row counts BEFORE the app ever touches it, and keep the old
# PG16 volume on disk as an instant rollback.
#
# ─── PROCEDURE (run on the VPS, from the deploy checkout: /home/deploy/nexus) ──
#   0. Pause the "Deploy" GitHub workflow (Actions -> Deploy -> Disable) so an
#      unrelated merge can't run `docker compose up` mid-migration.
#   1. ./scripts/pg-upgrade-16-to-18.sh backup    # stops writers, dumps PG16
#   2. ./scripts/pg-upgrade-16-to-18.sh restore   # inits PG18 on the new volume, restores
#   3. ./scripts/pg-upgrade-16-to-18.sh verify    # row-count parity + extensions + checksums
#   4. ./scripts/pg-upgrade-16-to-18.sh finalize  # tear down the temp container
#   5. Bring the new stack up with the PG18 compose (image tag + volume already
#      switched in this branch's docker-compose.yml):
#         git checkout feature/postgres-18-migration -- docker-compose.yml   # or merge first
#         docker compose up -d
#      The entrypoint runs `migration:run` (a no-op — the migrations table came
#      across in the dump) and starts the app against the populated volume.
#   6. Smoke test: /api/health/ready -> db:up, admin login, user search (hits the
#      trigram indexes), confirm an audit_logs row is written.
#   7. Re-enable the "Deploy" workflow and merge the PR (compose now matches VPS).
#   8. After ~1 week stable: drop the old volume — `docker volume rm nexus_postgres_data`.
#
#   ROLLBACK (any time before step 7 is confirmed):
#         ./scripts/pg-upgrade-16-to-18.sh rollback
#      restarts the PG16 stack on the untouched old volume. Writes made on PG18
#      after cutover are lost, so verify fast and keep the window short.
#
set -euo pipefail

# ─── configuration (override via env) ─────────────────────────────────────────
OLD_DB_CONTAINER="${OLD_DB_CONTAINER:-nexus-db-1}"
SERVER_CONTAINER="${SERVER_CONTAINER:-nexus-server-1}"
CLIENT_CONTAINER="${CLIENT_CONTAINER:-nexus-client-1}"
NETWORK="${NETWORK:-nexus_default}"
NEW_VOLUME="${NEW_VOLUME:-nexus_postgres_data_18}"
PG18_IMAGE="${PG18_IMAGE:-postgres:18-alpine}"
TMP_CONTAINER="${TMP_CONTAINER:-pg18-restore-target}"
WORKDIR="${WORKDIR:-$HOME/pg-upgrade}"

DUMP_FILE="$WORKDIR/nexus.dump"
GLOBALS_FILE="$WORKDIR/globals.sql"
COUNTS_BEFORE="$WORKDIR/counts-before.txt"
COUNTS_AFTER="$WORKDIR/counts-after.txt"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Read DB credentials straight from the running PG16 container — no secrets in
# this script and no dependency on which .env happens to be on disk.
read_creds() {
  docker inspect "$OLD_DB_CONTAINER" >/dev/null 2>&1 \
    || die "container '$OLD_DB_CONTAINER' not found — is the PG16 stack running?"
  DB_USER="$(docker exec "$OLD_DB_CONTAINER" printenv POSTGRES_USER)"
  DB_NAME="$(docker exec "$OLD_DB_CONTAINER" printenv POSTGRES_DB)"
  DB_PASSWORD="$(docker exec "$OLD_DB_CONTAINER" printenv POSTGRES_PASSWORD)"
  [ -n "${DB_USER:-}" ] && [ -n "${DB_NAME:-}" ] && [ -n "${DB_PASSWORD:-}" ] \
    || die "could not read POSTGRES_USER/DB/PASSWORD from $OLD_DB_CONTAINER"
}

# Exact per-table row counts for $1 = container name (must run psql as superuser).
exact_counts() {
  local container="$1"
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$container" \
    psql -U "$DB_USER" -d "$DB_NAME" -At -c \
    "select table_schema||'.'||table_name from information_schema.tables
       where table_schema not in ('pg_catalog','information_schema')
         and table_type='BASE TABLE' order by 1" \
  | while IFS= read -r tbl; do
      [ -z "$tbl" ] && continue
      cnt="$(docker exec -e PGPASSWORD="$DB_PASSWORD" "$container" \
        psql -U "$DB_USER" -d "$DB_NAME" -At -c "select count(*) from $tbl")"
      printf '%s %s\n' "$tbl" "$cnt"
    done
}

wait_ready() {
  local container="$1" tries=0
  until docker exec "$container" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -ge 30 ] && die "$container did not become ready in time"
    sleep 2
  done
}

cmd_backup() {
  read_creds
  mkdir -p "$WORKDIR"
  chmod 700 "$WORKDIR"

  log "Stopping writers ($SERVER_CONTAINER, $CLIENT_CONTAINER) for a consistent snapshot"
  docker stop "$SERVER_CONTAINER" "$CLIENT_CONTAINER" >/dev/null 2>&1 || true

  log "Recording exact row counts from PG16 -> $COUNTS_BEFORE"
  exact_counts "$OLD_DB_CONTAINER" | tee "$COUNTS_BEFORE"

  log "Dumping globals (roles) with the PG18 client"
  docker run --rm --network "$NETWORK" -e PGPASSWORD="$DB_PASSWORD" "$PG18_IMAGE" \
    pg_dumpall -h "$OLD_DB_CONTAINER" -U "$DB_USER" --globals-only --no-role-passwords \
    > "$GLOBALS_FILE"

  log "Dumping database '$DB_NAME' (custom format) with the PG18 client"
  docker run --rm --network "$NETWORK" -e PGPASSWORD="$DB_PASSWORD" \
    -v "$WORKDIR:/dump" "$PG18_IMAGE" \
    pg_dump -h "$OLD_DB_CONTAINER" -U "$DB_USER" -d "$DB_NAME" \
    -Fc --no-owner --no-privileges -f /dump/nexus.dump

  log "Backup complete: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
  echo "PG16 stack still running (db only). Next: ./scripts/pg-upgrade-16-to-18.sh restore"
}

cmd_restore() {
  read_creds
  [ -f "$DUMP_FILE" ] || die "dump not found ($DUMP_FILE) — run 'backup' first"

  if docker inspect "$TMP_CONTAINER" >/dev/null 2>&1; then
    log "Removing leftover temp container $TMP_CONTAINER"
    docker rm -f "$TMP_CONTAINER" >/dev/null
  fi

  log "Creating new volume $NEW_VOLUME (idempotent)"
  docker volume create "$NEW_VOLUME" >/dev/null

  log "Starting temp PG18 on $NEW_VOLUME (initializes the cluster, checksums on)"
  docker run -d --name "$TMP_CONTAINER" --network "$NETWORK" \
    -e POSTGRES_USER="$DB_USER" -e POSTGRES_DB="$DB_NAME" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e PGDATA=/var/lib/postgresql/data \
    -e POSTGRES_INITDB_ARGS=--data-checksums \
    -v "$NEW_VOLUME:/var/lib/postgresql/data" \
    -v "$WORKDIR:/dump:ro" \
    "$PG18_IMAGE" >/dev/null

  log "Waiting for PG18 to accept connections"
  wait_ready "$TMP_CONTAINER"

  log "Restoring dump into PG18"
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$TMP_CONTAINER" \
    pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
    --exit-on-error /dump/nexus.dump

  log "Recording exact row counts from PG18 -> $COUNTS_AFTER"
  exact_counts "$TMP_CONTAINER" | tee "$COUNTS_AFTER"

  echo "Restore complete. Next: ./scripts/pg-upgrade-16-to-18.sh verify"
}

cmd_verify() {
  read_creds
  [ -f "$COUNTS_BEFORE" ] && [ -f "$COUNTS_AFTER" ] \
    || die "count files missing — run backup + restore first"

  log "Row-count parity (PG16 vs PG18)"
  if diff -u "$COUNTS_BEFORE" "$COUNTS_AFTER"; then
    echo "  OK — all table counts match"
  else
    die "row counts differ — DO NOT cut over. Investigate the diff above."
  fi

  log "Extensions on PG18"
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$TMP_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -c "\dx"

  log "data_checksums on PG18 (expect: on)"
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$TMP_CONTAINER" \
    psql -U "$DB_USER" -d "$DB_NAME" -At -c "show data_checksums;"

  echo
  echo "Verification passed. Next: ./scripts/pg-upgrade-16-to-18.sh finalize, then 'docker compose up -d'."
}

cmd_finalize() {
  log "Tearing down temp container $TMP_CONTAINER (volume $NEW_VOLUME is kept)"
  docker rm -f "$TMP_CONTAINER" >/dev/null 2>&1 || true
  cat <<EOF

Temp container removed; data lives in volume '$NEW_VOLUME'.

Cut over now:
  git checkout feature/postgres-18-migration -- docker-compose.yml   # or merge the PR first
  docker compose up -d

Then smoke test (/api/health/ready -> db:up, admin login, user search) and
re-enable the Deploy workflow. Keep the old 'nexus_postgres_data' volume for a
week as rollback, then: docker volume rm nexus_postgres_data
EOF
}

cmd_rollback() {
  log "Rolling back to PG16: removing temp PG18 container/volume, restarting writers"
  docker rm -f "$TMP_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$NEW_VOLUME" >/dev/null 2>&1 || true
  docker start "$SERVER_CONTAINER" "$CLIENT_CONTAINER" >/dev/null 2>&1 || true
  echo "PG16 stack restored on the original volume. If you already switched"
  echo "docker-compose.yml, run: git checkout -- docker-compose.yml && docker compose up -d"
}

case "${1:-}" in
  backup)   cmd_backup ;;
  restore)  cmd_restore ;;
  verify)   cmd_verify ;;
  finalize) cmd_finalize ;;
  rollback) cmd_rollback ;;
  *) die "usage: $0 {backup|restore|verify|finalize|rollback}" ;;
esac
