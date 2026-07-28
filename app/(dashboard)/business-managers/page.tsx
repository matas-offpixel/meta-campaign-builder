import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import {
  listBusinessManagerSummaries,
  listDetectedNewPages,
} from "@/lib/db/business-managers";
import { getBMAssetCountsByKind } from "@/lib/db/bm-assets";
import { BM_V2_ASSET_KINDS } from "@/lib/bm/asset-kinds";
import { getLastKnownMetaAppUsage } from "@/lib/meta/client";
import {
  BusinessManagersDashboard,
  type AssetCountsByKind,
} from "@/components/admin/business-managers/bm-dashboard";

/**
 * /business-managers — operator tool for keeping asset-user access in sync
 * across the Business Managers Matas is an Admin on.
 *
 * Section 1: pages detected in the last 7 days (one-click grant).
 * Section 2: connected BMs, tabbed by asset type (pages / ad accounts / pixels
 * / Instagram accounts) with counts + Sync now / Grant all missing.
 *
 * Only per-BM COUNTS are loaded here — individual assets are fetched on demand
 * when a row is expanded, because a BM can hold hundreds across four kinds.
 *
 * Auth: cookie-bound session + operator allowlist. See migrations 145 + 147 and
 * docs/BUSINESS_MANAGER_ASSET_SYNC.md.
 */

export const dynamic = "force-dynamic";

export default async function BusinessManagersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!MATAS_USER_IDS.includes(user.id)) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Business Managers</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This tool is operator-only.
        </p>
      </main>
    );
  }

  const [businessManagers, newPages, ...kindCounts] = await Promise.all([
    listBusinessManagerSummaries(supabase),
    listDetectedNewPages(supabase, 7),
    ...BM_V2_ASSET_KINDS.map((kind) => getBMAssetCountsByKind(supabase, kind)),
  ]);

  // Maps → plain objects for the client boundary.
  const assetCounts: AssetCountsByKind = {};
  BM_V2_ASSET_KINDS.forEach((kind, index) => {
    assetCounts[kind] = Object.fromEntries(kindCounts[index]);
  });

  // Best-effort, per-instance only — see getLastKnownMetaAppUsage's docstring.
  // Null on a cold start until the next scan/grant call lands on this
  // instance; the indicator simply doesn't render in that case.
  const metaAppUsage = getLastKnownMetaAppUsage();

  return (
    <BusinessManagersDashboard
      initialBusinessManagers={businessManagers}
      initialNewPages={newPages}
      assetCounts={assetCounts}
      metaAppUsage={metaAppUsage}
    />
  );
}
