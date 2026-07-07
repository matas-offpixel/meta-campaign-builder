import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildD2CShareUrl,
  buildTimelineBars,
  channelVisual,
  isIntroParagraph,
  jobTypeLabel,
  splitMarkdownParagraphs,
  statusPill,
} from "../dashboard-view.ts";
import type { D2CScheduledSend } from "../types.ts";

function send(partial: Partial<D2CScheduledSend>): D2CScheduledSend {
  return {
    id: "id",
    user_id: "u",
    event_id: "e",
    template_id: "t",
    connection_id: "c",
    channel: "email",
    audience: {},
    variables: {},
    scheduled_for: "2026-07-08T11:00:00Z",
    status: "scheduled",
    result_jsonb: null,
    dry_run: true,
    approval_status: "pending_approval",
    approved_by: null,
    approved_at: null,
    job_type: "announce",
    idempotency_key: null,
    bird_campaign_id: null,
    bird_broadcast_id: null,
    bird_campaign_edit_url: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...partial,
  };
}

describe("jobTypeLabel", () => {
  test("maps known job type", () => {
    assert.equal(jobTypeLabel("presale_live"), "Presale live");
  });
  test("null → Send", () => {
    assert.equal(jobTypeLabel(null), "Send");
  });
});

describe("statusPill", () => {
  test("covers every status without throwing", () => {
    for (const s of [
      "scheduled",
      "sent",
      "failed",
      "cancelled",
      "draft_ready",
    ] as const) {
      const pill = statusPill(s);
      assert.ok(pill.label.length > 0);
      assert.ok(pill.className.length > 0);
    }
  });
});

describe("channelVisual", () => {
  test("whatsapp is tallest + green", () => {
    const wa = channelVisual("whatsapp");
    assert.equal(wa.heightRatio, 1);
    assert.equal(wa.color, "#25d366");
  });
  test("email shorter than whatsapp", () => {
    assert.ok(channelVisual("email").heightRatio < channelVisual("whatsapp").heightRatio);
  });
});

describe("buildTimelineBars", () => {
  test("empty → []", () => {
    assert.deepEqual(buildTimelineBars([]), []);
  });
  test("single send collapses to 50%", () => {
    const bars = buildTimelineBars([send({ id: "a" })]);
    assert.equal(bars.length, 1);
    assert.equal(bars[0]!.offsetPct, 50);
  });
  test("spreads earliest→latest across 0..100", () => {
    const bars = buildTimelineBars([
      send({ id: "late", scheduled_for: "2026-07-16T11:00:00Z" }),
      send({ id: "early", scheduled_for: "2026-07-08T11:00:00Z" }),
      send({ id: "mid", scheduled_for: "2026-07-12T11:00:00Z" }),
    ]);
    // sorted chronologically
    assert.deepEqual(bars.map((b) => b.id), ["early", "mid", "late"]);
    assert.equal(bars[0]!.offsetPct, 0);
    assert.equal(bars[2]!.offsetPct, 100);
    assert.ok(bars[1]!.offsetPct > 0 && bars[1]!.offsetPct < 100);
  });
  test("ignores unparseable timestamps", () => {
    const bars = buildTimelineBars([send({ id: "bad", scheduled_for: "nope" })]);
    assert.equal(bars.length, 0);
  });
});

describe("isIntroParagraph", () => {
  test("matches Thanks for signing up", () => {
    assert.equal(isIntroParagraph("Thanks for signing up for Throwback"), true);
  });
  test("matches You're in", () => {
    assert.equal(isIntroParagraph("You're in — presale Wednesday"), true);
  });
  test("does not match a normal line", () => {
    assert.equal(isIntroParagraph("Throwback lands in the Algarve"), false);
  });
});

describe("splitMarkdownParagraphs", () => {
  test("splits on blank lines, trims, drops empties", () => {
    const paras = splitMarkdownParagraphs("a\n\n\nb\n\n   \n\nc");
    assert.deepEqual(paras, ["a", "b", "c"]);
  });
});

describe("buildD2CShareUrl", () => {
  test("joins origin + token, trimming trailing slash", () => {
    assert.equal(
      buildD2CShareUrl("https://x.co/", "abc"),
      "https://x.co/share/d2c/abc",
    );
    assert.equal(
      buildD2CShareUrl("https://x.co", "abc"),
      "https://x.co/share/d2c/abc",
    );
  });
});
