import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname ?? __dirname, "../../..");

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

describe("fourthefans provider channel fallback", () => {
  it("writes fourthefans tiers to the client's automatic 4TF channel", () => {
    const ticketing = readSrc("lib/db/ticketing.ts");
    const fnStart = ticketing.indexOf(
      "export async function upsertProviderTierChannelSales(",
    );
    const nextExport = ticketing.indexOf("\nexport ", fnStart + 1);
    const fnBody = ticketing.slice(
      fnStart,
      nextExport > fnStart ? nextExport : undefined,
    );

    assert.ok(fnStart >= 0, "provider channel sync helper must exist");
    assert.ok(
      fnBody.includes('args.provider !== "fourthefans"'),
      "helper must be scoped to the fourthefans provider",
    );
    assert.ok(
      fnBody.includes('.eq("channel_name", "4TF")'),
      "helper must resolve the client's 4TF channel by name",
    );
    assert.ok(
      fnBody.includes('.eq("is_automatic", true)'),
      "helper must use the automatic 4TF channel, not Venue/manual channels",
    );
    assert.ok(
      fnBody.includes('onConflict: "event_id,tier_name,channel_id"'),
      "helper must upsert on the natural key so existing rows are preserved",
    );
    assert.ok(
      !fnBody.includes(".delete()"),
      "helper must never delete/null-refill tier_channel_sales",
    );
  });

  it("rollup sync invokes provider channel sync after replacing ticket tiers", () => {
    const runner = readSrc("lib/dashboard/rollup-sync-runner.ts");
    const replaceIndex = runner.indexOf("replaceEventTicketTiers(supabase");
    const channelIndex = runner.indexOf("upsertProviderTierChannelSales(supabase");

    assert.ok(replaceIndex >= 0, "rollup-sync must replace event tiers");
    assert.ok(channelIndex >= 0, "rollup-sync must sync provider channel rows");
    assert.ok(
      channelIndex > replaceIndex,
      "provider channel rows should be written from the same merged tier snapshot",
    );
  });
});
