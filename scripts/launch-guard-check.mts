/**
 * The pre-launch check (records RC3 and RC8) on stored drafts, read-only.
 *
 *   npx tsx --env-file=.env.local scripts/launch-guard-check.mts --draft <uuid> [--draft <uuid> …]
 *   npx tsx --env-file=.env.local scripts/launch-guard-check.mts --client <uuid> --since 2026-10-25 [--limit 40]
 *
 * Reads each draft's draft_json and runs runLaunchGuard() as the launch
 * route does, with the service role: SELECTs only. For a published draft
 * it also reads the live ads' page and Instagram (RC8) with Graph GETs on
 * META_ACCESS_TOKEN, as launch review does once per open. No write
 * anywhere, no fix applied. Prints each draft's checks, then a table.
 */

import { createClient } from "@supabase/supabase-js";

import { readLiveIdentity } from "../lib/launch-guard/live-identity.ts";
import { loadGuardEvent, loadIdentityOwnership, runLaunchGuard } from "../lib/launch-guard/load.ts";
import type { LaunchGuardResult, LiveIdentity } from "../lib/launch-guard/types.ts";
import type { CampaignDraft } from "../lib/types.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const metaToken = process.env.META_ACCESS_TOKEN ?? "";
const apiVersion = process.env.META_API_VERSION ?? "v21.0";
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (--env-file=.env.local).");
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const ids: string[] = [];
for (let i = 0; i < argv.length; i += 1) if (argv[i] === "--draft" && argv[i + 1]) ids.push(argv[(i += 1)]!);
const clientId = arg("--client");
const since = arg("--since");
const limit = Number(arg("--limit") ?? "40");

const db = createClient(url, key, { auth: { persistSession: false } });

/** Graph GET only. */
async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const target = new URL(`https://graph.facebook.com/${apiVersion}${path}`);
  for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value);
  target.searchParams.set("access_token", metaToken);
  const res = await fetch(target, { method: "GET" });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `Graph ${res.status}`);
  return body;
}

type Row = { id: string; name: string | null; status: string; updated_at: string; draft_json: CampaignDraft };
let rows: Row[] = [];
if (ids.length > 0) {
  const { data, error } = await db.from("campaign_drafts").select("id, name, status, updated_at, draft_json").in("id", ids);
  if (error) throw error;
  rows = (data ?? []) as Row[];
} else if (clientId && since) {
  const { data, error } = await db
    .from("campaign_drafts")
    .select("id, name, status, updated_at, draft_json")
    .eq("client_id", clientId)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .range(0, limit - 1);
  if (error) throw error;
  rows = (data ?? []) as Row[];
} else {
  console.error("Pass --draft <uuid>, or --client <uuid> --since YYYY-MM-DD.");
  process.exit(1);
}

const table: string[] = [];
for (const row of rows) {
  const draft = { ...row.draft_json, id: row.draft_json.id ?? row.id, status: row.status as CampaignDraft["status"] };
  let live: LiveIdentity | null = null;
  let liveNote = "not published";
  if (draft.status === "published" && draft.metaCampaignId && metaToken) {
    try {
      const eventId = draft.settings?.eventId?.trim();
      const event = eventId ? await loadGuardEvent(db, eventId) : null;
      live = await readLiveIdentity(graphGet, draft, async (pageIds, igIds) =>
        event ? loadIdentityOwnership(db, { event, pageIds, igIds, excludeDraftId: draft.id }) : null,
      );
      liveNote = live
        ? `${live.page?.name ?? live.page?.id ?? "?"} + @${live.instagram?.name ?? live.instagram?.id ?? "?"} (${live.page?.count ?? 0} ads)`
        : "no live ads";
    } catch (err) {
      liveNote = `read failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (draft.status === "published") {
    liveNote = draft.metaCampaignId ? "no token" : "no campaign id";
  }
  let result: LaunchGuardResult;
  try {
    result = await runLaunchGuard(db, draft, live);
  } catch (err) {
    console.log(`${row.id}: check failed (${err instanceof Error ? err.message : String(err)})`);
    continue;
  }
  const name = draft.settings?.campaignName ?? row.name ?? "";
  console.log(`\n${row.id} · ${name} · ${row.status}`);
  console.log(`  event ${result.eventCode ?? "(none)"} · ${result.blockers} blockers · ${result.warnings} warnings · live: ${liveNote}`);
  for (const check of result.checks) {
    console.log(`  [${check.severity}] ${check.key} · ${check.label}`);
    console.log(`    ${check.sentence}`);
    if (check.evidence) console.log(`    ${check.evidence}`);
    if (check.fixes.length) console.log(`    fixes: ${check.fixes.map((fix) => fix.label).join(" · ")}`);
  }
  const keys = (k: string) => result.checks.filter((c) => c.key === k).length;
  const cell = (k: string) => (keys(k) ? String(keys(k)) : "");
  table.push(
    [
      row.id.slice(0, 8),
      name.replace(/\|/g, "/").slice(0, 48),
      row.status,
      result.eventCode ?? "—",
      String(result.blockers),
      String(result.warnings),
      cell("pixel_not_venue"),
      cell("account_not_venue"),
      cell("other_show_reference"),
      cell("name_code_mismatch"),
      cell("page_other_client"),
      cell("venue_not_set"),
      cell("link_not_event"),
      cell("identity_not_live"),
      liveNote.replace(/\|/g, "/"),
    ].join(" | "),
  );
}
console.log(
  "\n| draft | name | status | event | blockers | warnings | pixel | account | other show | name | page/IG | venue | link | 8b live ads | live read |",
);
console.log("|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const line of table) console.log(`| ${line} |`);
