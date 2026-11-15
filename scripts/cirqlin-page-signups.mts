/**
 * scripts/cirqlin-page-signups.mts
 *
 * Read-only check of CIRQLIN's page-id signups route (cirqlin #627) for the
 * dashboard v2 registrations (HN2). Reads events from the dashboard DB
 * (service role, SELECT only) and makes ONE partner call per show named,
 * plus the September smoke call for Schak. Writes nothing. Never prints the
 * secret or anything derived from it.
 *
 *   npx tsx --env-file=.env.local scripts/cirqlin-page-signups.mts \
 *     --codes NX26-SCHAK,NX26-AZYR,NX26-FOLAMOUR,NX26-DJEZ,NX26-LOCKLEAD --end 2026-11-12
 *
 * The partner routes share a 60-calls-per-10-minutes budget; this makes
 * codes + 1 calls and prints the count.
 */

import { createClient } from "@supabase/supabase-js";

import { fetchCirqlinSignupsByPage } from "../lib/cirqlin/page-signups.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const codes = (arg("codes") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
const end = arg("end") ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const start14 = new Date(Date.parse(`${end}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10);
if (!process.env.CIRQLIN_PARTNER_READ_SECRET) {
  console.error("CIRQLIN_PARTNER_READ_SECRET is not set in this environment. Nothing was called.");
  process.exit(1);
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: events, error } = await sb.from("events").select("id,event_code,cirqlin_page_id,cirqlin_page_slug,mailchimp_tag").in("event_code", codes).order("event_code");
if (error) throw new Error(error.message);

let calls = 0;
const SCHAK_PAGE = "1860e52b-b261-4b3b-b53a-d72b79e5849d";
calls += 1;
const smoke = await fetchCirqlinSignupsByPage(SCHAK_PAGE, { from: "2026-09-01", to: "2026-09-30" });
if (smoke.ok) {
  const days = smoke.payload.days.map((d) => d.date).sort();
  console.log(`smoke Schak Sep: total ${smoke.payload.total} · daily_timezone ${smoke.payload.daily_timezone} · first ${days[0] ?? "-"} · last ${days.at(-1) ?? "-"} · days ${days.length}`);
} else {
  console.log(`smoke Schak Sep: failed ${smoke.reason}${smoke.status ? ` (${smoke.status})` : ""}`);
}

console.log(`\ncode | page | source | since launch (to ${end}) | ${start14}–${end} | first–last signup day`);
for (const e of events ?? []) {
  if (!e.cirqlin_page_id) {
    console.log(`${e.event_code} | no page | ${e.mailchimp_tag ? "tag only" : "none"} | — | — | —`);
    continue;
  }
  calls += 1;
  const r = await fetchCirqlinSignupsByPage(e.cirqlin_page_id, { to: end });
  if (!r.ok) {
    console.log(`${e.event_code} | ${e.cirqlin_page_slug ?? e.cirqlin_page_id} | page_id failed: ${r.reason}${r.status ? ` (${r.status})` : ""} | — | — | —`);
    continue;
  }
  const days = r.payload.days.filter((d) => d.signups > 0).map((d) => d.date).sort();
  const since = r.payload.days.filter((d) => d.date <= end).reduce((a, d) => a + d.signups, 0);
  const last14 = r.payload.days.filter((d) => d.date >= start14 && d.date <= end).reduce((a, d) => a + d.signups, 0);
  console.log(`${e.event_code} | ${e.cirqlin_page_slug ?? e.cirqlin_page_id} | page_id | ${since} (total ${r.payload.total}) | ${last14} | ${days[0] ?? "-"}–${days.at(-1) ?? "-"}`);
}
console.log(`\npartner calls: ${calls}`);
