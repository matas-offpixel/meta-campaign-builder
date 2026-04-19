// scripts/backfill-key-moments.mjs
//
// Backfill source='auto' rows in event_key_moments for the 5 Junction 2
// Bridge events. Idempotent: deletes existing source='auto' rows for
// each event before re-seeding, so it's safe to re-run after the
// migration is applied without producing duplicates. Manual rows are
// preserved (delete is scoped to source='auto').
//
// Mirrors lib/db/event-key-moments.ts:regenerateAutoMoments — kept
// here as a small inline copy so the script doesn't need to import
// from a TypeScript module via tsx (no new deps).
//
// Run with:
//   node --env-file=.env.local scripts/backfill-key-moments.mjs

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
  )
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── Targets ─────────────────────────────────────────────────────────────────
//
// The 5 Junction 2 Bridge events. Pulled from the previous seed pass.
// Labels mirror lib/db/event-key-moments.ts:AUTO_PHASE_MOMENTS.

const EVENT_IDS = [
  'a3dbf7df-63a6-4737-b2f7-977efe370223', // J2 x Fabric
  '42b5673a-aef4-402d-8855-9ca5339046a7', // J2 Melodic
  'a87b3cbb-1871-498e-bce4-abc611d6d515', // Effy x Mall Grab — Fragrance
  '4b7e5668-b020-4d63-809a-a28480a02064', // Innervisions
  '8fbb27c6-a9ce-4741-a34b-b06967bc9ce5', // J2 Hard Techno
]

const AUTO_PHASE_MOMENTS = [
  { offsetDays: 90, label: '3 months to go' },
  { offsetDays: 60, label: '2 months to go' },
  { offsetDays: 30, label: '1 month to go' },
  { offsetDays: 14, label: '2 weeks to go' },
  { offsetDays: 10, label: '10 days to go' },
  { offsetDays: 7, label: '1 week to go' },
  { offsetDays: 3, label: '3 days to go' },
  { offsetDays: 0, label: 'Event Day' },
]

// ─── Date helpers (local-tz, mirror lib/dashboard/pacing.ts) ────────────────

function parseLocalDate(ymd) {
  return new Date(ymd + 'T00:00:00')
}

function fmtLocalDate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isoToYmd(iso) {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return fmtLocalDate(d)
}

function computeAutoMoments(eventDateIso) {
  const ymd = isoToYmd(eventDateIso)
  if (!ymd) return []
  const eventDay = parseLocalDate(ymd)
  return AUTO_PHASE_MOMENTS.map((m) => {
    const d = new Date(eventDay)
    d.setDate(d.getDate() - m.offsetDays)
    return { moment_date: fmtLocalDate(d), label: m.label }
  })
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const report = []

for (const eventId of EVENT_IDS) {
  const { data: evt, error: evtErr } = await supabase
    .from('events')
    .select('id, name, user_id, event_date')
    .eq('id', eventId)
    .single()
  if (evtErr) {
    report.push({ event_id: eventId, error: evtErr.message })
    continue
  }

  // Wipe existing auto rows so the backfill is idempotent. Manual rows
  // (source='manual') are untouched — same contract regenerateAutoMoments
  // gives the live app.
  const { error: delErr } = await supabase
    .from('event_key_moments')
    .delete()
    .eq('event_id', eventId)
    .eq('source', 'auto')
  if (delErr) {
    report.push({ event_id: eventId, name: evt.name, error: delErr.message })
    continue
  }

  if (!evt.event_date) {
    report.push({
      event_id: eventId,
      name: evt.name,
      inserted: 0,
      note: 'event_date is null; nothing to seed',
    })
    continue
  }

  const moments = computeAutoMoments(evt.event_date)
  const rows = moments.map((m) => ({
    user_id: evt.user_id,
    event_id: eventId,
    moment_date: m.moment_date,
    label: m.label,
    category: 'phase',
    source: 'auto',
    budget_multiplier: null,
  }))

  const { data: inserted, error: insErr } = await supabase
    .from('event_key_moments')
    .insert(rows)
    .select('id, moment_date, label')

  if (insErr) {
    report.push({ event_id: eventId, name: evt.name, error: insErr.message })
    continue
  }

  report.push({
    event_id: eventId,
    name: evt.name,
    event_date: evt.event_date,
    inserted: inserted?.length ?? 0,
    moments: inserted,
  })
}

const totalInserted = report.reduce((sum, r) => sum + (r.inserted ?? 0), 0)

console.log(
  JSON.stringify(
    {
      events_processed: report.length,
      total_auto_moments_inserted: totalInserted,
      expected: EVENT_IDS.length * AUTO_PHASE_MOMENTS.length,
      per_event: report,
    },
    null,
    2,
  ),
)
