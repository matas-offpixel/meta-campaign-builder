// scripts/seed-clients-batch.mjs
//
// Batch-seed five new clients (and their known events) modelled on
// scripts/seed-junction2.mjs:
//
//   - Louder / Parable      (Meta only — ongoing campaigns placeholder event)
//   - Deep House Bible      (LA / NYC / Puglia 2026)
//   - Puzzle                (Brighton open air 2026)
//   - Back Of House Festival (Festival 2026)
//   - Black Butter Records  (TikTok-only client, no events yet)
//
// Run modes (DRY_RUN=1 is the DEFAULT — pass DRY_RUN=0 to actually write):
//
//   # Preview only (no writes):
//   set -a && source .env.local && set +a && \
//     SEED_USER_ID=<owner-uuid> node scripts/seed-clients-batch.mjs
//
//   # Live insert (idempotent — upsert by user_id+slug):
//   set -a && source .env.local && set +a && \
//     SEED_USER_ID=<owner-uuid> DRY_RUN=0 node scripts/seed-clients-batch.mjs
//
// Idempotency:
//   - Clients are upserted by (user_id, slug) — re-running updates fields
//     in place rather than duplicating.
//   - Events are upserted by (user_id, client_id, slug) — same story.
//   - Existing event rows are NEVER force-overwritten on fields the script
//     doesn't know about (we only PATCH the keys we explicitly set).
//
// Manual follow-up after live run:
//   - VERIFY the three Deep House Bible IDs (BM, ad account, pixel) — they
//     were extracted from an Excel cell that may have been in scientific
//     notation, so the trailing digits could be off.
//   - VERIFY which of Puzzle's two ad account IDs is live vs test
//     (1297062077498960 set as primary; 1058599195559790 noted in
//     event/client `notes` for follow-up).
//   - Black Butter Records has NO Meta ad account on purpose; once a
//     TikTok account row is created via Slice 3, link it via the
//     clients.tiktok_account_id FK from migration 018.
//   - Event statuses use the existing enum from migration 003 — the
//     spec asked for status='active' which isn't valid for events
//     (only clients use 'active'), so events default to 'on_sale'.

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
    'Missing SEED_USER_ID env var. Pass the owner user uuid, e.g. SEED_USER_ID=b3ee4e5c-… node scripts/seed-clients-batch.mjs',
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Spec → DB column mapping ───────────────────────────────────────────
//
// The spec uses friendlier names than the live schema. Mapping:
//   meta_business_manager_id → meta_business_id   (per migration 010)
//   meta_account_id          → meta_ad_account_id
//   meta_pixel_id            → meta_pixel_id      (unchanged)
//
// TikTok / Google Ads slice-3/4 FK columns (tiktok_account_id,
// google_ads_account_id) don't exist yet — they land in migration 018.

const CLIENTS = [
  {
    slug: 'louder-parable',
    name: 'Louder / Parable',
    primary_type: 'promoter',
    types: ['promoter'],
    status: 'active',
    instagram_handle: 'parablelondon',
    meta_business_id: '1511422815580007',
    meta_ad_account_id: '1129797095984755',
    meta_pixel_id: '1554272259038141',
    notes: 'Approx 6 shows/month, 700–2500 cap, melodic techno + afro house.',
    events: [
      {
        slug: 'louder-parable-ongoing',
        name: 'Louder / Parable — Ongoing Campaigns',
        capacity: null,
        budget_marketing: null,
        status: 'on_sale',
        notes:
          'Placeholder for ongoing show campaigns (~6 shows/month, 700–2500 cap, melodic techno + afro house). Replace with per-show events as they confirm.',
      },
    ],
  },
  {
    slug: 'deep-house-bible',
    name: 'Deep House Bible',
    primary_type: 'promoter',
    types: ['promoter'],
    status: 'active',
    instagram_handle: 'deephousebible',
    // VERIFY: Excel scientific-notation source — last digits may be off.
    meta_business_id: '678788015898818',
    meta_ad_account_id: '968594768066330',
    meta_pixel_id: '361462699910737',
    notes:
      'Meta IDs extracted from an Excel cell formatted in scientific notation — VERIFY in Business Manager before launching live spend.',
    events: [
      {
        slug: 'dhb-la-2026',
        name: 'Deep House Bible LA',
        venue_name: 'TBC',
        venue_city: 'Los Angeles',
        venue_country: 'USA',
        capacity: 1300,
        budget_marketing: 2000,
        event_date: '2026-06-06',
        status: 'on_sale',
        genres: ['deep house'],
      },
      {
        slug: 'dhb-nyc-2026',
        name: 'Deep House Bible NYC',
        venue_name: 'TBC',
        venue_city: 'New York',
        venue_country: 'USA',
        capacity: 1100,
        budget_marketing: 2000,
        event_date: null, // not provided in spec
        status: 'on_sale',
        genres: ['deep house'],
      },
      {
        slug: 'dhb-puglia-2026',
        name: 'Deep House Bible Puglia',
        venue_name: 'TBC',
        venue_city: 'Puglia',
        venue_country: 'Italy',
        capacity: 1500,
        budget_marketing: 1000,
        event_date: null,
        status: 'on_sale',
        genres: ['deep house'],
      },
    ],
  },
  {
    slug: 'puzzle',
    name: 'Puzzle',
    primary_type: 'promoter',
    types: ['promoter'],
    status: 'active',
    instagram_handle: 'puzzleofficialuk',
    // VERIFY: live vs test. Secondary ad account 1058599195559790 noted
    // here so we don't lose the alternate id.
    meta_ad_account_id: '1297062077498960',
    meta_pixel_id: '1067726194205285',
    notes:
      'Two ad accounts in play: primary 1297062077498960, secondary 1058599195559790 (verify live vs test before launching).',
    events: [
      {
        slug: 'puzzle-open-air-brighton-2026',
        name: 'Puzzle Open Air',
        venue_name: 'Black Rock Beach',
        venue_city: 'Brighton',
        venue_country: 'England',
        capacity: 1750,
        budget_marketing: 3500,
        event_date: '2026-04-05',
        status: 'on_sale',
      },
    ],
  },
  {
    slug: 'back-of-house',
    name: 'Back Of House Festival',
    primary_type: 'festival',
    types: ['festival', 'promoter'],
    status: 'active',
    instagram_handle: 'backofhouse.festival',
    meta_business_id: '213577919999601',
    meta_ad_account_id: '210578427',
    meta_pixel_id: '1223094912711117',
    notes:
      'Boutique 3-day festival, ~1hr from London, August 2026. Venue TBC.',
    events: [
      {
        slug: 'boh-festival-2026',
        name: 'Back Of House Festival 2026',
        venue_name: 'TBC',
        venue_city: 'TBC',
        venue_country: 'England',
        capacity: 1500,
        budget_marketing: 700,
        event_date: null,
        status: 'on_sale',
        notes:
          'Boutique 3-day festival, ~1hr from London, August 2026. Replace venue + date once confirmed.',
      },
    ],
  },
  {
    slug: 'black-butter-records',
    name: 'Black Butter Records',
    primary_type: 'brand',
    types: ['brand'],
    status: 'active',
    notes:
      'TikTok awareness campaigns only. No Meta ad account. Link a TikTok account via clients.tiktok_account_id once migration 018 lands.',
    events: [],
  },
]

// ─── Run loop ────────────────────────────────────────────────────────────
const report = []

for (const c of CLIENTS) {
  const { events: eventSpecs, ...clientFields } = c

  const clientPayload = {
    user_id: userId,
    ...clientFields,
  }

  let clientId = null
  let clientAction = 'dry-run'

  if (DRY_RUN) {
    console.log(`[DRY] would upsert client ${c.slug}:`, clientPayload)
  } else {
    // Look up first to decide insert vs update without surfacing a
    // duplicate-key error to the console.
    const { data: existing, error: lookupErr } = await supabase
      .from('clients')
      .select('id')
      .eq('user_id', userId)
      .eq('slug', c.slug)
      .maybeSingle()
    if (lookupErr) throw lookupErr

    if (existing) {
      const { data: updated, error: updErr } = await supabase
        .from('clients')
        .update(clientFields)
        .eq('id', existing.id)
        .select('id')
        .single()
      if (updErr) throw updErr
      clientId = updated.id
      clientAction = 'updated'
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('clients')
        .insert(clientPayload)
        .select('id')
        .single()
      if (insErr) throw insErr
      clientId = inserted.id
      clientAction = 'inserted'
    }
  }

  const eventResults = []
  for (const e of eventSpecs) {
    const eventPayload = {
      user_id: userId,
      client_id: clientId,
      genres: [],
      ...e,
    }

    if (DRY_RUN) {
      console.log(`  [DRY] would upsert event ${e.slug} under ${c.slug}`)
      eventResults.push({ slug: e.slug, action: 'dry-run' })
      continue
    }

    const { data: existing, error: lookupErr } = await supabase
      .from('events')
      .select('id')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .eq('slug', e.slug)
      .maybeSingle()
    if (lookupErr) throw lookupErr

    if (existing) {
      const { error: updErr } = await supabase
        .from('events')
        .update(e)
        .eq('id', existing.id)
      if (updErr) throw updErr
      eventResults.push({ slug: e.slug, id: existing.id, action: 'updated' })
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from('events')
        .insert(eventPayload)
        .select('id')
        .single()
      if (insErr) throw insErr
      eventResults.push({ slug: e.slug, id: inserted.id, action: 'inserted' })
    }
  }

  report.push({
    client_slug: c.slug,
    client_id: clientId,
    client_action: clientAction,
    events: eventResults,
  })
}

console.log('\n────────── SEED REPORT ──────────')
console.log(
  JSON.stringify(
    {
      dry_run: DRY_RUN,
      user_id: userId,
      summary: {
        clients: report.length,
        events: report.reduce((acc, r) => acc + r.events.length, 0),
      },
      clients: report,
    },
    null,
    2,
  ),
)
