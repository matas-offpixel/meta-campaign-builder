import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { getAssetQueueRow } from "@/lib/db/asset-queue";
import { resolveOrganiserDestinationUrl } from "@/lib/clients/asset-queue/destination-url";
import { loadResolvedEventContext } from "@/lib/clients/asset-queue/resolve-queue-venue";
import {
  isQueueBulkAttachHandoffStatus,
  isUmbrellaQueueRow,
  resolveQueueHandoffCopy,
} from "@/lib/clients/asset-queue/queue-handoff";
import { ClientBulkAttachWizard, type QueueContextProps } from "./wizard";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ queueId?: string }>;
}

export default async function ClientBulkAttachPage({ params, searchParams }: Props) {
  const { id: clientId } = await params;
  const { queueId } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClientByIdServer(clientId);
  if (!client) notFound();

  const adAccountId = client.meta_ad_account_id;

  if (!adAccountId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-muted-foreground">
          No Meta ad account is configured for{" "}
          <span className="font-medium text-foreground">{client.name}</span>.
          Set one in{" "}
          <Link
            href={`/clients/${clientId}/edit`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            client settings
          </Link>{" "}
          before running a bulk attach.
        </p>
        <Link
          href={`/clients/${clientId}?tab=campaigns`}
          className="mt-4 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          ← Back to Campaigns
        </Link>
      </div>
    );
  }

  let queueContext: QueueContextProps | undefined;

  if (queueId) {
    const row = await getAssetQueueRow(queueId);
    if (row && row.client_id === clientId && isQueueBulkAttachHandoffStatus(row.status)) {
      const umbrella = isUmbrellaQueueRow(row);
      const venueCodes = umbrella
        ? (row.resolved_event_codes_multi ?? [])
        : row.resolved_event_code
          ? [row.resolved_event_code]
          : [];

      const event = umbrella
        ? null
        : await loadResolvedEventContext(
            supabase,
            clientId,
            row.resolved_event_id,
            row.resolved_event_code,
          );
      const venueCity = event?.venue_city ?? null;
      const handoffCopy = resolveQueueHandoffCopy(row);

      const generatedUrl = umbrella
        ? handoffCopy.generatedUrl?.trim() || null
        : handoffCopy.generatedUrl?.trim() ||
          resolveOrganiserDestinationUrl(client.slug, venueCity) ||
          null;

      queueContext = {
        queueId: row.id,
        umbrella,
        venueCodes,
        eventCode: umbrella ? null : row.resolved_event_code ?? event?.event_code ?? null,
        eventId: umbrella ? null : row.resolved_event_id ?? event?.id ?? null,
        assetName: row.asset_name ?? null,
        generatedCopy: handoffCopy.generatedCopy,
        generatedCta: handoffCopy.generatedCta,
        generatedUrl,
        venueCity: umbrella ? null : venueCity,
        assetBlobUrl: row.asset_blob_url ?? null,
        assetBlobUrls: row.asset_blob_urls ?? [],
        mediaType: row.media_type ?? null,
        funnel: row.funnel ?? null,
      };
    }
  }

  return (
    <ClientBulkAttachWizard
      clientId={clientId}
      clientName={client.name}
      clientSlug={client.slug}
      adAccountId={adAccountId}
      queueContext={queueContext}
    />
  );
}
