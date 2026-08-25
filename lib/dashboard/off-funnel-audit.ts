import { destinationUrlsMatch } from "../wizard/lp-destination.ts";

/**
 * lib/dashboard/off-funnel-audit.ts
 *
 * Phase B.3 — which LIVE campaigns still point off-funnel while their
 * event has an instrumented landing page. Pure: fixtures pin the
 * invariant (on-funnel / off-funnel-with-LP / no-LP → only the middle
 * class is listed).
 *
 * Destination URLs come from cached snapshots, never a live platform
 * read. Actions are honest about what each platform permits:
 *
 *   Meta — AdCreative POST allows only name / status / adlabels
 *   (developers.facebook.com/docs/marketing-api/reference/ad-creative/).
 *   Destination is not updatable in place.
 *
 *   TikTok — AdupdateCreatives.landing_page_url exists on
 *   raw.githubusercontent.com/tiktok/tiktok-business-api-sdk/.../AdupdateCreatives.md
 *   but a safe update needs the rest of the ad (video_id, identity).
 *   Snapshots do not carry that; this path will not call /ad/get/.
 *
 * Neither platform gets an in-place write. The offered action is
 * "Relaunch with event page" (B.1 wizard offer), not a silent swap.
 */

export type OffFunnelPlatform = "meta" | "tiktok";

export type OffFunnelSkipReason =
  | "no_lp"
  | "already_on_funnel"
  | "no_website_destination"
  | "inactive";

export interface LiveCampaignDestination {
  campaignId: string;
  campaignName: string;
  platform: OffFunnelPlatform;
  /** Snapshot destination. Null = unrecoverable (empty ≠ off-funnel). */
  destinationUrl: string | null;
  spend: number;
  active: boolean;
  eventId: string;
  eventName: string;
}

export interface EventLandingPageRef {
  eventId: string;
  eventName: string;
  eventPageUrl: string | null;
}

export interface OffFunnelAuditRow {
  campaignId: string;
  campaignName: string;
  platform: OffFunnelPlatform;
  currentDestination: string;
  eventId: string;
  eventName: string;
  eventPageUrl: string;
  spend: number;
  action: OffFunnelRelaunchAction;
}

export interface OffFunnelRelaunchAction {
  kind: "relaunch";
  label: "Relaunch with event page";
  href: string;
  reason: string;
}

export const META_CREATIVE_IMMUTABLE_REASON =
  "Meta AdCreative updates allow only name, status, and adlabels — not the destination URL. Changing it means a new creative. This opens a new draft; the wizard offers the event page.";

export const TIKTOK_PARTIAL_UPDATE_UNSAFE_REASON =
  "TikTok lists landing_page_url on AdupdateCreatives, but a safe in-place update needs the full ad (video, identity). Snapshots do not carry that, and this path will not call TikTok. This opens a new draft; the wizard offers the event page.";

export function isOnPlatformCreativeUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    return path.includes("/video/") || path.startsWith("/@");
  }
  if (host === "instagram.com") {
    return path.startsWith("/p/") || path.startsWith("/reel/") || path.startsWith("/tv/");
  }
  if (host === "facebook.com" || host === "fb.com" || host === "fb.watch") {
    return (
      path.includes("/reel") ||
      path.includes("/videos/") ||
      path.includes("/watch") ||
      host === "fb.watch"
    );
  }
  return false;
}

export function isRecoverableWebsiteDestination(
  raw: string | null | undefined,
): raw is string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return !isOnPlatformCreativeUrl(trimmed);
}

export function relaunchActionFor(
  platform: OffFunnelPlatform,
  eventId: string,
): OffFunnelRelaunchAction {
  if (platform === "tiktok") {
    return {
      kind: "relaunch",
      label: "Relaunch with event page",
      href: `/tiktok/new?event=${encodeURIComponent(eventId)}`,
      reason: TIKTOK_PARTIAL_UPDATE_UNSAFE_REASON,
    };
  }
  return {
    kind: "relaunch",
    label: "Relaunch with event page",
    href: `/events/${encodeURIComponent(eventId)}`,
    reason: META_CREATIVE_IMMUTABLE_REASON,
  };
}

/**
 * Why a live campaign must not appear on the migration list — or
 * why a "migrate" action is a no-op. On-funnel can never be migrated.
 */
export function offFunnelSkipReason(
  live: LiveCampaignDestination,
  lp: EventLandingPageRef | undefined,
): OffFunnelSkipReason | null {
  if (!live.active) return "inactive";
  if (!lp?.eventPageUrl) return "no_lp";
  if (!isRecoverableWebsiteDestination(live.destinationUrl)) {
    return "no_website_destination";
  }
  if (destinationUrlsMatch(live.destinationUrl, lp.eventPageUrl)) {
    return "already_on_funnel";
  }
  return null;
}

export function canProposeMigration(
  live: LiveCampaignDestination,
  lp: EventLandingPageRef | undefined,
): boolean {
  return offFunnelSkipReason(live, lp) === null;
}

/**
 * Collapse per-creative snapshot rows to one audit row per
 * (platform, campaign, event). Spend is the sum of off-funnel
 * slices only. On-funnel / no-LP / unknown destination never appear.
 */
export function selectOffFunnelAuditRows(
  live: readonly LiveCampaignDestination[],
  lpByEventId: Readonly<Record<string, EventLandingPageRef>>,
): OffFunnelAuditRow[] {
  const buckets = new Map<
    string,
    {
      campaignId: string;
      campaignName: string;
      platform: OffFunnelPlatform;
      eventId: string;
      eventName: string;
      eventPageUrl: string;
      spend: number;
      destination: string;
    }
  >();

  for (const row of live) {
    const lp = lpByEventId[row.eventId];
    if (!canProposeMigration(row, lp) || !lp?.eventPageUrl) continue;
    const dest = row.destinationUrl!.trim();
    const key = `${row.platform}:${row.eventId}:${row.campaignId}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.spend += row.spend;
      continue;
    }
    buckets.set(key, {
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      platform: row.platform,
      eventId: row.eventId,
      eventName: lp.eventName || row.eventName,
      eventPageUrl: lp.eventPageUrl,
      spend: row.spend,
      destination: dest,
    });
  }

  return [...buckets.values()]
    .map((b) => ({
      campaignId: b.campaignId,
      campaignName: b.campaignName,
      platform: b.platform,
      currentDestination: b.destination,
      eventId: b.eventId,
      eventName: b.eventName,
      eventPageUrl: b.eventPageUrl,
      spend: b.spend,
      action: relaunchActionFor(b.platform, b.eventId),
    }))
    .sort((a, b) => b.spend - a.spend);
}
