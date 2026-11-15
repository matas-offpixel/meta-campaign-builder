import { NextRequest } from "next/server";
import { handleUploadAsset, uploadFailureResponse } from "@/lib/meta/upload-asset-handler";

// file_url returns as soon as Meta accepts the URL, then this function
// polls status. The multipart path (the default) of a large file still
// needs the long budget. Vercel's default 10s (Hobby) / 60s (Pro) is too short.
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
  try {
    return await handleUploadAsset(req);
  } catch (err) {
    return uploadFailureResponse(err);
  }
}
