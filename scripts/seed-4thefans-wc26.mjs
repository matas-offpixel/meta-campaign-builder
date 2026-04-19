// scripts/seed-4thefans-wc26.mjs
//
// Seed the 4theFans client + the World Cup 2026 group-stage FanPark
// event set (15 venues) for user b3ee4e5c-44e6-4684-acf6-efefbecd5858
// (hello@offpixel.co.uk).
//
// Source of truth: MASTER tab of Matas's WC26 ad-pacing spreadsheet
// (not checked into the repo). Capacities = Total Cap (venue cap × 3
// group games) from MASTER!row 7. budget_marketing = Min Budget from
// MASTER!row 35 (Matas's "current pace"; ceiling is Max Budget in
// row 34, ~1.46× higher).
//
// Strategy (mirrors scripts/seed-junction2.mjs):
//   1. Upsert the 4theFans client by (user_id, slug). If a row already
//      exists, preserve its id; otherwise insert fresh. Meta / TikTok /
//      Google IDs are left null — Matas wires those via the Clients UI.
//   2. For the 15 events, query existing rows by slug first. Skip any
//      that already exist (no overwrite). Insert the rest in one batch.
//   3. One venue is deliberately held back (commented-out below):
//      Margate (zero budget + missing capacity). Reported in the ship
//      summary. Ministry of Sound is NOT included — it is externally
//      promoted, not an Off Pixel campaign.
//
// Run with:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-4thefans-wc26.mjs
//
// Dry run (logs intended rows + exits before any write):
//   DRY_RUN=1 NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-4thefans-wc26.mjs

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const DRY_RUN = process.env.DRY_RUN === '1'

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Constants ────────────────────────────────────────────────────────────
const USER_ID = 'b3ee4e5c-44e6-4684-acf6-efefbecd5858'

const CLIENT_ROW = {
  user_id: USER_ID,
  name: '4theFans',
  slug: '4thefans',
  primary_type: 'promoter',
  types: ['promoter'],
  status: 'active',
  notes:
    'Football FanPark experiences. Phase 1: small-cap Zones across UK + Ireland. Phase 2 (now): World Cup 2026 group-stage FanPark campaigns across 15 UK venues, 3 group games + potential L32 per venue, all under one WC26-<CITY> event code.',
  // Meta / TikTok / Google / social fields intentionally null — Matas
  // wires these via the Clients UI post-seed.
}

// Final group game date per MASTER!A29. Single events.event_date column
// can't represent 3–4 separate game nights, so we use the campaign
// deadline. Per-game dates will be modelled in a future ad_plans slice.
const EVENT_DATE = '2026-06-27'

const BASE_NOTES =
  'WC26 group-stage FanPark campaign. 3 group games + potential L32 at this venue. Capacity = venue cap × 3 (Total Cap from ad pacing sheet). event_date = 2026-06-27 is the final group game — per-game dates are not modelled yet because events.event_date is a single column. budget_marketing is the Minimum Budget (starting pace); ceiling is ~1.46× (Max Budget).'

const GLASGOW_LEGACY_NOTE =
  ' NOTE: historical ad spend ran under shared campaign names `[WC26-GLASGOW] TRAFFIC ADS / PRESALE / CONVERSION ADS / TEST / LPV` before the venues were split into `[WC26-GLASGOW-SWG3]` and `[WC26-GLASGOW-O2]`. The insights aggregator wraps event_code in brackets at query time, so this event will only capture post-split spend. Pre-split shared spend needs a manual legacy-cost overlay — follow-up slice.'

// Same architectural problem as Glasgow: the 4 London venues all carry
// venue-specific event_codes (`WC26-LONDON-KENTISH` / `-SHEPHERDS` /
// `-SHOREDITCH` / `-TOTTENHAM`) but historical + ongoing shared spend
// runs under `[WC26-LONDON]`. The bracket wrap is significant — the
// insights aggregator searches for the literal `[<event_code>]`, so
// `[WC26-LONDON]` does NOT collide with `[WC26-LONDON-KENTISH]` etc
// (the closing bracket prevents the prefix match). Result: shared
// spend lands in nobody's report until a manual allocation overlay
// is added.
const LONDON_SHARED_NOTE =
  ' NOTE: historical ad spend for London runs under a shared campaign set coded `[WC26-LONDON]` which is not captured by any venue-specific event_code. That shared spend is to be distributed across this venue + the other 3 London venues (Kentish / Shepherds / Shoreditch / Tottenham). Allocation method TBC — follow-up slice, same bucket as the Glasgow legacy-spend reconciliation.'

const LONDON_EVENT_CODES = new Set([
  'WC26-LONDON-KENTISH',
  'WC26-LONDON-SHEPHERDS',
  'WC26-LONDON-SHOREDITCH',
  'WC26-LONDON-TOTTENHAM',
])

const SHARED_DEFAULTS = {
  user_id: USER_ID,
  event_timezone: 'Europe/London',
  event_date: EVENT_DATE,
  status: 'on_sale', // EB sold out, 2nd release live per MASTER R11–14.
  genres: ['sport', 'football'],
  // announcement_at / presale_at / general_sale_at: null — already live,
  // per Matas's standing rule "no presale dates = assume live, skip
  // presale phase in pacing".
  // event_start_at / ticket_url / signup_url: null — not in source sheet.
}

// ─── Per-venue rows ───────────────────────────────────────────────────────
const VENUES = [
  { name: '4theFans WC26: Birmingham',       slug: '4thefans-wc26-birmingham',       event_code: 'WC26-Birmingham',       venue_name: 'O2 Institute',              venue_city: 'Birmingham',  venue_country: 'England',  capacity: 4500,  budget_marketing: 7687.50 },
  { name: '4theFans WC26: Bournemouth',      slug: '4thefans-wc26-bournemouth',      event_code: 'WC26-Bournemouth',      venue_name: 'O2 Academy',                venue_city: 'Bournemouth', venue_country: 'England',  capacity: 4050,  budget_marketing: 6918.75 },
  { name: '4theFans WC26: Brighton',         slug: '4thefans-wc26-brighton',         event_code: 'WC26-Brighton',         venue_name: 'Central Park',              venue_city: 'Brighton',    venue_country: 'England',  capacity: 15000, budget_marketing: 25625.00 },
  { name: '4theFans WC26: Bristol',          slug: '4thefans-wc26-bristol',          event_code: 'WC26-Bristol',          venue_name: 'Prospect Building',         venue_city: 'Bristol',     venue_country: 'England',  capacity: 3960,  budget_marketing: 6765.00 },
  { name: '4theFans WC26: London Kentish',   slug: '4thefans-wc26-london-kentish',   event_code: 'WC26-LONDON-KENTISH',   venue_name: 'Kentish Town Forum',        venue_city: 'London',      venue_country: 'England',  capacity: 6900,  budget_marketing: 11787.50 },
  { name: '4theFans WC26: London Shepherds', slug: '4thefans-wc26-london-shepherds', event_code: 'WC26-LONDON-SHEPHERDS', venue_name: "O2 Shepherd's Bush Empire", venue_city: 'London',      venue_country: 'England',  capacity: 3015,  budget_marketing: 5150.625 },
  { name: '4theFans WC26: London Shoreditch',slug: '4thefans-wc26-london-shoreditch',event_code: 'WC26-LONDON-SHOREDITCH',venue_name: 'Shoreditch',                venue_city: 'London',      venue_country: 'England',  capacity: 3120,  budget_marketing: 5330.00 },
  { name: '4theFans WC26: London Tottenham', slug: '4thefans-wc26-london-tottenham', event_code: 'WC26-LONDON-TOTTENHAM', venue_name: 'Tottenham',                 venue_city: 'London',      venue_country: 'England',  capacity: 3528,  budget_marketing: 6027.00 },
  { name: '4theFans WC26: Leeds',            slug: '4thefans-wc26-leeds',            event_code: 'WC26-LEEDS',            venue_name: 'O2 Academy',                venue_city: 'Leeds',       venue_country: 'England',  capacity: 5790,  budget_marketing: 9891.25 },
  { name: '4theFans WC26: Manchester',       slug: '4thefans-wc26-manchester',       event_code: 'WC26-MANCHESTER',       venue_name: 'Depot Mayfield',            venue_city: 'Manchester',  venue_country: 'England',  capacity: 12000, budget_marketing: 20500.00 },
  { name: '4theFans WC26: Newcastle',        slug: '4thefans-wc26-newcastle',        event_code: 'WC26-NEWCASTLE',        venue_name: 'O2 City Hall',              venue_city: 'Newcastle',   venue_country: 'England',  capacity: 6000,  budget_marketing: 10250.00 },
  { name: '4theFans WC26: Aberdeen',         slug: '4thefans-wc26-aberdeen',         event_code: 'WC26-ABERDEEN',         venue_name: 'The Priory',                venue_city: 'Aberdeen',    venue_country: 'Scotland', capacity: 3240,  budget_marketing: 5535.00 },
  { name: '4theFans WC26: Edinburgh',        slug: '4thefans-wc26-edinburgh',        event_code: 'WC26-EDINBURGH',        venue_name: 'The Pitt',                  venue_city: 'Edinburgh',   venue_country: 'Scotland', capacity: 3966,  budget_marketing: 6775.25 },
  { name: '4theFans WC26: Glasgow SWG3',     slug: '4thefans-wc26-glasgow-swg3',     event_code: 'WC26-GLASGOW-SWG3',     venue_name: 'SWG3',                      venue_city: 'Glasgow',     venue_country: 'Scotland', capacity: 4080,  budget_marketing: 6970.00 },
  { name: '4theFans WC26: Glasgow O2',       slug: '4thefans-wc26-glasgow-o2',       event_code: 'WC26-GLASGOW-O2',       venue_name: 'O2 Academy Glasgow',        venue_city: 'Glasgow',     venue_country: 'Scotland', capacity: 6750,  budget_marketing: 11531.25 },

  // ── Held back — uncomment once Matas confirms ─────────────────────────
  // Margate: Drill Shed. Source sheet has Max Budget = £0 and Min
  // Budget = £0, no capacity in MASTER row 7. Confirm whether this
  // venue is actually running before inserting.
  // {
  //   name: '4theFans WC26: Margate',
  //   slug: '4thefans-wc26-margate',
  //   event_code: 'WC26-Margate',
  //   venue_name: 'Drill Shed',
  //   venue_city: 'Margate',
  //   venue_country: 'England',
  //   capacity: null,
  //   budget_marketing: 0,
  // },
  //
  // Ministry of Sound is intentionally excluded from this seed — the
  // venue is externally promoted, not an Off Pixel campaign. Do not
  // add it back without confirmation that ownership has changed.
]

const HELD_BACK = [
  {
    intended_code: 'WC26-Margate',
    venue: 'Drill Shed, Margate',
    reason:
      'Source sheet has Max Budget = £0, Min Budget = £0, and no capacity in MASTER row 7. Confirm with Matas whether this venue is actually running before inserting.',
  },
]

// ─── Build event rows ─────────────────────────────────────────────────────
function buildEventRow(venue, clientId) {
  const isGlasgow =
    venue.event_code === 'WC26-GLASGOW-SWG3' ||
    venue.event_code === 'WC26-GLASGOW-O2'
  const isLondon = LONDON_EVENT_CODES.has(venue.event_code)
  let notes = BASE_NOTES
  if (isGlasgow) notes += GLASGOW_LEGACY_NOTE
  if (isLondon) notes += LONDON_SHARED_NOTE
  return {
    ...SHARED_DEFAULTS,
    ...venue,
    client_id: clientId,
    notes,
  }
}

// ─── DRY RUN short-circuit ────────────────────────────────────────────────
if (DRY_RUN) {
  // Build with placeholder client_id so the shape is inspectable without
  // touching the database.
  const placeholderClientId = '<client_id-from-upsert>'
  console.log(
    JSON.stringify(
      {
        dry_run: true,
        client: CLIENT_ROW,
        events: VENUES.map((v) => buildEventRow(v, placeholderClientId)),
        held_back: HELD_BACK,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

// ─── 1. Upsert the 4theFans client ────────────────────────────────────────
const { data: existingClient, error: existingClientErr } = await supabase
  .from('clients')
  .select('id')
  .eq('user_id', USER_ID)
  .eq('slug', CLIENT_ROW.slug)
  .maybeSingle()
if (existingClientErr) throw existingClientErr

const { data: clientRow, error: clientErr } = await supabase
  .from('clients')
  .upsert(CLIENT_ROW, { onConflict: 'user_id,slug' })
  .select('id, name, slug')
  .single()
if (clientErr) throw clientErr

const clientAction = existingClient ? 'updated' : 'created'

// ─── 2. Insert events, skipping any that already exist by slug ────────────
const slugs = VENUES.map((v) => v.slug)

const { data: existingEvents, error: existingEventsErr } = await supabase
  .from('events')
  .select('slug')
  .eq('user_id', USER_ID)
  .in('slug', slugs)
if (existingEventsErr) throw existingEventsErr

const existingSlugs = new Set((existingEvents ?? []).map((e) => e.slug))
const skippedExisting = VENUES.filter((v) => existingSlugs.has(v.slug)).map(
  (v) => ({ slug: v.slug, reason: 'already exists under user' }),
)

const newRows = VENUES.filter((v) => !existingSlugs.has(v.slug)).map((v) =>
  buildEventRow(v, clientRow.id),
)

let insertedRows = []
if (newRows.length > 0) {
  const { data, error: insertErr } = await supabase
    .from('events')
    .insert(newRows)
    .select(
      'id, name, slug, event_code, event_date, capacity, budget_marketing',
    )
  if (insertErr) throw insertErr
  insertedRows = data ?? []
}

// ─── Report ───────────────────────────────────────────────────────────────
console.log(
  JSON.stringify(
    {
      client: {
        id: clientRow.id,
        name: clientRow.name,
        slug: clientRow.slug,
        action: clientAction,
      },
      events: {
        created: insertedRows.map((r) => ({
          id: r.id,
          name: r.name,
          slug: r.slug,
          event_code: r.event_code,
          event_date: r.event_date,
          capacity: r.capacity,
          budget_marketing: r.budget_marketing,
        })),
        skipped_existing: skippedExisting,
        held_back: HELD_BACK,
      },
    },
    null,
    2,
  ),
)
