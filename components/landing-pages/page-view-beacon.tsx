"use client";

import { useEffect } from "react";

import { captureAttribution } from "@/lib/landing-pages/attribution";
import {
  buildPageViewPayload,
  fireLandingPageView,
} from "@/lib/landing-pages/page-view-beacon";

/**
 * One POST per LP load. sendBeacon with fetch fallback. Never blocks
 * or breaks render — capture errors are swallowed.
 */
export function PageViewBeacon({
  clientSlug,
  eventSlug,
}: {
  clientSlug: string;
  eventSlug: string;
}) {
  useEffect(() => {
    const attribution = captureAttribution(
      window.location.search,
      document.referrer,
    );
    const url = `/api/l/${encodeURIComponent(clientSlug)}/${encodeURIComponent(eventSlug)}/view`;
    fireLandingPageView(
      url,
      buildPageViewPayload({
        utm: attribution.utm,
        referrer_url: attribution.referrer_url,
      }),
    );
  }, [clientSlug, eventSlug]);

  return null;
}
