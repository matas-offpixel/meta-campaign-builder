/**
 * The pre-launch check (record RC3) on stored drafts, read-only.
 *
 *   npx tsx --env-file=.env.local scripts/launch-guard-check.mts --draft <uuid> [--draft <uuid> …]
 *
 * Reads each draft's draft_json and runs runLaunchGuard() exactly as the
 * launch route does, with the service role: SELECTs only, no Meta call,
 * no write. Prints every check with its sentence, evidence and fixes.
 */

import { createClient } from "@supabase/supabase-js";

import { runLaunchGuard } from "../lib/launch-guard/load.ts";
import type { CampaignDraft } from "../lib/types.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (--env-file=.env.local).");
  process.exit(1);
}

const ids: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--draft" && argv[i + 1]) ids.push(argv[(i += 1)]!);
}
if (ids.length === 0) {
  console.error("Pass --draft <uuid> at least once.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

for (const id of ids) {
  const { data, error } = await db.from("campaign_drafts").select("id, name, status, draft_json").eq("id", id).maybeSingle();
  if (error || !data) {
    console.log(`${id}: not read (${error?.message ?? "no such draft"})`);
    continue;
  }
  const draft = data.draft_json as CampaignDraft;
  const result = await runLaunchGuard(db, draft);
  console.log(`\n${id} · ${draft.settings?.campaignName ?? data.name} · ${data.status}`);
  console.log(`  event ${result.eventCode ?? "(none)"} · ${result.blockers} blockers · ${result.warnings} warnings`);
  for (const check of result.checks) {
    console.log(`  [${check.severity}] ${check.key} · ${check.label}`);
    console.log(`    ${check.sentence}`);
    if (check.evidence) console.log(`    ${check.evidence}`);
    if (check.fixes.length) console.log(`    fixes: ${check.fixes.map((fix) => fix.label).join(" · ")}`);
  }
}
