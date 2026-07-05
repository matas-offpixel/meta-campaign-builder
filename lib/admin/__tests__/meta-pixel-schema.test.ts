import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCapiEventPayload } from "../../landing-pages/meta-capi.ts";
import {
  buildTestEventInput,
  eventsManagerUrl,
  parsePixelConfigForm,
} from "../meta-pixel-schema.ts";

const LONG_TOKEN = "EAAx".repeat(20); // 80 chars

function form(overrides: Record<string, unknown> = {}) {
  return {
    pixel_id: "",
    capi_token: "",
    clear_token: null,
    test_event_code: "",
    ...overrides,
  };
}

describe("parsePixelConfigForm", () => {
  it("all blank → nulls with token kept", () => {
    assert.deepEqual(parsePixelConfigForm(form()), {
      ok: true,
      value: { pixelId: null, tokenAction: "keep", token: null, testEventCode: null },
    });
  });

  it("valid full config", () => {
    assert.deepEqual(
      parsePixelConfigForm(
        form({
          pixel_id: " 1475359374117271 ",
          capi_token: LONG_TOKEN,
          test_event_code: "test12345",
        }),
      ),
      {
        ok: true,
        value: {
          pixelId: "1475359374117271",
          tokenAction: "set",
          token: LONG_TOKEN,
          testEventCode: "TEST12345",
        },
      },
    );
  });

  it("rejects non-numeric / wrong-length pixel ids", () => {
    for (const bad of ["12345", "1".repeat(17), "pixel-123", "12345678901234a5"]) {
      const result = parsePixelConfigForm(form({ pixel_id: bad }));
      assert.equal(result.ok, false, `expected reject: ${bad}`);
      if (!result.ok) assert.ok(result.errors.pixel_id);
    }
  });

  it("rejects short token pastes (truncation guard)", () => {
    const result = parsePixelConfigForm(form({ capi_token: "abc123" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.capi_token);
  });

  it("clear checkbox → clear action; clear + paste → error", () => {
    const cleared = parsePixelConfigForm(form({ clear_token: "on" }));
    assert.ok(cleared.ok && cleared.value.tokenAction === "clear");

    const both = parsePixelConfigForm(
      form({ clear_token: "on", capi_token: LONG_TOKEN }),
    );
    assert.equal(both.ok, false);
  });

  it("rejects malformed test event codes", () => {
    const result = parsePixelConfigForm(form({ test_event_code: "12345" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.errors.test_event_code);
  });
});

describe("buildTestEventInput → buildCapiEventPayload", () => {
  it("byte-exact test payload (same builder as the live signup path)", () => {
    const input = buildTestEventInput({
      uuid: "0000-fixed",
      email: "matas@example.com",
      nowMs: 1_780_000_000_123,
      pageUrl: "https://app.offpixel.co.uk/admin/gmc/integrations/meta-pixel",
    });
    const payload = buildCapiEventPayload(input, "TEST99");
    assert.deepEqual(payload, {
      data: [
        {
          event_name: "CompleteRegistration",
          event_time: 1_780_000_000,
          event_id: "test-0000-fixed",
          event_source_url:
            "https://app.offpixel.co.uk/admin/gmc/integrations/meta-pixel",
          action_source: "website",
          user_data: {
            // sha256("matas@example.com")
            em: [
              "6845384112277076ca69ad9f2d5994c41288116700fd6131b3a87489d3609b2e",
            ],
          },
          custom_data: { source: "admin-test-event", value: null },
        },
      ],
      test_event_code: "TEST99",
    });
  });

  it("no email + no test code → empty user_data, no test_event_code key", () => {
    const payload = buildCapiEventPayload(
      buildTestEventInput({
        uuid: "u",
        email: null,
        nowMs: 0,
        pageUrl: "https://x.example",
      }),
      null,
    );
    assert.deepEqual(payload.data[0].user_data, {});
    assert.ok(!("test_event_code" in payload));
  });
});

describe("eventsManagerUrl", () => {
  it("builds the dataset overview deep link", () => {
    assert.equal(
      eventsManagerUrl("1475359374117271"),
      "https://business.facebook.com/events_manager2/list/dataset/1475359374117271/overview",
    );
  });
});
