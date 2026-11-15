import { notFound, redirect } from "next/navigation";

import { GoogleVideoPlanEditor } from "@/components/google-video/plan-editor";
import { loadGoogleVideoPlanTree } from "@/lib/db/google-video-plans";
import { createClient } from "@/lib/supabase/server";

/**
 * /google-video/[id]
 *
 * A YouTube video plan: Settings → Targeting → Placements → Ads →
 * Review. Review downloads a Google Ads Editor CSV. Nothing is sent to
 * Google from here; the Google Ads API cannot create Video campaigns.
 */
export default async function GoogleVideoPlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tree = await loadGoogleVideoPlanTree(supabase, id);
  if (!tree) notFound();

  return <GoogleVideoPlanEditor initialTree={tree} />;
}
