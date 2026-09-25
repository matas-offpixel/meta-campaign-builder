/**
 * Operator capture of GET /api/meta/campaigns/import/raw, driven
 * locally so the fixture is Meta's bytes, not a hand-written bundle.
 *
 * Uses fetch against Graph directly (does not import lib/meta/client.ts
 * — MetaApiError's parameter properties break strip-types). The reads
 * are the same functions the route runs.
 *
 * Usage:
 *   node --env-file=.env.local scripts/capture-meta-import-raw.mjs \
 *     --adAccountId=act_1967530076312 --campaignId=52522388611107
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const adAccountId = flag("adAccountId") ?? "act_1967530076312";
const campaignId = flag("campaignId") ?? "52522388611107";

function flag(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const token = process.env.META_ACCESS_TOKEN;
if (!token) {
  throw new Error("META_ACCESS_TOKEN required");
}

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

async function graphGet(path, params) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status} on GET ${path}`);
  }
  return json;
}

async function graphPost(path, body) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `HTTP ${res.status} on POST ${path}`);
  }
  return json;
}

const { readMetaLiveCampaign } = await import("../lib/meta/import/readers.ts");
const { recordingMetaGraph } = await import("../lib/meta/import/record.ts");

console.error(`capturing ${campaignId} on ${adAccountId}`);

const { request, calls } = recordingMetaGraph({
  get: (path, params) => graphGet(path, params),
  post: (path, body) => graphPost(path, body),
});

let readError = null;
try {
  await readMetaLiveCampaign({
    adAccountId,
    campaignId,
    token,
    request,
  });
} catch (err) {
  readError = err instanceof Error ? err.message : String(err);
}

const SIGNED = ["thumbnail_url", "image_url"];
function stripSigned(value) {
  if (Array.isArray(value)) return value.map(stripSigned);
  // Graph paging.next / paging.previous URLs carry the caller's access_token.
  if (typeof value === "string") return value.replace(/access_token=[^&"]+/g, "access_token=REDACTED");
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (SIGNED.includes(key)) continue;
    next[key] = stripSigned(item);
  }
  return next;
}

const body = {
  _note: `CAPTURED ${new Date().toISOString().slice(0, 10)} — scripts/capture-meta-import-raw.mjs on ${adAccountId}, campaign ${campaignId}. Rows had thumbnail_url and image_url removed (signed, expiring); every other key is verbatim Graph, including targeting.geo_locations and targeting.flexible_spec.`,
  ok: readError == null,
  adAccountId,
  campaignId,
  capturedAt: new Date().toISOString(),
  note: "`data` is verbatim Graph. Creative hydration is POST / Batch API (Graph v26.0 removed GET /?ids=), using CREATIVE_BATCH_FIELDS. No mapping.",
  readError,
  calls: stripSigned(calls),
};

const out = join(
  ROOT,
  "lib/meta/import/__fixtures__/captured",
  `meta-import-capture-${campaignId}.json`,
);
writeFileSync(out, `${JSON.stringify(body)}\n`);
console.error(`wrote ${out}`);

const adsetCall = calls.find((call) => call.path.endsWith("/adsets"));
const adCall = calls.find((call) => call.path.endsWith("/ads"));
const cities = [];
const flexible = [];
for (const row of adsetCall?.data?.data ?? []) {
  const geo = row.targeting?.geo_locations;
  cities.push(geo?.cities ?? null);
  flexible.push(row.targeting?.flexible_spec ?? null);
}

console.error(
  JSON.stringify(
    {
      campaignId,
      ok: readError == null,
      readError,
      calls: calls.length,
      adSets: (adsetCall?.data?.data ?? []).length,
      ads: (adCall?.data?.data ?? []).length,
      firstCityKeys: (cities[0] ?? []).map((city) =>
        city && typeof city === "object" ? Object.keys(city) : city,
      ),
      firstFlexibleSpecType: flexible[0] == null ? null : Array.isArray(flexible[0]) ? "array" : typeof flexible[0],
    },
    null,
    2,
  ),
);
