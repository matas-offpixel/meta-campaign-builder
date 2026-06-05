import fs from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";

import { ReelRenderForm } from "@/components/admin/render-reel-form";
import { createClient } from "@/lib/supabase/server";

/**
 * /admin/render-reel — one-shot MP4 render for Junction 2 Melodic Bridge reel.
 *
 * Auth: cookie-bound Supabase session (same gate as /admin/render-test).
 * Requires FEATURE_REMOTION=1 and scratch/j2-bridge-render-input.json to exist.
 */

async function readZoomSetting(): Promise<boolean> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "scratch/j2-bridge-render-input.json"),
      "utf-8",
    );
    const data = JSON.parse(raw) as { inputProps?: { zoom?: boolean } };
    return data?.inputProps?.zoom === true;
  } catch {
    return false;
  }
}

export default async function AdminRenderReelPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const zoom = await readZoomSetting();

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-2 pb-8">
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-3xl tracking-wide">
            J2 Bridge reel — render
          </h1>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              zoom
                ? "bg-amber-100 text-amber-800"
                : "bg-zinc-100 text-zinc-600"
            }`}
          >
            Zoom: {zoom ? "ON" : "OFF"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Junction 2 Melodic 2026-07-26 · Bridge stage · 64 photos · 14.93s ·
          @khromacollective
        </p>
      </div>
      <ReelRenderForm zoom={zoom} />
    </main>
  );
}
