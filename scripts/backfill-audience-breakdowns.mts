// scripts/backfill-audience-breakdowns.mts
//
// History backfill for the audience breakdowns (dashboard v2 HE1,
// migration 245): Meta age+gender and region per campaign-day, TikTok
// age+gender and UK nation per campaign-day, stored per show. Same
// fetch / attribute / upsert path as the nightly step in the
// ad-daily-insights cron (lib/audience-breakdowns/runner.ts), with a pause
// before every platform call after the first.
//
// Dry run by default: it READS from Meta, TikTok and Supabase (shows,
// overrides, TikTok credentials) and writes nothing. It prints the calls
// made, the rows it would write, and, with --event, that show's E1 tables.
// --apply writes. ENABLE_AUDIENCE_BREAKDOWNS gates the cron only; this
// script is the operator's explicit run and doesn't need it.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-audience-breakdowns.mts \
//     --since 2026-08-01 --until 2026-11-14 \
//     [--event NX26-LOCKLEAD] [--account act_123] [--tiktok-account <tiktok_accounts.id>] \
//     [--platform meta|tiktok] [--json FILE] [--apply]
//
// --event scopes the run to that show's Meta and TikTok accounts and
// prints its rows; every row read from those accounts is attributed (and,
// with --apply, written), not only that show's.
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// META_ACCESS_TOKEN, TIKTOK_TOKEN_KEY (TikTok leg). --apply requires
// migration 245.

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { graphGetWithToken } from "../lib/meta/client.ts";
import { normalizeAdAccountId } from "../lib/meta/ad-account.ts";
import { tiktokGet } from "../lib/tiktok/client.ts";
import { getTikTokCredentials } from "../lib/tiktok/credentials.ts";
import { runAudienceBreakdowns, type BreakdownPlatform } from "../lib/audience-breakdowns/runner.ts";
import type { MetaBreakdownRow } from "../lib/audience-breakdowns/meta.ts";
import type { TikTokBreakdownRow, TikTokRequest } from "../lib/audience-breakdowns/tiktok.ts";
import { summariseMeta, summariseTikTok, type MetaStoredRow, type TikTokStoredRow } from "../lib/audience-breakdowns/read.ts";

const PAUSE_MS = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const since = arg("--since");
const until = arg("--until");
const eventCode = arg("--event");
const account = arg("--account");
const tiktokAccount = arg("--tiktok-account");
const platform = arg("--platform") as BreakdownPlatform | undefined;
const jsonOut = arg("--json");
if (!since || !until || !DAY.test(since) || !DAY.test(until) || since > until) {
  throw new Error("Usage: --since YYYY-MM-DD --until YYYY-MM-DD [--event CODE] [--account act_…] [--tiktok-account id] [--platform meta|tiktok] [--json FILE] [--apply]");
}
if (platform && platform !== "meta" && platform !== "tiktok") throw new Error("--platform is meta or tiktok");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.META_ACCESS_TOKEN;
  if (!url || !key || !token) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or META_ACCESS_TOKEN");
  const db = createClient(url, key, { auth: { persistSession: false } });

  let metaAccounts = account ? [normalizeAdAccountId(account)!].filter(Boolean) : undefined;
  let tiktokAccounts = tiktokAccount ? [tiktokAccount] : undefined;
  let eventId: string | null = null;
  if (eventCode) {
    const { data, error } = await db
      .from("events")
      .select("id,event_code,meta_ad_account_id,tiktok_account_id,client:clients(meta_ad_account_id,tiktok_account_id)")
      .eq("event_code", eventCode)
      .maybeSingle();
    if (error || !data) throw new Error(`event ${eventCode}: ${error?.message ?? "not found"}`);
    const e = data as unknown as {
      id: string;
      meta_ad_account_id: string | null;
      tiktok_account_id: string | null;
      client: { meta_ad_account_id: string | null; tiktok_account_id: string | null } | null;
    };
    eventId = e.id;
    const meta = normalizeAdAccountId(e.meta_ad_account_id ?? e.client?.meta_ad_account_id ?? null);
    metaAccounts ??= meta ? [meta] : [];
    const tt = e.tiktok_account_id ?? e.client?.tiktok_account_id ?? null;
    tiktokAccounts ??= tt ? [tt] : [];
  }

  let first = true;
  const pause = async () => {
    if (!first) await sleep(PAUSE_MS);
    first = false;
  };
  const collected: { platform: BreakdownPlatform; account: string; rows: (MetaBreakdownRow | TikTokBreakdownRow)[] }[] = [];

  console.log(`${APPLY ? "APPLY" : "DRY RUN (reads only, writes nothing)"} · ${since}..${until}${eventCode ? ` · ${eventCode}` : ""}`);
  const result = await runAudienceBreakdowns({
    env: { ENABLE_AUDIENCE_BREAKDOWNS: "1" },
    db,
    graphGet: async (path, params) => {
      await pause();
      return graphGetWithToken(path, params, token, { maxAttempts: 1 });
    },
    tiktok: {
      request: (async (path: string, params: Record<string, unknown>, t: string) => {
        await pause();
        return tiktokGet(path, params as Parameters<typeof tiktokGet>[1], t);
      }) as TikTokRequest,
      getToken: async (id) => (await getTikTokCredentials(db, id))?.access_token ?? null,
    },
    window: { since: since!, until: until! },
    ...(platform ? { platforms: [platform] } : {}),
    ...(metaAccounts ? { metaAccounts } : {}),
    ...(tiktokAccounts ? { tiktokAccounts } : {}),
    dryRun: !APPLY,
    onRows: (p, a, rows) => collected.push({ platform: p, account: a, rows: [...rows] }),
  });

  console.log(`\nMeta calls: ${result.metaCalls ?? 0} · TikTok calls: ${result.tiktokCalls ?? 0} · rows read: ${result.rowsRead ?? 0} · written: ${result.rowsWritten ?? 0}`);
  for (const o of result.outcomes ?? []) {
    console.log(`  ${o.platform} ${o.account}${o.advertiserId ? ` (advertiser ${o.advertiserId})` : ""}: ${o.status}, ${o.calls} calls, ${o.rows} rows, ${o.attributed} attributed${o.error ? ` — ${o.error}` : ""}`);
  }
  if (result.error) console.log(`  error: ${result.error}`);

  const meta = collected.filter((c) => c.platform === "meta").flatMap((c) => c.rows as MetaBreakdownRow[]);
  const tiktok = collected.filter((c) => c.platform === "tiktok").flatMap((c) => c.rows as TikTokBreakdownRow[]);
  const mine = <T extends { event_id?: string }>(rows: T[]) => (eventId ? rows.filter((r) => r.event_id === eventId) : rows);
  const metaMine = mine(meta);
  const tiktokMine = mine(tiktok);
  console.log(`\n${eventCode ?? "all"}: ${metaMine.length} Meta rows, ${tiktokMine.length} TikTok rows`);
  const show = (rows: object[]) => rows.slice(0, 6).forEach((r) => console.log("  " + JSON.stringify(r)));
  show(metaMine.filter((r) => r.breakdown === "age_gender"));
  show(metaMine.filter((r) => r.breakdown === "region"));
  show(tiktokMine);

  const asStored = <T extends { event_id?: string; campaign_name?: string }>(r: T) => ({ ...r, event_id: r.event_id ?? null, campaign_name: r.campaign_name ?? null });
  const m = summariseMeta(metaMine.map(asStored) as unknown as MetaStoredRow[]);
  const t = summariseTikTok(tiktokMine.map(asStored) as unknown as TikTokStoredRow[]);
  const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(2)} %`);
  const gbp = (x: number | null) => (x == null ? "—" : `£${x.toFixed(2)}`);
  console.log(`\nMeta by age (${m.firstDay}..${m.lastDay}, ${m.campaigns} campaigns):`);
  for (const r of [...m.byAge, m.total]) {
    console.log(`  ${r.segment.padEnd(8)} spend ${gbp(r.spend).padStart(10)} · impr share ${pct(r.impressionShare).padStart(8)} · CTR ${pct(r.ctr)} · signups ${r.signups} at ${gbp(r.costPerSignup)} · purchases ${r.purchases} at ${gbp(r.costPerPurchase)} · revenue ${gbp(r.revenue)}`);
  }
  console.log("Meta by gender:");
  for (const r of m.byGender) console.log(`  ${r.segment.padEnd(8)} spend ${gbp(r.spend)} · signups ${r.signups} · purchases ${r.purchases}`);
  console.log("Meta by region (top 6):");
  for (const r of m.byRegion.slice(0, 6)) console.log(`  ${r.segment.padEnd(18)} spend ${gbp(r.spend)} · impr share ${pct(r.impressionShare)} · CTR ${pct(r.ctr)}`);
  console.log(`TikTok by age (${t.campaigns} campaigns):`);
  for (const r of [...t.byAge, t.total]) console.log(`  ${r.segment.padEnd(8)} spend ${gbp(r.spend)} · impr ${r.impressions} · clicks ${r.clicks} · CTR ${pct(r.ctr)}`);
  console.log("TikTok by UK nation:");
  for (const r of t.byNation) console.log(`  ${r.segment.padEnd(18)} spend ${gbp(r.spend)} · impr share ${pct(r.impressionShare)}`);

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ result, meta: metaMine, tiktok: tiktokMine, summary: { meta: m, tiktok: t } }, null, 2));
    console.log(`\nwrote ${jsonOut}`);
  }
  if (!APPLY) console.log("\nDry run: nothing written. Re-run with --apply to write.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
