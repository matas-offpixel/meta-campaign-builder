/**
 * Rewrite the two held Puzzle claims the rung-1 split replaces.
 *
 *   npx tsx --env-file=.env.local scripts/ladder-split-recompute.mts
 *   npx tsx --env-file=.env.local scripts/ladder-split-recompute.mts --apply
 *
 * Dry run by default. Prints the claim text and the counts. --apply writes
 * only rows whose state is held and whose claim is one of the two exact
 * strings. Approved, scheduled, live and done rows are never updated.
 */

import { createClient } from "@supabase/supabase-js";

import {
  GENERAL_SALE_HELD_CLAIM,
  GENERAL_SALE_LIVE_CLAIM,
  PRESALE_ENDED_WHY,
  PRESALE_HELD_CLAIM,
  planHeldSplit,
} from "../lib/releases/held-split.ts";

const apply = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await db
  .from("ticket_warnings")
  .select("id, claim, state")
  .in("claim", [GENERAL_SALE_HELD_CLAIM, PRESALE_HELD_CLAIM]);
if (error) {
  console.error(error.message);
  process.exit(1);
}

const plan = planHeldSplit(data ?? []);
console.log(`held "${GENERAL_SALE_HELD_CLAIM}" → "${GENERAL_SALE_LIVE_CLAIM}": ${plan.generalSale.length}`);
console.log(`held "${PRESALE_HELD_CLAIM}" → locked: ${plan.presale.length}`);
console.log(PRESALE_ENDED_WHY);

if (!apply) {
  console.log("dry run");
  process.exit(0);
}

for (const row of plan.generalSale) {
  const { error: writeError } = await db
    .from("ticket_warnings")
    .update({ claim: row.claim, trigger: row.trigger })
    .eq("id", row.id)
    .eq("state", "held")
    .eq("claim", GENERAL_SALE_HELD_CLAIM);
  if (writeError) {
    console.error(writeError.message);
    process.exit(1);
  }
}
for (const row of plan.presale) {
  const { error: writeError } = await db
    .from("ticket_warnings")
    .update({ state: row.state, why: row.why })
    .eq("id", row.id)
    .eq("state", "held")
    .eq("claim", PRESALE_HELD_CLAIM);
  if (writeError) {
    console.error(writeError.message);
    process.exit(1);
  }
}
console.log("applied");
