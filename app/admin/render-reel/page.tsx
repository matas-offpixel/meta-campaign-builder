import fs from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import Link from "next/link";

import { ReelRenderForm } from "@/components/admin/render-reel-form";
import { createClient } from "@/lib/supabase/server";

/**
 * /admin/render-reel?reel={slug} — one-shot MP4 render for the selected reel.
 *
 * Auth: cookie-bound Supabase session.
 * Manifest at scratch/j2-{slug}-manifest.json drives the page metadata.
 * Render-input at scratch/j2-{slug}-render-input.json drives the actual render.
 */

const AVAILABLE_REELS = ["bridge", "woods"] as const;
type ReelSlug = (typeof AVAILABLE_REELS)[number];
const DEFAULT_REEL: ReelSlug = "bridge";

function isReelSlug(value: string | undefined): value is ReelSlug {
  return typeof value === "string" && (AVAILABLE_REELS as readonly string[]).includes(value);
}

interface ReelManifest {
  event: string;
  stage: string;
  source_year?: number;
  photographer_collective?: string;
  audio_reference?: {
    title?: string;
    artists?: string[];
    label?: string;
    bpm?: number;
  };
  render?: {
    duration_sec?: number;
    width?: number;
    height?: number;
    fps?: number;
  };
  photos?: unknown[];
}

interface RenderInput {
  inputProps?: { zoom?: boolean; photos?: unknown[] };
}

async function loadManifest(reel: ReelSlug): Promise<ReelManifest | null> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), `scratch/j2-${reel}-manifest.json`),
      "utf-8",
    );
    return JSON.parse(raw) as ReelManifest;
  } catch {
    return null;
  }
}

async function loadRenderInput(reel: ReelSlug): Promise<RenderInput | null> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), `scratch/j2-${reel}-render-input.json`),
      "utf-8",
    );
    return JSON.parse(raw) as RenderInput;
  } catch {
    return null;
  }
}

export default async function AdminRenderReelPage({
  searchParams,
}: {
  searchParams: Promise<{ reel?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const params = await searchParams;
  const reel: ReelSlug = isReelSlug(params.reel) ? params.reel : DEFAULT_REEL;

  const [manifest, renderInput] = await Promise.all([
    loadManifest(reel),
    loadRenderInput(reel),
  ]);

  const zoom = renderInput?.inputProps?.zoom === true;
  const renderInputReady =
    Array.isArray(renderInput?.inputProps?.photos) &&
    (renderInput?.inputProps?.photos?.length ?? 0) > 0;

  const title = manifest
    ? `${manifest.event.split(" ").slice(0, 2).join(" ")} ${manifest.stage} reel — render`
    : `${reel} reel — render`;
  const subtitle = manifest
    ? [
        manifest.event,
        `${manifest.stage} stage`,
        `${manifest.photos?.length ?? 0} photos`,
        manifest.render?.duration_sec ? `${manifest.render.duration_sec}s` : null,
        manifest.photographer_collective ?? null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Manifest not committed — add scratch/j2-{slug}-manifest.json to enable.";

  return (
    <main className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-2 pb-8">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-heading text-3xl tracking-wide">{title}</h1>
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
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <div className="flex items-center gap-2 pt-2 text-xs">
          <span className="text-muted-foreground">Reel:</span>
          {AVAILABLE_REELS.map((slug) => (
            <Link
              key={slug}
              href={`/admin/render-reel?reel=${slug}`}
              className={`rounded-full px-2.5 py-0.5 font-medium ${
                slug === reel
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted-foreground/10"
              }`}
            >
              {slug}
            </Link>
          ))}
        </div>
      </div>
      <ReelRenderForm reel={reel} zoom={zoom} renderInputReady={renderInputReady} />
    </main>
  );
}
