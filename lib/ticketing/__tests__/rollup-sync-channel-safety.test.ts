/**
 * lib/ticketing/__tests__/rollup-sync-channel-safety.test.ts
 *
 * Regression guards for the channel-ownership invariant documented in
 * lib/ticketing/CONTRACT.md.
 *
 * These are static source-analysis tests — they read the relevant source
 * files and assert that the invariant is encoded in the code. They run
 * without needing Next.js / server-only imports and can be executed with
 * `npm test` in a plain Node.js environment.
 *
 * If any assertion fails, check lib/ticketing/CONTRACT.md for the list of
 * approved functions. Sync may upsert provider-owned automatic channel sales
 * through `upsertProviderTierChannelSales`, but must not call the operator UI
 * helpers (`upsertTierChannelSale` / `deleteTierChannelSale`) directly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname ?? __dirname, "../../..");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

describe("rollup-sync channel-ownership invariant", () => {
  it("rollup-sync-runner.ts does not import from lib/db/tier-channels", () => {
    const src = readSrc("lib/dashboard/rollup-sync-runner.ts");
    assert.ok(
      !src.includes("tier-channels"),
      "rollup-sync-runner.ts must not import lib/db/tier-channels (operator-owned table)",
    );
  });

  it("rollup-sync-runner.ts does not call upsertTierChannelSale", () => {
    const src = readSrc("lib/dashboard/rollup-sync-runner.ts");
    assert.ok(
      !src.includes("upsertTierChannelSale"),
      "rollup-sync-runner.ts must not call upsertTierChannelSale",
    );
  });

  it("rollup-sync-runner.ts does not call deleteTierChannelSale", () => {
    const src = readSrc("lib/dashboard/rollup-sync-runner.ts");
    assert.ok(
      !src.includes("deleteTierChannelSale"),
      "rollup-sync-runner.ts must not call deleteTierChannelSale",
    );
  });

  it("rollup-sync-runner.ts writes provider channel sales only through the ticketing helper", () => {
    const src = readSrc("lib/dashboard/rollup-sync-runner.ts");
    assert.ok(
      src.includes("upsertProviderTierChannelSales"),
      "rollup-sync-runner.ts should route provider automatic channel writes through upsertProviderTierChannelSales",
    );
    assert.ok(
      !src.includes(".from(\"tier_channel_sales\")") &&
        !src.includes(".from('tier_channel_sales')"),
      "rollup-sync-runner.ts must not write tier_channel_sales directly",
    );
  });

  it("rollup-sync-runner.ts does not reference tier_channel_sales table directly", () => {
    const src = readSrc("lib/dashboard/rollup-sync-runner.ts");
    // Allow it only in comments (lines starting with * or //)
    const nonCommentLines = src
      .split("\n")
      .filter((line) => !/^\s*[\*\/]/.test(line));
    const hasDirectRef = nonCommentLines.some((line) =>
      line.includes("tier_channel_sales"),
    );
    assert.ok(
      !hasDirectRef,
      "rollup-sync-runner.ts must not reference tier_channel_sales in executable code",
    );
  });

  it("rollup-sync-runner.ts does not reference additional_ticket_entries", () => {
    const src = readSrc("lib/dashboard/rollup-sync-runner.ts");
    const nonCommentLines = src
      .split("\n")
      .filter((line) => !/^\s*[\*\/]/.test(line));
    const hasDirectRef = nonCommentLines.some((line) =>
      line.includes("additional_ticket_entries"),
    );
    assert.ok(
      !hasDirectRef,
      "rollup-sync-runner.ts must not reference additional_ticket_entries",
    );
  });

  it("replaceEventTicketTiers in lib/db/ticketing.ts only writes to event_ticket_tiers", () => {
    const src = readSrc("lib/db/ticketing.ts");
    // Extract just the replaceEventTicketTiers function body
    const fnStart = src.indexOf("export async function replaceEventTicketTiers(");
    const nextExport = src.indexOf("\nexport ", fnStart + 1);
    const fnBody = src.slice(fnStart, nextExport > fnStart ? nextExport : undefined);

    assert.ok(
      !fnBody.includes("tier_channel_sales"),
      "replaceEventTicketTiers must not touch tier_channel_sales",
    );
    assert.ok(
      !fnBody.includes("additional_ticket_entries"),
      "replaceEventTicketTiers must not touch additional_ticket_entries",
    );
    assert.ok(
      fnBody.includes('"event_ticket_tiers"'),
      "replaceEventTicketTiers must write to event_ticket_tiers",
    );
  });

  it("upsertProviderTierChannelSales only targets the 4TF automatic channel", () => {
    const src = readSrc("lib/db/ticketing.ts");
    const fnStart = src.indexOf(
      "export async function upsertProviderTierChannelSales(",
    );
    const nextExport = src.indexOf("\nexport ", fnStart + 1);
    const fnBody = src.slice(fnStart, nextExport > fnStart ? nextExport : undefined);

    assert.ok(fnStart >= 0, "upsertProviderTierChannelSales must exist");
    assert.ok(
      fnBody.includes('args.provider !== "fourthefans"'),
      "provider channel writer must be scoped to fourthefans for now",
    );
    assert.ok(
      fnBody.includes('.eq("channel_name", "4TF")'),
      "fourthefans provider writes must resolve the 4TF channel by name",
    );
    assert.ok(
      fnBody.includes('.eq("is_automatic", true)'),
      "fourthefans provider writes must target the automatic 4TF channel",
    );
    assert.ok(
      fnBody.includes('"tier_channel_sales"'),
      "provider channel writer must upsert tier_channel_sales",
    );
    assert.ok(
      !fnBody.includes(".delete()"),
      "provider channel writer must never delete/null-refill tier_channel_sales",
    );
    assert.ok(
      fnBody.includes('onConflict: "event_id,tier_name,channel_id"'),
      "provider channel writer must be idempotent on the natural key",
    );
  });

  it("migration 088 is insert-only and dedupes by event tier and 4TF channel", () => {
    const src = readSrc("supabase/migrations/088_cl_final_tier_channel_backfill.sql");
    assert.ok(
      src.includes("insert into public.tier_channel_sales"),
      "migration must insert missing tier_channel_sales rows",
    );
    assert.ok(
      src.includes("where not exists"),
      "migration must preserve existing rows via NOT EXISTS",
    );
    assert.ok(
      src.includes("existing.event_id = r.event_id") &&
        src.includes("existing.tier_name = r.tier_name") &&
        src.includes("existing.channel_id = r.channel_id"),
      "migration dedupe key must be event_id + tier_name + channel_id",
    );
    assert.ok(
      !src.includes("delete from") && !src.includes("truncate"),
      "migration must never null/refill tier_channel_sales",
    );
  });

  it("updateEventCapacityFromTicketTiers in lib/db/ticketing.ts only writes to events table", () => {
    const src = readSrc("lib/db/ticketing.ts");
    const fnStart = src.indexOf(
      "export async function updateEventCapacityFromTicketTiers(",
    );
    const nextExport = src.indexOf("\nexport ", fnStart + 1);
    const fnBody = src.slice(fnStart, nextExport > fnStart ? nextExport : undefined);

    assert.ok(
      !fnBody.includes("tier_channel_sales"),
      "updateEventCapacityFromTicketTiers must not touch tier_channel_sales",
    );
    assert.ok(
      fnBody.includes('"events"'),
      "updateEventCapacityFromTicketTiers must reference the events table",
    );
  });

  it("CONTRACT.md exists and documents the invariant", () => {
    const contractPath = path.join(root, "lib/ticketing/CONTRACT.md");
    assert.ok(
      fs.existsSync(contractPath),
      "lib/ticketing/CONTRACT.md must exist",
    );
    const contract = fs.readFileSync(contractPath, "utf8");
    assert.ok(
      contract.includes("tier_channel_sales"),
      "CONTRACT.md must document the tier_channel_sales constraint",
    );
    assert.ok(
      contract.includes("upsertProviderTierChannelSales"),
      "CONTRACT.md must list upsertProviderTierChannelSales as the sync helper",
    );
  });
});
