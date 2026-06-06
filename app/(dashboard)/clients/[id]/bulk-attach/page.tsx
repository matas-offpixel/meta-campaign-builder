import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { getAssetQueueRow } from "@/lib/db/asset-queue";
import { resolveOrganiserDestinationUrl } from "@/lib/clients/asset-queue/destination-url";
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
    if (row && row.client_id === clientId && row.status === "pending") {
      let venueCity: string | null = null;
      if (row.resolved_event_id) {
        const { data: event } = await supabase
          .from("events")
          .select("venue_city")
          .eq("id", row.resolved_event_id)
          .maybeSingle();
        venueCity = event?.venue_city ?? null;
      }

      const generatedUrl =
        row.generated_url?.trim() ||
        resolveOrganiserDestinationUrl(client.slug, venueCity) ||
        null;

      queueContext = {
        queueId: row.id,
        eventCode: row.resolved_event_code ?? null,
        eventId: row.resolved_event_id ?? null,
        assetName: row.asset_name ?? null,
        generatedCopy: row.generated_copy ?? null,
        generatedCta: row.generated_cta ?? null,
        generatedUrl,
        venueCity,
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
