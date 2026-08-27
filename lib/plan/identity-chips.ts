import {
  clientSettingsHref,
  type ChannelDefaultProvenance,
  type ResolvedChannelDefaults,
  type ResolvedChannelField,
} from "../clients/channel-defaults.ts";
import type { VizPlatform } from "../viz/tokens.ts";

export type PlanIdentityChip = {
  id: string;
  platform: VizPlatform;
  field: string;
  value: string | null;
  provenance: ChannelDefaultProvenance;
  href: string | null;
};

function chip(
  id: string,
  platform: VizPlatform,
  field: string,
  resolved: ResolvedChannelField<string>,
  clientId: string | null,
): PlanIdentityChip {
  const unset = resolved.provenance === "unset" || !resolved.value;
  return {
    id,
    platform,
    field,
    value: resolved.value,
    provenance: unset ? "unset" : resolved.provenance,
    href: unset ? clientSettingsHref(clientId) : null,
  };
}

/**
 * Compact identity stack for the event-picker chip row.
 * Same resolved object preflight / Prepare already consume.
 */
export function planIdentityChips(
  resolved: ResolvedChannelDefaults,
): PlanIdentityChip[] {
  const clientId = resolved.clientId;
  const identityId = resolved.tiktokIdentity.value?.id ?? null;
  const identityProvenance = resolved.tiktokIdentity.provenance;
  return [
    chip("meta-ad-account", "meta", "ad account", resolved.metaAdAccount, clientId),
    chip("meta-pixel", "meta", "pixel", resolved.metaPixel, clientId),
    chip("meta-page", "meta", "page", resolved.facebookPage, clientId),
    chip("meta-ig", "meta", "ig", resolved.instagramActor, clientId),
    chip("tiktok-advertiser", "tiktok", "advertiser", resolved.tiktokAdvertiser, clientId),
    chip(
      "tiktok-identity",
      "tiktok",
      "identity",
      { value: identityId, provenance: identityProvenance },
      clientId,
    ),
    chip("google-customer", "google", "customer", resolved.googleAdsCustomer, clientId),
  ];
}

export function identityChipDisplay(value: string | null): string {
  if (!value) return "—";
  return value;
}
