import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { parseBrief, type AnthropicLike } from "../brief-parser/index.ts";
import {
  computeReminderSendAt,
  computeCommunityEarlyAt,
} from "../brief-parser/schedule.ts";
import { BriefValidationError } from "../types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const FIXTURE_EVENT = {
  name: "Jackies Presents: Peggy Gou",
  venue_name: "The Warehouse",
  venue_city: "London",
  venue_country: "GB",
  event_timezone: "Europe/London",
  event_date: "2026-10-02",
  event_start_at: "2026-10-02T21:00:00Z",
  announcement_at: "2026-09-01T09:00:00Z",
  signup_launch_at: "2026-09-01T09:00:00Z",
  presale_at: "2026-09-10T10:00:00Z",
  general_sale_at: "2026-09-12T10:00:00Z",
  ticket_url: "https://tickets.example.com/peggy-gou",
  signup_url: "https://jackies.example.com/signup",
  event_code: "JACK-PG-1002",
  capacity: 1200,
};

/**
 * Frozen "today", injected into the parser as `now`. It is derived from the
 * fixture's own first date (two weeks before the announcement), never from
 * the wall clock, so the fixture can never drift into the past. The parser's
 * year-inference guard (`applyYearInferenceGuard`) rolls any field more than
 * a day behind `now` forward a year — which is exactly what turned every
 * `2026-09-01` assertion in this file into `2027-09-01` the moment the real
 * calendar passed 1 September 2026.
 */
const NOW = new Date(new Date(FIXTURE_EVENT.announcement_at).getTime() - 14 * DAY_MS);

/**
 * The next occurrence of a month-day (at the given UTC time) on or after
 * `reference` — the invariant the year-inference guard must hold for a brief
 * date that arrived without a trustworthy year. (The guard tolerates a date
 * up to one day behind `now`; the reference dates used below sit well clear
 * of that window, so "on or after" and the guard's rule agree.)
 */
function nextOccurrenceOnOrAfter(reference: Date, monthDayTime: string): string {
  let year = reference.getUTCFullYear();
  let candidate = new Date(`${year}${monthDayTime}`);
  if (candidate.getTime() < reference.getTime()) {
    year += 1;
    candidate = new Date(`${year}${monthDayTime}`);
  }
  return candidate.toISOString();
}

function copyBlock(label: string) {
  return { subject: `${label} subject`, body_markdown: `${label} body {{ticket_url}}` };
}

function fakeAnthropic(event: Record<string, unknown>): AnthropicLike {
  return {
    messages: {
      async create() {
        return {
          content: [
            {
              type: "tool_use",
              name: "record_event_brief",
              input: {
                event,
                copy: {
                  announce: copyBlock("announce"),
                  reminder: copyBlock("reminder"),
                  community_early: {
                    subject: null,
                    body_markdown: "Early access 👉 {{community_url}}",
                  },
                  presale_live: copyBlock("presale_live"),
                  gen_sale: copyBlock("gen_sale"),
                  autoresp_setup: {
                    subject: null,
                    body_markdown: "Autoresponder set",
                  },
                },
              },
            },
          ],
        };
      },
    },
  };
}

afterEach(() => {
  mock.restoreAll();
});

test("parseBrief returns event + 6 sends with derived schedule", async () => {
  const warnMock = mock.method(console, "warn", () => {});

  const result = await parseBrief(null, {
    anthropic: fakeAnthropic(FIXTURE_EVENT),
    briefText: "fixture",
    now: NOW,
  });

  assert.equal(result.event.name, FIXTURE_EVENT.name);
  assert.equal(result.event.event_timezone, "Europe/London");
  assert.equal(result.scheduled_sends.length, 6);

  // Every fixture date is after the frozen `now`, so the year-inference
  // guard must leave all of them alone.
  assert.equal(
    warnMock.mock.calls.filter(
      (call) => call.arguments[0] === "[d2c brief parser] year_rolled_forward",
    ).length,
    0,
    "no fixture date should have been rolled forward",
  );

  const byType = Object.fromEntries(
    result.scheduled_sends.map((s) => [s.job_type, s]),
  );

  // announce = signup_launch_at
  assert.equal(
    byType.announce.scheduled_for,
    new Date(FIXTURE_EVENT.signup_launch_at).toISOString(),
  );
  // presale_live = presale_at
  assert.equal(
    byType.presale_live.scheduled_for,
    new Date(FIXTURE_EVENT.presale_at).toISOString(),
  );
  // gen_sale = general_sale_at
  assert.equal(
    byType.gen_sale.scheduled_for,
    new Date(FIXTURE_EVENT.general_sale_at).toISOString(),
  );
  // community_early = presale − 30 min
  assert.equal(
    byType.community_early.scheduled_for,
    computeCommunityEarlyAt(FIXTURE_EVENT.presale_at),
  );
  assert.equal(
    byType.community_early.scheduled_for,
    new Date(new Date(FIXTURE_EVENT.presale_at).getTime() - 30 * 60 * 1000).toISOString(),
  );
  // reminder = presale − 1 day at 16:45 venue-local. The fixture's presale
  // is in September, when Europe/London is BST (UTC+1), so 16:45 local is
  // 15:45Z on the day before the fixture's presale date.
  assert.equal(
    byType.reminder.scheduled_for,
    computeReminderSendAt(FIXTURE_EVENT.presale_at, "Europe/London"),
  );
  const presaleDay = FIXTURE_EVENT.presale_at.slice(0, 10);
  const dayBeforePresale = new Date(new Date(`${presaleDay}T00:00:00Z`).getTime() - DAY_MS)
    .toISOString()
    .slice(0, 10);
  assert.equal(byType.reminder.scheduled_for, `${dayBeforePresale}T15:45:00.000Z`);

  // channel mapping: community_early + autoresp_setup are whatsapp
  assert.equal(byType.community_early.channel, "whatsapp");
  assert.equal(byType.autoresp_setup.channel, "whatsapp");
  assert.equal(byType.announce.channel, "email");

  // copy bundle carries community_url token
  assert.match(
    result.copy.copy_jsonb.community_early?.body_markdown ?? "",
    /\{\{community_url\}\}/,
  );
});

test("a '1 September' brief date resolves to the next 1 September on or after the reference date", async () => {
  mock.method(console, "warn", () => {});

  const SEPT_FIRST_0900Z = "-09-01T09:00:00Z";
  const year = NOW.getUTCFullYear();
  // What the model hands back when the brief just says "1 September": its
  // best guess is the reference year. Whether that guess survives depends
  // only on where the reference date falls relative to 1 September.
  const modelSaid = `${year}${SEPT_FIRST_0900Z}`;

  const references = [
    NOW, // two weeks before 1 September → stays in the reference year
    new Date(Date.UTC(year, 8, 4, 12)), // 4 September → rolls to the next year
  ];

  for (const reference of references) {
    const expected = nextOccurrenceOnOrAfter(reference, SEPT_FIRST_0900Z);

    const result = await parseBrief(null, {
      anthropic: fakeAnthropic({
        ...FIXTURE_EVENT,
        announcement_at: modelSaid,
        signup_launch_at: modelSaid,
      }),
      briefText: "fixture",
      now: reference,
    });

    const announce = result.scheduled_sends.find((s) => s.job_type === "announce");
    assert.equal(
      new Date(result.event.signup_launch_at ?? "").toISOString(),
      expected,
      `signup_launch_at for reference ${reference.toISOString()}`,
    );
    assert.equal(
      announce?.scheduled_for,
      expected,
      `announce send for reference ${reference.toISOString()}`,
    );
    assert.ok(
      new Date(expected).getTime() >= reference.getTime(),
      "resolved date must never be before the reference date",
    );
    assert.equal(new Date(expected).getUTCMonth(), 8);
    assert.equal(new Date(expected).getUTCDate(), 1);
  }
});

test("parseBrief rejects briefs missing required fields", async () => {
  const broken = { ...FIXTURE_EVENT } as Record<string, unknown>;
  delete broken.ticket_url;
  delete broken.venue_city;

  await assert.rejects(
    () =>
      parseBrief(null, {
        anthropic: fakeAnthropic(broken),
        briefText: "fixture",
        now: NOW,
      }),
    (err: unknown) => {
      assert.ok(err instanceof BriefValidationError);
      assert.ok(err.missingFields.includes("ticket_url"));
      assert.ok(err.missingFields.includes("city"));
      return true;
    },
  );
});

test("computeReminderSendAt lands at 16:45 local across a winter (GMT) date", () => {
  // A January presale → Europe/London is GMT (UTC+0), so 16:45 local is
  // 16:45Z. Pure function, no reference date involved, so the literal year
  // is only a label here.
  const winterPresale = "2027-01-15T10:00:00Z";
  const reminder = computeReminderSendAt(winterPresale, "Europe/London");
  assert.equal(reminder, "2027-01-14T16:45:00.000Z");
});
