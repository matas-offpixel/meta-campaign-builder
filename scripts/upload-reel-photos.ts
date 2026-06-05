#!/usr/bin/env node
/**
 * One-shot upload script for reel photos.
 *
 * Reads source photos from REEL_SOURCE_DIR, resizes via sharp, uploads to
 * Supabase Storage, writes scratch/j2-{target}-render-input.json.
 *
 * Multi-reel: REEL_TARGET selects which reel (default "bridge"). Manifest +
 * render-input + storage prefix all derive from the slug.
 *
 * Usage:
 *   REEL_SOURCE_DIR="/path" npx tsx scripts/upload-reel-photos.ts                  # bridge (default)
 *   REEL_SOURCE_DIR="/path" REEL_TARGET=woods npx tsx scripts/upload-reel-photos.ts
 *   ... --force                                                                     # re-upload existing
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(__filename), "..");

async function loadEnvLocal(): Promise<void> {
  try {
    const content = await fs.readFile(path.join(ROOT, ".env.local"), "utf-8");
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local absent — env vars must be set externally
  }
}

const BUCKET = "campaign-assets";
const RESIZE_WIDTH = 1080;
const RESIZE_HEIGHT = 1620;
const JPEG_QUALITY = 82;
const FRAMES_PER_PHOTO = 7;

interface ManifestPhoto {
  index: number;
  source_filename: string;
  target_filename: string;
}

interface Manifest {
  supabase_storage?: { prefix?: string };
  photos: ManifestPhoto[];
}

interface RenderInput {
  compositionId: string;
  inputProps: {
    photos: string[];
    framesPerPhoto: number;
    zoom?: boolean;
  };
}

function sanitizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

async function main(): Promise<void> {
  await loadEnvLocal();

  const force = process.argv.includes("--force");
  const reelTarget = sanitizeSlug(process.env.REEL_TARGET || "bridge");
  if (!reelTarget) {
    throw new Error("REEL_TARGET resolved to empty after sanitisation. Set to e.g. bridge or woods.");
  }

  const sourceDir = process.env.REEL_SOURCE_DIR;
  if (!sourceDir) {
    throw new Error(
      "REEL_SOURCE_DIR env var is required. Example:\n" +
        '  REEL_SOURCE_DIR="~/Documents/OFF Pixel/Junction 2/Melodic/Photos/Bridge" ' +
        "REEL_TARGET=bridge npx tsx scripts/upload-reel-photos.ts",
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (via .env.local or shell env).",
    );
  }

  const manifestPath = path.join(ROOT, `scratch/j2-${reelTarget}-manifest.json`);
  const renderInputPath = path.join(ROOT, `scratch/j2-${reelTarget}-render-input.json`);

  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(
      `Manifest not found at ${manifestPath}.\n` +
        `Generate one (or add another reel) before running this script.`,
    );
  }
  const manifest = JSON.parse(manifestRaw) as Manifest;
  const photos = manifest.photos;

  const rawPrefix = manifest.supabase_storage?.prefix || `remotion-source/j2-melodic-${reelTarget}-2025/`;
  const STORAGE_PREFIX = rawPrefix.replace(/\/+$/, "");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.info(`[upload-reel-photos] target=${reelTarget} photos=${photos.length}`);
  console.info(`[upload-reel-photos] source dir: ${sourceDir}`);
  console.info(`[upload-reel-photos] bucket: ${BUCKET}/${STORAGE_PREFIX}`);
  console.info(`[upload-reel-photos] manifest: ${manifestPath}`);
  console.info(`[upload-reel-photos] output: ${renderInputPath}`);
  if (force) console.info("[upload-reel-photos] --force: re-uploading existing files");

  const { data: existingList } = await supabase.storage
    .from(BUCKET)
    .list(STORAGE_PREFIX, { limit: 1000 });
  const existingNames = new Set((existingList ?? []).map((f) => f.name));

  const publicUrls: string[] = [];

  for (const photo of photos) {
    const targetName = photo.target_filename;
    const storagePath = `${STORAGE_PREFIX}/${targetName}`;

    if (!force && existingNames.has(targetName)) {
      console.info(`[upload-reel-photos] skip (exists): ${targetName}`);
    } else {
      const sourcePath = path.join(sourceDir, photo.source_filename);
      let sourceBuffer: Buffer;
      try {
        sourceBuffer = await fs.readFile(sourcePath);
      } catch {
        throw new Error(
          `Source photo not found: ${sourcePath}\n` +
            `Check that REEL_SOURCE_DIR points to the correct folder.`,
        );
      }

      const resized = await sharp(sourceBuffer)
        .resize(RESIZE_WIDTH, RESIZE_HEIGHT, { fit: "cover", position: "center" })
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, resized, {
          contentType: "image/jpeg",
          upsert: force,
        });

      if (uploadError) {
        throw new Error(`Upload failed for ${targetName}: ${uploadError.message}`);
      }

      console.info(`[upload-reel-photos] uploaded: ${targetName} (${resized.length} bytes)`);
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    publicUrls.push(urlData.publicUrl);
  }

  // Preserve existing zoom setting if render-input already exists, otherwise default false.
  let existingZoom: boolean | undefined;
  try {
    const existingRaw = await fs.readFile(renderInputPath, "utf-8");
    const existing = JSON.parse(existingRaw) as { inputProps?: { zoom?: boolean } };
    existingZoom = existing.inputProps?.zoom;
  } catch {
    // No existing render-input — that's fine.
  }

  const renderInput: RenderInput = {
    compositionId: "PhotoReelStatic",
    inputProps: {
      photos: publicUrls,
      framesPerPhoto: FRAMES_PER_PHOTO,
      ...(existingZoom !== undefined ? { zoom: existingZoom } : {}),
    },
  };

  await fs.writeFile(renderInputPath, JSON.stringify(renderInput, null, 2) + "\n", "utf-8");

  console.info(`[upload-reel-photos] wrote ${renderInputPath}`);
  console.info(`[upload-reel-photos] done — ${publicUrls.length} photos, framesPerPhoto=${FRAMES_PER_PHOTO}`);
  console.info(
    `[upload-reel-photos] total frames: ${publicUrls.length * FRAMES_PER_PHOTO} ` +
      `(${((publicUrls.length * FRAMES_PER_PHOTO) / 30).toFixed(2)}s @ 30fps)`,
  );
}

main().catch((err) => {
  console.error("[upload-reel-photos] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
