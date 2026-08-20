import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { readTikTokAccountCredentials } from "@/lib/tiktok/api-account";
import { tikTokAudienceAuthErrorBody } from "@/lib/tiktok/audience-response";
import {
  audienceErrorMessage,
  settleAudienceDimension,
} from "@/lib/tiktok/audience-settle";

export { audienceErrorMessage, settleAudienceDimension };

export async function requireTikTokAudienceContext(req: NextRequest): Promise<
  | {
      ok: true;
      advertiserId: string;
      accessToken: string;
    }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(tikTokAudienceAuthErrorBody("Not signed in"), {
        status: 401,
      }),
    };
  }

  const advertiserId = req.nextUrl.searchParams.get("advertiser_id");
  if (!advertiserId) {
    return {
      ok: false,
      response: NextResponse.json(
        tikTokAudienceAuthErrorBody("Missing advertiser_id query param"),
        { status: 400 },
      ),
    };
  }

  const credentials = await readTikTokAccountCredentials(supabase, {
    userId: user.id,
    advertiserId,
  });
  if (!credentials) {
    return {
      ok: false,
      response: NextResponse.json(
        tikTokAudienceAuthErrorBody("TikTok credentials missing"),
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    advertiserId,
    accessToken: credentials.accessToken,
  };
}

