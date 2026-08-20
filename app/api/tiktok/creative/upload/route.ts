import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readTikTokAccountCredentials } from "@/lib/tiktok/api-account";
import {
  executeTikTokCreativeUpload,
  prepareTikTokCreativeUpload,
} from "@/lib/tiktok/upload-route";
import type { TikTokVideoUploadMode } from "@/lib/tiktok/upload";

/**
 * Large videos (10–150 MB) stream Storage → TikTok. The launch route
 * uses 800; match that so Mode A is not killed by the default 60s cap.
 */
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: {
    storagePath?: string;
    storageBucket?: string;
    advertiserId?: string;
    fileName?: string;
    mode?: TikTokVideoUploadMode;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const prepared = prepareTikTokCreativeUpload(body);
  if (!prepared.ok) {
    return NextResponse.json(
      { ok: false, error: prepared.error },
      { status: prepared.status },
    );
  }

  const credentials = await readTikTokAccountCredentials(supabase, {
    userId: user.id,
    advertiserId: prepared.advertiserId,
  });
  if (!credentials) {
    return NextResponse.json(
      { ok: false, error: "TikTok credentials missing" },
      { status: 400 },
    );
  }

  const result = await executeTikTokCreativeUpload({
    prepared,
    token: credentials.accessToken,
    openServiceStorage: () => {
      const storage = createServiceRoleClient();
      return {
        createSignedUrl: async (bucket, path, expiresIn) => {
          const { data, error } = await storage.storage
            .from(bucket)
            .createSignedUrl(path, expiresIn);
          return {
            signedUrl: data?.signedUrl ?? null,
            error: error?.message ?? null,
          };
        },
        remove: async (bucket, path) => {
          await storage.storage.from(bucket).remove([path]);
        },
      };
    },
  });

  return NextResponse.json(result.json, { status: result.status });
}
