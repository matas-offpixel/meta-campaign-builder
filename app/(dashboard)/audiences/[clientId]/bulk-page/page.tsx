import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { createClient } from "@/lib/supabase/server";
import { BulkPageAudiencesForm } from "./bulk-page-form";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function BulkPageAudiencesPage({ params }: Props) {
  const { clientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClientByIdServer(clientId);
  if (!client) notFound();

  const writesEnabled =
    process.env.OFFPIXEL_META_AUDIENCE_WRITES_ENABLED === "true";

  return (
    <>
      <PageHeader
        title="Bulk page audiences"
        description="Pick a page/IG set once, then generate the full (subtype × retention) matrix in one pass. >5-page sets auto-split via the same path as the single builder."
        actions={
          <Link
            href={`/audiences/${clientId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to audiences
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <BulkPageAudiencesForm
            clientId={clientId}
            clientName={client.name}
            clientSlug={client.slug ?? null}
            writesEnabled={writesEnabled}
          />
        </div>
      </main>
    </>
  );
}
