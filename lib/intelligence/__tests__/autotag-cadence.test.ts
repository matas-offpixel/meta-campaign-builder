import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  isSameUtcDay,
  lastAiTagAt,
  shouldRunDailyAutoTagPass,
  type AutotagCadenceRow,
} from "../autotag-cadence.ts";

const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-4-6";

function row(
  source: string,
  model_version: string | null,
  created_at: string,
): AutotagCadenceRow {
  return { source, model_version, created_at };
}

describe("isSameUtcDay", () => {
  it("is true within the same UTC day across hours", () => {
    assert.equal(
      isSameUtcDay(
        new Date("2026-05-22T00:01:00Z"),
        new Date("2026-05-22T23:59:00Z"),
      ),
      true,
    );
  });

  it("is false across a UTC day boundary even minutes apart", () => {
    assert.equal(
      isSameUtcDay(
        new Date("2026-05-22T23:59:00Z"),
        new Date("2026-05-23T00:01:00Z"),
      ),
      false,
    );
  });

  it("is false across years", () => {
    assert.equal(
      isSameUtcDay(
        new Date("2025-12-31T12:00:00Z"),
        new Date("2026-12-31T12:00:00Z"),
      ),
      false,
    );
  });
});

describe("lastAiTagAt", () => {
  it("returns the latest created_at for AI rows of the given model", () => {
    const rows = [
      row("ai", HAIKU, "2026-05-20T10:00:00Z"),
      row("ai", HAIKU, "2026-05-22T08:00:00Z"),
      row("ai", HAIKU, "2026-05-21T09:00:00Z"),
    ];
    assert.equal(
      lastAiTagAt(rows, HAIKU)?.toISOString(),
      "2026-05-22T08:00:00.000Z",
    );
  });

  it("ignores other sources and other model versions", () => {
    const rows = [
      row("manual", null, "2026-05-22T12:00:00Z"),
      row("ai", SONNET, "2026-05-22T11:00:00Z"),
      row("ai", HAIKU, "2026-05-19T07:00:00Z"),
    ];
    assert.equal(
      lastAiTagAt(rows, HAIKU)?.toISOString(),
      "2026-05-19T07:00:00.000Z",
    );
  });

  it("returns null when the model has never tagged this event", () => {
    const rows = [row("ai", SONNET, "2026-05-22T11:00:00Z")];
    assert.equal(lastAiTagAt(rows, HAIKU), null);
  });

  it("skips unparseable timestamps", () => {
    const rows = [
      row("ai", HAIKU, "not-a-date"),
      row("ai", HAIKU, "2026-05-18T06:00:00Z"),
    ];
    assert.equal(
      lastAiTagAt(rows, HAIKU)?.toISOString(),
      "2026-05-18T06:00:00.000Z",
    );
  });
});

describe("shouldRunDailyAutoTagPass", () => {
  const now = new Date("2026-05-22T13:00:00Z");

  it("runs when the event has never been tagged under this model", () => {
    assert.equal(shouldRunDailyAutoTagPass(null, now), true);
  });

  it("skips when already tagged earlier the same UTC day", () => {
    assert.equal(
      shouldRunDailyAutoTagPass(new Date("2026-05-22T07:30:00Z"), now),
      false,
    );
  });

  it("runs again on a new UTC day", () => {
    assert.equal(
      shouldRunDailyAutoTagPass(new Date("2026-05-21T23:30:00Z"), now),
      true,
    );
  });
});
