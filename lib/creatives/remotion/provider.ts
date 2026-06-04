/**
 * lib/creatives/remotion/provider.ts
 *
 * Remotion adapter — behind `FEATURE_REMOTION`. Renders stills in-process
 * via @remotion/renderer and uploads to Supabase Storage (campaign-assets).
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { renderStill, selectComposition } from "@remotion/renderer";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import {
  assertRemotionEnabled,
  listRemotionTemplateSummaries,
  validateRemotionFields,
} from "./shared.ts";
import type {
  CreativeProvider,
  CreativeTemplate,
  ProviderTemplateSummary,
  RenderJob,
} from "../types.ts";

export {
  REMOTION_TEMPLATE_ID,
  validateRemotionFields,
  type RemotionInputProps,
} from "./shared.ts";

const BUCKET = "campaign-assets";
const COMPOSITION_ID = "4tfCityStatic";
const SIGNED_URL_TTL_SEC = 60 * 60 * 24 * 7;

let cachedServeUrl: string | null = null;

function getBundledServeUrl(): string {
  if (cachedServeUrl) return cachedServeUrl;
  cachedServeUrl = path.join(process.cwd(), ".remotion/bundle");
  return cachedServeUrl;
}

function createStorageAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase storage admin requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

async function ensureBundleExists(serveUrl: string): Promise<void> {
  try {
    await fs.access(serveUrl);
  } catch {
    throw new Error(
      "Remotion bundle not found. Run `npm run bundle-remotion` before rendering.",
    );
  }
}

export class RemotionProvider implements CreativeProvider {
  readonly name = "remotion" as const;

  async listTemplates(): Promise<ProviderTemplateSummary[]> {
    return listRemotionTemplateSummaries();
  }

  async render(
    template: CreativeTemplate,
    fields: Record<string, unknown>,
  ): Promise<{ jobId: string; status: "done" }> {
    assertRemotionEnabled();

    const inputProps = validateRemotionFields(template, fields);
    const serveUrl = getBundledServeUrl();
    await ensureBundleExists(serveUrl);

    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error("Remotion render requires an authenticated user session.");
    }

    const renderId = randomUUID();
    const storagePath = `remotion-renders/${user.id}/${renderId}.png`;
    const tempFile = path.join(os.tmpdir(), `remotion-${renderId}.png`);

    try {
      const composition = await selectComposition({
        serveUrl,
        id: COMPOSITION_ID,
        inputProps: inputProps as unknown as Record<string, unknown>,
      });

      await renderStill({
        composition,
        serveUrl,
        output: tempFile,
        inputProps: inputProps as unknown as Record<string, unknown>,
      });

      const fileBuffer = await fs.readFile(tempFile);
      const admin = createStorageAdminClient();

      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: "image/png",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      return { jobId: storagePath, status: "done" };
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  async pollRender(jobId: string): Promise<RenderJob> {
    assertRemotionEnabled();

    const admin = createStorageAdminClient();
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(jobId, SIGNED_URL_TTL_SEC);

    if (error || !data?.signedUrl) {
      return {
        jobId,
        status: "failed",
        errorMessage: "Render not found",
      };
    }

    return {
      jobId,
      status: "done",
      assetUrl: data.signedUrl,
    };
  }
}

export const remotionProvider = new RemotionProvider();
