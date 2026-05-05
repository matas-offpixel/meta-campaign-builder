import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";
import {
  AudienceBuilderClientPicker,
  type AudienceBuilderClientCard,
} from "./client-picker";

export default async function AudienceBuilderLandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: clientsData, error: clientsError } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("user_id", user.id)
    .not("meta_ad_account_id", "is", null)
    .order("name", { ascending: true });

  if (clientsError) {
    console.warn("[audience-builder] client fetch failed:", clientsError.message);
  }

  const clients = ((clientsData ?? []) as {
    id: string;
    name: string;
    meta_ad_account_id: string | null;
  }[]).filter((client) => client.meta_ad_account_id);

  const clientIds = clients.map((client) => client.id);
  const counts = new Map<
    string,
    AudienceBuilderClientCard["counts"]
  >();
  for (const client of clients) {
    counts.set(client.id, { draft: 0, ready: 0, failed: 0 });
  }

  if (clientIds.length > 0) {
    const { data: audienceRows, error: audienceError } = await supabase
      .from("meta_custom_audiences")
      .select("client_id, status")
      .in("client_id", clientIds);
    if (audienceError) {
      console.warn(
        "[audience-builder] audience count fetch failed:",
        audienceError.message,
      );
    } else {
      for (const row of (audienceRows ?? []) as {
        client_id: string;
        status: string;
      }[]) {
        const current = counts.get(row.client_id);
        if (!current) continue;
        if (row.status === "draft" || row.status === "ready" || row.status === "failed") {
          current[row.status] += 1;
        }
      }
    }
  }

  const cards: AudienceBuilderClientCard[] = clients.map((client) => ({
    id: client.id,
    name: client.name,
    metaAdAccountId: client.meta_ad_account_id ?? "",
    counts: counts.get(client.id) ?? { draft: 0, ready: 0, failed: 0 },
  }));

  return (
    <>
      <PageHeader
        title="Audience Builder"
        description="Pick a Meta-connected client, then build draft or live Meta custom audiences for its bound ad account."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <AudienceBuilderClientPicker clients={cards} />
        </div>
      </main>
    </>
  );
}
