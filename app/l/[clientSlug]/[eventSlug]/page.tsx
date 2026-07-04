import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { after } from "next/server";

import { LandingPage } from "@/components/landing-pages/landing-page";
import { getLandingPageContext } from "@/lib/db/landing-pages";
import {
  maybeExtractAndPersistPalette,
  type PaletteDb,
} from "@/lib/landing-pages/palette-extract";
import {
  buildLandingRateLimitKey,
  checkLandingPageRateLimit,
} from "@/lib/landing-pages/rate-limit";
import { resolveLandingPageOutcome } from "@/lib/landing-pages/resolve";
import type { LandingPageContext } from "@/lib/landing-pages/types";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * app/l/[clientSlug]/[eventSlug]/page.tsx
 *
 * PUBLIC event landing page. PR 2: themed renderer + signup form
 * (components/landing-pages/); Pixel wiring is PR 3, CAPI is PR 4. `/l/`
 * is in PUBLIC_PREFIXES so the default-deny proxy lets unauthenticated fans
 * through; the lookup uses the SERVICE-ROLE client, and authorisation is the
 * slug-resolution chain itself (see lib/db/landing-pages.ts).
 *
 * Behaviours:
 *   unknown client / event / no page_events row → 404
 *   provider 'evntree'                          → redirect to evntree_url
 *   provider 'evntree' with null url            → throw (500, loud)
 *   provider 'internal'                         → themed render (PR 2)
 *
 * NOTE: Next.js page redirects emit 307 (temporary), not a literal 302 — a
 * page component cannot set a bare status code. Both are non-cacheable
 * temporary redirects, which is the contract the Evntr.ee fallback needs.
 */

export default async function EventLandingPage({
  params,
}: {
  params: Promise<{ clientSlug: string; eventSlug: string }>;
}) {
  const [{ clientSlug, eventSlug }, headerList] = await Promise.all([
    params,
    headers(),
  ]);

  // In-process per-IP budget (60 req/min) so a looped URL can't turn every
  // request into DB lookups. Runs BEFORE any query.
  const rateKey = buildLandingRateLimitKey(headerList.get("x-forwarded-for"));
  const decision = checkLandingPageRateLimit(rateKey);
  if (!decision.allowed) {
    return (
      <main>
        <p>Too many requests — try again in a moment.</p>
      </main>
    );
  }

  const context = await getLandingPageContext(clientSlug, eventSlug);
  const outcome = resolveLandingPageOutcome(context);

  if (!outcome) notFound();

  if (outcome.kind === "redirect") {
    redirect(outcome.url);
  }

  if (outcome.kind === "misconfigured") {
    // Loud-fail: 500 beats silently redirecting a fan to a blank target.
    throw new Error(`[/l ${clientSlug}/${eventSlug}] ${outcome.reason}`);
  }

  // PR 6: lazy palette extraction. Nothing in the app writes LP artwork
  // (manual SQL + seed script only), so there is no write path to hook —
  // instead, the first render of a page with artwork but no stored
  // palette extracts + persists it in the background. Fire-and-forget
  // via after(); never blocks or fails the fan-facing response.
  schedulePaletteExtraction(outcome.context);

  // Turnstile site key is read server-side and handed to the client island
  // as a prop — keeps the env var un-prefixed (no NEXT_PUBLIC_) per the
  // agreed env contract.
  return (
    <LandingPage
      context={outcome.context}
      turnstileSiteKey={process.env.LANDING_PAGES_TURNSTILE_SITE_KEY ?? null}
    />
  );
}

function schedulePaletteExtraction(context: LandingPageContext): void {
  const pageEvent = context.pageEvent;
  if (pageEvent.artwork_palette != null) return;

  // First hero image wins; fall back to the artwork URL (same precedence
  // as the renderer). Raw values here — the extractor re-validates.
  const heroImages = Array.isArray(pageEvent.hero_images)
    ? pageEvent.hero_images.filter((v): v is string => typeof v === "string")
    : [];
  const contentArtwork = pageEvent.content?.["artwork_url"];
  const imageUrl =
    heroImages[0] ??
    (typeof contentArtwork === "string" ? contentArtwork : null);
  if (!imageUrl) return;

  after(async () => {
    const db = createServiceRoleClient() as unknown as PaletteDb;
    await maybeExtractAndPersistPalette(db, pageEvent.id, imageUrl);
  });
}
