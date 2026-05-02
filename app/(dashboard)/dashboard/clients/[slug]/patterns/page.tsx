import { notFound, permanentRedirect, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LegacyCreativePatternsRedirect({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const query = supabase
    .from("clients")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  const result = isUuid(slug)
    ? await query.eq("id", slug).maybeSingle()
    : await query.eq("slug", slug).maybeSingle();

  if (result.error || !result.data) notFound();

  permanentRedirect(`/clients/${result.data.id}/dashboard?tab=insights`);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
