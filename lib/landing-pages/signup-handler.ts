import type { FireCapi } from "./capi-fire.ts";
import { hashEmail, hashIp, hashPhone, ipFromForwardedFor } from "./hash.ts";
import type { CapiOutcome } from "./meta-capi.ts";
import { parseSignupSubmission } from "./signup-schema.ts";
import type { SignupDb } from "./signup-store.ts";
import { storeSignup } from "./signup-store.ts";
import type {
  LandingPageContext,
  SignupFormValues,
  SignupGeo,
  SubmitSignupResult,
} from "./types.ts";

/**
 * lib/landing-pages/signup-handler.ts
 *
 * The signup POST pipeline, DI-shaped so node:test drives the full
 * accept/reject matrix without an HTTP harness. The route file
 * (app/api/l/[clientSlug]/[eventSlug]/signup/route.ts) is a thin adapter.
 *
 * Pipeline order is deliberate — cheapest/widest filters first:
 *   1. rate limit        (in-memory, no IO)
 *   2. schema validation (pure)
 *   3. captcha           (external fetch — before ANY DB work so bot floods
 *                         never touch Supabase)
 *   4. context resolve   (slug chain; 404 unknown, 409 when provider is
 *                         'evntree' — the rollback gate covers the API, not
 *                         just the page render)
 *   5. hash + encrypt + store
 *   6. Meta CAPI CompleteRegistration (AFTER the DB write, inline before
 *                         the response so its outcome ships in the debug
 *                         `capi` field. Fail-open: a Meta outage can
 *                         never turn a stored signup into a fan-facing
 *                         error. Fires only for NON-deduplicated
 *                         signups — a repeat signup re-firing the event
 *                         would inflate conversion counts.)
 */

export interface SignupHandlerEnv {
  tokenKey: string | undefined;
  hashSalt: string | undefined;
  turnstileSecret: string | undefined;
  turnstileRequired: boolean;
}

export interface SignupHandlerDeps {
  db: SignupDb;
  resolveContext(
    clientSlug: string,
    eventSlug: string,
  ): Promise<LandingPageContext | null>;
  checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number };
  buildRateLimitKey(
    xForwardedFor: string | null,
    clientSlug: string,
    eventSlug: string,
  ): string;
  verifyCaptcha(
    token: string | null,
    env: SignupHandlerEnv,
  ): Promise<{ ok: boolean; reason?: string }>;
  /**
   * Server-side Meta CAPI CompleteRegistration. Optional — absent means
   * no CAPI leg (and no `capi` debug field), which keeps the PR-2
   * contract intact. The handler passes the pixel id FROM THE RESOLVED
   * CONTEXT and the client id from the same chain — the implementation
   * must not source credentials anywhere else.
   */
  fireCapi?: FireCapi;
  env: SignupHandlerEnv;
  now(): Date;
}

export interface SignupRequestInput {
  clientSlug: string;
  eventSlug: string;
  body: unknown;
  xForwardedFor: string | null;
  userAgent: string | null;
  /** Public URL of the landing page (CAPI event_source_url). */
  pageUrl?: string | null;
  /**
   * Coarse geo from Vercel's x-vercel-ip-* headers (PR 6) — server-derived
   * by the route, NEVER read from the body. Stored plaintext + hashed into
   * CAPI user_data.country / .st.
   */
  geo?: SignupGeo;
}

const EMPTY_GEO: SignupGeo = { country: null, region: null, city: null };

export interface SignupHandlerResponse {
  status: number;
  json: SubmitSignupResult;
}

function fail(
  status: number,
  error: string,
  fieldErrors?: Record<string, string>,
): SignupHandlerResponse {
  return {
    status,
    json: { ok: false, error, ...(fieldErrors ? { field_errors: fieldErrors } : {}) },
  };
}

/** Cloudflare Turnstile server-side verification endpoint. */
export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare Turnstile verification against siteverify. Dev mode: keys
 * unset → warn + skip, UNLESS LANDING_PAGES_TURNSTILE_REQUIRED=1 (prod
 * gate) in which case missing keys is a hard 500-shaped failure.
 * (Flipped from reCAPTCHA v3 pre-merge on PR #667 — free, no Google
 * dependency; unlike v3 there is no score, success is binary.)
 */
export async function verifyTurnstile(
  token: string | null,
  env: SignupHandlerEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; reason?: string }> {
  if (!env.turnstileSecret) {
    if (env.turnstileRequired) {
      return { ok: false, reason: "turnstile_required_but_unconfigured" };
    }
    console.warn(
      "[landing-pages] LANDING_PAGES_TURNSTILE_SECRET_KEY unset — skipping captcha check (dev mode)",
    );
    return { ok: true };
  }
  if (!token) return { ok: false, reason: "missing_captcha_token" };

  try {
    const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.turnstileSecret,
        response: token,
      }).toString(),
    });
    const payload = (await response.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    if (!payload.success) {
      return {
        ok: false,
        reason: `captcha_rejected:${(payload["error-codes"] ?? []).join(",") || "unknown"}`,
      };
    }
    return { ok: true };
  } catch (error) {
    // Cloudflare unreachable: fail OPEN (a fan's signup beats bot paranoia)
    // but loudly — sustained failures show in Vercel logs.
    console.error("[landing-pages] captcha verify errored, failing open:", error);
    return { ok: true };
  }
}

export async function processSignup(
  deps: SignupHandlerDeps,
  input: SignupRequestInput,
): Promise<SignupHandlerResponse> {
  const { clientSlug, eventSlug } = input;

  // 1. Rate limit.
  const rateKey = deps.buildRateLimitKey(input.xForwardedFor, clientSlug, eventSlug);
  const decision = deps.checkRateLimit(rateKey);
  if (!decision.allowed) {
    return fail(429, "Too many signups from this connection — try again shortly.");
  }

  // 2. Validate + normalise.
  if (typeof input.body !== "object" || input.body === null || Array.isArray(input.body)) {
    return fail(400, "Invalid request body.");
  }
  const parsed = parseSignupSubmission(input.body as SignupFormValues);
  if (!parsed.ok) {
    return fail(400, "Validation failed.", parsed.field_errors);
  }

  // 3. Captcha — before any DB work.
  const captchaToken =
    typeof (input.body as SignupFormValues).captcha_token === "string"
      ? ((input.body as SignupFormValues).captcha_token as string)
      : null;
  const captcha = await deps.verifyCaptcha(captchaToken, deps.env);
  if (!captcha.ok) {
    console.error(
      `[landing-pages] captcha failed for ${clientSlug}/${eventSlug}: ${captcha.reason}`,
    );
    return fail(403, "Captcha verification failed — please try again.");
  }

  // 4. Resolve the tenant chain (authorisation-by-resolution, PR-1 model).
  const context = await deps.resolveContext(clientSlug, eventSlug);
  if (!context) {
    return fail(404, "Unknown landing page.");
  }
  if (context.pageEvent.provider !== "internal") {
    // Rollback gate: a page flipped back to Evntr.ee must not silently keep
    // collecting internal signups through the API.
    return fail(409, "This page is not accepting signups here.");
  }

  // 5. Server config — loud 500s beat silent PII mishandling.
  if (!deps.env.tokenKey || deps.env.tokenKey.length < 8) {
    console.error("[landing-pages] LANDING_PAGES_TOKEN_KEY missing/short — cannot store signup");
    return fail(500, "Signup is temporarily unavailable.");
  }
  if (!deps.env.hashSalt || deps.env.hashSalt.length < 8) {
    console.error("[landing-pages] LANDING_PAGES_HASH_SALT missing/short — cannot store signup");
    return fail(500, "Signup is temporarily unavailable.");
  }

  const submission = parsed.data;
  const salt = deps.env.hashSalt;
  const ip = ipFromForwardedFor(input.xForwardedFor);
  const geo = input.geo ?? EMPTY_GEO;

  try {
    const outcome = await storeSignup(deps.db, {
      eventId: context.event.id,
      clientId: context.client.id,
      submission,
      emailHash: submission.email ? hashEmail(submission.email, salt) : null,
      phoneHash: submission.phone_e164 ? hashPhone(submission.phone_e164, salt) : null,
      ipHash: ip ? hashIp(ip, salt) : null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 500) : null,
      geo,
      tokenKey: deps.env.tokenKey,
      now: deps.now(),
    });

    // 6. Meta CAPI CompleteRegistration — after the write, before the response.
    let capi: CapiOutcome | undefined;
    if (deps.fireCapi) {
      if (outcome.deduplicated) {
        capi = { ok: false, skipped: "deduplicated" };
      } else {
        try {
          capi = await deps.fireCapi({
            clientId: context.client.id,
            pixelId: context.landingPage?.meta_pixel_id ?? null,
            submission,
            // Same id the browser pixel fired (validated in step 2);
            // fallback is deterministic per signup so CAPI retries and
            // accidental double-POSTs still dedup on Meta's side.
            eventId: submission.capi_event_id ?? `${outcome.signupId}-cr`,
            eventTime: Math.floor(deps.now().getTime() / 1000),
            eventSourceUrl:
              input.pageUrl ??
              `https://unknown-origin.invalid/l/${clientSlug}/${eventSlug}`,
            clientIp: ip,
            userAgent: input.userAgent ? input.userAgent.slice(0, 500) : null,
            geo,
            tokenKey: deps.env.tokenKey,
          });
        } catch (error) {
          // fireCapi is contractually non-throwing; this is belt-and-braces
          // so a future refactor can still never break a stored signup.
          console.error("[landing-pages capi] unexpected throw:", error);
          capi = { ok: false, error: "capi_internal_error" };
        }
      }
    }

    return {
      status: 200,
      json: {
        ok: true,
        signup_id: outcome.signupId,
        deduplicated: outcome.deduplicated,
        ...(capi ? { capi } : {}),
      },
    };
  } catch (error) {
    console.error(
      `[landing-pages] signup store failed for ${clientSlug}/${eventSlug}:`,
      error,
    );
    return fail(500, "Something went wrong saving your signup — please try again.");
  }
}
