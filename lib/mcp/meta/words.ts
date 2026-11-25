/**
 * lib/mcp/meta/words.ts — what the M3a tools tell Claude, word for word from
 * design's list (records 2026-11-25-mcp-full-control FC2 and
 * 2026-11-25-mcp-m3a-words MW2; list scratch/mcp/words-mcp-today-2026-11-25.tsv,
 * 208 rows, sha256 ed3bab16…). Pinned by lib/mcp/__tests__/meta-words.test.ts
 * against a copy of the list. No raw error (an HTTP status, Meta's message,
 * video_status, a database error) is ever put in one of these.
 *
 * {thing}/{things} are the builder's plain words per tool (TD's hand-back):
 * launch_draft "campaign"/"campaigns", upload_draft_assets "file"/"files",
 * update_event "event"/"events", ad sets "ad set"/"ad sets".
 *
 * Relative imports only (node:test).
 */

const gbp = (n: number) => n.toFixed(2);

/** "1 file" / "3 files": the {files} and {adsets} counts. */
export const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
export const filesCount = (n: number) => count(n, "file", "files");
export const adSetsCount = (n: number) => count(n, "ad set", "ad sets");

export const MCP_WORDS = {
  /** claude.mcp.refused.no_approval */
  refusedNoApproval:
    "Refused: there’s no approval with this. Ask Matas in chat, then send his exact question and answer with it. Nothing was sent to Meta.",
  /** claude.mcp.refused (over the ceiling) */
  refusedOverCeiling: (client: string, x: number, c: number) =>
    `Refused: this would take ${client} to £${gbp(x)} a day, over its £${gbp(c)} daily ceiling. Nothing was sent to Meta.`,
  /** claude.mcp.refused.none (no ceiling, a change that starts spend) */
  refusedNoCeiling: (client: string) =>
    `Refused: ${client} has no daily ceiling, so nothing that starts spend can run. Matas sets one in Settings › Claude. Nothing was sent to Meta.`,
  /** claude.mcp.refused.checks / .checks.one */
  refusedChecks: (n: number) => (n === 1 ? "Refused: 1 launch check to fix. Nothing was sent to Meta." : `Refused: ${n} launch checks to fix. Nothing was sent to Meta.`),
  /** claude.mcp.refused.scope */
  refusedScope:
    "Refused: this connection can’t make Meta changes. Only Matas’s can, once he reconnects Off/Pixel in Claude and allows Meta. Nothing was sent to Meta.",
  /** claude.mcp.refused.no_client */
  refusedNoClient: "Refused: this draft has no client, so there’s no ceiling to check a live launch against. Nothing was sent to Meta.",
  /** claude.mcp.refused.currency */
  refusedCurrency: (currency: string) => `Refused: this draft’s budget is in ${currency}, and ceilings are in £. Nothing was sent to Meta.`,
  /** claude.mcp.refused.ceiling_unread */
  refusedCeilingUnread: "Refused: the client’s daily ceiling couldn’t be read. Try again. Nothing was sent to Meta.",
  /** claude.mcp.refused.not_draft */
  refusedNotDraft: (status: string) =>
    `Refused: this draft is ${status}, and only a draft with status draft can be launched or have files sent. Nothing was sent to Meta.`,
  /** claude.mcp.refused.checks_unavailable */
  refusedChecksUnavailable: "Refused: the launch checks couldn’t run, so nothing was launched. Try again.",
  /** claude.mcp.done */
  done: (result: string) => `Done: ${result}.`,
  /** claude.mcp.undo_note: only where an Undo exists (FC1: a paused object Claude made). */
  undoNote: "Matas can undo this on Today.",
} as const;

/** The approval field's descriptions (claude.mcp.approval*). */
export const APPROVAL_FIELD_WORDS = {
  approval: "Matas’s yes, from this chat. Ask him first; never fill this in yourself.",
  asked: "The exact question you asked Matas in chat: what changes, where, the money a day, and paused or live.",
  answer: "Matas’s reply, word for word.",
} as const;

/** launch_draft (claude.mcp.launch.*). */
export const LAUNCH_WORDS = {
  paused: "It’s paused: nothing spends until it’s switched on.",
  live: (x: number) => `It’s live, up to £${gbp(x)} a day.`,
  link: (link: string) => `Ads Manager: ${link}`,
  failed: "Meta didn’t launch it, so nothing was created. Try again, or launch it in the app.",
  partialPaused: (id: string, a: number, n: number, link: string) =>
    `The launch stopped part way: campaign ${id} was made with ${a} of ${adSetsCount(n)}. It’s paused, so nothing spends. Matas can delete it on Today, or finish it in Ads Manager: ${link}`,
  partialLive: (id: string, a: number, n: number, link: string) =>
    `The launch stopped part way: campaign ${id} was made with ${a} of ${adSetsCount(n)}, and it’s live. Pause it in the campaign tree or in Ads Manager: ${link}`,
} as const;

/** The send step (claude.mcp.upload.*). */
export const UPLOAD_WORDS = {
  failedLaunch: (f: number, files: number) =>
    f === 1
      ? `1 of ${filesCount(files)} didn’t go to Meta, so nothing was launched. It’s marked “Upload failed — retry or remove” on the draft: send it again with upload_draft_assets, or remove that ad.`
      : `${f} of ${filesCount(files)} didn’t go to Meta, so nothing was launched. Each is marked “Upload failed — retry or remove” on the draft: send them again with upload_draft_assets, or remove those ads.`,
  failed: (f: number, files: number) =>
    f === 1
      ? `1 of ${filesCount(files)} didn’t go to Meta. It’s marked “Upload failed — retry or remove” on the draft: send it again with upload_draft_assets, or remove that ad.`
      : `${f} of ${filesCount(files)} didn’t go to Meta. Each is marked “Upload failed — retry or remove” on the draft: send them again with upload_draft_assets, or remove those ads.`,
  fileFailed: (name: string) => `${name}: Meta didn’t take it.`,
  videoFailed: (name: string) => `${name}: Meta couldn’t process the video.`,
  done: (files: number) => `Done: ${filesCount(files)} sent to Meta.`,
  already: (n: number) => (n === 1 ? "1 file was already on the account, so it wasn’t sent again." : `${n} files were already on the account, so they weren’t sent again.`),
  none: "Nothing to send: every file is already on Meta.",
  noLaunch: "Nothing was launched and nothing spends.",
} as const;

/** update_event (claude.mcp.event.*). */
export const EVENT_WORDS = {
  done: (code: string, changes: string) => `Done: ${code} · ${changes}. Only the app changed; nothing went to Meta.`,
  change: (field: string, before: string, after: string) => `${field}: ${before} → ${after}`,
  cleared: "cleared",
  notSet: "not set",
  field: {
    announcement_at: "Announcement",
    presale_at: "Presale",
    general_sale_at: "General sale",
    signup_url: "Signup link",
    ticket_url: "Ticket link",
  } as Record<string, string>,
  refusedEmpty: (fields: string) => `Refused: give at least one of ${fields}. Nothing changed.`,
  refusedUnknown: (code: string) => `Refused: no event with code ${code}. Nothing changed.`,
  refusedOtherAccount: "Refused: this event belongs to another account, so it can’t be changed from here. Nothing changed.",
  refusedTimeFormat: (field: string) =>
    `Refused: ${field} needs a time with its zone, like 2026-11-27T18:00:00Z (London in winter) or 2027-04-10T10:00:00+01:00 (London in summer), or null to clear it. Nothing changed.`,
  refusedTime: (field: string) => `Refused: ${field} isn’t a real time. Nothing changed.`,
  refusedLink: (field: string) => `Refused: ${field} must be an https:// link, or null to clear it. Nothing changed.`,
  failed: "The event couldn’t be saved. Try again. Nothing changed.",
} as const;

/** set_draft_name (claude.mcp.name.*). */
export const NAME_WORDS = {
  done: (before: string, after: string) => `Renamed: ${before} → ${after}.`,
  same: "Nothing changed: the draft already has this name.",
  tooLong: (max: number) => `Refused: a name is at most ${max} characters. Nothing changed.`,
} as const;

/** attach_drive_creatives and list_drive_creatives: pairs and any folder (claude.mcp.attach.*). */
export const ATTACH_WORDS = {
  outside: "Refused: that folder or file isn’t in the Off/Pixel shared drive. Nothing was saved.",
  fileOutside: (id: string) => `Refused: file ${id} isn’t in the Off/Pixel shared drive. Nothing was saved.`,
  notMedia: (id: string) => `Refused: file ${id} isn’t a photo or video. Nothing was saved.`,
  singleRatio: (name: string, ratio: string) =>
    `Refused: ${name} is ${ratio}. A file on its own must be 9:16: pass it in a pair as the feed file with its 9:16, or leave it out. Nothing was saved.`,
  pairFeed: (name: string, ratio: string) => `Refused: ${name} is ${ratio}. A pair’s feed file is 4:5 or 1:1. Nothing was saved.`,
  pairVertical: (name: string, ratio: string) => `Refused: ${name} is ${ratio}. A pair’s vertical file is 9:16. Nothing was saved.`,
  pairKinds: (a: string, kindA: string, b: string, kindB: string) => `Refused: ${a} is a ${kindA} and ${b} is a ${kindB}. A pair is two videos or two statics. Nothing was saved.`,
  kind: { video: "video", image: "static" } as Record<string, string>,
  pairSame: "Refused: a pair is two different files, the feed file and its 9:16. Nothing was saved.",
  empty: "Refused: give file_ids or pairs. Nothing was saved.",
  ratioUnknown: "not measured",
  pickerReason: (name: string, reason: string) => `Refused: ${name}: ${reason}. Nothing was saved.`,
  failed: "The files couldn’t be copied in. Try again. Nothing was saved.",
  waiting: "The new ads’ files wait in Off/Pixel and go to Meta at launch, or now with upload_draft_assets.",
  pairsOff: "Per-placement ads are switched off in Off/Pixel, so each pair launches as one file in every placement until they’re switched on.",
} as const;

/** today.mcp.result.* forms, for claude.mcp.done's {result}. */
export const RESULT_WORDS = {
  /** today.mcp.result.launched / .launched.one */
  launched: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} launched · ${ids[0]}` : `${ids.length} ${things[1]} launched · ${ids.join(", ")}`,
  /** today.mcp.result.added / .added.one */
  added: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} added · ${ids[0]}` : `${ids.length} ${things[1]} added · ${ids.join(", ")}`,
  /** today.mcp.result / .one */
  changed: (things: [string, string], ids: readonly string[]) =>
    ids.length === 1 ? `1 ${things[0]} changed · ${ids[0]}` : `${ids.length} ${things[1]} changed · ${ids.join(", ")}`,
} as const;

export const THINGS = {
  campaign: ["campaign", "campaigns"] as [string, string],
  file: ["file", "files"] as [string, string],
  event: ["event", "events"] as [string, string],
};
