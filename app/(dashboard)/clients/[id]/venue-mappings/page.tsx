import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listVenueMappings } from "@/lib/db/venue-mappings";
import { VenueMappingsPanel } from "@/components/dashboard/clients/venue-mappings-panel";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function VenueMappingsPage({ params }: Props) {
  const { id: clientId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id, name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) notFound();
  if (client.user_id !== user.id) notFound();

  const mappings = await listVenueMappings(clientId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/clients/${clientId}?tab=asset-queue`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to asset queue
      </Link>

      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="font-heading text-xl tracking-wide">Venue Mappings</h1>
          <p className="mt-1 text-sm text-muted-foreground">{client.name}</p>
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Map the venue labels Joe writes in the Google Sheet to your internal event codes.
        Matching is case-insensitive.
      </p>

      <VenueMappingsPanel clientId={clientId} initialMappings={mappings} />
    </div>
  );
}
