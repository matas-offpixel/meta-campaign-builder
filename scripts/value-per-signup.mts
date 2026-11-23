// scripts/value-per-signup.mts
//
// Value per signup, per client and per show (Task 7, overnight 23→24 Nov 2026):
//
//   presale-day tickets ÷ signups at presale × average ticket price
//
// It sizes the target cost per signup and how much budget to front-load into
// teasers (the Dec–Jan item). DRY RUN ONLY: SELECTs on prod Supabase, prints
// a table and the gaps. It writes nothing, stores nothing, calls no platform
// (no Meta, TikTok, Google, Mailchimp, Bird or CIRQLIN API) and reads counts
// only, never a person's data. The rules are in lib/value-per-signup/model.ts.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/value-per-signup.mts --dry-run
//     [--client "Electric"] [--event NX26-RUDIMENTAL] [--today 2026-11-24]
//
// Reads (all paged — loadAllPaged, the 1,000-row PostgREST cap):
//   clients, events               archived clients and cancelled shows left out
//                                 (lib/db/client-status.ts); a show with no
//                                 client stays in.
//   ticket_sales_snapshots        presale-day tickets, one source per show.
//   event_ticket_tiers            tier prices (sold-weighted).
//   presale_logs                  entered presale-day tickets / average price
//                                 (migration 249; 0 rows on 23 Nov, printed
//                                 next to the counted figure if any appear).
//   signup_source_snapshots       CIRQLIN daily signups (HE4's loadSignupDays).
//   event_signups                 landing-page signups: a head count, no rows.
//   mailchimp_tag_snapshots       the tag on P−1 (HE4's loadMailchimpDayCount),
//                                 else its nearest earlier day within 7 days.
//   ad_daily_insights             Meta registrations and signup-objective spend
//                                 before P, on the campaigns the dashboard gives
//                                 the show (metaCampaignOwners).
//   internal_count_blocks/reports HE4's 24-hour Internal Counts read, shown as
//                                 a cross-check column only.
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";

import { loadCampaignOverrides } from "../lib/attribution/campaign-owner.ts";
import { ARCHIVED } from "../lib/db/client-status.ts";
import { loadAllPaged, type PagedQuery } from "../lib/db/paged-read.ts";
import { dayIn, mailchimpSignupsFigure, presaleDayCount, signupsAtPresaleFigure } from "../lib/dashboard/presale/model.ts";
import { isMissingPresaleTable, loadInternalCounts, loadMailchimpDayCount, loadSignupDays } from "../lib/dashboard/presale/read.ts";
import { metaCampaignOwners } from "../lib/dashboard/sales-calc/figures.ts";
import { phaseFromMetaObjective } from "../lib/launched-ad-sets/snapshot.ts";
import {
  addDays,
  averagePrice,
  daysBetween,
  pickSignups,
  presaleDayReading,
  rollupClient,
  valueOf,
  type ShowValue,
  type SignupCandidate,
  type Snap,
  type TierRow,
} from "../lib/value-per-signup/model.ts";

const argv = process.argv.slice(2);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
if (!argv.includes("--dry-run")) {
  console.error("value-per-signup is a dry run only: pass --dry-run. It never writes.");
  process.exit(1);
}
const clientFilter = value("--client")?.toLowerCase();
const eventFilter = value("--event");
const TZ = "Europe/London";
const today = value("--today") ?? dayIn(new Date().toISOString(), TZ);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const db = createClient(url, key, { auth: { persistSession: false } });

type EventRow = {
  id: string;
  name: string | null;
  event_code: string | null;
  client_id: string | null;
  status: string | null;
  event_date: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  event_timezone: string | null;
  cirqlin_page_id: string | null;
  mailchimp_tag: string | null;
  meta_campaign_id: string | null;
  meta_ad_account_id: string | null;
};

async function inChunks<T>(ids: readonly string[], read: (chunk: string[]) => Promise<T[]>, size = 150): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await read(ids.slice(i, i + size))));
  return out;
}

const timeOf = (instant: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));

/** The instant London's day `day` starts. */
function londonStart(day: string): string {
  const utc = new Date(`${day}T00:00:00Z`);
  const bst = new Date(utc.getTime() - 3_600_000);
  return (dayIn(bst.toISOString(), TZ) === day ? bst : utc).toISOString();
}

const SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };
const money = (v: number | null, currency: string | null) =>
  v == null ? "—" : `${SYMBOL[currency ?? ""] ?? (currency && currency !== "mixed" ? `${currency} ` : currency === "mixed" ? "?" : "£")}${v.toFixed(2)}`;
const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-GB"));
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const short = (day: string | null) => (day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");

function table(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (c ?? "").padEnd(widths[i]!)).join(" | ").trimEnd();
  return [line(head), widths.map((w) => "-".repeat(w)).join("-|-"), ...rows.map(line)].join("\n");
}

// ── Meta: registrations and signup-objective spend before P ──────────────

const SAFE_CODE = /^[A-Za-z0-9_-]+$/;
const actId = (id: string) => `act_${id.trim().replace(/^act_/, "")}`;

type MetaRow = {
  id: string;
  meta_campaign_id: string | null;
  campaign_name: string | null;
  date: string;
  spend: number | string | null;
  registrations: number | string | null;
  campaign_objective: string | null;
  optimization_goal: string | null;
  promoted_event: string | null;
};

async function loadMetaByShow(
  clientId: string,
  clientAccount: string | null,
  allShows: EventRow[],
  presaleShows: { event: EventRow; presaleDay: string }[],
  overrides: Map<string, string>,
): Promise<Map<string, { registrations: number; spend: number; rows: number }>> {
  const out = new Map<string, { registrations: number; spend: number; rows: number }>();
  const shows = allShows.filter((e) => e.client_id === clientId && e.event_code && e.event_date && e.status !== "cancelled");
  const accounts = [...new Set([clientAccount, ...shows.map((s) => s.meta_ad_account_id)].filter((a): a is string => !!a).map(actId))];
  const codes = presaleShows.map((p) => p.event.event_code).filter((c): c is string => !!c && SAFE_CODE.test(c));
  if (!accounts.length || !codes.length) return out;
  const ids = [
    ...new Set(
      [
        ...presaleShows.flatMap((p) => (p.event.meta_campaign_id ?? "").split(",").map((s) => s.trim())),
        ...[...overrides.entries()].filter(([, e]) => presaleShows.some((p) => p.event.id === e)).map(([c]) => c),
      ].filter((id) => /^\d+$/.test(id)),
    ),
  ];
  const parts = codes.map((c) => `campaign_name.ilike.*${c}*`);
  if (ids.length) parts.push(`meta_campaign_id.in.(${ids.join(",")})`);
  const rows = await loadAllPaged<MetaRow>(
    db,
    "ad_daily_insights",
    "id,meta_campaign_id,campaign_name,date,spend,registrations,campaign_objective,optimization_goal,promoted_event",
    ["id"],
    (q: PagedQuery) => q.in("ad_account_id", accounts).or(parts.join(",")),
  );
  const names = new Map<string, string>();
  for (const r of rows) {
    if (!r.meta_campaign_id) continue;
    const name = r.campaign_name ?? "";
    const cur = names.get(r.meta_campaign_id);
    if (cur == null || name > cur) names.set(r.meta_campaign_id, name);
  }
  const owners = metaCampaignOwners(
    shows.map((s) => ({
      eventId: s.id,
      code: s.event_code!,
      showDate: s.event_date!,
      linkedCampaignIds: (s.meta_campaign_id ?? "").split(",").map((id) => id.trim()).filter(Boolean),
    })),
    names,
    Object.fromEntries(overrides),
  );
  const pday = new Map(presaleShows.map((p) => [p.event.id, p.presaleDay]));
  for (const r of rows) {
    const owner = r.meta_campaign_id ? owners.get(r.meta_campaign_id)?.eventId : undefined;
    const p = owner ? pday.get(owner) : undefined;
    if (!owner || !p || r.date >= p) continue;
    const acc = out.get(owner) ?? { registrations: 0, spend: 0, rows: 0 };
    acc.registrations += Number(r.registrations ?? 0);
    acc.rows += 1;
    if (phaseFromMetaObjective({ campaignObjective: r.campaign_objective, optimizationGoal: r.optimization_goal, promotedEvent: r.promoted_event }) === "presale") {
      acc.spend += Number(r.spend ?? 0);
    }
    out.set(owner, acc);
  }
  return out;
}

// ── main ───────────────────────────────────────────────────────────────

async function main() {
  const clients = await loadAllPaged<{ id: string; name: string | null; status: string | null; meta_ad_account_id: string | null }>(
    db,
    "clients",
    "id,name,status,meta_ad_account_id",
    ["id"],
  );
  const archived = new Set(clients.filter((c) => c.status === ARCHIVED).map((c) => c.id));
  const clientName = new Map(clients.map((c) => [c.id, c.name ?? c.id]));
  const allEvents = await loadAllPaged<EventRow>(
    db,
    "events",
    "id,name,event_code,client_id,status,event_date,presale_at,general_sale_at,event_timezone,cirqlin_page_id,mailchimp_tag,meta_campaign_id,meta_ad_account_id",
    ["id"],
  );
  const events = allEvents
    .filter((e) => !(e.client_id && archived.has(e.client_id)) && e.status !== "cancelled")
    .filter((e) => !clientFilter || (clientName.get(e.client_id ?? "") ?? "").toLowerCase().includes(clientFilter))
    .filter((e) => !eventFilter || e.event_code === eventFilter);
  const label = (e: EventRow) => e.event_code ?? `${(e.name ?? e.id).slice(0, 24)} (no code, ${e.event_date ?? "no date"})`;
  const clientOf = (e: EventRow) => (e.client_id ? clientName.get(e.client_id) ?? e.client_id : "(no client)");

  const presale = events
    .filter((e) => e.presale_at)
    .map((e) => {
      const tz = e.event_timezone?.trim() || TZ;
      return { event: e, tz, presaleDay: dayIn(e.presale_at!, tz), gsDay: e.general_sale_at ? dayIn(e.general_sale_at, tz) : null, presaleTime: timeOf(e.presale_at!, tz), gsTime: e.general_sale_at ? timeOf(e.general_sale_at, tz) : null };
    })
    .sort((a, b) => clientOf(a.event).localeCompare(clientOf(b.event)) || a.presaleDay.localeCompare(b.presaleDay));
  const past = presale.filter((p) => p.presaleDay < today);
  const ids = past.map((p) => p.event.id).sort();

  const [snapRows, tierRows, logRows] = await Promise.all([
    inChunks(ids, (chunk) =>
      loadAllPaged<{ id: string; event_id: string; snapshot_at: string; tickets_sold: number | null; gross_revenue_cents: number | string | null; currency: string | null; source: string }>(
        db,
        "ticket_sales_snapshots",
        "id,event_id,snapshot_at,tickets_sold,gross_revenue_cents,currency,source",
        ["id"],
        (q) => q.in("event_id", chunk),
      ),
    ),
    inChunks(ids, (chunk) =>
      loadAllPaged<TierRow & { id: string; event_id: string }>(db, "event_ticket_tiers", "id,event_id,tier_name,price,quantity_sold,snapshot_at,updated_at", ["id"], (q) =>
        q.in("event_id", chunk),
      ),
    ),
    loadAllPaged<{ event_id: string; presale_day_tickets: number | null; avg_ticket_price: number | string | null }>(
      db,
      "presale_logs",
      "event_id,presale_day_tickets,avg_ticket_price",
      ["event_id"],
    ).catch((err: Error) => {
      if (isMissingPresaleTable(err.message)) return [];
      throw err;
    }),
  ]);
  const snapsBy = new Map<string, Snap[]>();
  for (const r of snapRows) {
    if (r.tickets_sold == null) continue;
    const list = snapsBy.get(r.event_id) ?? [];
    list.push({
      snapshotAt: r.snapshot_at,
      day: dayIn(r.snapshot_at, TZ),
      tickets: Number(r.tickets_sold),
      revenueMinor: r.gross_revenue_cents == null ? null : Number(r.gross_revenue_cents),
      currency: r.currency,
      source: r.source,
    });
    snapsBy.set(r.event_id, list);
  }
  const tiersBy = new Map<string, TierRow[]>();
  for (const t of tierRows) tiersBy.set(t.event_id, [...(tiersBy.get(t.event_id) ?? []), t]);
  const logBy = new Map(logRows.map((l) => [l.event_id, l]));

  // Meta, one read per client.
  const overrides = await loadCampaignOverrides(db, "meta");
  const meta = new Map<string, { registrations: number; spend: number; rows: number }>();
  for (const clientId of [...new Set(past.map((p) => p.event.client_id).filter((c): c is string => !!c))]) {
    const c = clients.find((x) => x.id === clientId);
    const got = await loadMetaByShow(clientId, c?.meta_ad_account_id ?? null, allEvents, past.filter((p) => p.event.client_id === clientId), overrides);
    for (const [k, v] of got) meta.set(k, v);
  }

  type Row = ShowValue & {
    gsDay: string | null;
    presaleTime: string;
    gsTime: string | null;
    reading: ReturnType<typeof presaleDayReading>;
    ic24: number | null;
    candidates: SignupCandidate[];
    metaSpend: number | null;
    entered: { tickets: number | null; price: number | null } | null;
    gaps: string[];
  };
  const rows: Row[] = [];
  for (const p of past) {
    const e = p.event;
    const gaps: string[] = [];
    const snaps = snapsBy.get(e.id) ?? [];
    const reading = presaleDayReading(snaps, p.presaleDay, p.gsDay);
    if (!reading) {
      if (!snaps.length) gaps.push("tickets: no ticket_sales_snapshots at all");
      else {
        const days = snaps.map((s) => s.day).sort();
        const after = snaps.filter((s) => s.day > p.presaleDay).sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt))[0];
        const before = snaps.filter((s) => s.day < p.presaleDay).sort((a, b) => b.snapshotAt.localeCompare(a.snapshotAt))[0];
        gaps.push(
          `tickets: no count on ${short(p.presaleDay)} or the day after (snapshots ${short(days[0]!)}–${short(days.at(-1)!)}, ${[...new Set(snaps.map((s) => s.source))].join("/")})` +
            (after ? `; first count after P: ${n(after.tickets - (before?.tickets ?? 0))} on ${short(after.day)}, ${daysBetween(p.presaleDay, after.day)} days on (an upper bound, not used)` : ""),
        );
      }
    }
    const log = logBy.get(e.id) ?? null;
    const entered = log ? { tickets: log.presale_day_tickets, price: log.avg_ticket_price == null ? null : Number(log.avg_ticket_price) } : null;
    const price = averagePrice(entered?.price ?? null, tiersBy.get(e.id) ?? [], reading);
    if (reading && !price) gaps.push("price: no tiers and no revenue on the counts");

    // HE4's 24-hour Internal Counts read, cross-check only.
    const ic = await loadInternalCounts(db, e.id);
    const ic24 = presaleDayCount(ic, e.presale_at!)?.tickets ?? null;

    // Signup candidates, all through P−1.
    const candidates: SignupCandidate[] = [];
    const signupDays = await loadSignupDays(db, e.id);
    const cq = signupsAtPresaleFigure(signupDays, p.presaleDay, null, p.tz);
    if (cq.kind === "value" && cq.from === "CIRQLIN") {
      candidates.push({ source: "CIRQLIN", value: cq.value, estimated: false, note: `daily signups ${short(String(cq.detail?.fromDay))}–${short(String(cq.detail?.throughDay))}` });
    } else if (signupDays?.length) {
      gaps.push(`CIRQLIN: page history starts ${short(signupDays[0]!.day)}, after P−1`);
    }
    const { count: lp, error: lpErr } = await db
      .from("event_signups")
      .select("id", { count: "exact", head: true })
      .eq("event_id", e.id)
      .is("deleted_at", null)
      .is("deduplicated_signup_id", null)
      .lt("created_at", londonStart(p.presaleDay));
    if (lpErr) throw new Error(`event_signups count failed: ${lpErr.message}`);
    if (lp) candidates.push({ source: "landing page", value: lp, estimated: false, note: "event_signups before P (deduped)" });
    const tag = e.mailchimp_tag?.trim() || null;
    if (tag) {
      const p1 = addDays(p.presaleDay, -1);
      const exact = mailchimpSignupsFigure(await loadMailchimpDayCount(db, e.id, tag, p1, p.tz), p.presaleDay, p.tz);
      if (exact.kind === "value") candidates.push({ source: "Mailchimp P−1", value: exact.value, estimated: false, note: `tag on ${short(p1)}${exact.source === "est." ? ", not the end-of-day read" : ""}` });
      else {
        for (let back = 2; back <= 8; back++) {
          const day = addDays(p.presaleDay, -back);
          const mc = await loadMailchimpDayCount(db, e.id, tag, day, p.tz);
          if (mc.subscribers != null && mc.day === day) {
            candidates.push({ source: "Mailchimp earlier day", value: mc.subscribers, estimated: true, note: `tag on ${short(day)}, ${back} days before P` });
            break;
          }
        }
      }
      if (!candidates.some((c) => c.source.startsWith("Mailchimp"))) gaps.push(`Mailchimp: tag "${tag}" has no row from ${short(addDays(p.presaleDay, -8))} to ${short(p1)}`);
    }
    const m = meta.get(e.id);
    if (m && m.registrations > 0) candidates.push({ source: "Meta registrations", value: m.registrations, estimated: true, note: "Meta-attributed, before P" });
    const signups = pickSignups(candidates);
    if (!signups) gaps.push("signups: no CIRQLIN, landing page, Mailchimp or Meta registrations before P");
    const tickets = reading ? reading.tickets : null;
    const sharedDay = p.gsDay === p.presaleDay;
    rows.push({
      eventId: e.id,
      client: clientOf(e),
      label: label(e),
      presaleDay: p.presaleDay,
      gsDay: p.gsDay,
      presaleTime: p.presaleTime,
      gsTime: p.gsTime,
      tickets,
      signups,
      price,
      sharedDay,
      ...valueOf(tickets, signups, price),
      reading,
      ic24,
      candidates,
      metaSpend: m && m.spend > 0 ? Math.round(m.spend * 100) / 100 : null,
      entered,
      gaps,
    });
  }

  /** Counted signups only (CIRQLIN, landing page, Mailchimp on P−1) go into the headline. */
  const counted = (r: Row) => !!r.signups && !r.signups.estimated;

  // Internal Counts shows the importer hasn't linked to an event (alias not confirmed), from 1 Sep.
  const unmatched = await loadAllPaged<{ id: string; show_name: string | null; count_date: string | null }>(
    db,
    "internal_count_blocks",
    "id,show_name,count_date",
    ["id"],
    (q) => q.is("event_id", null).gte("count_date", "2026-09-01"),
  );

  // ── print ──
  console.log(`Value per signup · dry run, read only, nothing written · ${today} (London) · ${new Date().toISOString()}`);
  console.log(`Formula: presale-day tickets ÷ signups at presale (through P−1) × average ticket price.`);
  console.log(
    `Scope: ${events.length} shows (archived clients and cancelled shows out); ${presale.length} with presale_at, ${past.length} with the presale day before today, ${presale.length - past.length} still ahead. presale_logs rows: ${logRows.length}.\n`,
  );

  const byClient = new Map<string, Row[]>();
  for (const r of rows) byClient.set(r.client, [...(byClient.get(r.client) ?? []), r]);
  for (const [client, list] of byClient) {
    console.log(`\n## ${client}\n`);
    console.log(
      table(
        ["Show", "Presale (GS)", "Tickets P", "read", "to P+1", "IC 24h", "Signups", "source", "Conv", "Avg price", "price from", "Value/signup", "Meta spend<P", "Cost/signup", "Flags"],
        list.map((r) => {
          const cur = r.price?.currency ?? r.reading?.end.currency ?? "GBP";
          const cps = r.metaSpend != null && r.signups ? r.metaSpend / r.signups.value : null;
          return [
            r.label,
            `${short(r.presaleDay)} ${r.presaleTime} (GS ${r.gsDay ? `${r.gsDay === r.presaleDay ? "" : `${short(r.gsDay)} `}${r.gsTime}` : "—"})`,
            n(r.tickets),
            r.reading ? `${r.reading.source === "internal_counts" ? "IC" : r.reading.source} ${r.reading.endRead === "on_day" ? short(r.reading.end.day) : `${short(r.reading.end.day)}*`} − ${r.reading.base ? `${n(r.reading.base.tickets)} ${short(r.reading.base.day)}` : "0"}` : "—",
            n(r.reading?.throughNextCount),
            n(r.ic24),
            n(r.signups?.value),
            r.signups ? `${r.signups.source}${r.signups.estimated ? " (est.)" : ""}` : "—",
            pct(r.conversion),
            money(r.price?.value ?? null, cur),
            r.price?.source ?? "—",
            money(r.valuePerSignup, cur),
            money(r.metaSpend, "GBP"),
            money(cps, "GBP"),
            [...(r.reading?.flags ?? []), ...(r.conversion != null && r.conversion > 1 ? ["conversion > 100%: signups undercounted"] : []), ...(r.entered ? [`entered: ${n(r.entered.tickets)} tickets, ${money(r.entered.price, cur)}`] : [])].join("; "),
          ];
        }),
      ),
    );
    const roll = rollupClient(client, list.filter(counted));
    const est = rollupClient(client, list);
    console.log(
      `\n${client}: value per signup ${money(roll.pooled, roll.currency)} pooled over ${roll.withValue} of ${list.length} past-presale shows (those with counted signups) (conversion ${pct(roll.pooledConversion)}); ` +
        `${money(roll.pooledExShared, roll.currency)} over the ${roll.showsExShared} without general sale on the presale day; median per show ${money(roll.median, roll.currency)}. ` +
        `With estimated signups (Meta registrations, Mailchimp earlier day) as well: ${money(est.pooled, est.currency)} over ${est.withValue}.`,
    );
    const others = list.filter((r) => r.candidates.length > 1);
    if (others.length) {
      console.log(`Signup sources side by side (first in order is used: CIRQLIN → landing page → Mailchimp P−1 → Mailchimp earlier day → Meta registrations):`);
      for (const r of others) console.log(`  ${r.label}: ${r.candidates.map((c) => `${c.source} ${n(c.value)} (${c.note})`).join(" · ")}`);
    }
  }

  // Headline across clients.
  console.log(`\n## Headline per client\n`);
  console.log(
    table(
      ["Client", "Past presales", "With a value", "Pooled value/signup", "Ex GS-same-day (n)", "Median", "Conversion", "Incl. est. signups (n)"],
      [...byClient].map(([client, list]) => {
        const r = rollupClient(client, list.filter(counted));
        const e = rollupClient(client, list);
        return [
          client,
          String(list.length),
          String(r.withValue),
          money(r.pooled, r.currency),
          `${money(r.pooledExShared, r.currency)} (${r.showsExShared})`,
          money(r.median, r.currency),
          pct(r.pooledConversion),
          `${money(e.pooled, e.currency)} (${e.withValue})`,
        ];
      }),
    ),
  );

  // Gaps.
  console.log(`\n## Gaps\n`);
  for (const r of rows) if (r.gaps.length) console.log(`  ${r.client} · ${r.label} (P ${short(r.presaleDay)}): ${r.gaps.join("; ")}`);
  const um = new Map<string, { n: number; first: string; last: string }>();
  for (const b of unmatched) {
    const name = (b.show_name ?? "?").trim();
    const cur = um.get(name) ?? { n: 0, first: b.count_date ?? "", last: b.count_date ?? "" };
    cur.n += 1;
    if (b.count_date && b.count_date < cur.first) cur.first = b.count_date;
    if (b.count_date && b.count_date > cur.last) cur.last = b.count_date;
    um.set(name, cur);
  }
  if (um.size) {
    console.log(`\n  Internal Counts blocks with no event linked (since 1 Sep; a show here has counts the table can't use until its alias is confirmed):`);
    console.log(`    ${[...um].sort(([, a], [, b]) => b.last.localeCompare(a.last)).map(([name, v]) => `${name} (${v.n}, ${short(v.first)}–${short(v.last)})`).join(", ")}`);
  }
  const ahead = presale.filter((p) => p.presaleDay >= today);
  if (ahead.length) console.log(`\n  Presale today or ahead (no reading yet): ${ahead.map((p) => `${label(p.event)} ${short(p.presaleDay)}`).join(", ")}`);
  const noPresale = new Map<string, string[]>();
  for (const e of events.filter((x) => !x.presale_at && (!x.event_date || x.event_date >= "2026-01-01"))) noPresale.set(clientOf(e), [...(noPresale.get(clientOf(e)) ?? []), label(e)]);
  if (noPresale.size) {
    console.log(`\n  events.presale_at unset (2026+ shows, not in the table):`);
    for (const [c, list] of noPresale) console.log(`    ${c} (${list.length}): ${list.join(", ")}`);
  }
  console.log(
    `\nKey: P = presale_at's London day. "read" = source, the end count's day (* = the P+1 count) − the base count. "to P+1" = the first P+1 count − base when the P count was used (sensitivity). ` +
      `"IC 24h" = HE4's Internal Counts read (latest count landed within 24 h of the open, by email time), cross-check only. Signups are counted through P−1. ` +
      `"Meta spend<P" = Meta signup-objective spend before P on the show's campaigns; Cost/signup divides it by the signups used. ` +
      `Shared day: when general sale opens on P (Electric: presale 12:00, GS 14:00), the day's count holds both and is not split (Internal Counts are daily); those shows stay in, flagged "GS same day", and each client line also gives the value without them. ` +
      `The headline uses counted signups only (CIRQLIN, landing page, Mailchimp on P−1); estimated signups are shown beside it.`,
  );
}

await main();
