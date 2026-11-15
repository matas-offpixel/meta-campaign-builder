/**
 * Dry run for the rollup campaign-discovery change. READ ONLY.
 *
 * Exercises the exact union the runner now uses — discovery by [CODE]
 * across every ad account a client owns, merged with the stored hint
 * under `classifyCampaignClaim` — against production data, and writes
 * nothing. No Supabase write, no `events.meta_campaign_id` rewrite, no
 * rollup upsert.
 *
 * Usage:
 *   npx tsx scripts/rollup-discovery-dryrun.mts            # dry run
 *   npx tsx scripts/rollup-discovery-dryrun.mts --apply    # refuses
 */
import { createClient } from "@supabase/supabase-js";
import {
  fetchCampaignNameById,
  fetchCodedCampaignsForAccount,
  fetchEventDailyMetaMetrics,
} from "@/lib/insights/meta";
import {
  fetchEventDailyMetaMetricsUnion,
  formatClaimDecision,
} from "@/lib/insights/daily-meta-union";
import { collectClientAdAccountIds } from "@/lib/dashboard/client-ad-accounts";

if (process.argv.includes("--apply")) {
  console.error("This harness is read-only. Remove --apply.");
  process.exit(2);
}

const CODES = [
  "NX26-MF", "NX26-EED", "NX26-AZYR", "NX26-IPC", "NX26-DOD", "NX26-FOLAMOUR",
  "NX26-SCHAK", "NX26-RUDIMENTAL", "NX26-DJEZ", "NX26-ROBBIEDOHERTY",
  "ES26-GDS", "ES26-FEVER105", "EBR26-KREAM",
];
/**
 * The baseline is measured live, not hardcoded. A frozen table goes stale
 * within hours on a show that is still spending — the first run of this
 * harness "failed" GDS and Kream by £10.41 and £6.66 against a two-hour-old
 * table, when the union was in fact exact to the penny.
 */
const EXPECTED: Record<string, number> = {};
const ymd = (d: Date) => d.toISOString().slice(0, 10);
/**
 * `SINCE` predates the earliest campaign in the set; `UNTIL` is TODAY,
 * never a hardcoded date. The baseline is `date_preset=maximum`, which
 * always includes today's spend, so a frozen `UNTIL` makes every still-
 * spending event read as a shortfall — this harness reported 7 of 13
 * "over £5" on 14 Oct, all negative, purely because `UNTIL` still said
 * the 13th. Same stale-baseline trap as the hardcoded expectations table
 * it already replaced.
 */
const SINCE = "2026-06-01";
const UNTIL = ymd(new Date());

/**
 * The production window, reproduced exactly: `rollup-sync-runner` reads a
 * rolling 60 days inclusive of today. The reconciliation above uses a wide
 * window on purpose (it is checking the arithmetic against lifetime), and
 * that is precisely why it never caught the shrink — every campaign had a
 * row inside it. So each event is run a SECOND time at 60 days, which is
 * the only window that can show whether an id survives a quiet quarter.
 */
const WINDOW_DAYS = 60;
const WINDOW_UNTIL = UNTIL;
const WINDOW_SINCE = ymd(new Date(Date.now() - (WINDOW_DAYS - 1) * 86_400_000));

/** The six ids the 14 Oct ticks deleted. They must all come back. */
const DROPPED_14_OCT: Record<string, string> = {
  "120250940278960755": "NX26-MF lead gen (£596.96, last spend 5 Aug)",
  "120250939688140755": "NX26-MF lead gen - older (£370.30, 5 Aug)",
  "120251122257980755": "NX26-MF Newcastle - Purchase (£0.50, 5 Aug)",
  "120251199401080755": "NX26-IPC SIGNUP v4 (£16.01, 10 Aug)",
  "120251199103610755": "NX26-IPC SIGNUP v3 (£0.33, 7 Aug)",
  "120252046270930755": "NX26-RUDIMENTAL On Sale (never spent)",
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const token = process.env.META_ACCESS_TOKEN!;
if (!url || !key || !token) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, META_ACCESS_TOKEN.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const dash = (s: string) => s.replace(/[\u2013\u2014\u2212]/g, "-");
/** Meta lifetime per code, summed across all three accounts, read now. */
async function measureLifetime(accounts: string[]): Promise<void> {
  for (const account of accounts) {
    let next: string | null =
      `https://graph.facebook.com/v21.0/act_${account}/insights?` +
      new URLSearchParams({
        level: "campaign", date_preset: "maximum",
        fields: "campaign_name,spend", limit: "500", access_token: token,
      }).toString();
    while (next) {
      const page: { data?: { campaign_name?: string; spend?: string }[]; paging?: { next?: string } } =
        await (await fetch(next)).json();
      for (const r of page.data ?? []) {
        const name = dash(r.campaign_name ?? "");
        for (const code of CODES) {
          if (name.includes(dash(`[${code}]`))) {
            EXPECTED[code] = (EXPECTED[code] ?? 0) + Number.parseFloat(r.spend ?? "0");
            break;
          }
        }
      }
      next = page.paging?.next ?? null;
    }
  }
}
await measureLifetime(["606252931141334", "1073273492854557", "2011069725849568"]);
console.log("baseline: Meta lifetime measured live at", new Date().toISOString());

const { data: events, error } = await supabase
  .from("events")
  .select("id, event_code, client_id, meta_ad_account_id, meta_campaign_id")
  .in("event_code", CODES);
if (error) throw new Error(error.message);

const rows: {
  code: string; total: number; expected: number; delta: number;
  accounts: number; campaigns: number; stored: number; windowCamps: number;
  lost: string[];
}[] = [];
let failures = 0;
const restored = new Set<string>();

for (const code of CODES) {
  const event = (events ?? []).find((e) => e.event_code === code);
  if (!event) { console.error(`MISSING EVENT ${code}`); failures += 1; continue; }

  const { data: client } = await supabase
    .from("clients").select("meta_ad_account_id").eq("id", event.client_id).maybeSingle();
  const { data: siblings } = await supabase
    .from("events").select("meta_ad_account_id").eq("client_id", event.client_id);

  const adAccountIds = collectClientAdAccountIds({
    eventAdAccountId: event.meta_ad_account_id,
    clientAdAccountId: client?.meta_ad_account_id ?? null,
    siblingEventAdAccountIds: (siblings ?? []).map(
      (s: { meta_ad_account_id: string | null }) => s.meta_ad_account_id,
    ),
  });

  const storedIds = (event.meta_campaign_id ?? "")
    .split(",").map((part: string) => part.trim()).filter(Boolean);

  const runUnion = (since: string, until: string) =>
    fetchEventDailyMetaMetricsUnion({
      eventCode: code,
      adAccountIds,
      storedCampaignIds: storedIds,
      fetchDaily: (call) =>
        fetchEventDailyMetaMetrics({
          eventCode: call.eventCode,
          adAccountId: call.adAccountId,
          token,
          since,
          until,
          ...(call.knownCampaignIds ? { knownCampaignIds: call.knownCampaignIds } : {}),
        }),
      fetchCodedCampaigns: (call) =>
        fetchCodedCampaignsForAccount({
          eventCode: call.eventCode,
          adAccountId: call.adAccountId,
          token,
        }),
      fetchCampaignName: (call) =>
        fetchCampaignNameById({ campaignId: call.campaignId, token }),
    });

  const union = await runUnion(SINCE, UNTIL);
  // Second pass at the production 60-day window: this is the one that
  // proves an id survives a campaign that has not spent lately.
  const windowed = await runUnion(WINDOW_SINCE, WINDOW_UNTIL);

  console.log(`\n── ${code}  accounts=${adAccountIds.length} ──`);
  for (const d of union.decisions) console.log("  " + formatClaimDecision(code, d));
  for (const e of union.accountErrors) console.log(`  ACCOUNT ERROR ${e.adAccountId}: ${e.message}`);
  console.log(`  window ${WINDOW_SINCE}..${WINDOW_UNTIL} (production): ${windowed.campaignIds.length} campaign(s)`);
  for (const d of windowed.decisions) {
    if (d.reason === "coded") continue; // delivered; not what this pass is for
    console.log("  " + formatClaimDecision(code, d));
  }
  for (const id of windowed.campaignIds) {
    if (DROPPED_14_OCT[id] && !storedIds.includes(id)) restored.add(id);
  }

  // No event's list may get shorter. A `moved` id is the one legitimate
  // departure, so it is excluded from the check rather than hidden.
  const movedAway = new Set(
    windowed.decisions.filter((d) => d.reason === "moved").map((d) => d.campaignId),
  );
  const kept = new Set(windowed.campaignIds);
  const lost = storedIds.filter((id: string) => !kept.has(id) && !movedAway.has(id));
  if (lost.length > 0) {
    failures += 1;
    console.log(`  SHRANK: ${lost.length} stored id(s) dropped with no decision: ${lost.join(", ")}`);
  }

  const total = union.days.reduce((t, d) => t + d.spend + d.presaleSpend, 0);
  const expected = EXPECTED[code] ?? 0;
  const delta = total - expected;
  if (Math.abs(delta) > 5) failures += 1;
  rows.push({
    code, total, expected, delta,
    accounts: adAccountIds.length,
    campaigns: union.campaignIds.length,
    stored: storedIds.length,
    windowCamps: windowed.campaignIds.length,
    lost,
  });
}

console.log("\n=== totals (DRY RUN — nothing written) ===");
console.log("event                 union      expected      delta  accts  camps  stored  60d  shrank");
for (const r of rows) {
  const flag = Math.abs(r.delta) > 5 ? "  <-- OVER £5" : r.lost.length > 0 ? "  <-- SHRANK" : "";
  console.log(
    `${r.code.padEnd(20)} ${r.total.toFixed(2).padStart(9)} ${r.expected.toFixed(2).padStart(12)} ${r.delta.toFixed(2).padStart(10)} ${String(r.accounts).padStart(6)} ${String(r.campaigns).padStart(6)} ${String(r.stored).padStart(7)} ${String(r.windowCamps).padStart(4)} ${String(r.lost.length).padStart(7)}${flag}`,
  );
}

console.log("\n=== the six ids dropped on 14 Oct ===");
for (const [id, label] of Object.entries(DROPPED_14_OCT)) {
  const back = restored.has(id);
  if (!back) failures += 1;
  console.log(`  ${back ? "RESTORED" : "STILL MISSING"}  ${id}  ${label}`);
}

console.log(
  failures === 0
    ? "\nPASS: all 13 within £5, no list shrank, all six ids restored"
    : `\nFAIL: ${failures} problem(s)`,
);
process.exit(failures === 0 ? 0 : 1);
