/**
 * Seed the sheet names Matas confirmed on #1217 (13 Nov): 16 aliases into
 * event_count_aliases and 8 "Not a show we run" names, each through the
 * review list's own path (decideName), so held blocks are released and the
 * names' open items are checked by the same choice.
 *
 *   npx tsx --env-file=.env.local scripts/seed-internal-counts-names.mts           # dry run (reads only)
 *   npx tsx --env-file=.env.local scripts/seed-internal-counts-names.mts --apply   # writes
 *
 * Run after migrations 234 and 235 are applied (it stops if
 * event_count_aliases isn't there), then run the real backfill. Idempotent:
 * a second run writes nothing new. An event code that doesn't resolve to
 * exactly one event stops the whole run before anything is written. The
 * decisions are recorded as GMAIL_INGEST_MAILBOX's operator.
 */

import { createClient } from "@supabase/supabase-js";

import { loadRunContext } from "../lib/internal-counts/context.ts";
import { operatorForMailbox } from "../lib/internal-counts/gmail-session.ts";
import { resolverName } from "../lib/internal-counts/resolve.ts";
import { applySeed, planSeed, SeedError } from "../lib/internal-counts/seed-names.ts";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(2);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  console.log(`# Internal Counts names seed ${apply ? "APPLY" : "DRY RUN — nothing written"}`);
  const plan = await planSeed(sb);
  for (const a of plan.aliases) {
    const note = a.state === "conflict" ? ` CONFLICT: already points at event ${a.existingEventId}; not written` : "";
    console.log(`alias   ${JSON.stringify(a.alias).padEnd(20)} → ${a.eventCode.padEnd(20)} ${a.state}${note}`);
  }
  for (const n of plan.notOurs) console.log(`not ours ${JSON.stringify(n.name).padEnd(20)} ${n.state}`);
  const conflicts = plan.aliases.filter((a) => a.state === "conflict").length;
  console.log(`\n${plan.aliases.filter((a) => a.state === "new").length} new aliases, ${conflicts} conflicts, ${plan.notOurs.filter((n) => n.state === "new").length} new "not ours"`);
  if (!apply) return;
  const mailbox = process.env.GMAIL_INGEST_MAILBOX?.trim();
  const userId = mailbox ? await operatorForMailbox(sb, mailbox) : null;
  if (!userId) {
    console.error("GMAIL_INGEST_MAILBOX has no operator account; the decisions need an owner.");
    process.exit(2);
  }
  const ctx = await loadRunContext(sb);
  const result = await applySeed(sb, ctx, plan, { userId, name: resolverName(mailbox) });
  console.log(`Wrote ${result.aliasesWritten} aliases; ${result.decided} names decided.`);
}

main().catch((err) => {
  console.error(err instanceof SeedError ? err.message : err instanceof Error ? err.message : err);
  process.exit(1);
});
