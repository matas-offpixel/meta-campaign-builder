/**
 * Migration 256 against prod's live CHECK constraints.
 *
 * The first 256 rolled back on prod with
 *   constraint "meta_custom_audiences_audience_subtype_check" already exists
 * because its DO block looked for the old check by definition text
 * ('%audience_subtype%in%'), and prod writes it as
 * "CHECK ((audience_subtype = ANY (ARRAY[...])))". The fix drops both
 * checks by name.
 *
 * There is no Postgres on the test runner, so this replays the migration's
 * constraint statements in order over the four tables' live constraints,
 * copied verbatim from prod (pg_get_constraintdef, read 17 Nov 2026). An
 * `add constraint` whose name is already there fails with Postgres's own
 * message; a `drop constraint` without `if exists` on a missing name fails.
 * It also checks every new value list keeps the live values, and that
 * every row prod holds today (counts by subtype and window, no other data)
 * passes the new subtype and retention checks.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const SQL = readFileSync(new URL("../../../supabase/migrations/256_retargeting_campaign.sql", import.meta.url), "utf8");

/** pg_get_constraintdef on prod, 17 Nov 2026, contype = 'c'. */
const LIVE: Record<string, Record<string, string>> = {
  meta_custom_audiences: {
    meta_custom_audiences_audience_subtype_check:
      "CHECK ((audience_subtype = ANY (ARRAY['page_engagement_fb'::text, 'page_engagement_ig'::text, 'page_followers_fb'::text, 'page_followers_ig'::text, 'video_views'::text, 'website_pixel'::text, 'lookalike'::text])))",
    meta_custom_audiences_funnel_stage_check:
      "CHECK ((funnel_stage = ANY (ARRAY['top_of_funnel'::text, 'mid_funnel'::text, 'bottom_funnel'::text, 'retargeting'::text])))",
    meta_custom_audiences_retention_days_check: "CHECK (((retention_days > 0) AND (retention_days <= 365)))",
    meta_custom_audiences_status_check:
      "CHECK ((status = ANY (ARRAY['draft'::text, 'creating'::text, 'ready'::text, 'failed'::text, 'archived'::text])))",
  },
  onsale_refresh_audiences: {
    onsale_refresh_audiences_kind_check: "CHECK ((kind = ANY (ARRAY['retargeting'::text, 'registrations_lookalike'::text, 'cluster'::text])))",
    onsale_refresh_audiences_part_check:
      "CHECK ((part = ANY (ARRAY['landing'::text, 'ticket'::text, 'video'::text, 'registrations'::text, 'lookalike'::text, 'adset'::text])))",
  },
  onsale_refresh_lines: {
    onsale_refresh_lines_kind_check:
      "CHECK ((kind = ANY (ARRAY['add_creative'::text, 'claim_ready'::text, 'pause_creative'::text, 'bring_back_audience'::text, 'missing_default'::text, 'drop_audience'::text, 'move_budget'::text, 'purchase_campaign'::text, 'scale_purchase'::text, 'copy_audience'::text])))",
    onsale_refresh_lines_reject_reason_check:
      "CHECK (((reject_reason IS NULL) OR (reject_reason = ANY (ARRAY['too_early'::text, 'wrong_creative'::text, 'claim_not_right'::text, 'other'::text, 'not_this_show'::text]))))",
    onsale_refresh_lines_state_check:
      "CHECK ((state = ANY (ARRAY['to_review'::text, 'accepted'::text, 'rejected'::text, 'applying'::text, 'applied'::text, 'failed'::text, 'expired'::text])))",
  },
  onsale_refresh_proposals: {
    onsale_refresh_proposals_cycle_kind_check: "CHECK ((cycle_kind = ANY (ARRAY['payday'::text, 'content'::text])))",
    onsale_refresh_proposals_mode_check: "CHECK ((mode = ANY (ARRAY['shadow'::text, 'live'::text])))",
    onsale_refresh_proposals_objective_check:
      "CHECK ((objective = ANY (ARRAY['initiate_checkout'::text, 'landing_page_view'::text, 'complete_registration'::text])))",
    onsale_refresh_proposals_run_kind_check: "CHECK ((run_kind = ANY (ARRAY['cycle'::text, 'mid_cycle'::text, 'shadow'::text])))",
  },
};

/** select audience_subtype, retention_days, count(*) on prod, 17 Nov 2026. */
const PROD_ROWS: Array<[string, number, number]> = [
  ["lookalike", 1, 22], ["lookalike", 180, 2],
  ["page_engagement_fb", 30, 17], ["page_engagement_fb", 60, 8], ["page_engagement_fb", 180, 6], ["page_engagement_fb", 365, 14],
  ["page_engagement_ig", 30, 16], ["page_engagement_ig", 60, 9], ["page_engagement_ig", 180, 6], ["page_engagement_ig", 365, 12],
  ["page_followers_fb", 30, 2], ["page_followers_fb", 60, 2], ["page_followers_fb", 180, 2], ["page_followers_fb", 365, 14],
  ["page_followers_ig", 30, 2], ["page_followers_ig", 60, 2], ["page_followers_ig", 180, 2], ["page_followers_ig", 365, 12],
  ["video_views", 30, 17], ["video_views", 57, 1], ["video_views", 60, 8], ["video_views", 180, 3], ["video_views", 365, 3],
  ["website_pixel", 30, 13], ["website_pixel", 60, 7], ["website_pixel", 90, 3], ["website_pixel", 180, 8],
];

function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Replays the constraint statements; returns the constraints after, or throws Postgres's error. */
function replay(sql: string, live: Record<string, Record<string, string>>) {
  const tables = new Map(Object.entries(live).map(([t, cs]) => [t, new Map(Object.entries(cs))]));
  const added = new Map<string, string>();
  for (const stmt of statements(sql)) {
    if (/^do \$\$/i.test(stmt)) throw new Error("a DO block: drop constraints by name");
    const m = stmt.match(/^alter table public\.(\w+) (drop|add) constraint (if exists )?(\w+)(.*)$/i);
    if (!m) continue;
    const [, table, op, ifExists, name, rest] = m;
    const cs = tables.get(table!);
    assert.ok(cs, `table ${table} is in the live set`);
    if (op!.toLowerCase() === "drop") {
      if (!cs.has(name!) && !ifExists) throw new Error(`constraint "${name}" of relation "${table}" does not exist`);
      cs.delete(name!);
    } else {
      if (cs.has(name!)) throw new Error(`constraint "${name}" for relation "${table}" already exists`);
      cs.set(name!, rest!.trim());
      added.set(name!, rest!.trim());
    }
  }
  return { tables, added };
}

function liveValues(def: string): string[] {
  return [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!);
}

function newValues(def: string): string[] {
  const list = def.match(/ in \(([^)]*)\)/i);
  assert.ok(list, `an in (...) list in ${def}`);
  return [...list[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe("migration 256 on prod's live constraints", () => {
  it("the first 256's DO block pattern misses prod's subtype check, so its add failed", () => {
    const def = LIVE.meta_custom_audiences!.meta_custom_audiences_audience_subtype_check!;
    assert.equal(/audience_subtype.*in/is.test(def), false);
  });

  it("replays with no error: every check it adds was dropped by name first", () => {
    assert.doesNotThrow(() => replay(SQL, LIVE));
  });

  it("would fail the way prod did if the subtype check were not dropped", () => {
    const without = SQL.replace(/alter table public\.meta_custom_audiences\s+drop constraint if exists meta_custom_audiences_audience_subtype_check;/, "");
    assert.throws(() => replay(without, LIVE), /constraint "meta_custom_audiences_audience_subtype_check" for relation "meta_custom_audiences" already exists/);
  });

  it("keeps every live value in each check it replaces, plus PR A's new one", () => {
    const { added } = replay(SQL, LIVE);
    const expectNew: Record<string, string> = {
      onsale_refresh_lines_kind_check: "retargeting_campaign",
      onsale_refresh_proposals_run_kind_check: "retargeting",
      onsale_refresh_proposals_objective_check: "purchase",
      onsale_refresh_audiences_kind_check: "retargeting_campaign",
      meta_custom_audiences_audience_subtype_check: "customer_list",
    };
    for (const [name, value] of Object.entries(expectNew)) {
      const table = Object.keys(LIVE).find((t) => LIVE[t]![name])!;
      const before = liveValues(LIVE[table]![name]!);
      const after = newValues(added.get(name)!);
      for (const v of before) assert.ok(after.includes(v), `${name} keeps ${v}`);
      assert.ok(after.includes(value), `${name} adds ${value}`);
      assert.equal(after.length, before.length + 1, `${name} adds only ${value}`);
    }
  });

  it("leaves the other live checks as they are", () => {
    const { tables } = replay(SQL, LIVE);
    for (const [table, cs] of Object.entries(LIVE)) {
      for (const [name, def] of Object.entries(cs)) {
        assert.ok(tables.get(table)!.has(name), `${name} still there`);
        if (!/kind_check|run_kind|objective|audience_subtype|retention_days/.test(name)) assert.equal(tables.get(table)!.get(name), def);
      }
    }
    assert.ok(tables.get("meta_custom_audiences")!.has("meta_custom_audiences_list_role_check"));
  });

  it("passes every row prod holds today (subtype and window)", () => {
    const { added } = replay(SQL, LIVE);
    const subtypes = newValues(added.get("meta_custom_audiences_audience_subtype_check")!);
    // The new retention check: a customer list has no window; everything else 1–365.
    const retentionOk = (subtype: string, days: number | null) =>
      (subtype === "customer_list" && days === null) || (subtype !== "customer_list" && days !== null && days > 0 && days <= 365);
    assert.match(added.get("meta_custom_audiences_retention_days_check")!, /audience_subtype = 'customer_list' and retention_days is null/);
    let rows = 0;
    for (const [subtype, days, n] of PROD_ROWS) {
      assert.ok(subtypes.includes(subtype), `${subtype} allowed`);
      assert.ok(retentionOk(subtype, days), `${subtype} ${days} days allowed`);
      rows += n;
    }
    assert.equal(rows, 213);
    assert.ok(retentionOk("customer_list", null));
    assert.equal(retentionOk("customer_list", 30), false);
    assert.equal(retentionOk("website_pixel", null), false);
  });
});
