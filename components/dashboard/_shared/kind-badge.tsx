import type { EventKind } from "@/lib/db/events";

/**
 * Engagement-type badge for event rows. Renders a neutral "Event" pill or
 * an accented "Brand" pill based on the discriminator added by migration
 * 027. Pure render — safe to use from server components.
 *
 * Visual style mirrors `StatusPill` (compact, 10px font) so a row carrying
 * both badges keeps a consistent rhythm. Brand uses the primary-light
 * accent — distinct from any in-use status colour and deliberately NOT
 * TIKTOK_PINK, which is reserved for the TikTok report tab.
 */
export function KindBadge({ kind }: { kind: EventKind }) {
  if (kind === "brand_campaign") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-primary-light text-foreground">
        Brand
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">
      Event
    </span>
  );
}
