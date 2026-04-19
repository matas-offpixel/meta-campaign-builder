import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";

/**
 * Google Ads plan list (skeleton).
 *
 * Renders the empty-state CTA pointing at the plan builder. Once a
 * `lib/db/google-ad-plans.ts` server helper lands, swap to a real
 * server-fetched list — the route is intentionally narrow for now so
 * the skeleton ships cleanly without coupling to types that don't exist
 * until migration 017 is applied.
 */
export default function GoogleAdsIndexPage() {
  return (
    <>
      <PageHeader
        title="Google Ads"
        description="Search-side plans for events. Each plan defines campaign mix, geo modifiers and RLSA boosts. Launch is gated until the Google Ads API integration is connected."
        actions={
          <Link href="/google-ads/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New plan
            </Button>
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <section className="rounded-md border border-dashed border-border bg-card p-12 text-center">
            <Search className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
            <p className="font-heading text-lg tracking-wide">
              No Google Ads plans yet
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Build your first Search plan from an event. The builder
              walks through strategy, campaign mix, geo, RLSA and
              conversion tracking before you launch.
            </p>
            <div className="mt-6 flex justify-center">
              <Link href="/google-ads/new">
                <Button>
                  <Plus className="h-3.5 w-3.5" />
                  New plan
                </Button>
              </Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
