/**
 * P26-BDAY's AB copy test: point the app's rows at the kept ad set (Matas, 17 Nov).
 *
 * Two runs overlapped on 17 Nov and made two ad sets in campaign 120248937493860539.
 * Ops archived the duplicate (120248937494440539, with ads …6120539 and …9050539).
 * This points the ledger and launched_* rows at the kept ad set 120248937493960539
 * (A …5700539, B …9220539) and marks the archived objects' rows. Nothing is deleted.
 *
 * It first reads Meta and stops unless the duplicate and its two ads are ARCHIVED and
 * the kept ad set holds A and B, PAUSED or ACTIVE (P26 was switched on at 12:58, 17 Nov). Dry run by default: prints each row as
 * table, id, column, old value, new value. --apply writes them, each update guarded on
 * the old value, so a rerun changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/ab-copy-test-p26-rows.mts
 *   npx tsx --env-file=.env.local scripts/ab-copy-test-p26-rows.mts --apply
 */

import { createClient } from "@supabase/supabase-js";

import { graphGetWithToken } from "../lib/meta/client.ts";

const apply = process.argv.includes("--apply");
const DRAFT = "5f0d6b0e-7a11-4c3e-9b52-1c4f0a2b9d07";
const DUP_SET = "120248937494440539";
const KEPT_SET = "120248937493960539";
const KEPT_A = "120248937495700539";
const KEPT_B = "120248937499220539";
const KEPT_A_CREATIVE = "1154847356996753";
const DUP_A = "120248937496120539";
const DUP_B = "120248937499050539";
const DUP_A_CREATIVE = "1460100522975449";
const MARK = `[ARCHIVED duplicate ad set ${DUP_SET}; kept ${KEPT_SET}]`;

const token = process.env.META_ACCESS_TOKEN;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!token || !url || !key) {
  console.error("META_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// 1. Meta, read only.
type Row = { id: string; status?: string; effective_status?: string; adset_id?: string; creative?: { id?: string } };
const read = (id: string, fields: string) => graphGetWithToken<Row>(`/${id}`, { fields }, token);
const dupSet = await read(DUP_SET, "id,status,effective_status");
const dupAds = await Promise.all([DUP_A, DUP_B].map((id) => read(id, "id,status,effective_status,adset_id")));
const keptAds = await Promise.all([KEPT_A, KEPT_B].map((id) => read(id, "id,status,effective_status,adset_id,creative{id}")));
console.log(`duplicate ad set ${DUP_SET}: ${dupSet.status} / ${dupSet.effective_status}`);
for (const ad of dupAds) console.log(`  duplicate ad ${ad.id}: ${ad.status} / ${ad.effective_status} in ${ad.adset_id}`);
for (const ad of keptAds) console.log(`  kept ad ${ad.id}: ${ad.status} / ${ad.effective_status} in ${ad.adset_id}, creative ${ad.creative?.id}`);
const problems: string[] = [];
if (dupSet.status !== "ARCHIVED") problems.push(`duplicate ad set ${DUP_SET} is ${dupSet.status}, not ARCHIVED`);
for (const ad of dupAds) if (ad.status !== "ARCHIVED") problems.push(`duplicate ad ${ad.id} is ${ad.status}, not ARCHIVED`);
for (const ad of keptAds) {
  // Matas switched P26 on at 12:58 on 17 Nov: the kept ads may be PAUSED or ACTIVE, never archived or deleted.
  if (ad.status !== "PAUSED" && ad.status !== "ACTIVE") problems.push(`kept ad ${ad.id} is ${ad.status}, not PAUSED or ACTIVE`);
  if (ad.adset_id !== KEPT_SET) problems.push(`kept ad ${ad.id} is in ${ad.adset_id}, not ${KEPT_SET}`);
}
if (keptAds[0]?.creative?.id !== KEPT_A_CREATIVE) problems.push(`kept ad A's creative is ${keptAds[0]?.creative?.id}, not ${KEPT_A_CREATIVE}`);
if (problems.length) {
  console.error(`STOPPED, nothing written:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// 2. The rows.
type Change = { table: string; id: string; column: string; old: string | null; next: string; match: Record<string, string> };
const changes: Change[] = [];
const ledger = async (opKind: string, oldId: string, newId: string) => {
  const { data, error } = await db.from("meta_write_idempotency").select("id, op_result_id").eq("draft_id", DRAFT).eq("op_kind", opKind).eq("op_result_id", oldId);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { id: string; op_result_id: string }[]) {
    changes.push({ table: "meta_write_idempotency", id: row.id, column: "op_result_id", old: row.op_result_id, next: newId, match: { id: row.id, op_result_id: oldId } });
  }
};
await ledger("adset_create", DUP_SET, KEPT_SET);
await ledger("creative_upload", DUP_A_CREATIVE, KEPT_A_CREATIVE);
await ledger("ad_create", DUP_A, KEPT_A);

const ads = await db.from("launched_ads").select("meta_ad_id, meta_adset_id, ad_name").in("meta_ad_id", [KEPT_B, DUP_A, DUP_B]);
if (ads.error) throw new Error(ads.error.message);
for (const row of (ads.data ?? []) as { meta_ad_id: string; meta_adset_id: string | null; ad_name: string | null }[]) {
  if (row.meta_ad_id === KEPT_B && row.meta_adset_id !== KEPT_SET) {
    changes.push({ table: "launched_ads", id: row.meta_ad_id, column: "meta_adset_id", old: row.meta_adset_id, next: KEPT_SET, match: { meta_ad_id: row.meta_ad_id, meta_adset_id: row.meta_adset_id ?? "" } });
  }
  if ((row.meta_ad_id === DUP_A || row.meta_ad_id === DUP_B) && !(row.ad_name ?? "").startsWith("[ARCHIVED")) {
    changes.push({ table: "launched_ads", id: row.meta_ad_id, column: "ad_name", old: row.ad_name, next: `${MARK} ${row.ad_name ?? ""}`.trim(), match: { meta_ad_id: row.meta_ad_id } });
  }
}
const set = await db.from("launched_ad_sets").select("meta_adset_id, launch_note").eq("meta_adset_id", DUP_SET).maybeSingle();
if (set.error) throw new Error(set.error.message);
const note = (set.data as { launch_note?: string | null } | null)?.launch_note ?? null;
if (set.data && !(note ?? "").startsWith("[ARCHIVED")) {
  changes.push({ table: "launched_ad_sets", id: DUP_SET, column: "launch_note", old: note, next: `${MARK} ${note ?? ""}`.trim(), match: { meta_adset_id: DUP_SET } });
}

console.log(`\n${changes.length} row change${changes.length === 1 ? "" : "s"}${apply ? "" : " (dry run, nothing written)"}:`);
for (const c of changes) console.log(`  ${c.table} ${c.id} ${c.column}: ${JSON.stringify(c.old)} → ${JSON.stringify(c.next)}`);
if (!apply) process.exit(0);

let written = 0;
for (const c of changes) {
  let q = db.from(c.table).update({ [c.column]: c.next });
  for (const [column, value] of Object.entries(c.match)) q = q.eq(column, value);
  if (c.column === "ad_name" || c.column === "launch_note") q = c.old == null ? q.is(c.column, null) : q.eq(c.column, c.old);
  const { data, error } = await q.select();
  if (error) {
    console.error(`  ${c.table} ${c.id}: ${error.message}; stopped`);
    process.exit(1);
  }
  written += (data ?? []).length;
  console.log(`  ${c.table} ${c.id} ${c.column}: ${(data ?? []).length ? "written" : "unchanged (already changed)"}`);
}
console.log(`\nrows written: ${written}`);
