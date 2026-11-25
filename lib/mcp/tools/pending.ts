/**
 * lib/mcp/tools/pending.ts — get_campaign_tree and run_launch_checks.
 *
 * Their readers land with #1364 (campaign tree, R7) and #1361 (launch
 * checks, R4). Until those merge both tools answer "not available yet" and
 * read nothing. Wiring them is a follow-up once they're on main.
 */
import { z } from "zod";
import type { McpTool } from "../tool-types.ts";
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
  async run(_ctx, args) {
    return {
      data: { available: false, status: NOT_YET, waitingOn: "PR #1361 (launch checks)", draftId: String(args.draft_id ?? "") },
      summary: { available: false },
    };
  },
};
