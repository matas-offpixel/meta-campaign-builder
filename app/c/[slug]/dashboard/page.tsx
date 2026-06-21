import { notFound, redirect } from "next/navigation";

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * /c/[slug]/dashboard — vanity redirect for client dashboard links.
 *
 * Resolves a human-readable slug (e.g. "ironworks") to the internal
 * client UUID and redirects to the auth-gated dashboard:
 *   /c/ironworks/dashboard → /clients/f7ed8aef-.../dashboard
 *
 * The destination is the authenticated internal dashboard — unauthenticated
 * visitors will be bounced to /login by the middleware there, which is the
 * intended behaviour. For a fully public shareable URL, use the token-based
 * /share/client/[token] route.
 *
 * Uses service-role so the lookup works whether or not the visitor has a
 * session cookie (the redirect itself is unconditional; auth happens after).
 */
export default async function ClientBySlugDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const supabase = createServiceRoleClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (!client) return notFound();

  redirect(`/clients/${client.id}/dashboard`);
}
