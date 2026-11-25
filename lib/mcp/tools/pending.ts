/**
 * lib/mcp/tools/pending.ts — get_campaign_tree and run_launch_checks.
 *
 * Their readers land with #1364 (campaign tree, R7) and #1361 (launch
 * checks, R4). get_campaign_tree answers "not available yet" until #1364 is
 * wired. run_launch_checks runs through the same seam as M2's after-write
 * checks (ctx.draft.launchChecks, lib/mcp/pending-seams.ts): "not available
 * yet" while it is null, the checks once #1361 is wired there.
 */
import { z } from "zod";
import type { McpTool } from "../tool-types.ts";
import { launchChecksFor } from "../drafts/common.ts";
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
    "Runs the launch checks on one campaign draft without launching anything: account, pixel, page, link, dates and audiences against its show.",
    `Not available yet: it answers "${NOT_YET}" until the launch checks (PR #1361) are merged.`,
    'Example: run_launch_checks({ draft_id: "3f2c…-uuid" }).',
  ].join(" "),
  inputSchema: {
    draft_id: z.string().uuid().describe("The draft's id (a UUID), from get_drafts."),
  },
  async run(ctx, args) {
    const draftId = String(args.draft_id ?? "");
    if (!ctx.draft?.launchChecks) {
      return {
        data: { available: false, status: NOT_YET, waitingOn: "PR #1361 (launch checks)", draftId },
        summary: { available: false },
      };
    }
    const row = /^[0-9a-f-]{36}$/i.test(draftId) ? await readDraftRow(ctx.db, draftId) : null;
    if (!row) return { data: { error: `No draft with id ${draftId}.` }, summary: { draftId, found: false } };
    const checks = await launchChecksFor(ctx, migratedDraft(ctx, row));
    return { data: { draftId, launchChecks: checks }, eventId: row.event_id, clientId: row.client_id, summary: { draftId, available: true } };
  },
};
