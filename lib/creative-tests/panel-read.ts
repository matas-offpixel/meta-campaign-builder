/**
 * Reads the rows the Test plan panel and the share link's "What we're
 * testing" are built from (panel-view.ts): an event's tests, their variants
 * and each test's reads, newest first. Read-only. Paged at 1,000 (the
 * PostgREST cap). Before migration 255 is applied, a missing table reads as
 * no tests.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReadInput, TestInput, VariantInput } from "./panel-view.ts";

type Db = Pick<SupabaseClient, "from">;

const PAGE = 1000;

export const TEST_COLUMNS = "id, event_id, n, kind, format, runs_in, state, result_event, currency, daily_budget_minor, budget_pct, at_minimum, first_delivery_at, winner_variant_id, meta_adset_id, held, started_at";
/** TF6 / TF5 (migration 261): read when the columns are there, so the panel works before 261 is applied. */
export const TEST_COLUMNS_261 = `${TEST_COLUMNS}, extensions, extension_evidence`;
export const VARIANT_COLUMNS = "id, test_id, position, role, label, state";
export const READ_COLUMNS = "test_id, read_at, variants";
export const READ_COLUMNS_261 = `${READ_COLUMNS}, benchmark_cost`;

function missingColumn(message: string): boolean {
  return /column .* does not exist|could not find the .* column/i.test(message);
}

function missingTable(message: string): boolean {
  // A missing column (migration 261 not applied yet) isn't a missing table: loadTestInputs reads the older columns instead.
  if (missingColumn(message)) return false;
  return /does not exist|schema cache|creative_test/i.test(message) && /relation|table|schema cache/i.test(message);
}

async function paged<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await run(from, from + PAGE - 1);
    if (res.error) {
      if (missingTable(res.error.message)) return null;
      throw new Error(res.error.message);
    }
    const rows = (res.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export type TestInputs = { tests: (TestInput & { event_id: string; meta_adset_id?: string | null })[]; variants: VariantInput[]; reads: ReadInput[] };

export async function loadTestInputs(db: Db, eventIds: readonly string[]): Promise<TestInputs> {
  const empty: TestInputs = { tests: [], variants: [], reads: [] };
  if (!eventIds.length) return empty;
  type Row = TestInput & { event_id: string; meta_adset_id?: string | null };
  const readTests = (columns: string) => paged<Row>((a, b) => db.from("creative_tests").select(columns).in("event_id", [...eventIds]).order("id", { ascending: true }).range(a, b));
  let tests: Row[] | null;
  try {
    tests = await readTests(TEST_COLUMNS_261);
  } catch (err) {
    if (!(err instanceof Error) || !missingColumn(err.message)) throw err;
    tests = await readTests(TEST_COLUMNS);
  }
  if (!tests?.length) return empty;
  const ids = tests.map((t) => t.id);
  // TT8: each test ad set's name as Approve made it (launched_ad_sets.source_name).
  const adsetIds = [...new Set(tests.map((t) => t.meta_adset_id).filter((id): id is string => Boolean(id)))];
  if (adsetIds.length) {
    const named = (await paged<{ meta_adset_id: string; source_name: string | null }>((a, b) => db.from("launched_ad_sets").select("meta_adset_id, source_name").in("meta_adset_id", adsetIds).order("meta_adset_id", { ascending: true }).range(a, b))) ?? [];
    const byId = new Map(named.map((r) => [r.meta_adset_id, r.source_name]));
    for (const t of tests) t.adset_name = (t.meta_adset_id && byId.get(t.meta_adset_id)) || null;
  }
  const variants = (await paged<VariantInput>((a, b) => db.from("creative_test_variants").select(VARIANT_COLUMNS).in("test_id", ids).order("id", { ascending: true }).range(a, b))) ?? [];
  const readReads = (columns: string) => paged<ReadInput>((a, b) => db.from("creative_test_reads").select(columns).in("test_id", ids).order("read_at", { ascending: false }).order("test_id", { ascending: true }).range(a, b));
  let reads: ReadInput[];
  try {
    reads = (await readReads(READ_COLUMNS_261)) ?? [];
  } catch (err) {
    if (!(err instanceof Error) || !missingColumn(err.message)) throw err;
    reads = (await readReads(READ_COLUMNS)) ?? [];
  }
  return { tests, variants, reads: reads.map((r) => ({ ...r, variants: Array.isArray(r.variants) ? r.variants : [] })) };
}
