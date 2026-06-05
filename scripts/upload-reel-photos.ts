#!/usr/bin/env node
/**
 * One-shot upload script for Junction 2 Melodic Bridge reel photos.
 *
 * Reads source photos from REEL_SOURCE_DIR, resizes with sharp,
 * uploads to Supabase Storage, then writes scratch/j2-bridge-render-input.json.
 *
 * Usage:
 *   REEL_SOURCE_DIR="/path/to/photos" npx tsx scripts/upload-reel-photos.ts
 *   REEL_SOURCE_DIR="/path/to/photos" npx tsx scripts/upload-reel-photos.ts --force
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(__filename), "..");

// ---------------------------------------------------------------------------
// Minimal .env.local reader (no dotenv dependency needed)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BUCKET = "campaign-assets";
const STORAGE_PREFIX = "remotion-source/j2-melodic-bridge-2025";
const MANIFEST_PATH = path.join(ROOT, "scratch/j2-bridge-manifest.json");
const RENDER_INPUT_PATH = path.join(ROOT, "scratch/j2-bridge-render-input.json");

const RESIZE_WIDTH = 1080;
const RESIZE_HEIGHT = 1620;
const JPEG_QUALITY = 82;
const FRAMES_PER_PHOTO = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ManifestPhoto {
  index: number;
  source_filename: string;
  target_filename: string;
}

interface Manifest {
  photos: ManifestPhoto[];
}

interface RenderInput {
  compositionId: string;
  inputProps: {
    photos: string[];
    framesPerPhoto: number;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await loadEnvLocal();

  const force = process.argv.includes("--force");
  const sourceDir = process.env.REEL_SOURCE_DIR;
  if (!sourceDir) {
    throw new Error(
      "REEL_SOURCE_DIR env var is required. " +
        'Set it to the folder containing the Bridge JPEGs, e.g.:\n' +
        '  REEL_SOURCE_DIR="~/Documents/OFF Pixel/Junction 2/Melodic/Photos/Bridge" npx tsx scripts/upload-reel-photos.ts',
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (via .env.local or shell env).",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const manifestRaw = await fs.readFile(MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(manifestRaw) as Manifest;
  const photos = manifest.photos;

  console.info(`[upload-reel-photos] ${photos.length} photos to process`);
  console.info(`[upload-reel-photos] source dir: ${sourceDir}`);
  console.info(`[upload-reel-photos] bucket: ${BUCKET}/${STORAGE_PREFIX}`);
  if (force) console.info("[upload-reel-photos] --force: re-uploading existing files");

  // List existing objects under the prefix (for idempotency check)
  const { data: existingList } = await supabase.storage
    .from(BUCKET)
    .list(STORAGE_PREFIX, { limit: 1000 });
  const existingNames = new Set((existingList ?? []).map((f) => f.name));

  const publicUrls: string[] = [];

  for (const photo of photos) {
    const targetName = photo.target_filename; // e.g. bridge-01.jpeg
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

  const renderInput: RenderInput = {
    compositionId: "PhotoReelStatic",
    inputProps: {
      photos: publicUrls,
      framesPerPhoto: FRAMES_PER_PHOTO,
    },
  };

  await fs.writeFile(RENDER_INPUT_PATH, JSON.stringify(renderInput, null, 2) + "\n", "utf-8");

  console.info(`[upload-reel-photos] wrote ${RENDER_INPUT_PATH}`);
  console.info(`[upload-reel-photos] done — ${publicUrls.length} photos, framesPerPhoto=${FRAMES_PER_PHOTO}`);
  console.info(`[upload-reel-photos] total frames: ${publicUrls.length * FRAMES_PER_PHOTO} (${(publicUrls.length * FRAMES_PER_PHOTO / 30).toFixed(2)}s @ 30fps)`);
}

main().catch((err) => {
  console.error("[upload-reel-photos] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
