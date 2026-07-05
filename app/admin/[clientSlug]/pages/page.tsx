import Link from "next/link";
import { Plus } from "lucide-react";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { listClientPages } from "@/lib/db/client-admin";
import { archivePage } from "@/lib/actions/update-page-event";

/**
 * app/admin/[clientSlug]/pages/page.tsx — landing-page list (OP909
 * Phase 3). Archived pages sink to the bottom; Delete = soft-delete
 * (status=archived), never a row drop.
 */
export default async function PagesListPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const pages = await listClientPages(membership.clientId);
  const active = pages.filter((p) => p.status !== "archived");
  const archived = pages.filter((p) => p.status === "archived");

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl tracking-wide">Pages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Landing pages for your events.
          </p>
        </div>
        <Link
          href={`/admin/${membership.clientSlug}/pages/new`}
          className="flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
        >
          <Plus className="h-4 w-4" />
          New page
        </Link>
      </div>

      {pages.length === 0 ? (
        <div className="mt-8 rounded-md border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">
            No landing pages yet.
          </p>
          <Link
            href={`/admin/${membership.clientSlug}/pages/new`}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90"
          >
            <Plus className="h-4 w-4" />
            Create your first landing page
          </Link>
        </div>
      ) : (
        <>
          <PagesTable
            pages={active}
            clientSlug={membership.clientSlug}
            emptyLabel="No active pages — create one or restore an archived page."
          />
          {archived.length > 0 && (
            <>
              <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Archived
              </h2>
              <PagesTable
                pages={archived}
                clientSlug={membership.clientSlug}
                emptyLabel=""
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  live: "bg-green-100 text-green-800",
  draft: "bg-amber-100 text-amber-800",
  archived: "bg-gray-100 text-gray-600",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(date);
}

function PagesTable({
  pages,
  clientSlug,
  emptyLabel,
}: {
  pages: Awaited<ReturnType<typeof listClientPages>>;
  clientSlug: string;
  emptyLabel: string;
}) {
  if (pages.length === 0) {
    return emptyLabel ? (
      <p className="mt-4 text-sm text-muted-foreground">{emptyLabel}</p>
    ) : null;
  }
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Event</th>
            <th className="px-4 py-2.5 font-medium">URL</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium text-right">Signups</th>
            <th className="px-4 py-2.5 font-medium">Presale</th>
            <th className="px-4 py-2.5 font-medium">Last edited</th>
            <th className="px-4 py-2.5 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => (
            <tr key={page.pageEventId} className="border-b border-border last:border-b-0">
              <td className="px-4 py-3 font-medium">{page.eventName}</td>
              <td className="px-4 py-3">
                <code className="text-xs text-muted-foreground">
                  /l/{clientSlug}/{page.eventSlug}
                </code>
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[page.status] ?? STATUS_STYLES.draft
                  }`}
                >
                  {page.status}
                </span>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {page.signupCount}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(page.presaleAt)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDate(page.updatedAt)}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-3">
                  <Link
                    href={`/admin/${clientSlug}/pages/${page.pageEventId}/edit`}
                    className="text-xs underline text-muted-foreground hover:text-foreground"
                  >
                    Edit
                  </Link>
                  <Link
                    href={`/l/${clientSlug}/${page.eventSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline text-muted-foreground hover:text-foreground"
                  >
                    Preview
                  </Link>
                  {page.status !== "archived" && (
                    <form action={archivePage}>
                      <input
                        type="hidden"
                        name="page_event_id"
                        value={page.pageEventId}
                      />
                      <button
                        type="submit"
                        className="text-xs underline text-destructive/80 hover:text-destructive"
                      >
                        Delete
                      </button>
                    </form>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
