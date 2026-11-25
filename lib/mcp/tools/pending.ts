/**
 * lib/mcp/tools/pending.ts — get_campaign_tree and run_launch_checks.
 *
 * get_campaign_tree answers "not available yet" until #1364's reader is
 * wired. run_launch_checks is runLaunchGuard (#1361, R4), the same check
 * POST /api/launch-guard runs and every draft tool returns after a write:
 * database reads only, no Meta call.
 */
import { z } from "zod";
import { ToolInputError, type McpTool } from "../tool-types.ts";
import { checksSummary, launchChecksFor } from "../drafts/common.ts";
import { migratedDraft, readDraftRow } from "../drafts/write.ts";
import { normaliseCode } from "./shared.ts";

const NOT_YET = "not available yet";

export const getCampaignTreeTool: McpTool = {
  name: "get_campaign_tree",
  title: "Get an event's campaign tree",
  kind: "read",
  description: [
    "One show's campaign tree: stages → campaigns → ad sets → additions.",
    `Not available yet: it answers "${NOT_YET}" until the campaign tree (PR #1364) is merged.`,
    'Example: get_campaign_tree({ code: "NX26-DOD" }).',
  ].join(" "),
  inputSchema: {
    code: z.string().min(2).max(40).describe('The event code, e.g. "NX26-DOD".'),
  },
  async run(_ctx, args) {
    const code = normaliseCode(args.code);
    return { data: { available: false, status: NOT_YET, waitingOn: "PR #1364 (campaign tree)", code }, summary: { available: false } };
  },
};

export const runLaunchChecksTool: McpTool = {
  name: "run_launch_checks",
  title: "Run launch checks on a draft",
  kind: "read",
  description: [
    "Runs the launch checks on one campaign draft without launching anything (the checks Review & launch shows): account, pixel, page, Instagram, link, code, dates and locations against its show.",
    "Each check comes back as the app words it: label, sentence, evidence, and the fix buttons. Blockers stop a launch; warnings don't.",
    'Example: run_launch_checks({ draft_id: "3f2c…-uuid" }).',
  ].join(" "),
  inputSchema: {
    draft_id: z.string().uuid().describe("The draft's id (a UUID), from get_drafts."),
  },
  async run(ctx, args) {
    const draftId = String(args.draft_id ?? "");
    const row = /^[0-9a-f-]{36}$/i.test(draftId) ? await readDraftRow(ctx.db, draftId) : null;
    if (!row) throw new ToolInputError(`No draft with id ${draftId}.`, { draftId, found: false });
    const checks = await launchChecksFor(ctx, migratedDraft(ctx, row));
    return { data: { draftId, status: row.status, launchChecks: checks }, eventId: row.event_id, clientId: row.client_id, summary: { draftId, ...checksSummary(checks) } };
  },
};
