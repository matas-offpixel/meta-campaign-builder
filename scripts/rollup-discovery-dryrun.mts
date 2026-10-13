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
import { fetchEventDailyMetaMetrics } from "@/lib/insights/meta";
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
const SINCE = "2026-06-01";
const UNTIL = "2026-10-13";

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

const rows: { code: string; total: number; expected: number; delta: number; accounts: number; campaigns: number }[] = [];
let failures = 0;

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

  const union = await fetchEventDailyMetaMetricsUnion({
    eventCode: code,
    adAccountIds,
    storedCampaignIds: (event.meta_campaign_id ?? "").split(",").map((part: string) => part.trim()).filter(Boolean),
    fetchDaily: (call) =>
      fetchEventDailyMetaMetrics({
        eventCode: call.eventCode,
        adAccountId: call.adAccountId,
        token,
        since: SINCE,
        until: UNTIL,
        ...(call.knownCampaignIds ? { knownCampaignIds: call.knownCampaignIds } : {}),
      }),
  });

  console.log(`\n── ${code}  accounts=${adAccountIds.length} ──`);
  for (const d of union.decisions) console.log("  " + formatClaimDecision(code, d));
  for (const e of union.accountErrors) console.log(`  ACCOUNT ERROR ${e.adAccountId}: ${e.message}`);

  const total = union.days.reduce((t, d) => t + d.spend + d.presaleSpend, 0);
  const expected = EXPECTED[code] ?? 0;
  const delta = total - expected;
  if (Math.abs(delta) > 5) failures += 1;
  rows.push({ code, total, expected, delta, accounts: adAccountIds.length, campaigns: union.campaignIds.length });
}

console.log("\n=== totals (DRY RUN — nothing written) ===");
console.log("event                 union      expected      delta  accts  camps");
for (const r of rows) {
  const flag = Math.abs(r.delta) > 5 ? "  <-- OVER £5" : "";
  console.log(
    `${r.code.padEnd(20)} ${r.total.toFixed(2).padStart(9)} ${r.expected.toFixed(2).padStart(12)} ${r.delta.toFixed(2).padStart(10)} ${String(r.accounts).padStart(6)} ${String(r.campaigns).padStart(6)}${flag}`,
  );
}
console.log(failures === 0 ? "\nPASS: all 13 within £5" : `\nFAIL: ${failures} event(s) outside £5`);
process.exit(failures === 0 ? 0 : 1);
