// scripts/ingest-junction2-plans.mjs
//
// Ingest real daily-spend plans for the 5 Junction 2 Bridge events from
// References/The Bridge_ Ad Access _ Marketing Plans.xlsx.
//
// Strategy:
//   - Fabric (existing plan cfe9469f-…cd6a): wipe its ad_plan_days,
//     update plan row's start/end/total/name, re-seed days from sheet.
//   - Other 4: insert fresh ad_plans row, then bulk insert ad_plan_days.
//
// Source sheet daily-section column layout (header at row 22, data 23+):
//   A Sales | B Target | C Key Dates (date serial) | D Note
//   E Ad Allocation (= sum of channel cols, used for verification only)
//   F Total spend (running cumulative, ignored)
//   G Traffic / Signup     → traffic
//   H Conversion           → conversion
//   I Lifetime Conversions → conversion (folded; same campaign objective,
//                            different attribution window)
//   J Reach                → reach
//   K Post Engagement      → post_engagement
//   L Event Response       → all zero in every sheet, skipped
//   M Tiktok               → tiktok
//   N Google               → google
//
// Phase markers (`day.notes`): pulled from col D — sheet annotations
// like "Payday Push", "Easter weekend", "1 month to go" etc.
//
// Run:
//   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//     node scripts/ingest-junction2-plans.mjs

import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const USER_ID = 'b3ee4e5c-44e6-4684-acf6-efefbecd5858'
const XLSX_PATH = 'References/The Bridge_ Ad Access _ Marketing Plans.xlsx'

// (event_id, sheet_name, sheet_xml_filename, label)
const TARGETS = [
  {
    event_id: 'a3dbf7df-63a6-4737-b2f7-977efe370223',
    label: 'Junction 2 x Fabric',
    sheet_xml: 'sheet4.xml',
    existing_plan_id: 'cfe9469f-1aa6-4150-8eb9-79d5effecd6a',
  },
  {
    event_id: '42b5673a-aef4-402d-8855-9ca5339046a7',
    label: 'Junction 2: Melodic',
    sheet_xml: 'sheet2.xml',
    existing_plan_id: null,
  },
  {
    event_id: 'a87b3cbb-1871-498e-bce4-abc611d6d515',
    label: 'Effy x Mall Grab present Fragrance',
    sheet_xml: 'sheet5.xml',
    existing_plan_id: null,
  },
  {
    event_id: '4b7e5668-b020-4d63-809a-a28480a02064',
    label: 'Innervisions',
    sheet_xml: 'sheet6.xml',
    existing_plan_id: null,
  },
  {
    event_id: '8fbb27c6-a9ce-4741-a34b-b06967bc9ce5',
    label: 'Junction 2: Hard Techno',
    sheet_xml: 'sheet3.xml',
    existing_plan_id: null,
  },
]

// ─── XLSX extraction (just unzip + xml parse — avoids new runtime deps
// beyond fast-xml-parser which already ships with the project) ──────────
//
// Actually we don't have fast-xml-parser. Use the Node stdlib + a
// minimal handwritten reader instead. xlsx files are zip archives;
// `unzip` is on macOS by default.

const tmp = mkdtempSync(join(tmpdir(), 'bridge-xlsx-'))
try {
  execSync(`unzip -q -o "${XLSX_PATH}" -d "${tmp}"`)
} catch (e) {
  rmSync(tmp, { recursive: true, force: true })
  throw new Error(`Failed to unzip ${XLSX_PATH}: ${e.message}`)
}

// Load shared strings
function loadSharedStrings(path) {
  const xml = readFileSync(path, 'utf8')
  const out = []
  // Each <si>…</si> may contain multiple <t>…</t> (rich text runs).
  const siRegex = /<si>([\s\S]*?)<\/si>/g
  const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g
  let m
  while ((m = siRegex.exec(xml))) {
    let combined = ''
    let tm
    tRegex.lastIndex = 0
    while ((tm = tRegex.exec(m[1]))) combined += decodeXml(tm[1])
    out.push(combined)
  }
  return out
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

const strings = loadSharedStrings(join(tmp, 'xl', 'sharedStrings.xml'))

function colIdx(letters) {
  let n = 0
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

// Read a worksheet → array of (row index, sparse cell array)
function readSheet(path) {
  const xml = readFileSync(path, 'utf8')
  const rowRegex = /<row\s+([^>]*)>([\s\S]*?)<\/row>/g
  const cellRegex = /<c\s+([^/>]*)(?:\/>|>([\s\S]*?)<\/c>)/g
  const out = []
  let rm
  while ((rm = rowRegex.exec(xml))) {
    const rAttr = rm[1].match(/r="(\d+)"/)
    if (!rAttr) continue
    const rIdx = Number(rAttr[1])
    const inner = rm[2]
    const cells = []
    let cm
    cellRegex.lastIndex = 0
    while ((cm = cellRegex.exec(inner))) {
      const attrs = cm[1]
      const refMatch = attrs.match(/r="([A-Z]+)\d+"/)
      const tMatch = attrs.match(/t="([^"]+)"/)
      if (!refMatch) continue
      const ci = colIdx(refMatch[1])
      const t = tMatch?.[1] ?? ''
      const body = cm[2] ?? ''
      const vMatch = body.match(/<v>([\s\S]*?)<\/v>/)
      let val = ''
      if (vMatch) {
        val = t === 's' ? strings[Number(vMatch[1])] : vMatch[1]
      } else if (t === 'inlineStr') {
        const tInline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)
        if (tInline) val = decodeXml(tInline[1])
      }
      cells[ci] = val
    }
    out.push({ r: rIdx, cells })
  }
  return out
}

// Excel date serial → ISO yyyy-mm-dd, matching seed-junction2.mjs epoch
function excelToIso(serial) {
  const days = Number(serial)
  if (!Number.isFinite(days)) return null
  const d = new Date(Date.UTC(1899, 11, 30))
  d.setUTCDate(d.getUTCDate() + Math.floor(days))
  return d.toISOString().slice(0, 10)
}

function num(cell) {
  if (cell === '' || cell == null) return 0
  const n = Number(cell)
  return Number.isFinite(n) ? n : 0
}

// Parse one sheet → ordered list of day rows with merged channel budgets
function parseDailyTimeline(sheetPath) {
  const rows = readSheet(sheetPath)
  const out = []
  let split = false // true if any sheet has Traffic/Conversion split per day
  for (const { r, cells } of rows) {
    if (r < 23) continue // header is rows 17-22; daily data starts at 23
    const dateRaw = cells[2]
    if (dateRaw == null || dateRaw === '') continue
    const dayIso = excelToIso(dateRaw)
    if (!dayIso) continue

    const traffic = num(cells[6])
    const convH = num(cells[7])
    const convI = num(cells[8]) // Lifetime Conversions → conversion
    const reach = num(cells[9])
    const postEng = num(cells[10]) + num(cells[11]) // Event Resp folded; all zero anyway
    const tiktok = num(cells[12])
    const google = num(cells[13])

    const sum = traffic + convH + convI + reach + postEng + tiktok + google
    if (sum <= 0) continue // skip blank/zero days

    if (traffic > 0 && (convH > 0 || convI > 0)) split = true

    const objective_budgets = {}
    if (traffic > 0) objective_budgets.traffic = round2(traffic)
    const conversion = convH + convI
    if (conversion > 0) objective_budgets.conversion = round2(conversion)
    if (reach > 0) objective_budgets.reach = round2(reach)
    if (postEng > 0) objective_budgets.post_engagement = round2(postEng)
    if (tiktok > 0) objective_budgets.tiktok = round2(tiktok)
    if (google > 0) objective_budgets.google = round2(google)

    const note = (cells[3] || '').trim()
    out.push({
      day: dayIso,
      objective_budgets,
      notes: note || null,
    })
  }
  return { days: out, split }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// ─── Main loop ──────────────────────────────────────────────────────────
const report = []

for (const target of TARGETS) {
  const sheetPath = join(tmp, 'xl', 'worksheets', target.sheet_xml)
  const { days, split } = parseDailyTimeline(sheetPath)
  if (days.length === 0) {
    report.push({ ...target, error: 'No daily rows parsed' })
    continue
  }

  // Fetch the event so we can verify total + grab event_date.
  const { data: evt, error: evtErr } = await supabase
    .from('events')
    .select('id, name, event_date, budget_marketing')
    .eq('id', target.event_id)
    .single()
  if (evtErr) throw evtErr

  const totalSpend = round2(
    days.reduce(
      (s, d) =>
        s +
        Object.values(d.objective_budgets).reduce((a, b) => a + b, 0),
      0,
    ),
  )
  const delta = round2(totalSpend - Number(evt.budget_marketing))

  const startDate = days[0].day
  const endDate = evt.event_date

  // ── Plan row: reuse existing for Fabric, insert otherwise ────────────
  let planId
  if (target.existing_plan_id) {
    // Wipe existing day rows, then update plan metadata.
    const { error: delErr } = await supabase
      .from('ad_plan_days')
      .delete()
      .eq('plan_id', target.existing_plan_id)
    if (delErr) throw delErr

    const { data: planRow, error: planErr } = await supabase
      .from('ad_plans')
      .update({
        name: `${target.label} — Ad Plan`,
        start_date: startDate,
        end_date: endDate,
        total_budget: evt.budget_marketing,
        notes:
          'Re-seeded from References/The Bridge_ Ad Access _ Marketing Plans.xlsx (sheet daily-spend timeline). Replaces earlier engine-generated days.',
      })
      .eq('id', target.existing_plan_id)
      .select('id')
      .single()
    if (planErr) throw planErr
    planId = planRow.id
  } else {
    const { data: planRow, error: planErr } = await supabase
      .from('ad_plans')
      .insert({
        user_id: USER_ID,
        event_id: target.event_id,
        name: `${target.label} — Ad Plan`,
        status: 'draft',
        total_budget: evt.budget_marketing,
        start_date: startDate,
        end_date: endDate,
        notes:
          'Seeded from References/The Bridge_ Ad Access _ Marketing Plans.xlsx (sheet daily-spend timeline). Channel split preserved.',
      })
      .select('id')
      .single()
    if (planErr) throw planErr
    planId = planRow.id
  }

  // ── Insert days in chunks (Supabase REST max payload safety) ─────────
  const dayRows = days.map((d) => ({
    plan_id: planId,
    user_id: USER_ID,
    day: d.day,
    objective_budgets: d.objective_budgets,
    notes: d.notes,
  }))

  for (let i = 0; i < dayRows.length; i += 100) {
    const chunk = dayRows.slice(i, i + 100)
    const { error: insErr } = await supabase.from('ad_plan_days').insert(chunk)
    if (insErr) throw insErr
  }

  report.push({
    event_id: target.event_id,
    label: target.label,
    plan_id: planId,
    sheet: target.sheet_xml,
    day_count: days.length,
    start_date: startDate,
    end_date: endDate,
    sheet_total_spend: totalSpend,
    event_budget_marketing: Number(evt.budget_marketing),
    delta_vs_event_budget: delta,
    delta_within_10: Math.abs(delta) <= 10,
    has_traffic_conversion_split: split,
    skipped_reason: null,
  })
}

rmSync(tmp, { recursive: true, force: true })

console.log(JSON.stringify({ plans: report }, null, 2))
