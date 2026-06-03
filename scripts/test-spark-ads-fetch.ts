import { getTikTokCredentials } from "../lib/tiktok/credentials.ts";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const creds = await getTikTokCredentials(supabase as any, "15e11c2d-5649-408c-85f6-cdf10d789d87");
  if (!creds?.access_token) throw new Error("No credentials found");

  const advertiserId = "7639802149165301776";
  const identityId = "f5096207-c327-581f-93a4-e4f2f708069f";
  const identityType = "BC_AUTH_TT";
  const itemId = "7644514580277808406";

  async function rawGet(url: string, headers: Record<string, string> = {}) {
    console.log("  URL:", url);
    const r = await fetch(url, { headers });
    const text = await r.text();
    return { status: r.status, body: text.slice(0, 1200) };
  }

  const auth = { "Access-Token": creds.access_token };
  const base = "https://business-api.tiktok.com/open_api/v1.3/";

  const tests: Array<{ label: string; fn: () => Promise<{ status: number; body: string }> }> = [
    // Public TikTok OEmbed (no auth, can fetch thumbnail for any public post)
    { label: "OEmbed (public)", fn: () => rawGet(`https://www.tiktok.com/oembed?url=https://www.tiktok.com/video/${itemId}`) },

    // spark/ad/get with item_id
    { label: "GET /spark/ad/get/ item_id", fn: () => rawGet(`${base}spark/ad/get/?advertiser_id=${advertiserId}&item_id=${itemId}`, auth) },

    // Try the /file/video/ad/info/ endpoint with the tiktok_item_id as video_id
    { label: "GET /file/video/ad/info/ item_id as video_id", fn: () => rawGet(`${base}file/video/ad/info/?advertiser_id=${advertiserId}&video_ids=%5B%22${itemId}%22%5D`, auth) },

    // identity/video/get/ — identity-based video listing
    { label: "GET /identity/video/get/ item_id", fn: () => rawGet(`${base}identity/video/get/?advertiser_id=${advertiserId}&identity_id=${identityId}&identity_type=${identityType}&item_id=${itemId}`, auth) },

    // /spark/post/ list without item_id (list all posts for this identity)
    { label: "GET /spark/post/list/ identity", fn: () => rawGet(`${base}spark/post/list/?advertiser_id=${advertiserId}&identity_id=${identityId}&identity_type=${identityType}&page_size=3`, auth) },

    // Try checking what happens with just the advertiser spark ads
    { label: "GET /spark/post/list/ no identity", fn: () => rawGet(`${base}spark/post/list/?advertiser_id=${advertiserId}&page_size=3`, auth) },
  ];

  for (const { label, fn } of tests) {
    console.log(`\n=== ${label} ===`);
    try {
      const { status, body } = await fn();
      console.log(`  status=${status} body=${body}`);
    } catch (e) { console.error("  error:", (e as Error).message); }
  }
}

main().catch(console.error);
