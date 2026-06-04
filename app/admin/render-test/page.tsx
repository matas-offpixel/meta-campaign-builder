import { redirect } from "next/navigation";

import { RenderTestForm } from "@/components/admin/render-test-form";
import { createClient } from "@/lib/supabase/server";

/**
 * /admin/render-test — internal Remotion POC smoke-test page.
 *
 * Auth: cookie-bound Supabase session (same gate as other admin API routes).
 */
export default async function AdminRenderTestPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-xl space-y-2 pb-8">
        <h1 className="font-heading text-3xl tracking-wide">
          Remotion render test
        </h1>
        <p className="text-sm text-muted-foreground">
          Week-1 POC — requires <code>FEATURE_REMOTION=1</code>. Output uploads
          to <code>campaign-assets/remotion-renders/</code>.
        </p>
      </div>
      <RenderTestForm />
    </main>
  );
}
