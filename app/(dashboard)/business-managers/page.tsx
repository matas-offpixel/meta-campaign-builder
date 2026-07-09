import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import {
  listBusinessManagerSummaries,
  listDetectedNewPages,
} from "@/lib/db/business-managers";
import { BusinessManagersDashboard } from "@/components/admin/business-managers/bm-dashboard";

/**
 * /business-managers — operator tool for keeping page asset-user access in
 * sync across the Business Managers Matas is an Admin on.
 *
 * Section 1: pages detected in the last 7 days (one-click grant).
 * Section 2: connected BMs with page counts + Sync now / Grant all missing.
 *
 * Auth: cookie-bound session + operator allowlist. See migration 145 +
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

  const [businessManagers, newPages] = await Promise.all([
    listBusinessManagerSummaries(supabase),
    listDetectedNewPages(supabase, 7),
  ]);

  return (
    <BusinessManagersDashboard
      initialBusinessManagers={businessManagers}
      initialNewPages={newPages}
    />
  );
}
