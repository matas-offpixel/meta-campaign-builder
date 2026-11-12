/**
 * Captions whose declared_names name someone the overlay does not say.
 * Dry run unless --apply. Status is never written.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-caption-declared-names.mts --event P26-BDAY
 *   … --apply
 */
import { createClient } from "@supabase/supabase-js";

import { declaredNamesMissTheText, namesInOverlay } from "../lib/creative-lab/writer.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apply = argv.includes("--apply");
const code = flag("--event") ?? "P26-BDAY";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const event = await db.from("events").select("id, event_code").eq("event_code", code).maybeSingle();
if (event.error || !event.data) {
  console.error(event.error?.message ?? `${code} not found`);
  process.exit(2);
}
const facts = await db.from("creative_lab_event_facts").select("lineup").eq("event_id", event.data.id).maybeSingle();
if (facts.error) {
  console.error(facts.error.message);
  process.exit(2);
}
const lineup = Array.isArray(facts.data?.lineup) ? facts.data.lineup.map((name) => String(name)) : [];
const captions = await db.from("creative_lab_captions").select("id, status, text, declared_names").eq("event_id", event.data.id);
if (captions.error) {
  console.error(captions.error.message);
  process.exit(2);
}
const rows = (captions.data ?? []).filter((row) => declaredNamesMissTheText(
  Array.isArray(row.declared_names) ? row.declared_names : [],
  String(row.text ?? ""),
));
console.log(`${apply ? "apply" : "dry run"} ${event.data.event_code} · ${rows.length} caption${rows.length === 1 ? "" : "s"}`);
for (const row of rows) {
  const next = namesInOverlay(lineup, String(row.text ?? ""));
  console.log(`${row.id.slice(0, 8)}  ${row.status}  ${JSON.stringify(row.declared_names)}  →  ${JSON.stringify(next)}`);
  if (!apply) continue;
  const updated = await db.from("creative_lab_captions").update({ declared_names: next }).eq("id", row.id).select("id, status");
  if (updated.error) throw new Error(updated.error.message);
  const status = updated.data?.[0]?.status;
  if (status !== row.status) throw new Error(`${row.id} status changed`);
}
