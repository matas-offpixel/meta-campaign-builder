import { notFound } from "next/navigation";

import { PageEditor } from "@/components/admin/page-editor";
import { requireClientContext } from "@/lib/auth/get-client-context";
import { getPageEventForEdit } from "@/lib/db/client-admin";

/**
 * app/admin/[clientSlug]/pages/[pageId]/edit — full LP content editor
 * (OP909 Phase 3). Another tenant's pageId resolves null through the
 * RLS-scoped join and 404s identically to a nonexistent id.
 */
export default async function EditPagePage({
  params,
}: {
  params: Promise<{ clientSlug: string; pageId: string }>;
}) {
  const { clientSlug, pageId } = await params;
  const membership = await requireClientContext(clientSlug);

  const view = await getPageEventForEdit(membership.clientId, pageId);
  if (!view) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="font-heading text-2xl tracking-wide">{view.eventName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Edit this landing page — changes auto-save as you type.
      </p>
      <div className="mt-6">
        <PageEditor view={view} clientSlug={membership.clientSlug} />
      </div>
    </div>
  );
}
