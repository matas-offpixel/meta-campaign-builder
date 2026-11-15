// scripts/backfill-ad-copy.mts
//
// Copy for every ad already in ad_daily_insights. Dry-run by default:
// ads that have no ad_copy row, or a row older than 30 days, and the
// Graph calls that would read them (one per 50 ads), per account and
// in total. No Meta call and no write.
//
// --apply reads creatives and writes. --account act_… limits the run.
// Migration 206 has to be applied before --apply. This script does not
// apply it.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-ad-copy.mts [--account act_123] [--apply]

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizeAdAccountId } from "../lib/meta/ad-account.ts";
import { AD_COPY_BATCH, needsCopyRead, type StoredAdCopy } from "../lib/ad-daily-insights/copy.ts";
import { captureAccountCopy } from "../lib/ad-daily-insights/copy-capture.ts";
import { selectIn } from "../lib/ad-daily-insights/id-lookup.ts";

const PAGE = 1000;
const PAUSE_MS = 2000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const accountArg = arg("--account");
const account = accountArg ? normalizeAdAccountId(accountArg) : null;
if (accountArg && !account) throw new Error("--account must be an ad account id");

function missingTable(message: string): boolean {
  return /ad_copy/i.test(message) && /does not exist|schema cache|could not find the table/i.test(message);
}

async function listAds(db: SupabaseClient, only: string | null): Promise<Map<string, string>> {
  const ads = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    let query = db.from("ad_daily_insights").select("meta_ad_id, ad_account_id");
    if (only) query = query.eq("ad_account_id", only);
    const { data, error } = await query.order("meta_ad_id").range(from, from + PAGE - 1);
    if (error) throw new Error(`ad_daily_insights: ${error.message}`);
    const rows = (data ?? []) as { meta_ad_id?: string; ad_account_id?: string }[];
    for (const row of rows) {
      const id = row.meta_ad_id?.trim();
      const adAccountId = normalizeAdAccountId(row.ad_account_id);
      if (id && adAccountId && !ads.has(id)) ads.set(id, adAccountId);
    }
    if (rows.length < PAGE) break;
    if (from > 0 && from % 100_000 === 0) console.log(`listed ${from + rows.length} insight rows, ${ads.size} ads`);
  }
  return ads;
}

async function storedCopy(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, StoredAdCopy>> {
  const stored = new Map<string, StoredAdCopy>();
  const { rows, error } = await selectIn(
    (chunk) => db.from("ad_copy").select("meta_ad_id, source, fetched_at").in("meta_ad_id", chunk),
    ids,
  );
  if (error) {
    if (missingTable(error)) return stored;
    throw new Error(`ad_copy: ${error}`);
  }
  for (const row of rows as { meta_ad_id?: string; source?: string; fetched_at?: string }[]) {
    if (!row.meta_ad_id || !row.fetched_at) continue;
    if (row.source !== "graph" && row.source !== "lab" && row.source !== "snapshot" && row.source !== "draft") continue;
    stored.set(row.meta_ad_id, { source: row.source, fetchedAt: row.fetched_at });
  }
  return stored;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date();
  const ads = await listAds(db, account);
  const stored = await storedCopy(db, [...ads.keys()]);
  const due = [...ads.entries()].filter(([id]) => needsCopyRead(stored.get(id), now));
  const byAccount = new Map<string, number>();
  for (const [, adAccountId] of due) byAccount.set(adAccountId, (byAccount.get(adAccountId) ?? 0) + 1);

  let totalCalls = 0;
  console.log(APPLY ? "ad copy backfill (apply)" : "ad copy backfill (dry run)");
  if (stored.size === 0) console.log("ad_copy rows read: 0 (table missing, or no rows yet)");
  for (const [adAccountId, count] of [...byAccount.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const calls = Math.ceil(count / AD_COPY_BATCH);
    totalCalls += calls;
    console.log(`${adAccountId}  ads=${count}  calls=${calls}`);
  }
  console.log(`total  ads=${due.length}  calls=${totalCalls}  accounts=${byAccount.size}`);
  if (!APPLY) {
    console.log("Dry run — no Meta calls, no writes. Re-run with --apply after migration 206 is applied.");
    return;
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("Missing META_ACCESS_TOKEN");
  const { graphMultiGetByIds } = await import("../lib/meta/graph-multi-get.ts");
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  let first = true;
  const multiGet = async (path: string, params: Record<string, string>) => {
    if (!first) await sleep(PAUSE_MS);
    first = false;
    return graphMultiGetByIds(path, params, token);
  };
  const wanted = new Map<string, string[]>();
  for (const [id, adAccountId] of due) {
    const list = wanted.get(adAccountId) ?? [];
    list.push(id);
    wanted.set(adAccountId, list);
  }
  for (const [adAccountId, ids] of wanted) {
    const result = await captureAccountCopy({
      db,
      multiGet,
      adAccountId,
      ads: ids.map((metaAdId) => ({ metaAdId, adName: null })),
      now,
    });
    console.log(`${adAccountId}  status=${result.status}  calls=${result.calls}  written=${result.written}${result.error ? `  error=${result.error}` : ""}`);
    if (result.status === "rate_limited" || result.status === "auth_error") break;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
