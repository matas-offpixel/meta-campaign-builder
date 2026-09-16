import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { buildCirqlinSnapshotRows, calendarDayIn } from "../snapshot-rows.ts";
import { CIRQLIN_LIVE_BODY } from "./live-partner-body.ts";

const payload = {
  ...CIRQLIN_LIVE_BODY,
  daily: [
    { day: "2026-08-26", signups: 64 },
    { day: "2026-08-27", signups: 160 },
  ],
};

describe("buildCirqlinSnapshotRows", () => {
  it("writes one row per day and stamps the counted total on each", () => {
    const rows = buildCirqlinSnapshotRows("event-1", payload);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.day, "2026-08-26");
    assert.equal(rows[0]?.signups_day, 64);
    assert.equal(rows[0]?.signups_total, 1843);
    assert.equal(rows[1]?.signups_day, 160);
    assert.equal((rows[0]?.raw_json.sync as { mailchimp: { failed: number } }).mailchimp.failed, 4);
  });

  it("persists pages, multiple and daily_timezone so the row keeps its scope", () => {
    const rows = buildCirqlinSnapshotRows("event-1", {
      ...payload,
      multiple: true,
      daily_timezone: "Europe/Madrid",
      pages: [
        CIRQLIN_LIVE_BODY.pages[0]!,
        { ...CIRQLIN_LIVE_BODY.pages[0]!, id: "second", slug: "dod-madrid" },
      ],
    });
    const raw = rows[0]!.raw_json;
    assert.equal(raw.multiple, true);
    assert.equal(raw.daily_timezone, "Europe/Madrid");
    assert.equal((raw.pages as unknown[]).length, 2);
    assert.equal(
      (raw.pages as Array<{ id: string }>)[0]?.id,
      "e0b4a82d-a530-49a8-a04d-e5494b947d14",
    );
    assert.equal("page" in raw, false);
  });

  it("keeps a zero-day page as a single totals row on the daily_timezone day", () => {
    const rows = buildCirqlinSnapshotRows("event-1", {
      ...payload,
      daily: [],
      daily_timezone: "Europe/Madrid",
      capturedAt: "2026-09-15T23:30:00.000Z",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.signups_total, 1843);
    assert.equal(rows[0]?.signups_day, 0);
    // UTC would file this under the 15th; Madrid is already the 16th.
    assert.equal(rows[0]?.day, "2026-09-16");
  });
});

describe("calendarDayIn", () => {
  it("buckets by the zone Cirqlin reported", () => {
    assert.equal(calendarDayIn("Europe/London", "2026-09-15T22:30:00Z"), "2026-09-15");
    assert.equal(calendarDayIn("Europe/London", "2026-09-15T23:30:00Z"), "2026-09-16");
    assert.equal(calendarDayIn("America/New_York", "2026-09-15T02:30:00Z"), "2026-09-14");
  });

  it("falls back to the UTC date rather than throwing on a zone Intl rejects", () => {
    assert.equal(calendarDayIn("Not/AZone", "2026-09-15T23:30:00Z"), "2026-09-15");
    assert.equal(calendarDayIn(undefined, "2026-09-15T23:30:00Z"), "2026-09-15");
  });
});

describe("lib/cirqlin", () => {
  it("no longer claims Cirqlin days are Europe/London", () => {
    const dir = new URL("../", import.meta.url).pathname;
    const claims = readdirSync(dir)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => readFileSync(`${dir}${name}`, "utf8").includes("Europe/London"));
    assert.deepEqual(claims, []);
  });
});
