// scripts/seed-tiktok-accounts.mjs
//
// Seed the two known TikTok ad accounts (Louder + Amaad) into the
// tiktok_accounts table created by migration 016.
//
// The advertiser id and access token are intentionally left null on
// both rows — they get filled in once the OAuth flow + credential
// vault land. With both null the dashboard surfaces these as
// "Not configured" via the TikTok report tab + platform config card,
// which is the correct UX state until the API plumbing is wired up.
//
// Modelled on scripts/seed-clients-batch.mjs:
//   - service-role client (bypasses RLS — required for cross-user inserts)
//   - DRY_RUN=1 default; pass DRY_RUN=0 to actually write
//   - Idempotent upsert by (user_id, account_name) — re-running this
//     script after manually filling in tiktok_advertiser_id WILL NOT
//     overwrite that field because we only patch the keys we set here.
//   - JSON report at the end with the inserted UUIDs
//
// Run modes:
//   # Preview only (no writes — DEFAULT):
//   set -a && source .env.local && set +a && \
//     SEED_USER_ID=<owner-uuid> node scripts/seed-tiktok-accounts.mjs
//
//   # Live insert/update:
//   set -a && source .env.local && set +a && \
//     SEED_USER_ID=<owner-uuid> DRY_RUN=0 node scripts/seed-tiktok-accounts.mjs
//
// Manual follow-ups after live run:
//   - Fill in tiktok_advertiser_id for each row once the OAuth flow
//     surfaces the advertiser id from the TikTok Business API.
//   - Wire the encrypted access token into access_token_encrypted via
//     the credential vault layer (not yet implemented).
//   - Link the account to clients / events:
//       - Louder  → clients.louder-parable.tiktok_account_id
//       - Amaad   → events.junction-2-* (per-event override) once the
//         J2 client is seeded into clients
//   - Re-running this script is safe — existing rows update only the
//     fields we explicitly set (account_name), leaving advertiser id
//     and access token alone.

import { createClient } from '@supabase/supabase-js'

// ─── Env wiring ──────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const userId = process.env.SEED_USER_ID
const DRY_RUN = process.env.DRY_RUN !== '0' // default ON

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (source .env.local first).',
  )
}
if (!userId) {
  throw new Error(
    'Missing SEED_USER_ID env var. Pass the owner user uuid, e.g. SEED_USER_ID=b3ee4e5c-… node scripts/seed-tiktok-accounts.mjs',
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Account spec ────────────────────────────────────────────────────────
//
// Both rows omit tiktok_advertiser_id + access_token_encrypted on
// purpose — see header notes. The unique key on the table is
// (user_id, account_name) so account_name doubles as the idempotency
// handle.

const ACCOUNTS = [
  {
    account_name: 'Louder',
    tiktok_advertiser_id: null,
    notes:
      'Used for Parable / Louder events. Fill advertiser id once OAuth flow lands.',
  },
  {
    account_name: 'Amaad',
    tiktok_advertiser_id: null,
    notes:
      'Used for Junction 2 events. Fill advertiser id once OAuth flow lands.',
  },
]

// ─── Run ─────────────────────────────────────────────────────────────────

const report = []

for (const a of ACCOUNTS) {
  // Notes is local-only — the tiktok_accounts table doesn't carry a
  // notes column (kept narrow on purpose). Strip before payload build.
  const { notes: _notes, ...accountFields } = a
  const accountPayload = {
    user_id: userId,
    ...accountFields,
  }

  let accountId = null
  let action = 'dry-run'

  if (DRY_RUN) {
    console.log(`[DRY] would upsert tiktok_account "${a.account_name}":`, accountPayload)
    if (a.notes) console.log(`      note: ${a.notes}`)
  } else {
    const { data: existing, error: lookupErr } = await supabase
      .from('tiktok_accounts')
      .select('id, tiktok_advertiser_id')
      .eq('user_id', userId)
      .eq('account_name', a.account_name)
      .maybeSingle()
    if (lookupErr) throw lookupErr

    if (existing) {
      // Only update account_name (the only field this script claims
      // ownership of) — leave any manually-filled advertiser id +
      // access token untouched.
      const { data: updated, error: updErr } = await supabase
        .from('tiktok_accounts')
        .update({ account_name: a.account_name })
        .eq('id', existing.id)
        .select('id')
        .single()
      if (updErr) throw updErr
      accountId = updated.id
      action = 'updated'
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('tiktok_accounts')
        .insert(accountPayload)
        .select('id')
        .single()
      if (insErr) throw insErr
      accountId = inserted.id
      action = 'inserted'
    }
  }

  report.push({
    account_name: a.account_name,
    id: accountId,
    action,
  })
}

console.log('\n────────── TIKTOK ACCOUNTS SEED REPORT ──────────')
console.log(
  JSON.stringify(
    {
      dry_run: DRY_RUN,
      user_id: userId,
      summary: { accounts: report.length },
      accounts: report,
    },
    null,
    2,
  ),
)
