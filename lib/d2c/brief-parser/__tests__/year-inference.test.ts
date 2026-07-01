/**
 * Tests for the brief-parser year-inference fix (Jackies Mallorca live trial,
 * 2026-07-01): the model hallucinated 2025 for every extracted date even
 * though the brief was unambiguously 2026.
 *
 * Covers:
 *   - System prompt injects today's date + an explicit future-year rule
 *     (the fix at the source — see `buildSystemPrompt` in ../index.ts).
 *   - Explicit, already-future dates are retained unchanged; no
 *     `year_rolled_forward` warning is logged.
 *   - An implicit/hallucinated past year is rolled forward (deterministic
 *     backstop — `applyYearInferenceGuard`), the corrected year flows through
 *     to the derived `scheduled_sends`, and a `[d2c brief parser]
 *     year_rolled_forward` warning is logged per corrected field.
 *
 * Run: node --test (repo's test runner).
 */

import assert from "node:assert/strict";
import { afterEach, test, mock } from "node:test";

import { parseBrief, type AnthropicLike } from "../index.ts";

function copyBlock(label: string) {
  return { subject: `${label} subject`, body_markdown: `${label} body {{ticket_url}}` };
}

function fullCopy() {
  return {
    announce: copyBlock("announce"),
    reminder: copyBlock("reminder"),
    community_early: { subject: null, body_markdown: "Early access 👉 {{community_url}}" },
    presale_live: copyBlock("presale_live"),
    gen_sale: copyBlock("gen_sale"),
    autoresp_setup: { subject: null, body_markdown: "Autoresponder set" },
  };
}

/** Fake Anthropic client. When `captured` is passed, records the system prompt. */
function fakeAnthropic(
  event: Record<string, unknown>,
  captured?: { system?: string },
): AnthropicLike {
  return {
    messages: {
      async create(args: Record<string, unknown>) {
        if (captured) captured.system = args.system as string;
        return {
          content: [
            {
              type: "tool_use",
              name: "record_event_brief",
              input: { event, copy: fullCopy() },
            },
          ],
        };
      },
    },
  };
}

const BASE_EVENT = {
  name: "Jackies Mallorca",
  venue_name: "Jackies Beach Club",
  venue_city: "Mallorca",
  venue_country: "ES",
  event_timezone: "Europe/Madrid",
  ticket_url: "https://tickets.example.com/jackies-mallorca",
};

/** Fixed "today" so tests are deterministic regardless of the real clock. */
const NOW = new Date("2026-07-01T12:00:00Z");

function warnCalls(mockFn: ReturnType<typeof mock.method>) {
  return mockFn.mock.calls.filter(
    (call) => call.arguments[0] === "[d2c brief parser] year_rolled_forward",
  );
}

afterEach(() => {
  mock.restoreAll();
});

test("system prompt injects today's date and a future-year assumption rule", async () => {
  const captured: { system?: string } = {};
  const event = {
    ...BASE_EVENT,
    presale_at: "2026-08-01T10:00:00Z",
    general_sale_at: "2026-08-05T10:00:00Z",
  };

  await parseBrief(null, {
    anthropic: fakeAnthropic(event, captured),
    briefText: "fixture",
    now: NOW,
  });

  assert.ok(captured.system, "system prompt should have been captured");
  assert.match(captured.system!, /Today is 2026-07-01\./);
  assert.match(captured.system!, /Assume dates in the brief refer to future events/);
  assert.match(
    captured.system!,
    /If a date has no year, use the current or next year such that the event date is in the future/,
  );
});

test("explicit future-year dates (2026) are retained unchanged — no rollforward", async () => {
  const warnMock = mock.method(console, "warn", () => {});

  const event = {
    ...BASE_EVENT,
    event_date: "2026-08-16",
    presale_at: "2026-08-01T10:00:00Z",
    general_sale_at: "2026-08-05T10:00:00Z",
  };

  const result = await parseBrief(null, {
    anthropic: fakeAnthropic(event),
    briefText: "fixture",
    now: NOW,
  });

  assert.equal(result.event.event_date, "2026-08-16");
  assert.equal(result.event.presale_at, "2026-08-01T10:00:00Z");
  assert.equal(result.event.general_sale_at, "2026-08-05T10:00:00Z");
  assert.equal(warnCalls(warnMock).length, 0, "no year_rolled_forward warning expected");
});

test("implicit/hallucinated past year (2025) rolls forward and logs year_rolled_forward", async () => {
  const warnMock = mock.method(console, "warn", () => {});

  // Model hallucinated 2025 (training-data bias) for a brief confirmed to be
  // the 2026-08-16 Jackies Mallorca event.
  const event = {
    ...BASE_EVENT,
    event_date: "2025-08-16",
    presale_at: "2025-08-01T10:00:00Z",
    general_sale_at: "2025-08-05T10:00:00Z",
  };

  const result = await parseBrief(null, {
    anthropic: fakeAnthropic(event),
    briefText: "fixture",
    now: NOW,
  });

  assert.equal(result.event.event_date, "2026-08-16");
  assert.equal(result.event.presale_at, "2026-08-01T10:00:00Z");
  assert.equal(result.event.general_sale_at, "2026-08-05T10:00:00Z");

  // The corrected year must flow through to the derived schedule.
  const presaleLive = result.scheduled_sends.find((s) => s.job_type === "presale_live");
  assert.equal(presaleLive?.scheduled_for, "2026-08-01T10:00:00.000Z");
  const genSale = result.scheduled_sends.find((s) => s.job_type === "gen_sale");
  assert.equal(genSale?.scheduled_for, "2026-08-05T10:00:00.000Z");

  const rolled = warnCalls(warnMock);
  const rolledFields = rolled.map((call) => (call.arguments[1] as { field: string }).field);
  assert.ok(rolledFields.includes("event_date"));
  assert.ok(rolledFields.includes("presale_at"));
  assert.ok(rolledFields.includes("general_sale_at"));
  for (const call of rolled) {
    const detail = call.arguments[1] as { field: string; from: string; to: string };
    assert.ok(detail.from.startsWith("2025-"), `expected 2025 source, got ${detail.from}`);
    assert.ok(detail.to.startsWith("2026-"), `expected 2026 target, got ${detail.to}`);
  }
});

test("a date more than a year off the mark rolls forward until it lands in the future", async () => {
  const warnMock = mock.method(console, "warn", () => {});

  // Pathological case: model returns 2023 (2+ years stale). The guard must
  // keep incrementing the year rather than stopping after a single +1.
  const event = {
    ...BASE_EVENT,
    presale_at: "2023-08-01T10:00:00Z",
    general_sale_at: "2023-08-05T10:00:00Z",
  };

  const result = await parseBrief(null, {
    anthropic: fakeAnthropic(event),
    briefText: "fixture",
    now: NOW,
  });

  assert.equal(result.event.presale_at, "2026-08-01T10:00:00Z");
  assert.equal(result.event.general_sale_at, "2026-08-05T10:00:00Z");
  assert.ok(warnCalls(warnMock).length > 0);
});
