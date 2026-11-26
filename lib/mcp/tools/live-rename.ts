/**
 * lib/mcp/tools/live-rename.ts — rename (M3b, scope mcp:meta, Matas only).
 *
 * One live campaign, ad set or ad in the event's campaign tree renamed on
 * Meta (McpLiveDeps.rename, lib/meta/object-name-write.ts, ledger
 * object_name_update). Nothing spends, so no ceiling. The draft's own name
 * is set_draft_name's.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { NAME_WORDS } from "../meta/words.ts";
import { MAX_META_NAME, callKey, errorReason, liveEvent, metaId, placeObject, requireLive } from "../live/resolve.ts";
import { LIVE_WORDS } from "../live/words.ts";
import { ToolInputError, type McpTool } from "../tool-types.ts";
import { KIND_ARG, kindOf } from "./live-status.ts";

export const renameTool: McpTool = {
  name: "rename",
  title: "Rename a live campaign, ad set or ad",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  failedText: LIVE_WORDS.metaFailed,
  description: [
    "Renames one live campaign, ad set or ad in an event's campaigns on Meta. Nothing else changes and nothing spends. (A draft's name is set_draft_name.)",
    "Needs Matas's yes in this chat: ask him the name before → after, then pass approval with your question (asked) and his reply word for word (answer).",
  ].join(" "),
  inputSchema: {
    event: z.string().min(2).max(40).describe("The event code."),
    kind: KIND_ARG,
    id: z.string().min(5).max(32).describe("The Meta id, from get_live."),
    name: z.string().min(1).max(2000).describe("The new name."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    const { approval } = requireMetaApproval(ctx, args);
    const live = requireLive(ctx);
    const kind = kindOf(args.kind);
    const id = metaId(args.id, kind);
    const name = typeof args.name === "string" ? args.name.replace(/\s+/g, " ").trim() : "";
    if (!name || [...name].length > MAX_META_NAME) throw new ToolInputError(NAME_WORDS.tooLong(MAX_META_NAME), { refused: "bad_name" });
    const event = await liveEvent(ctx, live, args.event);
    const placed = await placeObject(ctx, live, event, kind, id);
    const before = placed.object.name ?? id;
    const base = { code: event.code, kind, objectId: id, before, after: name };
    if (before === name) return { data: { message: LIVE_WORDS.nameSame(name), changed: false }, eventId: event.id, clientId: event.clientId, summary: { ...base, noop: "same" } };
    const key = callKey("rename", args, approval);
    try {
      await live.rename({ userId: ctx.userId, kind, id, name, ledger: placed.ledger, key });
    } catch (e) {
      throw new ToolInputError(LIVE_WORDS.metaFailed, { ...base, refused: "meta_failed", error: errorReason(e) });
    }
    return { data: { message: NAME_WORDS.done(before, name) }, eventId: event.id, clientId: event.clientId, summary: { ...base, key, undo: { tool: "rename", kind, id, name: before } } };
  },
};
