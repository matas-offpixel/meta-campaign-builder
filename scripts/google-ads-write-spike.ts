#!/usr/bin/env node
/**
 * scripts/google-ads-write-spike.ts
 *
 * Phase 0 — Google Ads Search Campaign Creator write-API spike.
 *
 * Builds a minimal PAUSED Search campaign on a chosen sub-account via the
 * REST API, verifies it with a read-back GAQL query, and removes it.
 *
 * NON-NEGOTIABLES
 * - Dry-run by default. Live execution requires --execute (or
 *   GOOGLE_ADS_SPIKE_EXECUTE=1).
 * - All resources created PAUSED.
 * - Campaign name MUST contain "[SPIKE-TEST]" and "DELETE ME".
 * - Cleanup with a campaign-level remove operation at the end.
 * - Mutates are sequential (GOOGLE_ADS_CHUNK_CONCURRENCY=1).
 * - REST only via the existing explicit-OAuth2Client path; never gRPC, never
 *   ADC (PR #207 lesson — do not regress).
 *
 * USAGE
 *   set -a && source .env.local && set +a
 *   # Dry-run (no API calls touch a real account other than read-back/cleanup queries):
 *   node --experimental-strip-types scripts/google-ads-write-spike.ts \
 *     --account-id 34fcf0f8-7d15-4dc2-9f78-f6915cb84286
 *
 *   # Live execution:
 *   node --experimental-strip-types scripts/google-ads-write-spike.ts \
 *     --account-id 34fcf0f8-7d15-4dc2-9f78-f6915cb84286 --execute
 *
 *   # Or by Google customer id (string match against google_customer_id):
 *   node --experimental-strip-types scripts/google-ads-write-spike.ts \
 *     --customer-id 793-280-0197 --execute
 *
 *   # Skip cleanup (for debugging — only with --execute):
 *   ... --execute --no-cleanup
 *
 *   # Validate-only mode (Google Ads API validates without persisting):
 *   ... --execute --validate-only
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  GoogleAdsApiError,
  GoogleAdsClient,
  GOOGLE_ADS_CHUNK_CONCURRENCY,
  type GoogleAdsCustomerCredentials,
  type GoogleAdsMutateOperation,
  type GoogleAdsMutateResult,
} from "../lib/google-ads/client.ts";
import {
  getGoogleAdsCredentials,
  requireGoogleAdsTokenKey,
  type GoogleAdsCredentials,
} from "../lib/google-ads/credentials.ts";
import { normaliseCustomerId } from "../lib/google-ads/oauth.ts";

const SPIKE_TAG = "[SPIKE-TEST]";
const SPIKE_NAME = `${SPIKE_TAG} Google Ads Write Spike — DELETE ME`;
const DAILY_BUDGET_MICROS = 5_000_000; // £5/day at micros (1 GBP = 1,000,000 micros)
const CPC_BID_CEILING_MICROS = 500_000; // £0.50 ceiling for Maximise Clicks
const DEFAULT_CPC_BID_MICROS = 250_000; // £0.25 default ad-group bid (manual_cpc fallback only)

interface Args {
  accountId?: string;
  customerIdInput?: string;
  execute: boolean;
  validateOnly: boolean;
  cleanup: boolean;
  finalUrl: string;
}

function parseArgs(): Args {
  const args: Args = {
    execute:
      process.argv.includes("--execute") ||
      process.env.GOOGLE_ADS_SPIKE_EXECUTE === "1",
    validateOnly: process.argv.includes("--validate-only"),
    cleanup: !process.argv.includes("--no-cleanup"),
    finalUrl:
      argValue("--final-url") ?? "https://offpixel.com/?utm_source=spike-test",
  };
  args.accountId = argValue("--account-id");
  args.customerIdInput = argValue("--customer-id");
  return args;
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const prefix = `${flag}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Source .env.local first.",
    );
  }
  requireGoogleAdsTokenKey(); // throws if missing/short
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Resolve account ────────────────────────────────────────────────────
  const { accountRow, credentials } = await resolveAccount(supabase, args);

  console.log("─".repeat(80));
  console.log(" Google Ads Write Spike");
  console.log("─".repeat(80));
  console.log(
    JSON.stringify(
      {
        account_id: accountRow.id,
        account_name: accountRow.account_name,
        google_customer_id: accountRow.google_customer_id,
        login_customer_id: accountRow.login_customer_id,
        execute: args.execute,
        validate_only: args.validateOnly,
        cleanup: args.cleanup,
        chunk_concurrency: GOOGLE_ADS_CHUNK_CONCURRENCY,
      },
      null,
      2,
    ),
  );

  if (!args.execute) {
    console.log("\n[dry-run] No mutate calls will be issued.");
    console.log(
      "[dry-run] Run again with --execute (or GOOGLE_ADS_SPIKE_EXECUTE=1) to hit the live API.",
    );
  }

  const client = new GoogleAdsClient();
  const customerIdDigits = credentials.customer_id.replace(/\D/g, "");
  const creds: GoogleAdsCustomerCredentials = {
    customerId: credentials.customer_id,
    refreshToken: credentials.refresh_token,
    loginCustomerId: credentials.login_customer_id,
  };

  // ── Build operations ───────────────────────────────────────────────────
  const tempBudgetRef = "-1";
  const tempCampaignRef = "-2";
  const tempAdGroupRef = "-3";

  const budgetOp: GoogleAdsMutateOperation = {
    create: {
      resourceName: `customers/${customerIdDigits}/campaignBudgets/${tempBudgetRef}`,
      name: `${SPIKE_NAME} Budget ${Date.now()}`,
      amountMicros: String(DAILY_BUDGET_MICROS),
      deliveryMethod: "STANDARD",
      explicitlyShared: false,
    },
  };

  const campaignOp: GoogleAdsMutateOperation = {
    create: {
      resourceName: `customers/${customerIdDigits}/campaigns/${tempCampaignRef}`,
      name: `${SPIKE_NAME} ${Date.now()}`,
      advertisingChannelType: "SEARCH",
      status: "PAUSED",
      campaignBudget: budgetOp.create.resourceName,
      // Maximise Clicks: no conversion tracking required, with a CPC ceiling.
      // Field name in v23 is `target_spend` with `cpcBidCeilingMicros`.
      targetSpend: {
        cpcBidCeilingMicros: String(CPC_BID_CEILING_MICROS),
      },
      networkSettings: {
        targetGoogleSearch: true,
        targetSearchNetwork: true,
        targetContentNetwork: false,
        targetPartnerSearchNetwork: false,
      },
      // v23 hard-requires this field on campaign create (EU DSA compliance).
      // Spike confirmed by FIELD_REQUIRED error on first --execute run.
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    },
  };

  const adGroupOp: GoogleAdsMutateOperation = {
    create: {
      resourceName: `customers/${customerIdDigits}/adGroups/${tempAdGroupRef}`,
      campaign: campaignOp.create.resourceName,
      name: `${SPIKE_NAME} AG`,
      status: "PAUSED",
      type: "SEARCH_STANDARD",
      // Required even with Maximise Clicks (kept as a default/manual fallback signal).
      cpcBidMicros: String(DEFAULT_CPC_BID_MICROS),
    },
  };

  const keywordTexts = [
    { text: "junction 2 festival tickets", matchType: "EXACT" },
    { text: "junction 2 melodic stage", matchType: "PHRASE" },
    { text: "junction 2 lineup 2026", matchType: "PHRASE" },
    { text: "boomtown festival tickets", matchType: "EXACT" },
  ];
  const negativeTexts = [
    { text: "free tickets", matchType: "PHRASE" },
    { text: "torrent", matchType: "BROAD" },
    { text: "stream", matchType: "BROAD" },
  ];

  const keywordOps: GoogleAdsMutateOperation[] = keywordTexts.map((kw) => ({
    create: {
      adGroup: adGroupOp.create.resourceName,
      status: "ENABLED",
      keyword: { text: kw.text, matchType: kw.matchType },
    },
  }));

  const negativeOps: GoogleAdsMutateOperation[] = negativeTexts.map((kw) => ({
    create: {
      adGroup: adGroupOp.create.resourceName,
      negative: true,
      keyword: { text: kw.text, matchType: kw.matchType },
    },
  }));

  // RSA — 3+ headlines (≤30 chars each), 2+ descriptions (≤90 chars each).
  const rsaOp: GoogleAdsMutateOperation = {
    create: {
      adGroup: adGroupOp.create.resourceName,
      status: "PAUSED",
      ad: {
        finalUrls: [args.finalUrl],
        responsiveSearchAd: {
          headlines: [
            { text: "Junction 2 Festival" }, // 19
            { text: "Melodic Stage Tickets" }, // 22
            { text: "Buy Tickets Now — J2 2026" }, // 25
            { text: "Festival This July" }, // 18
          ],
          descriptions: [
            { text: "Limited tickets remaining for Junction 2 Melodic Stage. Secure yours today." }, // 76
            { text: "Headline acts, world-class production, and unforgettable nights — book now." }, // 79
          ],
        },
      },
    },
  };

  // ── Print pretty plan ──────────────────────────────────────────────────
  console.log("\nOperations planned (5 sequential mutate calls):");
  console.log("  1. campaignBudgets:mutate (1 op)");
  console.log("  2. campaigns:mutate (1 op, Maximise Clicks via target_spend)");
  console.log("  3. adGroups:mutate (1 op)");
  console.log(
    `  4. adGroupCriteria:mutate (${keywordOps.length} keyword + ${negativeOps.length} negative ops)`,
  );
  console.log("  5. adGroupAds:mutate (1 RSA op)");
  console.log("\nFull request bodies (will be POSTed when --execute):");
  console.log(
    JSON.stringify(
      {
        campaignBudgets: { operations: [budgetOp] },
        campaigns: { operations: [campaignOp] },
        adGroups: { operations: [adGroupOp] },
        adGroupCriteria: { operations: [...keywordOps, ...negativeOps] },
        adGroupAds: { operations: [rsaOp] },
      },
      null,
      2,
    ),
  );

  if (!args.execute) {
    console.log("\n[dry-run] Exiting without API mutate calls.");
    return;
  }

  // ── Execute (sequential, all-or-nothing per call) ──────────────────────
  let createdCampaignResource: string | null = null;
  let createdBudgetResource: string | null = null;
  const successes: Array<{ step: string; resourceName: string }> = [];
  const stepStart = (label: string) => {
    const t = Date.now();
    console.log(`\n→ ${label}`);
    return () => console.log(`  ✓ ${label} (${Date.now() - t}ms)`);
  };

  try {
    // Step 1 — campaign budget
    const done1 = stepStart("campaignBudgets:mutate");
    const budgetRes = await client.mutate(
      creds,
      "campaignBudgets",
      [budgetOp],
      { validateOnly: args.validateOnly },
    );
    const budgetResource = pickResourceName(budgetRes.results, 0);
    createdBudgetResource = args.validateOnly ? null : budgetResource;
    successes.push({ step: "campaignBudget", resourceName: budgetResource });
    done1();

    // Step 2 — campaign
    const campaignOpFinal = withReplacedRef(
      campaignOp,
      "campaignBudget",
      budgetOp.create.resourceName as string,
      budgetResource,
    );
    const done2 = stepStart("campaigns:mutate");
    const campaignRes = await client.mutate(
      creds,
      "campaigns",
      [campaignOpFinal],
      { validateOnly: args.validateOnly },
    );
    const campaignResource = pickResourceName(campaignRes.results, 0);
    createdCampaignResource = campaignResource;
    successes.push({ step: "campaign", resourceName: campaignResource });
    done2();

    // Step 3 — ad group
    const adGroupOpFinal = withReplacedRef(
      adGroupOp,
      "campaign",
      campaignOp.create.resourceName as string,
      campaignResource,
    );
    const done3 = stepStart("adGroups:mutate");
    const adGroupRes = await client.mutate(
      creds,
      "adGroups",
      [adGroupOpFinal],
      { validateOnly: args.validateOnly },
    );
    const adGroupResource = pickResourceName(adGroupRes.results, 0);
    successes.push({ step: "adGroup", resourceName: adGroupResource });
    done3();

    // Step 4 — keywords + negatives (partial-failure ON so per-keyword failures don't abort the batch)
    const criteriaOpsFinal = [...keywordOps, ...negativeOps].map((op) =>
      withReplacedRef(op, "adGroup", adGroupOp.create.resourceName as string, adGroupResource),
    );
    const done4 = stepStart(
      `adGroupCriteria:mutate (${criteriaOpsFinal.length} ops, partial-failure ON)`,
    );
    const criteriaRes = await client.mutate(
      creds,
      "adGroupCriteria",
      criteriaOpsFinal,
      { validateOnly: args.validateOnly, partialFailure: true },
    );
    if (criteriaRes.partialFailureError) {
      console.warn(
        "  ⚠ partialFailureError:",
        JSON.stringify(criteriaRes.partialFailureError, null, 2),
      );
    }
    (criteriaRes.results ?? []).forEach((r, i) => {
      if (r?.resourceName) {
        successes.push({
          step: `adGroupCriterion[${i}]`,
          resourceName: r.resourceName,
        });
      }
    });
    done4();

    // Step 5 — RSA
    const rsaOpFinal = withReplacedRef(rsaOp, "adGroup", adGroupOp.create.resourceName as string, adGroupResource);
    const done5 = stepStart("adGroupAds:mutate (1 RSA)");
    const rsaRes = await client.mutate(
      creds,
      "adGroupAds",
      [rsaOpFinal],
      { validateOnly: args.validateOnly },
    );
    const rsaResource = pickResourceName(rsaRes.results, 0);
    successes.push({ step: "adGroupAd", resourceName: rsaResource });
    done5();

    console.log("\n✓ Mutate chain complete. Created resources:");
    for (const s of successes) console.log(`  ${s.step}: ${s.resourceName}`);

    // ── Read-back verification ─────────────────────────────────────────
    // GAQL resource-compatibility rule: each query has a single FROM, and
    // only fields from compatible resources are SELECTable. We can pull
    // campaign + ad_group fields from FROM ad_group, but campaign_budget
    // fields need their own FROM campaign_budget query. Split accordingly.
    if (!args.validateOnly) {
      console.log("\n→ Read-back verification via GAQL");
      const campaignGaql = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.bidding_strategy_type,
          ad_group.id,
          ad_group.name,
          ad_group.status,
          ad_group.type
        FROM ad_group
        WHERE campaign.resource_name = '${campaignResource}'
      `;
      const campaignRows = await client.query<unknown[]>(creds, campaignGaql);
      console.log(
        `  campaign + ad_group rows (${campaignRows.length}):`,
        JSON.stringify(campaignRows, null, 2),
      );

      const budgetGaql = `
        SELECT
          campaign_budget.resource_name,
          campaign_budget.amount_micros,
          campaign_budget.delivery_method
        FROM campaign_budget
        WHERE campaign_budget.resource_name = '${budgetResource}'
      `;
      const budgetRows = await client.query<unknown[]>(creds, budgetGaql);
      console.log(
        `  campaign_budget rows (${budgetRows.length}):`,
        JSON.stringify(budgetRows, null, 2),
      );

      const criteriaGaql = `
        SELECT
          ad_group_criterion.criterion_id,
          ad_group_criterion.type,
          ad_group_criterion.negative,
          ad_group_criterion.keyword.text,
          ad_group_criterion.keyword.match_type,
          ad_group_criterion.status
        FROM ad_group_criterion
        WHERE ad_group.resource_name = '${adGroupResource}'
      `;
      const criteriaRows = await client.query<unknown[]>(creds, criteriaGaql);
      console.log(
        `  ad_group_criterion rows (${criteriaRows.length}, expect 4 keyword + 3 negative = 7):`,
        JSON.stringify(criteriaRows, null, 2),
      );

      const rsaGaql = `
        SELECT
          ad_group_ad.resource_name,
          ad_group_ad.status,
          ad_group_ad.ad.responsive_search_ad.headlines,
          ad_group_ad.ad.responsive_search_ad.descriptions,
          ad_group_ad.ad.final_urls
        FROM ad_group_ad
        WHERE ad_group.resource_name = '${adGroupResource}'
      `;
      const rsaRows = await client.query<unknown[]>(creds, rsaGaql);
      console.log(
        `  ad_group_ad rows (${rsaRows.length}):`,
        JSON.stringify(rsaRows, null, 2),
      );
    }
  } catch (err) {
    console.error("\n✗ Mutate chain aborted with error:");
    printGoogleAdsError(err);
    if (args.cleanup && !args.validateOnly) {
      // Campaign first (it depends on the budget). Removing the campaign also
      // releases the budget link so the budget can be deleted afterwards.
      if (createdCampaignResource) {
        console.log("\n→ Attempting best-effort cleanup of orphaned campaign…");
        await cleanupResource(client, creds, "campaigns", createdCampaignResource).catch(
          (cleanupErr) => {
            console.error("  campaign cleanup failed:");
            printGoogleAdsError(cleanupErr);
          },
        );
      }
      if (createdBudgetResource) {
        console.log("\n→ Attempting best-effort cleanup of orphaned budget…");
        await cleanupResource(client, creds, "campaignBudgets", createdBudgetResource).catch(
          (cleanupErr) => {
            console.error("  budget cleanup failed:");
            printGoogleAdsError(cleanupErr);
          },
        );
      }
    }
    process.exitCode = 1;
    return;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────
  if (args.validateOnly) {
    console.log("\n[validate-only] No persisted resources to clean up.");
    return;
  }
  if (!args.cleanup) {
    console.log(
      "\n[--no-cleanup] Skipping campaign removal. Remember to delete manually:",
      createdCampaignResource,
    );
    return;
  }
  if (!createdCampaignResource) {
    console.warn(
      "\n⚠ No campaign resource captured — nothing to clean up. Inspect logs above.",
    );
    return;
  }
  await cleanupResource(client, creds, "campaigns", createdCampaignResource);
  if (createdBudgetResource) {
    await cleanupResource(client, creds, "campaignBudgets", createdBudgetResource);
  }
}

async function cleanupResource(
  client: GoogleAdsClient,
  creds: GoogleAdsCustomerCredentials,
  resource: string,
  resourceName: string,
): Promise<void> {
  const t = Date.now();
  console.log(`\n→ Cleanup: ${resource}:mutate remove ${resourceName}`);
  const res = await client.mutate(creds, resource, [{ remove: resourceName }]);
  console.log(`  ✓ cleanup complete (${Date.now() - t}ms)`);
  console.log("  cleanup response:", JSON.stringify(res, null, 2));
}

function pickResourceName(
  results: GoogleAdsMutateResult[] | undefined,
  index: number,
): string {
  const name = results?.[index]?.resourceName;
  if (!name) {
    throw new Error(
      `Google Ads mutate returned no resourceName for index ${index}. Response: ${JSON.stringify(results)}`,
    );
  }
  return name;
}

function withReplacedRef(
  op: GoogleAdsMutateOperation,
  field: string,
  tempValue: string,
  realValue: string,
): GoogleAdsMutateOperation {
  if (!("create" in op)) return op;
  const create = op.create as Record<string, unknown>;
  if (create[field] === tempValue) {
    return { create: { ...create, [field]: realValue } };
  }
  return op;
}

function printGoogleAdsError(err: unknown): void {
  if (err instanceof GoogleAdsApiError) {
    console.error(`  ${err.name}: ${err.message}`);
    console.error(
      `  status=${err.status ?? ""} code=${err.code ?? ""} httpStatus=${err.httpStatus ?? ""}`,
    );
    return;
  }
  if (err && typeof err === "object" && "response" in err) {
    console.error("  raw:", JSON.stringify((err as { response: unknown }).response, null, 2));
    return;
  }
  console.error("  ", err);
}

interface GoogleAdsAccountRow {
  id: string;
  account_name: string | null;
  google_customer_id: string;
  login_customer_id: string | null;
}

async function resolveAccount(
  supabase: SupabaseClient,
  args: Args,
): Promise<{
  accountRow: GoogleAdsAccountRow;
  credentials: GoogleAdsCredentials;
}> {
  let row: GoogleAdsAccountRow | null = null;
  if (args.accountId) {
    const { data, error } = await supabase
      .from("google_ads_accounts")
      .select("id, account_name, google_customer_id, login_customer_id")
      .eq("id", args.accountId)
      .maybeSingle();
    if (error) throw new Error(`Lookup failed: ${error.message}`);
    row = (data as GoogleAdsAccountRow | null) ?? null;
  } else if (args.customerIdInput) {
    const normalised = normaliseCustomerId(args.customerIdInput);
    const { data, error } = await supabase
      .from("google_ads_accounts")
      .select("id, account_name, google_customer_id, login_customer_id")
      .eq("google_customer_id", normalised)
      .maybeSingle();
    if (error) throw new Error(`Lookup failed: ${error.message}`);
    row = (data as GoogleAdsAccountRow | null) ?? null;
  } else {
    throw new Error(
      "Pass --account-id <uuid> or --customer-id <NNN-NNN-NNNN> to choose a target account.",
    );
  }

  if (!row) {
    throw new Error("No google_ads_accounts row matched the given identifier.");
  }

  // getGoogleAdsCredentials is typed for SupabaseClient<Database>; the script
  // uses an untyped service-role client (same pattern as other scripts/* utils),
  // so we cast to keep the script self-contained without dragging Database
  // types in here.
  const creds = await getGoogleAdsCredentials(supabase as never, row.id);
  if (!creds) {
    throw new Error(
      `No decrypted credentials for account ${row.id} (${row.google_customer_id}).`,
    );
  }
  return { accountRow: row, credentials: creds };
}

await main();
