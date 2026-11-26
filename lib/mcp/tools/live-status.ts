/**
 * lib/mcp/tools/live-status.ts — pause and resume (M3b, scope mcp:meta,
 * Matas only, each on his chat yes).
 *
 * One live campaign, ad set or ad in the event's campaign tree, switched off
 * or on through the app's status writes (McpLiveDeps.setStatus):
 *   - ad set: the ad-set status write (OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED);
 *   - ad: the ad-status write (OFFPIXEL_META_AD_STATUS_WRITES_ENABLED);
 *   - campaign: its mirror behind the ad-set switch.
 * A switch that's off is refused before anything is read from Meta.
 *
 * Resume starts spend, so it checks the show's spend ceiling against the
 * show's committed spend with the object live (lib/mcp/meta/show-ceiling.ts:
 * a resumed campaign or ad set counts its budgets; an ad's ad set is counted
 * already). Something paused
 * outside Off/Pixel (no pause of it in the app's log) is refused unless
 * Matas's question said so.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { MCP_WORDS, RESULT_WORDS } from "../meta/words.ts";
import { callKey, checkLiveCeiling, errorReason, liveEvent, metaId, placeObject, requireLive, type LiveEvent } from "../live/resolve.ts";
import type { LiveKind, McpLiveDeps } from "../live/types.ts";
import { LIVE_THINGS, LIVE_WORDS } from "../live/words.ts";
import { ToolInputError, type McpTool, type ToolContext } from "../tool-types.ts";

export const KIND_ARG = z.enum(["campaign", "ad_set", "ad"]).describe("campaign, ad_set or ad.");
export const kindOf = (v: unknown): LiveKind => (v === "ad_set" ? "adset" : v === "ad" ? "ad" : "campaign");

/** Matas's question says the thing was paused outside the app. */
const SAYS_OUTSIDE = /ads manager|outside (of )?(off\s*\/?\s*pixel|the app)|by hand|manually/i;

/** Tools whose done rows record something the app paused or made paused. */
const APP_PAUSE_TOOLS = ["pause", "launch_draft", "add_creatives_to_stage", "create_split_test"];

/** Whether the app's own log has this object paused (a pause, or made paused). */
export async function pausedByApp(ctx: ToolContext, id: string): Promise<boolean> {
  const res = await ctx.db
    .from("mcp_actions")
    .select("tool, status, result, created_at")
    .eq("user_id", ctx.userId)
    .eq("status", "done")
    .in("tool", APP_PAUSE_TOOLS)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (res.error) return false;
  return ((res.data ?? []) as Array<{ result: unknown }>).some((r) => JSON.stringify(r.result ?? "").includes(id));
}

function switchOn(live: McpLiveDeps, kind: LiveKind): boolean {
  const s = live.switches();
  return kind === "ad" ? s.adStatus : s.adsetStatus;
}

async function runStatus(ctx: ToolContext, args: Record<string, unknown>, to: "PAUSED" | "ACTIVE", tool: "pause" | "resume") {
  const { approval } = requireMetaApproval(ctx, args);
  const live = requireLive(ctx);
  const kind = kindOf(args.kind);
  const id = metaId(args.id, kind);
  if (!switchOn(live, kind)) throw new ToolInputError(LIVE_WORDS.refusedSwitch, { refused: "switch_off", kind, id });
  const event: LiveEvent = await liveEvent(ctx, live, args.event);
  const placed = await placeObject(ctx, live, event, kind, id);
  const { object, name } = placed;
  const things = LIVE_THINGS[kind];
  const base = { code: event.code, kind, objectId: id, campaignId: placed.campaign.metaCampaignId, ledgerDraftId: placed.ledger.draftId, before: { status: object.status, effectiveStatus: object.effectiveStatus } };

  if (to === "PAUSED" && object.status === "PAUSED") {
    return { data: { message: LIVE_WORDS.samePaused(name), changed: false }, eventId: event.id, clientId: event.clientId, summary: { ...base, noop: "already_paused" } };
  }
  if (to === "ACTIVE" && object.status === "ACTIVE") {
    return { data: { message: LIVE_WORDS.sameLive(name), changed: false }, eventId: event.id, clientId: event.clientId, summary: { ...base, noop: "already_live" } };
  }

  let ceiling: Awaited<ReturnType<typeof checkLiveCeiling>> | null = null;
  if (to === "ACTIVE") {
    if (object.endTime && Date.parse(object.endTime) <= ctx.now.getTime()) {
      throw new ToolInputError(LIVE_WORDS.ended(name, object.endTime.slice(0, 10)), { ...base, refused: "ended" });
    }
    if (!SAYS_OUTSIDE.test(approval.asked) && !(await pausedByApp(ctx, id))) {
      throw new ToolInputError(LIVE_WORDS.pausedOutside(name), { ...base, refused: "paused_outside" });
    }
    ceiling = await checkLiveCeiling(ctx, live, {
      event,
      accountId: object.accountId ?? placed.campaign.adAccountId,
      name,
      change: { starts: true, objects: kind === "ad" ? [] : [{ kind, id, status: "ACTIVE" }] },
    });
  }

  const key = callKey(tool, args, approval);
  try {
    await live.setStatus({ userId: ctx.userId, kind, id, status: to, ledger: placed.ledger, key });
  } catch (e) {
    throw new ToolInputError(LIVE_WORDS.metaFailed, { ...base, refused: "meta_failed", error: errorReason(e) });
  }

  const notes: string[] = [];
  if (to === "ACTIVE") {
    if (kind === "adset" && placed.campaign.status === "paused") notes.push(LIVE_WORDS.parentOff(name, LIVE_THINGS.campaign[0]));
    if (kind === "ad" && object.adsetId) {
      const parent = (await live.readObjects(ctx.userId, "adset", [object.adsetId]).catch(() => null))?.objects.get(object.adsetId);
      if (parent && parent.status === "PAUSED") notes.push(LIVE_WORDS.parentOff(name, LIVE_THINGS.adset[0]));
    }
  }
  return {
    data: {
      message: MCP_WORDS.done(RESULT_WORDS.changed(things, [id])),
      change: to === "PAUSED" ? LIVE_WORDS.changePause(name) : LIVE_WORDS.changeResume(name),
      ...(notes.length ? { notes } : {}),
    },
    eventId: event.id,
    clientId: event.clientId,
    summary: {
      ...base,
      after: { status: to },
      key,
      ...(ceiling ? { ceiling } : {}),
      // Today's Undo (server side; the log row isn't built yet).
      undo: { tool: to === "PAUSED" ? "resume" : "pause", kind, id },
    },
  };
}

const describe = (verb: string, extra: string) =>
  [
    `${verb} one live campaign, ad set or ad in an event's campaigns, as the app's status switch does.`,
    extra,
    "Needs Matas's yes in this chat: ask him what changes (the name and live → paused or paused → live), then pass approval with your question (asked) and his reply word for word (answer).",
  ].join(" ");

const inputSchema = {
  event: z.string().min(2).max(40).describe('The event code, e.g. "ES27-ENZOSIRAGUSA".'),
  kind: KIND_ARG,
  id: z.string().min(5).max(32).describe("The Meta id, from get_live."),
  approval: approvalInput,
};

export const pauseTool: McpTool = {
  name: "pause",
  title: "Pause a live campaign, ad set or ad",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.metaFailed,
  description: describe("Pauses", "Nothing else on it changes. Pausing starts no spend."),
  inputSchema,
  run: (ctx, args) => runStatus(ctx, args, "PAUSED", "pause"),
};

export const resumeTool: McpTool = {
  name: "resume",
  title: "Switch a paused campaign, ad set or ad back on",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.metaFailed,
  description: describe(
    "Switches back on",
    /* PENDING DESIGN: claude.mcp.tool.resume.ceiling */ "This starts spend, so it's refused when the show's committed spend would pass its spend ceiling (and without one). If it was paused outside Off/Pixel, say so in your question to Matas.",
  ),
  inputSchema,
  run: (ctx, args) => runStatus(ctx, args, "ACTIVE", "resume"),
};
