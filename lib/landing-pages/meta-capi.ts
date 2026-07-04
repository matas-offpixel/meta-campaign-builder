import { createHash } from "node:crypto";

/**
 * lib/landing-pages/meta-capi.ts
 *
 * Server-side Meta Conversions API for the landing pages (PR 3). SERVER
 * ONLY (node:crypto). Deliberately self-contained — zero imports from
 * lib/meta/** (that is Off/Pixel's OPERATIONAL Graph client with its own
 * token plumbing; sharing code paths with the per-CLIENT pixel/token silo
 * is exactly the wrong-credential bug class the isolation contract bans).
 *
 * Hash contract (Meta CAPI user_data spec):
 *   em = sha256(lowercase(trim(email)))          — UNSALTED
 *   ph = sha256(digits-only E.164, no '+')       — UNSALTED
 * This is the OPPOSITE of lib/landing-pages/hash.ts (salted + namespaced
 * dedupe hashes). They are not interchangeable — pinned by test.
 *
 * Retry policy (Meta CAPI has documented intermittent 5xxs):
 *   max 3 attempts, backoff 200ms → 500ms → 1200ms, 2s hard cap per
 *   attempt, 6s total deadline across everything. 4xx responses are
 *   PERMANENT failures (bad token / bad pixel / malformed payload) — no
 *   retry, they will not heal. The SAME event_id is sent on every retry:
 *   Meta dedups on (event_name, event_id) for 48h, so retries are
 *   idempotent; a per-attempt id would CREATE duplicates.
 *
 * Fail-open-loudly: sendCapiEvent never throws. A fan's signup success
 * must not depend on Meta being up; failures return {ok:false} and are
 * console.error'd with the `[landing-pages capi]` prefix.
 */

export const CAPI_API_VERSION =
  process.env.LANDING_PAGES_META_API_VERSION ?? "v21.0";

const ATTEMPT_TIMEOUT_MS = 2_000;
const TOTAL_DEADLINE_MS = 6_000;
const BACKOFF_MS = [200, 500, 1_200] as const;
const MAX_ATTEMPTS = 3;

/** Outcome surfaced in the signup response's debug `capi` field. */
export interface CapiOutcome {
  ok: boolean;
  fbtrace_id?: string;
  error?: string;
  /** "not_configured" | "deduplicated" | "no_contact_data" */
  skipped?: string;
}

/** Per-client CAPI credentials, resolved at send time (never cached). */
export interface CapiCredentials {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
}

/**
 * Meta's unsalted sha256 for CAPI user_data. Lowercase + trim, hex digest.
 * Returns null on empty so callers drop the field instead of hashing "".
 * NOT for storage, NOT for dedupe — see hash.ts for the salted family.
 */
export function hashForCapi(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalised = value.trim().toLowerCase();
  if (normalised.length === 0) return null;
  return createHash("sha256").update(normalised, "utf8").digest("hex");
}

/** E.164 → Meta's phone format: digits only, country code, no '+'. */
export function normalizePhoneForCapi(
  phoneE164: string | null | undefined,
): string | null {
  if (!phoneE164) return null;
  const digits = phoneE164.replace(/[^0-9]/g, "");
  return digits.length > 0 ? digits : null;
}

export interface CapiEventInput {
  eventId: string;
  /** Unix seconds. */
  eventTime: number;
  eventSourceUrl: string;
  email: string | null;
  phoneE164: string | null;
  clientIp: string | null;
  clientUserAgent: string | null;
  source: string | null;
}

export interface CapiEventPayload {
  data: Array<Record<string, unknown>>;
  test_event_code?: string;
}

/**
 * Build the /events payload. PII is hashed here at send time from the
 * just-decrypted values and never persisted in this form.
 */
export function buildCapiEventPayload(
  input: CapiEventInput,
  testEventCode: string | null,
): CapiEventPayload {
  const userData: Record<string, unknown> = {};
  const em = hashForCapi(input.email);
  if (em) userData.em = [em];
  const ph = hashForCapi(normalizePhoneForCapi(input.phoneE164));
  if (ph) userData.ph = [ph];
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;

  const payload: CapiEventPayload = {
    data: [
      {
        event_name: "Lead",
        event_time: input.eventTime,
        event_id: input.eventId,
        event_source_url: input.eventSourceUrl,
        action_source: "website",
        user_data: userData,
        custom_data: { source: input.source, value: null },
      },
    ],
  };
  if (testEventCode) payload.test_event_code = testEventCode;
  return payload;
}

export interface SendCapiOptions {
  fetchImpl?: typeof fetch;
  /** Injectable for tests — defaults to real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST the event to the CLIENT's pixel with the CLIENT's token. The
 * access_token travels as a URL param per Meta's spec — never log the URL.
 */
export async function sendCapiEvent(
  payload: CapiEventPayload,
  credentials: CapiCredentials,
  options: SendCapiOptions = {},
): Promise<CapiOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const url =
    `https://graph.facebook.com/${CAPI_API_VERSION}/` +
    `${encodeURIComponent(credentials.pixelId)}/events` +
    `?access_token=${encodeURIComponent(credentials.accessToken)}`;

  const eventId = String(
    (payload.data[0] as { event_id?: unknown })?.event_id ?? "unknown",
  );
  const deadline = now() + TOTAL_DEADLINE_MS;
  let lastError = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      lastError = "total_deadline_exceeded";
      break;
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(ATTEMPT_TIMEOUT_MS, remaining),
    );

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      let body: {
        events_received?: number;
        fbtrace_id?: string;
        error?: { message?: string; fbtrace_id?: string };
      } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        // Non-JSON body — status code drives the outcome below.
      }

      if (response.ok) {
        const fbtraceId = body.fbtrace_id ?? body.error?.fbtrace_id;
        console.error(
          `[landing-pages capi] Lead sent ok event_id=${eventId} fbtrace_id=${fbtraceId ?? "n/a"} attempt=${attempt}`,
        );
        return { ok: true, ...(fbtraceId ? { fbtrace_id: fbtraceId } : {}) };
      }

      const fbtraceId = body.error?.fbtrace_id ?? body.fbtrace_id;
      lastError = `http_${response.status}: ${body.error?.message ?? "no message"}`;

      if (response.status < 500) {
        // 4xx is permanent (bad token / pixel / payload) — retrying cannot
        // heal it and burns the fan's response-time budget.
        console.error(
          `[landing-pages capi] Lead REJECTED event_id=${eventId} ${lastError} fbtrace_id=${fbtraceId ?? "n/a"} (permanent, no retry)`,
        );
        return {
          ok: false,
          error: lastError,
          ...(fbtraceId ? { fbtrace_id: fbtraceId } : {}),
        };
      }

      console.error(
        `[landing-pages capi] Lead attempt ${attempt}/${MAX_ATTEMPTS} failed event_id=${eventId} ${lastError} fbtrace_id=${fbtraceId ?? "n/a"}`,
      );
    } catch (error) {
      clearTimeout(timer);
      lastError =
        error instanceof Error && error.name === "AbortError"
          ? `timeout_after_${ATTEMPT_TIMEOUT_MS}ms`
          : `network_error: ${error instanceof Error ? error.message : String(error)}`;
      console.error(
        `[landing-pages capi] Lead attempt ${attempt}/${MAX_ATTEMPTS} errored event_id=${eventId} ${lastError}`,
      );
    }

    if (attempt < MAX_ATTEMPTS) {
      const backoff = BACKOFF_MS[attempt - 1];
      if (now() + backoff >= deadline) {
        lastError = `${lastError}; total_deadline_exceeded`;
        break;
      }
      await sleep(backoff);
    }
  }

  console.error(
    `[landing-pages capi] Lead FAILED after retries event_id=${eventId} last_error=${lastError} — failing open, signup unaffected`,
  );
  return { ok: false, error: lastError };
}
