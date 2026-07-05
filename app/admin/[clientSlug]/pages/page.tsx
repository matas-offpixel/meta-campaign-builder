import { headers } from "next/headers";
import { Plus } from "lucide-react";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { getClientBranding, listClientPages } from "@/lib/db/client-admin";
import type { PagesListItem } from "@/lib/admin/pages-list";
import { AdminLinkButton } from "@/components/admin/ui/button";
import { PagesList } from "@/components/admin/pages-list";

/**
 * app/admin/[clientSlug]/pages/page.tsx — landing-page list (OP909 Sprint 1
 * restructure). Thumbnails + clickable title + copy-path + icon actions, all
 * in the Supreme aesthetic. Soft-delete (status=archived) still never drops a
 * row; archived pages show inline with an archived status pill.
 */
export default async function PagesListPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const [pages, branding, hdrs] = await Promise.all([
    listClientPages(membership.clientId),
    getClientBranding(membership.clientId, membership.clientName),
    headers(),
  ]);

  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const host = hdrs.get("host") ?? "app.offpixel.co.uk";
  const origin = `${proto}://${host}`;

  const items: PagesListItem[] = pages.map((p) => ({
    pageEventId: p.pageEventId,
    eventName: p.eventName,
    eventSlug: p.eventSlug,
    status: p.status,
    artworkUrl: p.artworkUrl,
    presaleAt: p.presaleAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    signupCount: p.signupCount,
  }));

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="admin-heading text-[28px] leading-none">Pages</h1>
          <p className="mt-2 font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
            Landing pages for your events.
          </p>
        </div>
      </div>

      <div className="mt-8">
        {items.length === 0 ? (
          <div className="border-[0.5px] border-black px-6 py-16 text-center">
            <p className="font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
              No landing pages yet.
            </p>
            <div className="mt-5 flex justify-center">
              <AdminLinkButton
                href={`/admin/${membership.clientSlug}/pages/new`}
                accentFill={branding.accent}
              >
                <Plus className="h-3.5 w-3.5" />
                create your first landing page
              </AdminLinkButton>
            </div>
          </div>
        ) : (
          <PagesList
            items={items}
            clientSlug={membership.clientSlug}
            origin={origin}
            accent={branding.accent}
            boxLogoText={branding.boxLogoText}
          />
        )}
      </div>
    </div>
  );
}
