/**
 * lib/mcp/tools/meta-event.ts — update_event (M3a, scope mcp:meta, Matas
 * only).
 *
 * The event form's save for an event's three sale dates and two links
 * (lib/mcp/meta/event-write.ts). App database only: nothing goes to Meta,
 * CIRQLIN, Mailchimp or Bird, and nothing spends, so no ceiling is read.
 * Takes Matas's chat yes like every mcp:meta tool, because the dates move
 * the show's phase for every cron that reads them.
 *
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { approvalInput, requireMetaApproval } from "../meta/approval.ts";
import { EVENT_EDIT_COLUMNS, EVENT_EDIT_FIELDS, normaliseInstant, normaliseLink, updateEventFields, type EventEditRow, type EventPatch } from "../meta/event-write.ts";
import { changes, linkKey } from "../drafts/common.ts";
import { ToolInputError, type McpTool } from "../tool-types.ts";
import { loadEventByCode, normaliseCode } from "./shared.ts";

const TIMES = new Set(["announcement_at", "presale_at", "general_sale_at"]);

export const updateEventTool: McpTool = {
  name: "update_event",
  title: "Change an event's dates and links",
  kind: "meta",
  readOnly: false,
  idempotent: true,
  description: [
    "Changes an event's announcement, presale and general sale times and its signup and ticket links, as the event form's Save does. Only the fields you pass change; null clears one. Times carry their zone (\"2026-11-27T18:00:00Z\"); links are https.",
    "App only: nothing goes to Meta or any other platform. The dates move the show's phase for the app's reports and automations.",
    "Needs Matas's yes in this chat: ask him the change, then pass approval with your question (asked) and his reply word for word (answer).",
    'Example: update_event({ event_code: "ES27-ENZOSIRAGUSA", changes: { announcement_at: "2026-11-27T18:00:00Z" }, approval: { asked: "Set ES27-ENZOSIRAGUSA\'s announcement to Fri 27 Nov 18:00?", answer: "yes" } }).',
  ].join(" "),
  inputSchema: {
    event_code: z.string().min(2).max(40).describe('The event code, e.g. "ES27-ENZOSIRAGUSA".'),
    changes: z
      .object({
        announcement_at: z.string().max(40).nullable().optional(),
        presale_at: z.string().max(40).nullable().optional(),
        general_sale_at: z.string().max(40).nullable().optional(),
        signup_url: z.string().max(2000).nullable().optional(),
        ticket_url: z.string().max(2000).nullable().optional(),
      })
      .describe("Only the fields to change."),
    approval: approvalInput,
  },
  async run(ctx, args) {
    requireMetaApproval(ctx, args);
    const code = normaliseCode(args.event_code);
    const given = args.changes && typeof args.changes === "object" ? (args.changes as Record<string, unknown>) : {};
    const patch: EventPatch = {};
    for (const field of EVENT_EDIT_FIELDS) {
      if (!(field in given) || given[field] === undefined) continue;
      patch[field] = TIMES.has(field) ? normaliseInstant(field, given[field]) : normaliseLink(field, given[field]);
    }
    if (Object.keys(patch).length === 0) throw new ToolInputError(`Give at least one of ${EVENT_EDIT_FIELDS.join(", ")} in changes.`, { refused: "no_changes" });

    const found = await loadEventByCode(ctx.db, code);
    if (!found) throw new ToolInputError(`No event with code ${code}.`, { code, refused: "event_not_found" });
    const res = await ctx.db.from("events").select(EVENT_EDIT_COLUMNS).eq("id", found.primary.id).maybeSingle();
    const before = res.data as EventEditRow | null;
    if (res.error || !before) throw new ToolInputError(`No event with code ${code}.`, { code, refused: "event_not_found" });
    if (before.user_id !== ctx.userId) throw new ToolInputError("This event belongs to another account, so it can't be changed from here.", { code, refused: "not_owner" });

    const after = await updateEventFields(ctx.db, { eventId: before.id, userId: ctx.userId, patch });
    const show = (f: string, v: string | null) => (TIMES.has(f) ? v : linkKey(v));
    const changed = changes(Object.keys(patch).map((f) => [f, show(f, before[f as keyof EventEditRow]), show(f, after[f as keyof EventEditRow])]));
    return {
      data: {
        event: code,
        changed,
        ...(found.siblings.length ? { note: `${code} has ${found.siblings.length} sibling fixture${found.siblings.length === 1 ? "" : "s"}; only the first (the code's owner) changed.` } : {}),
      },
      eventId: before.id,
      clientId: before.client_id,
      summary: { code, eventId: before.id, fieldsChanged: changed.map((c) => c.field), changes: changed },
    };
  },
};
