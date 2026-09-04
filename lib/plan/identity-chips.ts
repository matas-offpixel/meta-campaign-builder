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
  /** Resolved display name from a stored cache. Null until known. */
  name: string | null;
  provenance: ChannelDefaultProvenance;
  href: string | null;
};

export type IdentityNameMap = {
  metaAdAccount: Record<string, string>;
  metaPixel: Record<string, string>;
  facebookPage: Record<string, string>;
  instagramActor: Record<string, string>;
  tiktokAdvertiser: Record<string, string>;
  tiktokIdentity: Record<string, string>;
  googleCustomer: Record<string, string>;
};

export const EMPTY_IDENTITY_NAMES: IdentityNameMap = {
  metaAdAccount: {},
  metaPixel: {},
  facebookPage: {},
  instagramActor: {},
  tiktokAdvertiser: {},
  tiktokIdentity: {},
  googleCustomer: {},
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
    name: null,
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

/** Look up a stored name under the raw id, `act_` form, or bare digits. */
export function lookupStoredName(
  map: Record<string, string>,
  value: string | null,
): string | null {
  if (!value) return null;
  if (map[value]) return map[value];
  if (value.startsWith("act_")) {
    const bare = value.slice(4);
    if (map[bare]) return map[bare];
  } else if (map[`act_${value}`]) {
    return map[`act_${value}`];
  }
  return null;
}

function mapForChip(id: string, names: IdentityNameMap): Record<string, string> {
  switch (id) {
    case "meta-ad-account":
      return names.metaAdAccount;
    case "meta-pixel":
      return names.metaPixel;
    case "meta-page":
      return names.facebookPage;
    case "meta-ig":
      return names.instagramActor;
    case "tiktok-advertiser":
      return names.tiktokAdvertiser;
    case "tiktok-identity":
      return names.tiktokIdentity;
    case "google-customer":
      return names.googleCustomer;
    default:
      return {};
  }
}

export function withIdentityNames(
  chips: PlanIdentityChip[],
  names: IdentityNameMap,
): PlanIdentityChip[] {
  return chips.map((row) => ({
    ...row,
    name: lookupStoredName(mapForChip(row.id, names), row.value),
  }));
}

/**
 * Name → id → `null`. `null` is the dashed chip; an id without a name
 * stays the id (unresolved), never blank.
 */
export function identityChipDisplay(
  value: string | null,
  name?: string | null,
): string | null {
  if (!value) return null;
  if (name) return name;
  return value;
}

export function identityChipTip(chip: PlanIdentityChip): string {
  return `${chip.field} · ${chip.name ?? "—"} · ${chip.value ?? "—"} · ${chip.provenance}`;
}

/** Google shows name and customer id together — the id is how operators recognise the account. */
export function identityChipVisibleLabel(chip: PlanIdentityChip): string | null {
  const display = identityChipDisplay(chip.value, chip.name);
  if (display == null) return null;
  if (chip.id === "google-customer" && chip.name && chip.value) {
    return `${chip.name} — ${chip.value}`;
  }
  if (chip.id === "meta-ig" && chip.name && !chip.name.startsWith("@")) {
    return `@${chip.name}`;
  }
  return display;
}
