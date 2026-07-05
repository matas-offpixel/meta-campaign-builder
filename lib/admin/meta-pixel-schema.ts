import type { CapiEventInput } from "@/lib/landing-pages/meta-capi";

/**
 * lib/admin/meta-pixel-schema.ts — pure logic for the self-service Meta
 * Pixel + CAPI setup (OP909 Phase 7). Validation, the test-event input
 * builder, and the Events Manager deep link. No Next.js/Supabase imports
 * so node:test byte-diffs everything directly.
 */

const PIXEL_ID_RE = /^\d{15,16}$/;
const TEST_EVENT_CODE_RE = /^TEST\d{3,10}$/i;

export interface PixelConfigFormValues {
  /** Validated 15–16 digit pixel id, or null to clear. */
  pixelId: string | null;
  /**
   * CAPI access token handling:
   *  - "keep"  → field left blank, existing token untouched
   *  - "set"   → new token provided
   *  - "clear" → explicit clear checkbox ticked
   */
  tokenAction: "keep" | "set" | "clear";
  token: string | null;
  testEventCode: string | null;
}

export type ParsePixelConfigResult =
  | { ok: true; value: PixelConfigFormValues }
  | { ok: false; errors: Record<string, string> };

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parsePixelConfigForm(values: {
  pixel_id: unknown;
  capi_token: unknown;
  clear_token: unknown;
  test_event_code: unknown;
}): ParsePixelConfigResult {
  const errors: Record<string, string> = {};

  const pixelRaw = asTrimmed(values.pixel_id);
  let pixelId: string | null = null;
  if (pixelRaw.length > 0) {
    if (!PIXEL_ID_RE.test(pixelRaw)) {
      errors.pixel_id =
        "Pixel ID should be the 15–16 digit number from Meta Events Manager.";
    } else {
      pixelId = pixelRaw;
    }
  }

  const tokenRaw = asTrimmed(values.capi_token);
  const clearToken = values.clear_token === "on" || values.clear_token === true;
  let tokenAction: PixelConfigFormValues["tokenAction"] = "keep";
  let token: string | null = null;
  if (clearToken && tokenRaw.length > 0) {
    errors.capi_token =
      "Either paste a new token or tick the clear box — not both.";
  } else if (clearToken) {
    tokenAction = "clear";
  } else if (tokenRaw.length > 0) {
    if (tokenRaw.length < 32) {
      // System-user CAPI tokens are long; a short paste is a truncation.
      errors.capi_token = "That looks too short to be a CAPI access token.";
    } else {
      tokenAction = "set";
      token = tokenRaw;
    }
  }

  const codeRaw = asTrimmed(values.test_event_code);
  let testEventCode: string | null = null;
  if (codeRaw.length > 0) {
    if (!TEST_EVENT_CODE_RE.test(codeRaw)) {
      errors.test_event_code =
        "Test event codes look like TEST12345 (from the Test events tab). Leave blank for the live pipeline.";
    } else {
      testEventCode = codeRaw.toUpperCase();
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { pixelId, tokenAction, token, testEventCode } };
}

// ─── Test event ──────────────────────────────────────────────────────────────

/**
 * Input for the "Send test event" CompleteRegistration — same builder
 * as the real signup pipeline (buildCapiEventPayload) so the test
 * exercises the identical payload shape. Distinguishable in Events
 * Manager by the `test-…` event id + `admin-test-event` source.
 */
export function buildTestEventInput(args: {
  uuid: string;
  /** The logged-in client user's email — hashed into user_data. */
  email: string | null;
  /** Unix ms. */
  nowMs: number;
  pageUrl: string;
}): CapiEventInput {
  return {
    eventId: `test-${args.uuid}`,
    eventTime: Math.floor(args.nowMs / 1000),
    eventSourceUrl: args.pageUrl,
    email: args.email,
    phoneE164: null,
    clientIp: null,
    clientUserAgent: null,
    geoCountry: null,
    geoRegion: null,
    source: "admin-test-event",
  };
}

/** Meta Events Manager deep link for a pixel (public id, safe to build). */
export function eventsManagerUrl(pixelId: string): string {
  return `https://business.facebook.com/events_manager2/list/dataset/${encodeURIComponent(pixelId)}/overview`;
}
