/**
 * Client-side page-view fire. sendBeacon first, fetch keepalive fallback.
 * Capture failure must never throw — the LP is a conversion surface.
 */

export interface PageViewBeaconTransport {
  sendBeacon?: (url: string, data: BodyInit) => boolean;
  fetch?: (
    url: string,
    init: { method: string; body: string; headers: Record<string, string>; keepalive: boolean },
  ) => Promise<unknown>;
}

export function fireLandingPageView(
  url: string,
  body: string,
  transport: PageViewBeaconTransport = {},
): { method: "sendBeacon" | "fetch" | "none" } {
  try {
    const sendBeacon = transport.sendBeacon;
    if (typeof sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (sendBeacon(url, blob)) return { method: "sendBeacon" };
    }
  } catch {
    // Fall through to fetch.
  }

  try {
    const fetchImpl = transport.fetch;
    if (typeof fetchImpl === "function") {
      void fetchImpl(url, {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => undefined);
      return { method: "fetch" };
    }
  } catch {
    // Capture must never break render.
  }
  return { method: "none" };
}

export function buildPageViewPayload(args: {
  utm: Record<string, string>;
  referrer_url: string | null;
}): string {
  return JSON.stringify({
    utm: args.utm,
    referrer_url: args.referrer_url,
  });
}
