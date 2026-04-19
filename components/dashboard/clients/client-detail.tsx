"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  setClientStatus,
  deleteClientRow,
  type ClientRow,
} from "@/lib/db/clients";
import { type EventWithClient } from "@/lib/db/events";
import { VerifyMetaConnection } from "./verify-meta-connection";
import { PlatformAccountsCard } from "./platform-accounts-card";

interface Props {
  client: ClientRow;
  events: EventWithClient[];
}

/**
 * Client-side detail view. Initial row + events are server-fetched by the
 * parent route and passed in as props. This component owns mutations
 * (archive / unarchive / delete) and the local state needed to reflect
 * status changes without a full page refetch.
 */
export function ClientDetail({ client: initial, events }: Props) {
  const router = useRouter();
  const [client, setClient] = useState<ClientRow>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleArchive = async () => {
    setWorking(true);
    try {
      await setClientStatus(client.id, "archived");
      setClient({ ...client, status: "archived" });
    } finally {
      setWorking(false);
    }
  };

  const handleUnarchive = async () => {
    setWorking(true);
    try {
      await setClientStatus(client.id, "active");
      setClient({ ...client, status: "active" });
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async () => {
    setWorking(true);
    setError(null);
    try {
      await deleteClientRow(client.id);
      router.push("/clients");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete client.";
      setError(msg);
      setWorking(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <PageHeader
        title={client.name}
        description={`${client.primary_type}${
          client.types.length > 1
            ? " · " + client.types.filter((t) => t !== client.primary_type).join(", ")
            : ""
        }`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => router.push(`/clients/${client.id}/edit`)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            {client.status === "archived" ? (
              <Button variant="ghost" onClick={handleUnarchive} disabled={working}>
                Unarchive
              </Button>
            ) : (
              <Button variant="ghost" onClick={handleArchive} disabled={working}>
                <Archive className="h-3.5 w-3.5" />
                Archive
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={working}
                >
                  Confirm delete
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                  disabled={working}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={working}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <Link
            href="/clients"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            All clients
          </Link>

          {error && (
            <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <section className="rounded-md border border-border bg-card p-5">
            <h2 className="font-heading text-base tracking-wide mb-3">
              Details
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Slug" value={client.slug} />
              <DetailRow label="Status" value={client.status} />
              <DetailRow label="Primary type" value={client.primary_type} />
              <DetailRow
                label="All types"
                value={client.types.length > 0 ? client.types.join(", ") : "—"}
              />
              <DetailRow
                label="Instagram"
                value={
                  client.instagram_handle
                    ? `@${client.instagram_handle}`
                    : "—"
                }
              />
              <DetailRow
                label="TikTok"
                value={
                  client.tiktok_handle ? `@${client.tiktok_handle}` : "—"
                }
              />
              <DetailRow
                label="Facebook page"
                value={client.facebook_page_handle ?? "—"}
              />
              <DetailRow
                label="TikTok ad account"
                value={client.tiktok_ad_account_id ?? "—"}
              />
              <DetailRow
                label="Google Ads customer"
                value={client.google_ads_customer_id ?? "—"}
              />
              <DetailRow
                label="Drive folder"
                value={client.google_drive_folder_url ?? "—"}
              />
            </dl>
            {client.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Notes
                </p>
                <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
              </div>
            )}
          </section>

          <section className="rounded-md border border-border bg-card p-5 space-y-4">
            <h2 className="font-heading text-base tracking-wide">
              Meta Business assets
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <DetailRow
                label="Business ID"
                value={client.meta_business_id ?? "—"}
              />
              <DetailRow
                label="Ad Account ID"
                value={client.meta_ad_account_id ?? "—"}
              />
              <DetailRow
                label="Pixel ID"
                value={client.meta_pixel_id ?? "—"}
              />
            </dl>
            <div className="pt-4 border-t border-border">
              <VerifyMetaConnection
                clientId={client.id}
                hasAnyMetaId={Boolean(
                  client.meta_business_id ??
                    client.meta_ad_account_id ??
                    client.meta_pixel_id,
                )}
              />
            </div>
          </section>

          <PlatformAccountsCard
            clientId={client.id}
            initialTikTokAccountId={client.tiktok_account_id ?? null}
            initialGoogleAdsAccountId={client.google_ads_account_id ?? null}
            metaBusinessId={client.meta_business_id ?? null}
            metaAdAccountId={client.meta_ad_account_id ?? null}
            metaPixelId={client.meta_pixel_id ?? null}
          />

          <section className="rounded-md border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-heading text-base tracking-wide">
                Events ({events.length})
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  router.push(`/events/new?clientId=${client.id}`)
                }
              >
                New event
              </Button>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No events yet for this client.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((ev) => (
                  <li key={ev.id}>
                    <Link
                      href={`/events/${ev.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-3 py-2
                        text-sm hover:bg-muted transition-colors"
                    >
                      <span className="truncate">{ev.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {ev.event_date ?? "TBD"} · {ev.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm break-words">{value}</dd>
    </div>
  );
}
