import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("portal snapshot cadence", () => {
  it("keeps a snapshot for 13 hours and runs at 07:15, 13:15 and 19:15", () => {
    const snapshot = readFileSync("lib/reporting/client-portal-snapshot.ts", "utf8");
    assert.match(snapshot, /CLIENT_PORTAL_SNAPSHOT_MAX_AGE_MS = 13 \* 60 \* 60 \* 1000/);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    assert.equal(
      vercel.crons.find((cron) => cron.path === "/api/cron/refresh-client-portal-snapshots")?.schedule,
      "15 7,13,19 * * *",
    );
    assert.equal(
      vercel.crons.find((cron) => cron.path === "/api/cron/rollup-sync-events")?.schedule,
      "0 7,13,19 * * *",
    );
    const header = readFileSync("app/api/cron/refresh-client-portal-snapshots/route.ts", "utf8");
    assert.match(header, /15 7,13,19/);
    assert.doesNotMatch(header, /every 15 minutes/);
    const creatives = readFileSync("app/api/cron/refresh-active-creatives/route.ts", "utf8");
    assert.match(creatives, /30 7,13,19/);
    assert.doesNotMatch(creatives, /every 6 hours/);
  });
});
