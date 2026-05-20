import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { listAudiencesForClient } from "@/lib/db/meta-custom-audiences";
import { getClientByIdServer } from "@/lib/db/clients-server";
import type { LookalikeSeedCandidate } from "@/lib/audiences/lookalike-types";
import { createClient } from "@/lib/supabase/server";
import { BulkLookalikeForm } from "./lookalike-form";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function LookalikeAudiencesPage({ params }: Props) {
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

  // DB-list seeds: ONLY audiences with a Meta id can seed a lookalike.
  // RLS scopes to the user; we filter status=ready (only created audiences),
  // then drop any without a meta_audience_id defensively.
  const localAudiences = await listAudiencesForClient(clientId, {
    status: ["ready"],
  });
  const dbSeeds: LookalikeSeedCandidate[] = localAudiences
    .filter(
      (a) =>
        a.metaAudienceId &&
        // Don't allow lookalikes-from-lookalikes via the DB list either.
        a.audienceSubtype !== "lookalike",
    )
    .map((a) => ({
      metaAudienceId: a.metaAudienceId!,
      name: a.name,
      source: "db" as const,
      localAudienceId: a.id,
      audienceSubtype: a.audienceSubtype,
      funnelStage: a.funnelStage,
      metaSubtype: null,
      approximateCount: null,
    }));

  return (
    <>
      <PageHeader
        title="Lookalike audiences"
        description="Pick one or more seed custom audiences, choose a tier (1% / 2% / 3%) and country — each seed becomes one lookalike on Meta."
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
          <BulkLookalikeForm
            clientId={clientId}
            clientName={client.name}
            clientSlug={client.slug ?? null}
            initialDbSeeds={dbSeeds}
            writesEnabled={writesEnabled}
          />
        </div>
      </main>
    </>
  );
}
