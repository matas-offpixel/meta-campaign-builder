import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";

/**
 * TikTok campaign list (skeleton).
 *
 * Mirrors the existing /campaigns library at /. Will become the index
 * for TikTok campaigns once the persistence layer lands. For now the
 * empty state guides the user to launch a new draft via the builder.
 */
export default function TikTokIndexPage() {
  return (
    <>
      <PageHeader
        title="TikTok"
        description="Manage TikTok campaigns separately from Meta. Launches require an active TikTok Business connection."
        actions={
          <Link href="/tiktok/new">
            <Button size="sm">
              <Plus className="h-3.5 w-3.5" />
              New TikTok campaign
            </Button>
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <section className="rounded-md border border-dashed border-border bg-card p-12 text-center">
            <p className="font-heading text-lg tracking-wide">
              No TikTok campaigns yet
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              The TikTok side of the platform mix lives here. Spin up a
              draft via the campaign builder — saves are disabled until
              the Ads API integration is connected.
            </p>
            <div className="mt-6 flex justify-center">
              <Link href="/tiktok/new">
                <Button>
                  <Plus className="h-3.5 w-3.5" />
                  New TikTok campaign
                </Button>
              </Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
