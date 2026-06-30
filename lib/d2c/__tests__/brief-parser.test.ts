import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBrief, type AnthropicLike } from "../brief-parser/index.ts";
import {
  computeReminderSendAt,
  computeCommunityEarlyAt,
} from "../brief-parser/schedule.ts";
import { BriefValidationError } from "../types.ts";

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

test("parseBrief returns event + 6 sends with derived schedule", async () => {
  const result = await parseBrief(null, {
    anthropic: fakeAnthropic(FIXTURE_EVENT),
    briefText: "fixture",
  });

  assert.equal(result.event.name, FIXTURE_EVENT.name);
  assert.equal(result.event.event_timezone, "Europe/London");
  assert.equal(result.scheduled_sends.length, 6);

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
  assert.equal(byType.community_early.scheduled_for, "2026-09-10T09:30:00.000Z");
  // reminder = presale − 1 day at 16:45 venue-local (BST = UTC+1 → 15:45Z)
  assert.equal(
    byType.reminder.scheduled_for,
    computeReminderSendAt(FIXTURE_EVENT.presale_at, "Europe/London"),
  );
  assert.equal(byType.reminder.scheduled_for, "2026-09-09T15:45:00.000Z");

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

test("parseBrief rejects briefs missing required fields", async () => {
  const broken = { ...FIXTURE_EVENT } as Record<string, unknown>;
  delete broken.ticket_url;
  delete broken.venue_city;

  await assert.rejects(
    () =>
      parseBrief(null, {
        anthropic: fakeAnthropic(broken),
        briefText: "fixture",
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
  // January → Europe/London is GMT (UTC+0). 16:45 local == 16:45Z.
  const reminder = computeReminderSendAt("2027-01-15T10:00:00Z", "Europe/London");
  assert.equal(reminder, "2027-01-14T16:45:00.000Z");
});
