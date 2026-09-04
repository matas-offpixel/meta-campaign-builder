import "server-only";

import { readUserAdAccountListCache } from "@/lib/db/user-ad-account-list-cache";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_IDENTITY_NAMES,
  type IdentityNameMap,
} from "./identity-chips.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any, any, any>;

function put(map: Record<string, string>, key: string | null | undefined, name: string | null | undefined) {
  const id = key?.trim();
  const label = name?.trim();
  if (!id || !label) return;
  map[id] = label;
}

/**
 * Stored-cache identity names for the canvas chips. Never calls Meta,
 * TikTok or Google — BM sync tables, the ad-account list cache,
 * `tiktok_accounts` and `google_ads_accounts` only.
 */
export async function loadIdentityNameMap(
  userClient: AnyClient,
  userId: string,
  googleAdsAccounts: Array<{
    account_name: string | null;
    google_customer_id: string | null;
  }> = [],
): Promise<IdentityNameMap> {
  const names: IdentityNameMap = {
    metaAdAccount: { ...EMPTY_IDENTITY_NAMES.metaAdAccount },
    metaPixel: { ...EMPTY_IDENTITY_NAMES.metaPixel },
    facebookPage: { ...EMPTY_IDENTITY_NAMES.facebookPage },
    instagramActor: { ...EMPTY_IDENTITY_NAMES.instagramActor },
    tiktokAdvertiser: { ...EMPTY_IDENTITY_NAMES.tiktokAdvertiser },
    tiktokIdentity: { ...EMPTY_IDENTITY_NAMES.tiktokIdentity },
    googleCustomer: { ...EMPTY_IDENTITY_NAMES.googleCustomer },
  };

  for (const row of googleAdsAccounts) {
    put(names.googleCustomer, row.google_customer_id, row.account_name);
    const digits = row.google_customer_id?.replace(/-/g, "") ?? "";
    if (digits && row.account_name) put(names.googleCustomer, digits, row.account_name);
  }

  try {
    const { data: tiktokRows } = await userClient
      .from("tiktok_accounts")
      .select("tiktok_advertiser_id, account_name")
      .eq("user_id", userId);
    for (const row of (tiktokRows ?? []) as {
      tiktok_advertiser_id: string | null;
      account_name: string | null;
    }[]) {
      put(names.tiktokAdvertiser, row.tiktok_advertiser_id, row.account_name);
    }
  } catch (err) {
    console.warn(
      "[identity-names] tiktok_accounts read failed",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const cached = await readUserAdAccountListCache(userId);
    for (const account of cached?.accounts ?? []) {
      put(names.metaAdAccount, account.id, account.name);
      if (account.id.startsWith("act_")) {
        put(names.metaAdAccount, account.id.slice(4), account.name);
      }
    }
  } catch (err) {
    console.warn(
      "[identity-names] ad-account cache read failed",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const admin = createServiceRoleClient() as AnyClient;
    const [pages, accounts, pixels, igs] = await Promise.all([
      admin.from("bm_pages").select("page_id, page_name"),
      admin.from("bm_ad_accounts").select("ad_account_id, account_id, name"),
      admin.from("bm_pixels").select("pixel_id, name"),
      admin.from("bm_ig_accounts").select("ig_asset_id, ig_user_id, ig_username"),
    ]);
    for (const row of (pages.data ?? []) as { page_id: string; page_name: string | null }[]) {
      put(names.facebookPage, row.page_id, row.page_name);
    }
    for (const row of (accounts.data ?? []) as {
      ad_account_id: string;
      account_id: string | null;
      name: string | null;
    }[]) {
      put(names.metaAdAccount, row.ad_account_id, row.name);
      put(names.metaAdAccount, row.account_id, row.name);
    }
    for (const row of (pixels.data ?? []) as { pixel_id: string; name: string | null }[]) {
      put(names.metaPixel, row.pixel_id, row.name);
    }
    for (const row of (igs.data ?? []) as {
      ig_asset_id: string;
      ig_user_id: string | null;
      ig_username: string | null;
    }[]) {
      const handle = row.ig_username
        ? row.ig_username.startsWith("@")
          ? row.ig_username
          : `@${row.ig_username}`
        : null;
      put(names.instagramActor, row.ig_asset_id, handle);
      put(names.instagramActor, row.ig_user_id, handle);
    }
  } catch (err) {
    console.warn(
      "[identity-names] BM name tables unavailable",
      err instanceof Error ? err.message : err,
    );
  }

  return names;
}
