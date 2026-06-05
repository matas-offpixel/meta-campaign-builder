import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssetQueueConfigForm } from "@/components/dashboard/clients/asset-queue-config-form";
import { getAssetSheetConfig } from "@/lib/db/asset-sheet-config";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AssetQueueConfigPage({ params }: Props) {
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

  const config = await getAssetSheetConfig(clientId);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href={`/clients/${clientId}?tab=asset-queue`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to asset queue
      </Link>

      <h1 className="font-heading text-xl tracking-wide">Asset Queue Config</h1>
      <p className="mt-1 text-sm text-muted-foreground">{client.name}</p>

      <AssetQueueConfigForm
        clientId={clientId}
        initialConfig={config}
      />
    </div>
  );
}
