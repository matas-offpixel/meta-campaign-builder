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

export const TEST_COLUMNS = "id, event_id, n, kind, format, runs_in, state, result_event, currency, daily_budget_minor, budget_pct, at_minimum, first_delivery_at, winner_variant_id";
export const VARIANT_COLUMNS = "id, test_id, position, role, label, state";
export const READ_COLUMNS = "test_id, read_at, variants";

function missingTable(message: string): boolean {
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

export type TestInputs = { tests: (TestInput & { event_id: string })[]; variants: VariantInput[]; reads: ReadInput[] };

export async function loadTestInputs(db: Db, eventIds: readonly string[]): Promise<TestInputs> {
  const empty: TestInputs = { tests: [], variants: [], reads: [] };
  if (!eventIds.length) return empty;
  const tests = await paged<TestInput & { event_id: string }>((a, b) => db.from("creative_tests").select(TEST_COLUMNS).in("event_id", [...eventIds]).order("id", { ascending: true }).range(a, b));
  if (!tests?.length) return empty;
  const ids = tests.map((t) => t.id);
  const variants = (await paged<VariantInput>((a, b) => db.from("creative_test_variants").select(VARIANT_COLUMNS).in("test_id", ids).order("id", { ascending: true }).range(a, b))) ?? [];
  const reads = (await paged<ReadInput>((a, b) => db.from("creative_test_reads").select(READ_COLUMNS).in("test_id", ids).order("read_at", { ascending: false }).order("test_id", { ascending: true }).range(a, b))) ?? [];
  return { tests, variants, reads: reads.map((r) => ({ ...r, variants: Array.isArray(r.variants) ? r.variants : [] })) };
}
