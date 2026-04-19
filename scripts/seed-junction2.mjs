// scripts/seed-junction2.mjs
//
// Seed the Junction 2 client + 5 Bridge-series events for user
// b3ee4e5c-44e6-4684-acf6-efefbecd5858 (hello@offpixel.co.uk).
//
// Source of truth: References/The Bridge_ Ad Access _ Marketing Plans.xlsx
//
// Strategy:
//   1. Rename existing lowercase "junction 2" client → "Junction 2"
//      (preserve id 52093b76-3555-457a-adbd-e434746c15c6 — already linked
//      to the test event).
//   2. Update existing test event a3dbf7df-63a6-4737-b2f7-977efe370223
//      in place to the canonical "Junction 2 x Fabric" record. Its
//      event_date (2026-07-25) and budget (£11,500) already match the
//      spreadsheet, so we keep its 98 attached ad_plan_days untouched.
//   3. Insert 4 new events (Melodic, Fragrance, Innervisions, Hard Techno)
//      under the same client_id + user_id.
//
// Run with:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-junction2.mjs

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Constants pulled from the existing test event + spreadsheet audit ──
const USER_ID = 'b3ee4e5c-44e6-4684-acf6-efefbecd5858'
const CLIENT_ID = '52093b76-3555-457a-adbd-e434746c15c6'
const TEST_EVENT_ID = 'a3dbf7df-63a6-4737-b2f7-977efe370223' // → becomes J2 x Fabric

// Shared venue across all 5 Bridge events. NOTE: task brief said
// "Baston Manor Park" — that is a typo. The actual venue (per the
// marketing plan workbook and Junction 2's public site) is Boston
// Manor Park, west London.
const VENUE = {
  venue_name: 'Boston Manor Park',
  venue_city: 'London',
  venue_country: 'England',
  event_timezone: 'Europe/London',
}

// ─── 1. Update the Junction 2 client ─────────────────────────────────────
const { data: clientRow, error: clientErr } = await supabase
  .from('clients')
  .update({
    name: 'Junction 2',
    slug: 'junction-2',
    primary_type: 'promoter',
    types: ['promoter'],
    status: 'active',
    // Meta / TikTok / Google IDs + handles + drive folder left null —
    // Matas will fill them after the Slice C schema migration.
  })
  .eq('id', CLIENT_ID)
  .select('*')
  .single()
if (clientErr) throw clientErr

// ─── 2. Update the existing test event in place → J2 x Fabric ────────────
const j2Fabric = {
  client_id: CLIENT_ID,
  user_id: USER_ID,
  name: 'Junction 2 x Fabric',
  slug: 'junction-2-x-fabric',
  event_code: 'J2-FAB-2026',
  capacity: 6000,
  // Lineup (per spreadsheet AD ACCESS sheet): Nina Kraviz, Jeff Mills,
  // Marcel Dettmann, DJ Hell, Nicolas Lutz, Francesco Del Garda,
  // Gabrielle Kwarteng, Peach, GiGi FM, Polygonia → minimal/techno.
  genres: ['techno'],
  ...VENUE,
  event_date: '2026-07-25',
  budget_marketing: 11500,
  status: 'on_sale',
  notes:
    'Bridge series 2026. Source: References/The Bridge_ Ad Access _ Marketing Plans.xlsx (sheet "25th July Junction 2 x fabric"). 98 ad_plan_days already attached.',
}

const { data: fabricRow, error: fabricErr } = await supabase
  .from('events')
  .update(j2Fabric)
  .eq('id', TEST_EVENT_ID)
  .select('*')
  .single()
if (fabricErr) throw fabricErr

// ─── 3. Insert the other 4 events ────────────────────────────────────────
//
// All five share venue + capacity + client. Per-event overrides come from
// each sheet's header block (Event Name + Date + Digital Spend) plus
// the artist lineup (used to infer genres). on_sale_date / presale_at /
// announcement_at + ticket price tiers are NOT in the workbook —
// left null and flagged in the report.
const newEvents = [
  {
    name: 'Junction 2: Melodic',
    slug: 'junction-2-melodic',
    event_code: 'J2-MEL-2026',
    event_date: '2026-07-26',
    budget_marketing: 11450,
    // Lineup: Adam Beyer, Miss Monique, Indo Warehouse, Franky Wah,
    // Aaron Hibell, Kasablanca, Henri Bergmann, Tripolism, Carina
    // Lawrence, Mia Aurora.
    genres: ['melodic techno', 'melodic house'],
    notes:
      'Bridge series 2026. Source sheet: "26th July Junction 2 x melodic". Headlined by Adam Beyer’s 10-year J2 anniversary set.',
  },
  {
    name: 'Effy x Mall Grab present Fragrance',
    slug: 'effy-x-mall-grab-fragrance',
    event_code: 'J2-FRG-2026',
    event_date: '2026-07-31',
    budget_marketing: 11939,
    // Lineup: Mall Grab, Effy, Benga, Special Request, Blumitsu (Jossy
    // Mitsu / Bluetoof), Sully, Claire O'brien, David Jackson, DJ
    // Storm, Roni, Tarzsa → UK garage / jungle / breakbeat house.
    genres: ['house', 'uk garage', 'jungle'],
    notes:
      'Bridge series 2026. "Fragrance Open Air" — co-presented by Effy and Mall Grab. Source sheet: "31st July Effy & Mall Grab".',
  },
  {
    name: 'Innervisions',
    slug: 'innervisions-open-air',
    event_code: 'J2-INV-2026',
    event_date: '2026-08-01',
    budget_marketing: 12342,
    // Lineup: Innervisions, Dixon, Howling, Ivory, Jamiie, Julya
    // Karma, Ry X, Sama' Abdulhadi, Trikk, Âme, Jimi Jules → label
    // showcase, melodic house/techno.
    genres: ['melodic house', 'melodic techno'],
    notes:
      'Bridge series 2026. Innervisions label showcase ("Innervisions Open Air"). Source sheet: "1st August Innervisions London".',
  },
  {
    name: 'Junction 2: Hard Techno',
    slug: 'junction-2-hard-techno',
    event_code: 'J2-HT-2026',
    event_date: '2026-08-02',
    budget_marketing: 11500,
    // Lineup: Charlie Sparks, I Hate Models, Funk Tribu, Ammara,
    // Caravel, Leo Pol, Supergloss, LAmmer, Marceldune.
    genres: ['hard techno'],
    notes:
      'Bridge series 2026. Source sheet: "2nd August Junction 2 x Hard Te". Closing weekend of the series.',
  },
].map((e) => ({
  ...e,
  client_id: CLIENT_ID,
  user_id: USER_ID,
  capacity: 6000,
  status: 'on_sale',
  ...VENUE,
  // on_sale / presale / announcement timestamps + ticket URLs not in
  // the workbook header — leave null. See report for missing fields.
}))

const { data: insertedRows, error: insertErr } = await supabase
  .from('events')
  .insert(newEvents)
  .select('id, name, event_date, budget_marketing')
if (insertErr) throw insertErr

// ─── Report ──────────────────────────────────────────────────────────────
console.log(
  JSON.stringify(
    {
      client: { id: clientRow.id, name: clientRow.name, slug: clientRow.slug },
      events: [
        {
          id: fabricRow.id,
          name: fabricRow.name,
          event_date: fabricRow.event_date,
          budget_marketing: fabricRow.budget_marketing,
          note: 'updated in place — 98 ad_plan_days preserved',
        },
        ...insertedRows.map((r) => ({
          id: r.id,
          name: r.name,
          event_date: r.event_date,
          budget_marketing: r.budget_marketing,
          note: 'newly inserted',
        })),
      ],
    },
    null,
    2,
  ),
)
