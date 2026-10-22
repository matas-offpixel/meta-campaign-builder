#!/usr/bin/env bash
#
# Bring up a fully-local Supabase backend for developing/testing this app.
#
# Why this exists: the app cannot serve any page without a Supabase backend
# (proxy.ts calls supabase auth on every request) and auth is invite-only, so
# real end-to-end testing needs a running Supabase + a provisioned user. This
# script stands one up entirely locally — no cloud project or secrets needed.
#
# It is idempotent: safe to re-run. Requirements (installed once per VM, NOT in
# the cloud update script): Docker engine + the `supabase` CLI on PATH. See
# AGENTS.md "Cursor Cloud specific instructions" for one-time install commands.
#
# After it finishes, start the app with `npm run dev` and log in with the
# printed credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEV_EMAIL="${DEV_EMAIL:-dev@offpixel.test}"
DEV_PASSWORD="${DEV_PASSWORD:-devpassword123}"

# 1. Ensure the Docker daemon is up (Cloud VMs need dockerd started manually).
if ! docker info >/dev/null 2>&1; then
  echo "==> Starting dockerd..."
  sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
fi
docker info >/dev/null 2>&1 || { echo "Docker is not available — install it first (see AGENTS.md)."; exit 1; }
command -v supabase >/dev/null || { echo "supabase CLI not found on PATH (see AGENTS.md)."; exit 1; }

# 2. Initialise the local Supabase config if it does not exist yet.
[ -f supabase/config.toml ] || printf 'n\nn\n' | supabase init

# 3. Start Supabase WITHOUT auto-applying the incremental migrations.
#    The 100+ files in supabase/migrations were written to run on top of an
#    existing production base and fail from an empty DB (e.g. 002 needs a
#    helper function an earlier base provided; several 068x files are skipped
#    for not matching the <timestamp>_name.sql pattern). We instead load the
#    consolidated production schema dump (supabase/schema.sql) in step 4.
if ! supabase status >/dev/null 2>&1; then
  echo "==> Starting Supabase (pulls images on first run)..."
  MOVED=""
  if [ -d supabase/migrations ]; then
    MOVED="/tmp/mc_migrations_off.$$"
    mv supabase/migrations "$MOVED"
  fi
  restore_migrations() { [ -n "$MOVED" ] && [ -d "$MOVED" ] && mv "$MOVED" supabase/migrations || true; }
  trap restore_migrations EXIT
  supabase start
  restore_migrations
  trap - EXIT
else
  echo "==> Supabase already running."
fi

# 4. Load the schema dump + grant the PostgREST roles. Run inside the db
#    container so a host psql client is not required.
DBC="$(docker ps --filter name=supabase_db --format '{{.Names}}' | head -1)"
[ -n "$DBC" ] || { echo "Could not find the supabase_db container."; exit 1; }
echo "==> Loading schema into $DBC ..."
# schema.sql references a custom enum the dump never defined; a permissive
# text domain lets every CREATE TABLE succeed.
docker exec -i "$DBC" psql -U postgres -d postgres -q \
  -c "DROP DOMAIN IF EXISTS additional_spend_category CASCADE; CREATE DOMAIN additional_spend_category AS text;"
docker exec -i "$DBC" psql -U postgres -d postgres -q < supabase/schema.sql || true
docker exec -i "$DBC" psql -U postgres -d postgres -q <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
SQL

# 5. Write .env.local (gitignored) pointing the app at local Supabase.
STATUS_ENV="$(supabase status -o env)"
val() { printf '%s\n' "$STATUS_ENV" | sed -n "s/^$1=\"\\(.*\\)\"\$/\\1/p"; }
API_URL="$(val API_URL)"; ANON="$(val ANON_KEY)"; SERVICE="$(val SERVICE_ROLE_KEY)"
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
EOF
echo "==> Wrote .env.local pointing at $API_URL"

# 6. Provision the invite-only dev user (idempotent — ignores "already exists").
echo "==> Ensuring dev user $DEV_EMAIL exists..."
curl -s -X POST "$API_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DEV_EMAIL\",\"password\":\"$DEV_PASSWORD\",\"email_confirm\":true}" >/dev/null || true

echo ""
echo "Local Supabase is ready."
echo "  Studio:   $(val STUDIO_URL)"
echo "  Login as: $DEV_EMAIL / $DEV_PASSWORD"
echo "  Start the app with: npm run dev   (then open http://localhost:3000)"
