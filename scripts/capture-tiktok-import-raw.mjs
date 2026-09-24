/**
 * Operator capture of GET /api/tiktok/campaigns/import/raw, driven
 * locally so the fixture is TikTok's bytes, not a hand-written bundle.
 *
 * Usage:
 *   node --env-file=.env.local scripts/capture-tiktok-import-raw.mjs \
 *     --advertiserId=7681317718284304385 --name=RUDIMENTAL
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const advertiserId = flag("advertiserId");
const campaignIdFlag = flag("campaignId");
const nameNeedle = (flag("name") ?? "RUDIMENTAL").toLowerCase();
const accountId =
  flag("accountId") ?? "a33bea77-500d-4bcb-99de-83547b2c11fa";

function flag(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tokenKey = process.env.TIKTOK_TOKEN_KEY;
if (!url || !serviceKey || !tokenKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TIKTOK_TOKEN_KEY required",
  );
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.rpc("get_tiktok_credentials", {
  p_account_id: accountId,
  p_key: tokenKey,
});
if (error) throw new Error(error.message);
if (!data) throw new Error("no TikTok credentials for account");

const credentials = JSON.parse(data);
const token = credentials.access_token;
if (typeof token !== "string" || !token) {
  throw new Error("TikTok credentials missing access_token");
}

const { listTikTokLiveCampaigns } = await import(
  "../lib/tiktok/import/readers.ts"
);
const { readTikTokLiveCampaign } = await import(
  "../lib/tiktok/import/readers.ts"
);
const { recordingTikTokGet } = await import("../lib/tiktok/import/record.ts");

if (!advertiserId) {
  throw new Error("--advertiserId is required");
}

const campaigns = await listTikTokLiveCampaigns({ advertiserId, token });
const match = campaignIdFlag
  ? campaigns.find((row) => row.id === campaignIdFlag)
  : campaigns.find((row) => row.name.toLowerCase().includes(nameNeedle));
if (!match) {
  const names = campaigns.map((row) => `${row.id}  ${row.name}  ${row.kind}`);
  console.error(`no campaign matching ${nameNeedle || campaignIdFlag}`);
  console.error(names.join("\n"));
  process.exit(1);
}

console.error(`capturing ${match.id}  ${match.name}  ${match.kind}`);

const { request, calls } = recordingTikTokGet();
let readError = null;
try {
  await readTikTokLiveCampaign({
    advertiserId,
    campaignId: match.id,
    token,
    request,
  });
} catch (err) {
  readError = err instanceof Error ? err.message : String(err);
}

const SIGNED = [
  "preview_url",
  "video_cover_url",
  "signature",
  "preview_url_expire_time",
];
function stripSigned(value) {
  if (Array.isArray(value)) return value.map(stripSigned);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (SIGNED.includes(key)) continue;
    next[key] = stripSigned(item);
  }
  return next;
}

const body = {
  _note: `CAPTURED ${new Date().toISOString().slice(0, 10)} — scripts/capture-tiktok-import-raw.mjs on advertiser ${advertiserId}, campaign ${match.id} (${match.name}, ${match.kind}). Library rows had preview_url, video_cover_url, signature, preview_url_expire_time removed (signed, expiring); every other key is verbatim.`,
  ok: readError == null,
  advertiserId,
  campaignId: match.id,
  capturedAt: new Date().toISOString(),
  note: "`data` is verbatim. The outer envelope (code, message, request_id) is only present on `error` because lib/tiktok/client.ts unwraps a code-0 response before this recorder sees it.",
  readError,
  calls: stripSigned(calls),
};

const out = join(
  ROOT,
  "lib/tiktok/import/__fixtures__/captured",
  `tiktok-import-capture-${match.id}.json`,
);
writeFileSync(out, `${JSON.stringify(body)}\n`);
console.error(`wrote ${out}`);
console.error(
  JSON.stringify({
    campaignId: match.id,
    name: match.name,
    kind: match.kind,
    calls: calls.length,
    readError,
    adGroups: calls
      .filter(
        (call) =>
          call.path === "/smart_plus/adgroup/get/" ||
          call.path === "/adgroup/get/",
      )
      .flatMap((call) => call.data?.list ?? []).length,
  }),
);
