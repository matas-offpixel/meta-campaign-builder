/**
 * scripts/advantage-age-proof.mts
 *
 * Proof for PR "Advantage+ Audience: send age as the suggestion": one
 * PAUSED test campaign with one PAUSED Advantage+ ad set at 18–45 with one
 * suggestion audience, on NX (act_606252931141334, Sales objective via
 * registration). It reads the ad set back and deletes the campaign.
 *
 * The ad set goes through the app's own builder (buildAdSetPayload) and,
 * if Meta refuses the first create, the app's own salvage ladder
 * (createAdSetWithSalvage), so the read-back shows which step Meta took:
 *   step 1 — age_range [18, 45] with individual_setting.age = 1;
 *   step 2 — Advantage+ with age_max 65 and no age suggestion;
 *   step 3 — Advantage+ refused: the ad set fails with Meta's error.
 *
 * Every network call passes a fetch guard that allows ONLY:
 *   1. POST /act_606252931141334/campaigns, status PAUSED, once;
 *   2. POST /act_606252931141334/adsets, status PAUSED, under that campaign,
 *      at most twice (step 1, then step 2's retry if step 1 was refused);
 *   3. GET /{the ad set it made}?fields=…;
 *   4. DELETE /{the campaign it made}, once.
 * Anything else throws before it reaches the network. No ads, no
 * creatives, no uploads, no audience writes. Tokens are never printed.
 *
 * Dry run (default): builds and prints the payloads; the guard refuses
 * every request. --run: does the four calls above.
 *
 *   cd ~/meta-campaign-builder && npx tsx --env-file=.env.local scripts/advantage-age-proof.mts          # dry run
 *   cd ~/meta-campaign-builder && npx tsx --env-file=.env.local scripts/advantage-age-proof.mts --run    # proof
 *
 * Token: PROOF_META_TOKEN if set, else META_ACCESS_TOKEN.
 */

const AD_ACCOUNT = "act_606252931141334";
const PIXEL_ID = "645185673672763";
/** [NX26-LOCKLEAD] 75% video views 60d — an existing custom audience on the account, chosen read-only. */
const SUGGESTION_AUDIENCE_ID = "120252626474390755";
const CAMPAIGN_NAME = "[TEST] Advantage+ age proof";
const RUN = process.argv.includes("--run");
const API_VERSION = process.env.META_API_VERSION ?? "v21.0";

// ── Fetch guard ──────────────────────────────────────────────────────────────

const state = {
  campaignCreates: 0,
  adSetCreates: 0,
  deletes: 0,
  campaignId: null as string | null,
  adSetId: null as string | null,
};

function pathOf(url: URL): string {
  return url.pathname.replace(/^\/v\d+\.\d+/, "");
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  if (!init?.body || typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  const path = pathOf(url);
  const refuse = (why: string): never => {
    throw new Error(`[guard] refused ${method} ${path}: ${why}`);
  };
  if (url.hostname !== "graph.facebook.com") refuse("only graph.facebook.com");
  if (!RUN) refuse("dry run — no network");

  let kind: "campaign" | "adset" | "get" | "delete";
  const body = bodyOf(init);
  if (method === "POST" && path === `/${AD_ACCOUNT}/campaigns`) {
    if (state.campaignCreates >= 1) refuse("one campaign create only");
    if (body.status !== "PAUSED") refuse("campaign must be PAUSED");
    kind = "campaign";
    state.campaignCreates += 1;
  } else if (method === "POST" && path === `/${AD_ACCOUNT}/adsets`) {
    if (!state.campaignId) refuse("no test campaign yet");
    if (state.adSetId) refuse("an ad set already exists");
    if (state.adSetCreates >= 2) refuse("two ad set creates at most (step 1, step 2)");
    if (body.status !== "PAUSED") refuse("ad set must be PAUSED");
    if (String(body.campaign_id) !== state.campaignId) refuse("ad set must be under the test campaign");
    kind = "adset";
    state.adSetCreates += 1;
  } else if (method === "GET" && state.adSetId && path === `/${state.adSetId}`) {
    kind = "get";
  } else if (method === "DELETE" && state.campaignId && path === `/${state.campaignId}`) {
    if (state.deletes >= 1) refuse("one DELETE only");
    kind = "delete";
    state.deletes += 1;
  } else {
    return refuse("not on the allow list");
  }

  const res = await realFetch(input, init);
  const json = (await res.clone().json().catch(() => ({}))) as Record<string, unknown>;
  const err = (json.error ?? null) as Record<string, unknown> | null;
  const tail = err
    ? `HTTP ${res.status} code=${err.code ?? "n/a"} subcode=${err.error_subcode ?? "n/a"} message=${err.message ?? ""}`
    : `HTTP ${res.status}${json.id ? ` id=${json.id}` : ""}${json.success != null ? ` success=${json.success}` : ""}`;
  if (kind === "campaign" && !err && typeof json.id === "string") state.campaignId = json.id;
  if (kind === "adset" && !err && typeof json.id === "string") state.adSetId = json.id;
  const label = kind === "campaign" || kind === "adset" ? `POST /${kind === "campaign" ? "campaigns" : "adsets"} status=PAUSED` : `${method} /{${kind === "get" ? "ad set" : "campaign"}}`;
  console.log(`    [meta] ${label} → ${tail}`);
  return res;
}) as typeof fetch;

// ── The proof ────────────────────────────────────────────────────────────────

const { buildAdSetPayload } = await import("../lib/meta/adset.ts");
const { createMetaCampaign, createMetaAdSet } = await import("../lib/meta/client.ts");
const { createAdSetWithSalvage } = await import("../lib/audiences/adset-create-with-salvage.ts");
type AdSetSuggestion = import("../lib/types.ts").AdSetSuggestion;
type AudienceSettings = import("../lib/types.ts").AudienceSettings;
type BudgetScheduleSettings = import("../lib/types.ts").BudgetScheduleSettings;

const token = process.env.PROOF_META_TOKEN || process.env.META_ACCESS_TOKEN || "";
if (RUN && !token) throw new Error("Set PROOF_META_TOKEN or META_ACCESS_TOKEN.");

const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
const adSet = {
  id: "as_proof",
  name: "Broad + suggestions (proof)",
  sourceType: "custom_group",
  sourceId: "cag_proof",
  sourceName: "Proof suggestion audience",
  ageMin: 18,
  ageMax: 45,
  budgetPerDay: 5,
  advantagePlus: true,
  enabled: true,
  geoLocations: { countries: ["GB"] },
} as unknown as AdSetSuggestion;
const audiences = {
  interestGroups: [],
  customAudienceGroups: [
    { id: "cag_proof", name: "Proof suggestion audience", audienceIds: [SUGGESTION_AUDIENCE_ID], suggestionsOnly: true },
  ],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;
const schedule = { startDate: `${tomorrow}T09:00`, endDate: "", timezone: "Europe/London" } as unknown as BudgetScheduleSettings;

console.log(`Advantage+ age proof · ${AD_ACCOUNT} · Graph ${API_VERSION} · ${RUN ? "RUN" : "dry run"}`);

let exitCode = 0;
try {
  const payloadFor = (campaignId: string) =>
    buildAdSetPayload(adSet, campaignId, audiences, schedule, "conversions", "registration", PIXEL_ID, false, undefined, "PAUSED");

  console.log("\n▶ step 1 payload (targeting):");
  console.log(JSON.stringify(JSON.parse(JSON.stringify(payloadFor("{campaign}").targeting)), null, 2));
  if (!RUN) {
    console.log("\nDry run: nothing sent. Re-run with --run.");
  } else {
    console.log("\n▶ create the paused test campaign");
    await createMetaCampaign({ adAccountId: AD_ACCOUNT, name: CAMPAIGN_NAME, objective: "registration", status: "PAUSED", token });
    const payload = payloadFor(state.campaignId!);

    console.log("\n▶ create the paused Advantage+ ad set (step 1)");
    const asStart = Date.now();
    let step = "1";
    try {
      await createMetaAdSet(AD_ACCOUNT, payload, token);
    } catch (first) {
      console.log("  step 1 refused — running the app's salvage ladder");
      const res = await createAdSetWithSalvage(
        {
          adSet,
          initialPayload: payload,
          initialError: first,
          adAccountId: AD_ACCOUNT,
          launchToken: token,
          logPrefix: "proof",
          asStart,
          freshReadinessResults: new Map(),
          preflightDroppedCount: 0,
          audienceNameById: new Map(),
          pageGroups: [],
        },
        {
          createMetaAdSet: (acc, p, t) => createMetaAdSet(acc, p, t),
          fetchCustomAudienceAvailability: async () => {
            throw new Error("[proof] audience availability reads are not part of this proof");
          },
          recreateEngagementAudiencesForGroup: async () => {
            throw new Error("[proof] audience writes are not part of this proof");
          },
          formatError: (e) => (e instanceof Error ? e.message : String(e)),
        },
      );
      step = res.ageSuggestionDropped ? "2" : "salvaged";
      console.log(`  salvage result: ageSuggestionDropped=${res.ageSuggestionDropped ?? "none"} metaError=${JSON.stringify(res.metaError ?? null)}`);
    }

    console.log(`\n▶ read the ad set back (GET) — Meta took step ${step}`);
    const getUrl = new URL(`https://graph.facebook.com/${API_VERSION}/${state.adSetId}`);
    getUrl.searchParams.set("fields", "id,name,status,campaign_id,targeting");
    getUrl.searchParams.set("access_token", token);
    const read = (await (await fetch(getUrl.toString(), { method: "GET" })).json()) as Record<string, unknown>;
    const t = (read.targeting ?? {}) as Record<string, unknown>;
    console.log(
      JSON.stringify(
        {
          id: read.id,
          status: read.status,
          campaign_id: read.campaign_id,
          age_min: t.age_min,
          age_max: t.age_max,
          age_range: t.age_range,
          targeting_automation: t.targeting_automation,
          custom_audiences: Array.isArray(t.custom_audiences) ? (t.custom_audiences as { id: string }[]).map((a) => a.id) : t.custom_audiences,
          targeting_relaxation_types: t.targeting_relaxation_types,
          geo_locations: t.geo_locations,
        },
        null,
        2,
      ),
    );
  }
} catch (err) {
  exitCode = 1;
  const e = err as { message?: string; code?: unknown; subcode?: unknown };
  console.log(`\n✗ ${e.message ?? String(err)}${e.code != null ? ` · code=${e.code} subcode=${e.subcode ?? "n/a"}` : ""}`);
} finally {
  if (RUN && state.campaignId) {
    console.log("\n▶ delete the paused test campaign (one DELETE)");
    const delUrl = new URL(`https://graph.facebook.com/${API_VERSION}/${state.campaignId}`);
    delUrl.searchParams.set("access_token", token);
    await fetch(delUrl.toString(), { method: "DELETE" }).catch((e) => {
      exitCode = 1;
      console.log(`  DELETE failed: ${String(e)} — delete campaign ${state.campaignId} by hand`);
    });
  }
}
process.exit(exitCode);
