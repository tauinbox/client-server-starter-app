#!/usr/bin/env bash
#
# Sync production credentials from CI-injected environment variables into the
# VPS env files. The source of truth for these keys is GitHub repository
# secrets; this script makes the on-disk server/.env (and root .env for
# DB_PASSWORD) a DERIVED artifact, so a from-scratch VPS rebuild restores them
# instead of silently losing email / auth / DB access.
#
# Run from the deploy checkout root (where docker-compose.yml lives), with the
# managed keys exported as environment variables (the deploy workflow passes
# them via appleboy/ssh-action `envs:` from `${{ secrets.* }}`).
#
# Rules:
#   - Each key is written ONLY when its env var is non-empty; otherwise the
#     existing on-disk value is preserved. This makes the script safe to run
#     before a secret has been populated (it is a no-op for that key).
#   - Keys NOT listed here are never touched: JWT_MIN_IAT and JWT_ALGORITHM
#     (managed by rotate-keys.yml), and all non-secret config (CLIENT_URL,
#     CORS_ORIGINS, OAuth client IDs, ADMIN_EMAIL, pool/log settings, ...).
#   - DB_PASSWORD must equal the password the postgres data volume was
#     initialized with — rotating it requires changing it inside postgres too,
#     not just here. It is mirrored into root .env for the `db` service.
#
set -euo pipefail

SERVER_ENV="${SERVER_ENV:-server/.env}"
ROOT_ENV="${ROOT_ENV:-.env}"

# upsert KEY VALUE FILE — replace or append `KEY=VALUE`; no-op when VALUE empty.
upsert() {
  local key="$1" val="$2" file="$3"
  [ -z "$val" ] && return 0
  touch "$file"
  local tmp="${file}.tmp.$$"
  grep -v "^${key}=" "$file" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$file"
}

# --- managed secret keys (server/.env) ---
upsert JWT_PRIVATE_KEY        "${JWT_PRIVATE_KEY:-}"        "$SERVER_ENV"
upsert JWT_PUBLIC_KEY         "${JWT_PUBLIC_KEY:-}"         "$SERVER_ENV"
upsert DB_PASSWORD            "${DB_PASSWORD:-}"            "$SERVER_ENV"
upsert GOOGLE_CLIENT_SECRET   "${GOOGLE_CLIENT_SECRET:-}"   "$SERVER_ENV"
upsert FACEBOOK_CLIENT_SECRET "${FACEBOOK_CLIENT_SECRET:-}" "$SERVER_ENV"
upsert VK_CLIENT_SECRET       "${VK_CLIENT_SECRET:-}"       "$SERVER_ENV"
upsert EXTERNAL_API_TOKEN     "${EXTERNAL_API_TOKEN:-}"     "$SERVER_ENV"
upsert ADMIN_PASSWORD         "${ADMIN_PASSWORD:-}"         "$SERVER_ENV"
upsert SMTP_HOST              "${SMTP_HOST:-}"              "$SERVER_ENV"
upsert SMTP_PORT              "${SMTP_PORT:-}"              "$SERVER_ENV"
upsert SMTP_USER              "${SMTP_USER:-}"              "$SERVER_ENV"
upsert SMTP_PASS              "${SMTP_PASS:-}"              "$SERVER_ENV"
upsert SMTP_FROM              "${SMTP_FROM:-}"              "$SERVER_ENV"

# DB_PASSWORD also feeds the postgres `db` service via root .env — keep in sync.
upsert DB_PASSWORD            "${DB_PASSWORD:-}"            "$ROOT_ENV"

[ -f "$SERVER_ENV" ] && chmod 600 "$SERVER_ENV"
[ -f "$ROOT_ENV" ]   && chmod 600 "$ROOT_ENV"

echo "sync-prod-env: applied managed keys (non-empty only) to ${SERVER_ENV} and ${ROOT_ENV}"
