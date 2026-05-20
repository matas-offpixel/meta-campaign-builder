import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { createClient } from "@/lib/supabase/server";
import { BulkWebsiteAudiencesForm } from "./bulk-website-form";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function BulkWebsiteAudiencesPage({ params }: Props) {
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

  const pixelId = client.meta_pixel_id ?? null;

  return (
    <>
      <PageHeader
        title="Bulk website audiences"
        description="Pick a pixel + URL scope, then generate the full (event × retention) matrix in one pass. No campaign walk — pixel audiences are rate-limit-safe."
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
          <BulkWebsiteAudiencesForm
            clientId={clientId}
            clientName={client.name}
            clientSlug={client.slug ?? null}
            defaultPixelId={pixelId}
            writesEnabled={writesEnabled}
          />
        </div>
      </main>
    </>
  );
}
