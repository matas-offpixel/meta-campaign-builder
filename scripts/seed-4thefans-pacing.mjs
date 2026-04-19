// scripts/seed-4thefans-pacing.mjs
//
// Seed ad_plans + ad_plan_days for the 15 4theFans WC26 group-stage
// FanPark events from the master pacing sheet (scripts/data/
// 4thefans_wc26_pacing.json). Mirrors scripts/seed-junction2.mjs and
// scripts/seed-4thefans-wc26.mjs in shape: service-role client,
// hardcoded USER_ID, JSON report, DRY_RUN=1 support, idempotent
// (skips events that already have an ad_plan, never overwrites).
//
// Inputs per event (14 weekly entries each, week 1 W/C 2026-04-13):
//   { week_start, phase_marker, daily_budget, weekly_budget,
//     total_forecast, budget_remaining }
//
// Plan derivation:
//   - name           = `${event.name} — WC26 pacing`
//   - start_date     = week 1 Monday (2026-04-13)
//   - end_date       = Sunday of the LAST week with daily_budget > 0
//                      (i.e. last_active.week_start + 6 days). Tail
//                      weeks 12–14 with 0 budget are intentionally
//                      dropped via this trim.
//   - legacy_spend   = round2(week1.total_forecast - week1.weekly_budget),
//                      null if <= 0. This captures pre-plan ad spend
//                      that ran before the master pacing window opened.
//   - total_budget   = event.budget_marketing (reused, NOT recomputed)
//   - status         = 'draft'
//   - landing_page_url = null (filled in the plan UI)
//
// ad_plan_days (one row per day in [start_date, end_date]):
//   - objective_budgets = { traffic: weekly_daily_budget } when the
//     week's daily_budget > 0, else `{}` (empty jsonb). Default
//     objective is traffic for every day; per-day traffic/conversion
//     splits are made in the plan UI.
//   - phase_marker      = ONLY on the Monday of each week (day ===
//                         week_start), null otherwise. Source = the
//                         week's phase_marker from the JSON.
//   - allocation_pct    = null
//   - tickets_sold_cumulative = null
//   - notes             = null
//
// Sanity check (fatal if any event fails):
//   sum(daily_budget across days) === sum(weekly_budget across active
//   weeks) modulo 1p of rounding. Bails the entire run before any
//   write if any event mismatches.
//
// Notes on specific events:
//   - WC26-GLASGOW-SWG3: daily_budget > 0 only in week 11 (2026-06-22).
//     Intentional — reflects the [WC26-GLASGOW] legacy shared-spend
//     situation flagged in the 4theFans seed (insights aggregator
//     wraps event_code in brackets, so [WC26-GLASGOW] does not match
//     [WC26-GLASGOW-SWG3] / [WC26-GLASGOW-O2]). Plan still spans
//     2026-04-13 → 2026-06-28 with empty days for the inactive weeks.
//   - The 4 London venues (KENTISH/SHEPHERDS/SHOREDITCH/TOTTENHAM)
//     have an analogous shared-spend issue under [WC26-LONDON] — not
//     handled here, follow-up cost-allocation overlay slice.
//
// Event lookup is case-insensitive on event_code: the first 4 venues
// were inserted as Title-case (`WC26-Birmingham`) and the rest as
// UPPERCASE; the JSON keys are all UPPERCASE.
//
// Run:
//   DRY_RUN=1 NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-4thefans-pacing.mjs
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/seed-4thefans-pacing.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
const CLIENT_SLUG = '4thefans'

const PLAN_NOTES =
  'Seeded from scripts/data/4thefans_wc26_pacing.json (master WC26 pacing sheet, weekly granularity expanded to one ad_plan_days row per day). Default objective is traffic for every day — per-day traffic/conversion splits are made in the plan UI. legacy_spend captures pre-plan ad spend that ran before this window opened (week-1 total_forecast minus week-1 weekly_budget).'

// ─── Helpers ──────────────────────────────────────────────────────────────
const round2 = (n) => Math.round(n * 100) / 100

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function buildPlanShape(weeks) {
  const week1 = weeks[0]
  const startDate = week1.week_start

  let lastActiveIdx = -1
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (Number(weeks[i].daily_budget) > 0) {
      lastActiveIdx = i
      break
    }
  }
  // Guard: if every week is 0 (shouldn't happen), keep just week 1
  // and let the empty days speak for themselves.
  const activeWeeks =
    lastActiveIdx >= 0 ? weeks.slice(0, lastActiveIdx + 1) : [week1]
  const lastWeek = activeWeeks[activeWeeks.length - 1]
  const endDate = addDaysIso(lastWeek.week_start, 6)

  const legacyRaw = round2(
    Number(week1.total_forecast) - Number(week1.weekly_budget),
  )
  const legacy_spend = legacyRaw > 0 ? legacyRaw : null

  const days = []
  for (const w of activeWeeks) {
    const daily = Number(w.daily_budget)
    for (let i = 0; i < 7; i++) {
      const dayIso = addDaysIso(w.week_start, i)
      const isMonday = i === 0
      days.push({
        day: dayIso,
        objective_budgets: daily > 0 ? { traffic: daily } : {},
        phase_marker: isMonday ? w.phase_marker ?? null : null,
      })
    }
  }

  const dayBudgetSum = round2(
    days.reduce((s, d) => s + Number(d.objective_budgets.traffic ?? 0), 0),
  )
  const weeklyBudgetSum = round2(
    activeWeeks.reduce((s, w) => s + Number(w.weekly_budget), 0),
  )

  return {
    startDate,
    endDate,
    legacy_spend,
    days,
    dayBudgetSum,
    weeklyBudgetSum,
    activeWeekCount: activeWeeks.length,
  }
}

// ─── Load source data ─────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const dataPath = join(__dirname, 'data', '4thefans_wc26_pacing.json')
const data = JSON.parse(readFileSync(dataPath, 'utf8'))
const eventCodes = Object.keys(data)

// ─── Pre-flight: build all shapes + run sanity checks ─────────────────────
const shapes = {}
const sanityFailures = []
for (const code of eventCodes) {
  const shape = buildPlanShape(data[code].weeks)
  shapes[code] = shape
  if (Math.abs(shape.dayBudgetSum - shape.weeklyBudgetSum) > 0.01) {
    sanityFailures.push({
      event_code: code,
      day_budget_sum: shape.dayBudgetSum,
      weekly_budget_sum: shape.weeklyBudgetSum,
      delta: round2(shape.dayBudgetSum - shape.weeklyBudgetSum),
    })
  }
}

if (sanityFailures.length > 0) {
  console.error(
    JSON.stringify(
      { error: 'sanity_check_failed', failures: sanityFailures },
      null,
      2,
    ),
  )
  process.exit(1)
}

// ─── Resolve client + events ──────────────────────────────────────────────
const { data: client, error: clientErr } = await supabase
  .from('clients')
  .select('id, slug, name')
  .eq('user_id', USER_ID)
  .eq('slug', CLIENT_SLUG)
  .maybeSingle()
if (clientErr) throw clientErr
if (!client) {
  throw new Error(
    `4theFans client (user_id=${USER_ID}, slug=${CLIENT_SLUG}) not found`,
  )
}

const { data: clientEvents, error: eventsErr } = await supabase
  .from('events')
  .select('id, name, event_code, slug, budget_marketing')
  .eq('client_id', client.id)
  .eq('user_id', USER_ID)
if (eventsErr) throw eventsErr

const eventByCode = new Map()
for (const e of clientEvents ?? []) {
  if (e.event_code) eventByCode.set(e.event_code.toUpperCase(), e)
}

// ─── Per-event seed ───────────────────────────────────────────────────────
const report = []
let eventsSeeded = 0
let eventsSkipped = 0
let totalDaysInserted = 0

for (const code of eventCodes) {
  const event = eventByCode.get(code.toUpperCase())
  if (!event) {
    report.push({
      event_code: code,
      status: `skipped: event not found under client ${client.slug}`,
    })
    eventsSkipped++
    console.warn(
      `[seed-4thefans-pacing] WARN: event_code ${code} not found under 4theFans — skipping`,
    )
    continue
  }

  const { data: existingPlans, error: existingPlansErr } = await supabase
    .from('ad_plans')
    .select('id')
    .eq('event_id', event.id)
    .eq('user_id', USER_ID)
  if (existingPlansErr) throw existingPlansErr

  if (existingPlans && existingPlans.length > 0) {
    report.push({
      event_code: code,
      event_id: event.id,
      status: `skipped: ${existingPlans.length} ad_plan(s) already exist (${existingPlans
        .map((p) => p.id)
        .join(', ')})`,
    })
    eventsSkipped++
    continue
  }

  const shape = shapes[code]
  const planRow = {
    user_id: USER_ID,
    event_id: event.id,
    name: `${event.name} — WC26 pacing`,
    status: 'draft',
    total_budget: event.budget_marketing,
    legacy_spend: shape.legacy_spend,
    landing_page_url: null,
    start_date: shape.startDate,
    end_date: shape.endDate,
    notes: PLAN_NOTES,
  }

  if (DRY_RUN) {
    const traffickedDays = shape.days.filter(
      (d) => Object.keys(d.objective_budgets).length > 0,
    ).length
    const phaseMarkerDays = shape.days.filter((d) => d.phase_marker).length
    report.push({
      event_code: code,
      event_id: event.id,
      event_name: event.name,
      plan: planRow,
      day_count: shape.days.length,
      trafficked_day_count: traffickedDays,
      phase_marker_day_count: phaseMarkerDays,
      total_days_budget: shape.dayBudgetSum,
      sanity_weekly_sum: shape.weeklyBudgetSum,
      first_day_sample: shape.days[0],
      last_day_sample: shape.days[shape.days.length - 1],
    })
    eventsSeeded++
    totalDaysInserted += shape.days.length
    continue
  }

  const { data: insertedPlan, error: planErr } = await supabase
    .from('ad_plans')
    .insert(planRow)
    .select('id')
    .single()
  if (planErr) throw planErr

  const dayRows = shape.days.map((d) => ({
    plan_id: insertedPlan.id,
    user_id: USER_ID,
    day: d.day,
    objective_budgets: d.objective_budgets,
    phase_marker: d.phase_marker,
    allocation_pct: null,
    tickets_sold_cumulative: null,
    notes: null,
  }))

  for (let i = 0; i < dayRows.length; i += 100) {
    const chunk = dayRows.slice(i, i + 100)
    const { error: dayErr } = await supabase
      .from('ad_plan_days')
      .insert(chunk)
    if (dayErr) throw dayErr
  }

  report.push({
    event_code: code,
    event_id: event.id,
    event_name: event.name,
    plan_id: insertedPlan.id,
    start_date: shape.startDate,
    end_date: shape.endDate,
    legacy_spend: shape.legacy_spend,
    day_count: dayRows.length,
    total_days_budget: shape.dayBudgetSum,
  })
  eventsSeeded++
  totalDaysInserted += dayRows.length
}

console.log(
  JSON.stringify(
    {
      dry_run: DRY_RUN,
      client: { id: client.id, slug: client.slug, name: client.name },
      events: report,
      summary: {
        events_seeded: eventsSeeded,
        events_skipped: eventsSkipped,
        total_ad_plan_days_inserted: totalDaysInserted,
      },
    },
    null,
    2,
  ),
)
