/**
 * Option rows for the TikTok advertiser and pixel Comboboxes.
 *
 * The saved value is the id the `<select>` already stored: the
 * `tiktok_accounts` row id for the advertiser, `pixel_id` for the pixel.
 * The label is name + id; keywords carry the id with and without
 * separators so a pasted Ads Manager id matches.
 */

import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";

// Same strings as the Meta fallback in lib/meta/account-picker-options.ts.
export const UNNAMED_ACCOUNT_LABEL = "Unnamed account";
export const UNNAMED_PIXEL_LABEL = "Unnamed pixel";

export type TikTokPickerRow = {
  value: string;
  label: string;
  sublabel?: string;
  keywords: string;
};

export type TikTokAdvertiserPickerInput = {
  id: string;
  account_name: string | null;
  tiktok_advertiser_id: string | null;
};

export type TikTokPixelPickerInput = {
  pixel_id: string;
  pixel_name: string | null;
  status: string | null;
};

function idKeywords(id: string): string[] {
  const digits = /^[\d\s-]+$/.test(id) ? id.replace(/\D/g, "") : "";
  return [...new Set([id, digits].filter(Boolean))];
}

function isUnnamed(name: string, id: string): boolean {
  return !name || name.toLowerCase() === id.toLowerCase();
}

function sortRows(rows: Array<{ row: TikTokPickerRow; unnamed: boolean }>): TikTokPickerRow[] {
  rows.sort((a, b) => {
    if (a.unnamed !== b.unnamed) return a.unnamed ? 1 : -1;
    const byName = a.row.label.localeCompare(b.row.label, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return a.row.value.localeCompare(b.row.value);
  });
  return rows.map(({ row }) => row);
}

/** Accounts without an advertiser id stay out, as they did in the select. */
export function tikTokAdvertiserPickerOptions(
  accounts: readonly TikTokAdvertiserPickerInput[],
): TikTokPickerRow[] {
  const rows = accounts
    .filter((account) => Boolean(account.tiktok_advertiser_id))
    .map((account) => {
      const advertiserId = account.tiktok_advertiser_id as string;
      const name = (account.account_name ?? "").trim();
      const unnamed = isUnnamed(name, advertiserId);
      return {
        row: {
          value: account.id,
          label: `${unnamed ? UNNAMED_ACCOUNT_LABEL : name} (${advertiserId})`,
          keywords: [unnamed ? "" : name, ...idKeywords(advertiserId)].filter(Boolean).join(" "),
        },
        unnamed,
      };
    });
  return sortRows(rows);
}

export function tikTokPixelPickerOptions(
  pixels: readonly TikTokPixelPickerInput[],
): TikTokPickerRow[] {
  const rows = pixels.map((pixel) => {
    const name = (pixel.pixel_name ?? "").trim();
    const unnamed = isUnnamed(name, pixel.pixel_id);
    return {
      row: {
        value: pixel.pixel_id,
        label: `${unnamed ? UNNAMED_PIXEL_LABEL : name} (${pixel.pixel_id})`,
        sublabel: pixel.status || undefined,
        keywords: [unnamed ? "" : name, ...idKeywords(pixel.pixel_id)].filter(Boolean).join(" "),
      },
      unnamed,
    };
  });
  return sortRows(rows);
}

/**
 * The `accountSetup` patch for a picked advertiser row value. Identity,
 * pixel, event, and currency reset because they belong to the previous
 * advertiser.
 */
export function tikTokAdvertiserSelectionPatch(
  accounts: readonly TikTokAdvertiserPickerInput[],
  accountId: string,
): Partial<TikTokCampaignDraft["accountSetup"]> {
  const account = accounts.find((candidate) => candidate.id === accountId);
  return {
    tiktokAccountId: account?.id ?? null,
    advertiserId: account?.tiktok_advertiser_id ?? null,
    identityId: null,
    identityDisplayName: null,
    identityManualName: null,
    identityBcId: null,
    identityType: null,
    pixelId: null,
    pixelName: null,
    optimisationEvent: null,
    currency: null,
  };
}

/** The `accountSetup` patch for a picked pixel row value. */
export function tikTokPixelSelectionPatch(
  pixels: readonly TikTokPixelPickerInput[],
  pixelId: string,
): Partial<TikTokCampaignDraft["accountSetup"]> {
  const pixel = pixels.find((candidate) => candidate.pixel_id === pixelId);
  return {
    pixelId: pixel?.pixel_id ?? null,
    pixelName: pixel?.pixel_name ?? null,
    optimisationEvent: null,
  };
}
