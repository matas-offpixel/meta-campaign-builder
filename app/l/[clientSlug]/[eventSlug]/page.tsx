import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { getLandingPageContext } from "@/lib/db/landing-pages";
import {
  buildLandingRateLimitKey,
  checkLandingPageRateLimit,
} from "@/lib/landing-pages/rate-limit";
import { resolveLandingPageOutcome } from "@/lib/landing-pages/resolve";
import type { LandingPageContext } from "@/lib/landing-pages/types";

/**
 * app/l/[clientSlug]/[eventSlug]/page.tsx
 *
 * PUBLIC event landing page (PR 1 skeleton — placeholder only; theming,
 * blocks, signup form, and Pixel wiring are PRs 2–4). `/l/` is in
 * PUBLIC_PREFIXES so the default-deny proxy lets unauthenticated fans
 * through; the lookup uses the SERVICE-ROLE client, and authorisation is the
 * slug-resolution chain itself (see lib/db/landing-pages.ts).
 *
 * Behaviours:
 *   unknown client / event / no page_events row → 404
 *   provider 'evntree'                          → redirect to evntree_url
 *   provider 'evntree' with null url            → throw (500, loud)
 *   provider 'internal'                         → placeholder render
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

  return <LandingPagePlaceholder context={outcome.context} />;
}

/**
 * Raw-text placeholder — deliberately unstyled beyond globals. PR 2 owns
 * theming, PR 3 the block renderer, PR 4 the signup form + Pixel/CAPI.
 */
function LandingPagePlaceholder({ context }: { context: LandingPageContext }) {
  const templateKey =
    context.template?.key ??
    (typeof context.pageEvent.content?.template_key === "string"
      ? context.pageEvent.content.template_key
      : "mvp_v1");

  return (
    <main>
      <h1>{context.event.name}</h1>
      <p>Presented by {context.client.name}</p>
      {context.event.venue_name ? (
        <p>
          {context.event.venue_name}
          {context.event.venue_city ? `, ${context.event.venue_city}` : ""}
        </p>
      ) : null}
      {context.event.event_date ? <p>{context.event.event_date}</p> : null}
      <hr />
      <p>
        Landing page scaffold (template: {templateKey}). Theming, content
        blocks, and the signup form arrive in PR 2/3/4.
      </p>
    </main>
  );
}
