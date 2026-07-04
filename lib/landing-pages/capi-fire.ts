import type { SignupDb } from "./signup-store.ts";
import type { CapiOutcome } from "./meta-capi.ts";
import {
  buildCapiEventPayload,
  sendCapiEvent,
  type SendCapiOptions,
} from "./meta-capi.ts";
import type { SignupSubmission } from "./types.ts";

/**
 * lib/landing-pages/capi-fire.ts
 *
 * Bridges the signup pipeline to the CAPI sender: resolves the TENANT's
 * credentials at send time and fires the Lead event. DI-shaped (db +
 * fetch/sleep injectable) so the isolation tests can byte-diff the
 * outgoing call across tenants.
 *
 * Credential silo (C+O non-negotiable C):
 *   - pixel id: passed in from `context.landingPage.meta_pixel_id` — the
 *     row resolved through the clientSlug chain, nothing else.
 *   - CAPI token: decrypted per call via the get_landing_page_capi_token
 *     accessor (migration 135, service_role-only) keyed on THE SAME
 *     client id. Never cached at module level — a memoised token is
 *     exactly the cross-tenant leak this arc bans.
 *   - test_event_code: selected per call from the same client's row.
 *
 * PII note: hashes are computed from the IN-MEMORY validated submission
 * (the same plaintext that was just encrypted into event_signups), then
 * discarded with the request scope. Nothing Meta-formatted is ever stored.
 */

export interface FireCapiArgs {
  clientId: string;
  /** context.landingPage.meta_pixel_id — null means no pixel configured. */
  pixelId: string | null;
  submission: SignupSubmission;
  eventId: string;
  /** Unix seconds. */
  eventTime: number;
  eventSourceUrl: string;
  clientIp: string | null;
  userAgent: string | null;
  tokenKey: string;
}

export type FireCapi = (args: FireCapiArgs) => Promise<CapiOutcome>;

async function resolveTestEventCode(
  db: SignupDb,
  clientId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("client_landing_pages")
    .select("meta_test_event_code")
    .eq("client_id", clientId);
  if (error) {
    console.error(
      `[landing-pages capi] test_event_code lookup failed: ${error.message}`,
    );
    return null;
  }
  const row = (data ?? [])[0] as
    | { meta_test_event_code?: string | null }
    | undefined;
  return row?.meta_test_event_code ?? null;
}

async function decryptCapiToken(
  db: SignupDb,
  clientId: string,
  tokenKey: string,
): Promise<string | null> {
  const { data, error } = await db.rpc("get_landing_page_capi_token", {
    p_client_id: clientId,
    p_key: tokenKey,
  });
  if (error) {
    console.error(
      `[landing-pages capi] token decrypt failed: ${error.message}`,
    );
    return null;
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * Fire the server-side Lead. Never throws; never blocks signup success
 * beyond the sender's 6s deadline. Returns the debug outcome echoed in
 * the signup response.
 */
export async function fireLeadCapi(
  db: SignupDb,
  args: FireCapiArgs,
  options: SendCapiOptions = {},
): Promise<CapiOutcome> {
  if (!args.pixelId) {
    return { ok: false, skipped: "not_configured" };
  }

  const accessToken = await decryptCapiToken(db, args.clientId, args.tokenKey);
  if (!accessToken) {
    // Pixel set but no CAPI token: browser pixel still tracks; server leg
    // silently (well — loudly) off until Matas sets the token.
    console.error(
      `[landing-pages capi] pixel configured but no CAPI token for client ${args.clientId} — skipping server event`,
    );
    return { ok: false, skipped: "not_configured" };
  }

  const testEventCode = await resolveTestEventCode(db, args.clientId);

  const payload = buildCapiEventPayload(
    {
      eventId: args.eventId,
      eventTime: args.eventTime,
      eventSourceUrl: args.eventSourceUrl,
      email: args.submission.email,
      phoneE164: args.submission.phone_e164,
      clientIp: args.clientIp,
      clientUserAgent: args.userAgent,
      source: args.submission.source,
    },
    testEventCode,
  );

  return sendCapiEvent(
    payload,
    { pixelId: args.pixelId, accessToken, testEventCode },
    options,
  );
}
