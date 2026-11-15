// scripts/presale-log-dry-run.mts
//
// HE4 dry run: one show's presale log (lib/dashboard/presale/read.ts) next
// to the season report's hand-built figures. READ ONLY: it selects from
// Supabase and prints. It writes nothing, calls no platform, and never
// stores the --presale-at it is given.
//
// Two columns of the dashboard's figures:
//   "Read"    what loadPresaleLog returns from the stored rows today.
//   "+report" the same rules with the report's entered figures (community
//             count, window sales, presale-day tickets) held in memory, as
//             if they had been typed into the presale log. Never written.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/presale-log-dry-run.mts --event IRW0006 \
//     [--presale-at 2026-08-05T00:00:00+01:00] [--report signups=14500,community=7100,window=4000,presaleDay=6600,spendPerTicket=0.87]
//
// --presale-at is used only when events.presale_at is unset, and is printed
// as supplied. The defaults are Ironworks Season 1's Charlotte de Witte
// (show 1 Nov 2026, presale Wed 5 Aug 2026; the report gives no time, so
// midnight London). With no CIRQLIN count on or before the day before
// presale, "Signups at presale" reads the Mailchimp tag's latest row stored
// on that day (#1257 ruling), naming its time when it isn't the end-of-day read.
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

import { buildPresaleLog, dayIn, type Figure, type MissingReason, type PresaleLog } from "../lib/dashboard/presale/model.ts";
import { adminNameLookup, resolveEnteredNames } from "../lib/dashboard/presale/names.ts";
import {
  dayBefore,
  loadInternalCounts,
  loadMailchimpDayCount,
  loadMemberCounts,
  loadPresaleLog,
  loadPresaleLogRow,
  loadRegistrationSpend,
  loadRelaunches,
  loadSignupDays,
  type PresaleEventRow,
} from "../lib/dashboard/presale/read.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const code = arg("--event") ?? "IRW0006";
const presaleArg = arg("--presale-at") ?? "2026-08-05T00:00:00+01:00";
const reportArg = arg("--report") ?? "signups=14500,community=7100,window=4000,presaleDay=6600,spendPerTicket=0.87";
const report = Object.fromEntries(reportArg.split(",").map((kv) => kv.split("=")).map(([k, v]) => [k!, Number(v)])) as Record<string, number>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const db = createClient(url, key, { auth: { persistSession: false } });

const CAUSE: Record<MissingReason, string> = {
  no_presale_time: "events.presale_at is not set",
  no_cirqlin_signups: "no CIRQLIN signup history (no linked page)",
  no_signups_before_presale: "no CIRQLIN day before the presale day",
  no_mailchimp_count_for_day: "no CIRQLIN history, and the Mailchimp tag has no 12:00Z row for the day before presale",
  not_entered: "not entered (migration 249 holds no row)",
  no_count_within_24h: "no Internal Counts count within 24 h of the open, and none entered",
  no_registration_spend: "no Meta signup spend on the show",
  needs_inputs: "a figure it is worked out from is missing",
  not_meaningful: "denominator is zero or below",
};

const fmt = (f: Figure<number>, kind: "n" | "pct" | "gbp" | "x"): string => {
  if (f.kind === "missing") return "—";
  const v = f.value;
  const s =
    kind === "pct" ? `${(v * 100).toFixed(1)} %` : kind === "gbp" ? `£${v.toFixed(2)}` : kind === "x" ? `${v.toFixed(2)}×` : Math.round(v).toLocaleString("en-GB");
  return `${s} (${f.source})`;
};
const why = (f: Figure<unknown>): string => (f.kind === "missing" ? CAUSE[f.reason] : "");
const from = (f: Figure<unknown>): string => (f.kind === "value" ? f.from : "—");

async function main() {
  const { data: event, error } = await db
    .from("events")
    .select("id,name,client_id,event_code,event_date,presale_at,meta_campaign_id,meta_ad_account_id,cirqlin_page_id,mailchimp_tag,event_timezone")
    .eq("event_code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) throw new Error(`No event ${code}`);
  const e = event as PresaleEventRow & { name: string; cirqlin_page_id: string | null; mailchimp_tag: string | null };
  const presaleAt = e.presale_at ?? new Date(presaleArg).toISOString();

  const read = (await loadPresaleLog(db, e.id, { presaleAtWhenUnset: presaleAt }))!;

  // The same rules with the report's entered figures in memory. Never written.
  const [log, relaunches, counts, signupDays, internalCounts, registrationSpend] = await Promise.all([
    loadPresaleLogRow(db, e.id),
    loadRelaunches(db, e.id),
    loadMemberCounts(db, [e.id]),
    loadSignupDays(db, e.id),
    loadInternalCounts(db, e.id),
    loadRegistrationSpend(db, e),
  ]);
  const at = "dry-run (not stored)";
  const timeZone = e.event_timezone?.trim() || "Europe/London";
  const presaleDay = dayIn(presaleAt, timeZone);
  const tag = e.mailchimp_tag?.trim() || null;
  const cirqlinBefore = !!signupDays?.some((d) => d.day < presaleDay);
  const mailchimp = !cirqlinBefore && tag ? await loadMailchimpDayCount(db, e.id, tag, dayBefore(presaleDay), timeZone) : null;
  const names = await resolveEnteredNames(
    [...(counts.get(e.id) ?? []).map((c) => c.entered_by), ...relaunches.flatMap((r) => [r.entered_by, r.result_entered_by])],
    adminNameLookup(db),
  );
  const supposed: PresaleLog = buildPresaleLog({
    eventId: e.id,
    presaleAt,
    timeZone,
    log: {
      ...(log ?? {
        window_start_at: null,
        window_start_entered_by: null,
        window_start_entered_at: null,
        avg_ticket_price: null,
        avg_ticket_price_entered_by: null,
        avg_ticket_price_entered_at: null,
      }),
      sold_in_window: report.window ?? null,
      sold_in_window_entered_by: null,
      sold_in_window_entered_at: at,
      presale_day_tickets: report.presaleDay ?? null,
      presale_day_tickets_entered_by: null,
      presale_day_tickets_entered_at: at,
    } as never,
    relaunches,
    memberCounts: [...(counts.get(e.id) ?? []), ...(report.community ? [{ counted_on: presaleDay, members: report.community, entered_by: null, entered_at: at }] : [])],
    signupDays,
    internalCounts,
    registrationSpend,
    mailchimp,
    names,
  });

  console.log(`\nPresale log dry run · ${e.name} (${e.event_code}) · read only, nothing written`);
  console.log(
    `events.presale_at: ${e.presale_at ?? `unset → using --presale-at ${presaleArg} (not stored)`} · presale day ${presaleDay} · zone ${timeZone}${e.event_timezone ? "" : " (event_timezone null → Europe/London)"}`,
  );
  console.log(`CIRQLIN page: ${e.cirqlin_page_id ?? "none linked"} · state: ${read.state}${read.prompt ? ` → "${read.prompt}"` : ""}`);
  console.log(`Meta signup spend: ${registrationSpend == null ? "none" : `£${registrationSpend.toFixed(2)}`}`);
  console.log(
    `Mailchimp fallback: ${
      mailchimp
        ? `tag "${mailchimp.tag}", latest row on ${mailchimp.day}: ${mailchimp.subscribers ?? "none"} (row source ${mailchimp.rowSource ?? "—"}, ${mailchimp.endOfDay ? "end of day" : mailchimp.readAt ? `read ${mailchimp.readAt}` : "no time stored"})`
        : cirqlinBefore
          ? "not read (CIRQLIN has a count by the last day)"
          : "no tag"
    }\n`,
  );

  const rows: [string, string, string, string, string][] = [
    [read.signupsAtPresaleLabel ?? "Signups at presale", fmt(read.signupsAtPresale, "n"), fmt(supposed.signupsAtPresale, "n"), report.signups?.toLocaleString("en-GB") ?? "—", why(read.signupsAtPresale)],
    ["Community at presale", fmt(read.communityAtPresale, "n"), fmt(supposed.communityAtPresale, "n"), report.community?.toLocaleString("en-GB") ?? "—", why(read.communityAtPresale)],
    ["Sold in community window", fmt(read.soldInWindow, "n"), fmt(supposed.soldInWindow, "n"), report.window?.toLocaleString("en-GB") ?? "—", why(read.soldInWindow)],
    ["Community conversion", fmt(read.communityConversion, "pct"), fmt(supposed.communityConversion, "pct"), report.window && report.community ? `${((report.window / report.community) * 100).toFixed(1)} %` : "—", why(read.communityConversion)],
    ["Presale-day tickets", fmt(read.presaleDayTickets, "n"), fmt(supposed.presaleDayTickets, "n"), report.presaleDay?.toLocaleString("en-GB") ?? "—", why(read.presaleDayTickets)],
    ["Wider conversion", fmt(read.widerConversion, "pct"), fmt(supposed.widerConversion, "pct"), "—", why(read.widerConversion) || why(supposed.widerConversion)],
    ["Meta signup spend per presale ticket", fmt(read.signupSpendPerPresaleTicket, "gbp"), fmt(supposed.signupSpendPerPresaleTicket, "gbp"), report.spendPerTicket != null ? `£${report.spendPerTicket.toFixed(2)}` : "—", why(read.signupSpendPerPresaleTicket)],
    ["Presale return (est.)", fmt(read.presaleReturn, "x"), fmt(supposed.presaleReturn, "x"), "—", why(read.presaleReturn) || why(supposed.presaleReturn)],
  ];
  const head: [string, string, string, string, string] = ["Figure", "Read", "+report (in memory)", "Season report", "Why Read differs"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join(" | ");
  console.log(line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("-|-"));
  for (const r of rows) console.log(line(r));
  console.log(`\nSources: signups ${from(read.signupsAtPresale)} · spend ${from(read.registrationSpend)}`);
  console.log(`Window start: ${read.windowStart.kind === "value" ? `${read.windowStart.value} (${read.windowStart.source})` : why(read.windowStart)}`);
  console.log(`Relaunches: ${read.relaunches.length}`);
}

await main();
