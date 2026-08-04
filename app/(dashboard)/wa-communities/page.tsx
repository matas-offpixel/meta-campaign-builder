import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import { listAliasesWithDestinations } from "@/lib/db/wa-community-aliases";
import { WaCommunitiesDashboard } from "@/components/admin/wa-communities/wa-communities-dashboard";

/**
 * /wa-communities — operator tool to create and repoint WhatsApp community
 * alias slugs used by Meta template buttons (`/j/{slug}`).
 *
 * Auth: cookie session + operator allowlist (same gate as Business Managers).
 */

export const dynamic = "force-dynamic";

export default async function WaCommunitiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!MATAS_USER_IDS.includes(user.id)) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">
          WA Community Aliases
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This tool is operator-only.
        </p>
      </main>
    );
  }

  let aliases: Awaited<ReturnType<typeof listAliasesWithDestinations>> = [];
  let clients: { id: string; name: string }[] = [];

  try {
    const service = createServiceRoleClient();
    aliases = await listAliasesWithDestinations(service);
    const { data: clientRows } = await service
      .from("clients")
      .select("id, name")
      .order("name", { ascending: true });
    clients = (clientRows ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
    }));
  } catch (err) {
    console.error("[wa-communities page]", err);
  }

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "app.offpixel.co.uk";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const appOrigin = `${proto}://${host}`;

  return (
    <WaCommunitiesDashboard
      initialAliases={aliases}
      clients={clients}
      appOrigin={appOrigin}
    />
  );
}
