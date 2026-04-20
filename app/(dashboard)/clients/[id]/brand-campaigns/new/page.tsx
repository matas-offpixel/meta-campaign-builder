import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { BrandCampaignForm } from "@/components/dashboard/events/brand-campaign-form";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * "New brand campaign" route, scoped under a client. Mirrors
 * `app/(dashboard)/events/new/page.tsx` (the dated-show flow) but
 * pre-binds clientId from the route param so the form doesn't have to
 * surface a client picker.
 *
 * Auth + client existence are validated server-side. We hard-fail with
 * 404 when the client isn't visible to the current user — RLS would
 * otherwise let the form load and only blow up on submit.
 */
export default async function NewBrandCampaignPage({ params }: Props) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) notFound();

  return (
    <>
      <PageHeader
        title="New brand campaign"
        description={`Brand awareness / reach push for ${client.name}.`}
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Link
            href={`/clients/${clientId}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to {client.name}
          </Link>
          <BrandCampaignForm clientId={clientId} userId={user.id} />
        </div>
      </main>
    </>
  );
}
