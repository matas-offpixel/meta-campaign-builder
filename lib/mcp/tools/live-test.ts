/**
 * lib/mcp/tools/live-test.ts — create_split_test (M3b, scope mcp:meta,
 * Matas only).
 *
 * Meta's A/B test (an ad study, type SPLIT_TEST) on two existing campaigns
 * of an event, 50 % each, judged on cost per result: POST
 * /{business_id}/ad_studies through lib/meta/ad-study.ts (the shape #1321's
 * retargeting layout test sends), on meta_write_idempotency as
 * ad_study_create. Refused when the two campaigns are on different ad
 * accounts, when either is already in a running study (Meta's list for the
 * account's business), and when the dates aren't a forward window of at most
 * 90 days. The test splits the campaigns' audiences and moves no budget, so
 * it reads no ceiling; a paused campaign stays paused.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { normalizeAdAccountId } from "../../meta/ad-account.ts";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { MCP_WORDS } from "../meta/words.ts";
import { callKey, errorReason, liveEvent, londonWhen, metaId, placeObject, requireLive } from "../live/resolve.ts";
import { LIVE_WORDS } from "../live/words.ts";
import { ToolInputError, type McpTool } from "../tool-types.ts";

const ZONED = /(Z|[+-]\d{2}:?\d{2})$/;
const MAX_STUDY_DAYS = 90;

export const createSplitTestTool: McpTool = {
  name: "create_split_test",
  title: "Start a Meta A/B test on two campaigns",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.metaFailed,
  description: [
    "Sets up Meta's A/B test on two of an event's existing campaigns: each gets 50 % of the audience from start to end, and Meta judges them on cost per result. Both must be on one ad account and in no other running test. Budgets don't change and a paused campaign stays paused.",
    "Needs Matas's yes in this chat: ask him the two campaigns, the dates and the name, then pass approval with your question (asked) and his reply word for word (answer).",
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    campaign_ids: z.array(z.string().min(5).max(32)).length(2).describe("The two campaigns' Meta ids."),
    metric: z.enum(["cost_per_result"]).optional().describe("Always cost_per_result."),
    start: z.string().max(40).describe("When the test starts, with its zone."),
    end: z.string().max(40).describe("When it ends, with its zone."),
    name: z.string().min(1).max(200).describe("The test's name on Meta."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    const live = requireLive(ctx);
    if (args.metric != null && args.metric !== "cost_per_result") throw new ToolInputError(LIVE_WORDS.testMetric, { refused: "metric" });
    const list = Array.isArray(args.campaign_ids) ? args.campaign_ids.map((c) => String(c).trim()) : [];
    if (list.length !== 2 || list[0] === list[1]) throw new ToolInputError(LIVE_WORDS.testTwo, { refused: "not_two" });
    const [a, b] = [metaId(list[0], "campaign"), metaId(list[1], "campaign")];
    const startS = typeof args.start === "string" ? args.start.trim() : "";
    const endS = typeof args.end === "string" ? args.end.trim() : "";
    const start = Date.parse(startS);
    const end = Date.parse(endS);
    if (!ZONED.test(startS) || !ZONED.test(endS) || !Number.isFinite(start) || !Number.isFinite(end) || start < ctx.now.getTime() - 60_000 || end <= start || end - start > MAX_STUDY_DAYS * 86_400_000) {
      throw new ToolInputError(LIVE_WORDS.testDates, { refused: "bad_dates" });
    }
    const name = String(args.name ?? "").trim();

    const event = await liveEvent(ctx, live, args.event);
    const pa = await placeObject(ctx, live, event, "campaign", a);
    const pb = await placeObject(ctx, live, event, "campaign", b);
    const accA = normalizeAdAccountId(pa.object.accountId) ?? pa.campaign.adAccountId;
    const accB = normalizeAdAccountId(pb.object.accountId) ?? pb.campaign.adAccountId;
    const base = { code: event.code, campaigns: [a, b], start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    if (!accA || accA !== accB) throw new ToolInputError(LIVE_WORDS.testAccounts(pa.name, pb.name), { ...base, refused: "different_accounts" });

    let businessId: string | null;
    let running: Map<string, string>;
    try {
      businessId = (await live.accountInfo(ctx.userId, accA)).businessId;
      running = businessId ? await live.runningStudies(ctx.userId, businessId) : new Map();
    } catch {
      throw new ToolInputError(LIVE_WORDS.readFailed, { ...base, refused: "meta_unread" });
    }
    if (!businessId) throw new ToolInputError(LIVE_WORDS.testNoBusiness, { ...base, refused: "no_business" });
    for (const p of [pa, pb]) {
      const study = running.get(p.object.id);
      if (study) throw new ToolInputError(LIVE_WORDS.testInStudy(p.name, study), { ...base, refused: "in_study", studyId: study });
    }

    const key = callKey("create_split_test", args, approval);
    let studyId: string;
    try {
      studyId = await live.createStudy({ userId: ctx.userId, businessId, study: { name, campaignA: a, campaignB: b, start: new Date(start).toISOString(), end: new Date(end).toISOString() }, ledger: pa.ledger, key });
    } catch (e) {
      throw new ToolInputError(LIVE_WORDS.metaFailed, { ...base, refused: "meta_failed", error: errorReason(e) });
    }
    return {
      data: {
        message: MCP_WORDS.done(LIVE_WORDS.created(LIVE_WORDS.testThings, [studyId])),
        line: LIVE_WORDS.testLine(pa.name, pb.name, londonWhen(base.start), londonWhen(base.end)),
      },
      eventId: event.id,
      clientId: event.clientId,
      summary: { ...base, aName: pa.name, bName: pb.name, key, studyId, businessId },
    };
  },
};
