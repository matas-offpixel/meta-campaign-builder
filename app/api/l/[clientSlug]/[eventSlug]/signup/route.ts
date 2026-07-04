import { NextResponse } from "next/server";

import { fireLeadCapi } from "@/lib/landing-pages/capi-fire";
import { getLandingPageContext } from "@/lib/db/landing-pages";
import {
  processSignup,
  verifyTurnstile,
  type SignupHandlerEnv,
} from "@/lib/landing-pages/signup-handler";
import {
  buildSignupRateLimitKey,
  checkSignupRateLimit,
} from "@/lib/landing-pages/rate-limit";
import type { SignupDb } from "@/lib/landing-pages/signup-store";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * app/api/l/[clientSlug]/[eventSlug]/signup/route.ts
 *
 * PUBLIC signup endpoint for the internal landing pages (PR 2). Thin HTTP
 * adapter — the whole pipeline (rate limit → validation → captcha → tenant
 * resolution → hash/encrypt/store) lives in
 * lib/landing-pages/signup-handler.ts where node:test drives it directly.
 *
 * `/api/l/` is in PUBLIC_PREFIXES (fans have no session); the service-role
 * client performs the insert because event_signups has NO write policies —
 * PostgREST-level anonymous writes are impossible by construction, and this
 * route is the single, defended write path.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handlerEnv(): SignupHandlerEnv {
  return {
    tokenKey: process.env.LANDING_PAGES_TOKEN_KEY,
    hashSalt: process.env.LANDING_PAGES_HASH_SALT,
    turnstileSecret: process.env.LANDING_PAGES_TURNSTILE_SECRET_KEY,
    turnstileRequired: process.env.LANDING_PAGES_TURNSTILE_REQUIRED === "1",
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientSlug: string; eventSlug: string }> },
) {
  const { clientSlug, eventSlug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const db = createServiceRoleClient() as unknown as SignupDb;

  // CAPI event_source_url: the public page this signup came from. Origin
  // from the request URL (Vercel rewrites preserve the public host).
  let pageUrl: string | null = null;
  try {
    pageUrl = `${new URL(request.url).origin}/l/${encodeURIComponent(clientSlug)}/${encodeURIComponent(eventSlug)}`;
  } catch {
    pageUrl = null;
  }

  const result = await processSignup(
    {
      db,
      resolveContext: getLandingPageContext,
      checkRateLimit: (key) => checkSignupRateLimit(key),
      buildRateLimitKey: buildSignupRateLimitKey,
      verifyCaptcha: verifyTurnstile,
      // PR 3: server-side Meta CAPI Lead — same db handle, credentials
      // resolved per call from the tenant's client_landing_pages row.
      fireCapi: (args) => fireLeadCapi(db, args),
      env: handlerEnv(),
      now: () => new Date(),
    },
    {
      clientSlug,
      eventSlug,
      body,
      xForwardedFor: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      pageUrl,
    },
  );

  return NextResponse.json(result.json, { status: result.status });
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method not allowed." },
    { status: 405, headers: { allow: "POST" } },
  );
}
