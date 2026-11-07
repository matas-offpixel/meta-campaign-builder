<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Single Next.js 16 app (Campaign Builder wizard + an agency reporting dashboard) backed by Supabase. Standard scripts live in `package.json`: `npm run dev`, `npm run build`, `npm run lint`, `npm test`. The cloud update script runs `npm install` only.

### Node
Use Node 22.22.2 via nvm (`nvm use 22.22.2`) for `dev`/`build`/`test` — `package.json` requires `^22.17.0`. The VM's default `node` on PATH (`/exec-daemon/node`, 22.14) still runs everything but prints `EBADENGINE` warnings.

### Running / testing the app needs a local Supabase backend
`proxy.ts` calls Supabase auth on every request, so **no page renders without `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`**, and auth is invite-only (no UI signup). Stand up a fully-local backend with **`bash scripts/dev-local-supabase.sh`** (idempotent), then `npm run dev` and log in at `/login` with `dev@offpixel.test` / `devpassword123`. The script writes `.env.local` and provisions that user.

Prereqs the script needs (install once per VM; not part of the update script):
- Docker engine, started manually: `sudo nohup dockerd >/tmp/dockerd.log 2>&1 &` then `sudo chmod 666 /var/run/docker.sock`. Docker 29 requires fuse-overlayfs with the containerd-snapshotter feature disabled (`/etc/docker/daemon.json`: `{"storage-driver":"fuse-overlayfs","features":{"containerd-snapshotter":false}}`) plus iptables-legacy.
- The `supabase` CLI on PATH (install the full release tarball — it ships both `supabase` and `supabase-go`; extracting only `supabase` fails).

Do **not** let `supabase start` auto-apply `supabase/migrations/*` from an empty DB — those incremental files assume an existing base and error out (e.g. `002` needs a helper function; several `068x` files are skipped for the filename pattern). The reliable source of truth is the consolidated dump `supabase/schema.sql`; the script loads it and `GRANT`s the `anon`/`authenticated`/`service_role` roles (the dump has no grants/RLS, and the app filters by `user_id` in code rather than relying on RLS).

### Local testing scope / gotchas
- Demonstrable end-to-end locally: log in → create a Client → create a Campaign (a minimal Event is required inline) → the wizard `Save Draft` persists to `campaign_drafts`.
- The wizard's Account Setup (step 1) blocks `Continue` until a Meta ad account is connected (real Facebook OAuth), so the full publish/launch flow is **not** testable locally without Meta credentials. All other integrations (TikTok, Google Ads, Mailchimp, Dropbox, Eventbrite, Anthropic) are feature-gated and only error when their specific feature is used.
- `npm run lint` and `npm test` have pre-existing failures unrelated to setup: lint reports repo errors/warnings, and ~13 tests fail with `Cannot find package '@/lib'` because the `node --experimental-strip-types` test runner doesn't resolve the `@/` tsconfig path alias. The other ~2293 tests pass.
