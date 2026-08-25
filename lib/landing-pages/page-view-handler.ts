import type { LandingPageContext, SignupGeo } from "./types.ts";
import {
  sanitizeReferrerUrl,
  sanitizeUtm,
} from "./signup-schema.ts";

/**
 * Public LP page-view capture. No PII, no cookies, no fingerprint.
 * Counts views, not people. Failures never 500 to the fan.
 */

export interface PageViewHandlerDeps {
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
  insertView(row: PageViewInsert): Promise<void>;
  now(): Date;
}

export interface PageViewInsert {
  eventId: string;
  occurredAt: string;
  utm: Record<string, string>;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
  referrer: string | null;
}

export interface PageViewRequestInput {
  clientSlug: string;
  eventSlug: string;
  method: string;
  body: unknown;
  xForwardedFor: string | null;
  userAgent: string | null;
  geo?: SignupGeo;
}

export interface PageViewHandlerResponse {
  status: number;
  json: { ok: boolean; error?: string; skipped?: string };
}

const EMPTY_GEO: SignupGeo = { country: null, region: null, city: null };

const BOT_UA =
  /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|linkedinbot|pingdom|uptimerobot|headlesschrome|phantomjs|crawler|spider/i;

export function isObviousBotUserAgent(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return BOT_UA.test(userAgent);
}

export function parsePageViewBody(
  body: unknown,
):
  | { ok: true; utm: Record<string, string>; referrer_url: string | null }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }
  const record = body as Record<string, unknown>;
  return {
    ok: true,
    utm: sanitizeUtm(record.utm),
    referrer_url: sanitizeReferrerUrl(record.referrer_url),
  };
}

function ok(
  status: number,
  extra?: { skipped?: string },
): PageViewHandlerResponse {
  return { status, json: { ok: true, ...extra } };
}

function fail(status: number, error: string): PageViewHandlerResponse {
  return { status, json: { ok: false, error } };
}

export async function processPageView(
  deps: PageViewHandlerDeps,
  input: PageViewRequestInput,
): Promise<PageViewHandlerResponse> {
  const method = input.method.toUpperCase();
  if (method === "HEAD" || method === "GET") {
    return fail(405, "Method not allowed.");
  }
  if (method !== "POST") {
    return fail(405, "Method not allowed.");
  }

  const { clientSlug, eventSlug } = input;
  if (!clientSlug || !eventSlug) {
    return fail(400, "Unknown landing page.");
  }

  const rateKey = deps.buildRateLimitKey(input.xForwardedFor, clientSlug, eventSlug);
  const decision = deps.checkRateLimit(rateKey);
  if (!decision.allowed) {
    return fail(429, "Too many views from this connection — try again shortly.");
  }

  if (isObviousBotUserAgent(input.userAgent)) {
    return ok(204, { skipped: "bot_ua" });
  }

  const parsed = parsePageViewBody(input.body);
  if (!parsed.ok) return fail(400, parsed.error);

  const context = await deps.resolveContext(clientSlug, eventSlug);
  if (!context) return fail(404, "Unknown landing page.");
  if (context.pageEvent.status !== "live") {
    return ok(204, { skipped: "not_live" });
  }
  if (context.pageEvent.provider !== "internal") {
    return ok(204, { skipped: "not_internal" });
  }

  const geo = input.geo ?? EMPTY_GEO;
  try {
    await deps.insertView({
      eventId: context.event.id,
      occurredAt: deps.now().toISOString(),
      utm: parsed.utm,
      geoCountry: geo.country,
      geoRegion: geo.region,
      geoCity: geo.city,
      referrer: parsed.referrer_url,
    });
    return ok(204);
  } catch (error) {
    console.error(
      `[landing-pages] page-view store failed for ${clientSlug}/${eventSlug}:`,
      error,
    );
    return ok(204, { skipped: "store_failed" });
  }
}
