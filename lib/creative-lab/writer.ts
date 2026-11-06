/**
 * Caption writer. One Claude call per generateCaptions.
 *
 * The model does not type dates, the venue, the lineup or a Next list.
 * It writes {venue}, {city}, {date}, {artist}, {lineup} and {next3}.
 * This module substitutes them from the event record, then keeps the
 * first n candidates that pass the validator and the dedupe.
 *
 * Rows are status 'proposed', stamped with the current style version.
 * A caption_no unique clash is retried once.
 */

import { styleVersion } from "../../src/remotion/caption-style/profile.ts";
import {
  factsHash,
  loadEventFacts,
  normaliseCaption,
  validateCaption,
  type EventFacts,
} from "./caption-facts.ts";
import { CORPUS } from "./corpus.ts";
import type { ServiceRoleDb } from "./load.ts";
import { isCaptionStyle, voiceForStyle, type CaptionStyle } from "./tags.ts";
import { loadUpcomingLineups, londonDay, nextThreeNames, type UpcomingShow } from "./upcoming.ts";

export const WRITER_MODEL = process.env.CREATIVE_LAB_WRITER_MODEL?.trim() || "claude-opus-4-6";
export const MAX_CAPTIONS = 6;

const TOOL_NAME = "submit_captions";

export interface AnthropicToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}
export type AnthropicContentBlock = AnthropicToolUseBlock | { type: string; [k: string]: unknown };

export interface AnthropicLike {
  messages: {
    create(args: Record<string, unknown>): Promise<{ content: AnthropicContentBlock[] }>;
  };
}

export type CaptionCandidate = { overlay: string; primaryText: string; declaredNames: string[] };

export type WrittenCaption = {
  id: string;
  style: CaptionStyle;
  text: string;
  lines: string[];
  primaryText: string;
  sizeVariant: "default" | "long";
  declaredNames: string[];
  captionNo: number;
  ok: true;
};

export type GenerateCaptionsArgs = {
  eventId: string;
  artistId?: string;
  clipId?: string;
  style: CaptionStyle;
  n: number;
  now?: Date;
};

export type GenerateCaptionsDeps = {
  anthropic?: AnthropicLike;
  model?: string;
};

type PlaceholderValues = {
  venue: string;
  city: string;
  date: string;
  artist: string;
  lineup: string;
  next3: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "27 December". The year is not written: the validator matches day and month to the event date. */
export function formatCaptionDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return "";
  return `${d} ${MONTHS[m - 1]}`;
}

export function substitutePlaceholders(text: string, values: PlaceholderValues): string {
  return text.replace(/\{(venue|city|date|artist|lineup|next3)\}/g, (token, key: keyof PlaceholderValues) => values[key] || token);
}

function stillHasPlaceholder(text: string): boolean {
  return /\{(venue|city|date|artist|lineup|next3)\}/.test(text);
}

function joinNames(names: readonly string[]): string {
  return names.slice(0, 3).join(", ");
}

function toolInput(content: AnthropicContentBlock[]): CaptionCandidate[] {
  const block = content.find((item) => item.type === "tool_use" && (item as AnthropicToolUseBlock).name === TOOL_NAME) as
    | AnthropicToolUseBlock
    | undefined;
  const raw = (block?.input as { candidates?: unknown } | undefined)?.candidates;
  if (!Array.isArray(raw)) throw new Error("the writer did not call submit_captions");
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { overlay?: unknown; primary_text?: unknown; declared_names?: unknown };
    if (typeof row.overlay !== "string" || typeof row.primary_text !== "string") return [];
    const declared = Array.isArray(row.declared_names) ? row.declared_names.filter((name): name is string => typeof name === "string") : [];
    return [{ overlay: row.overlay, primaryText: row.primary_text, declaredNames: declared }];
  });
}

async function defaultAnthropic(): Promise<AnthropicLike> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set — required to write captions.");
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;
  return new Anthropic({ apiKey }) as unknown as AnthropicLike;
}

function systemPrompt(style: CaptionStyle, facts: EventFacts, upcoming: readonly UpcomingShow[]): string {
  const examples = CORPUS[style].map((example, i) => `${i + 1}. Overlay: ${example.overlay}\n   Caption: ${example.primaryText}`).join("\n");
  return `You write paid-social captions for a live music promoter. Voice: ${voiceForStyle(style)}. Style: ${style}.

Return only by calling ${TOOL_NAME}. Write ${MAX_CAPTIONS + 4} is the ceiling; write the number asked.

The overlay is burned onto the video. No emoji, no '#', not all capitals. Default size is 4 lines of 18 characters. An overlay of 73 to 96 characters uses a smaller size, 4 lines of 24. Over 96 is useless. A single word longer than the line width cannot render. four_line is exactly 4 lines.

Primary text is the copy under the post, at most 125 characters. Emoji are allowed there.

Never type a date, a venue, a city, an artist, a lineup or a Next list. Use these tokens and nothing else for those facts:
{artist} {venue} {city} {date} {lineup} {next3}
{next3} is already three upcoming names. Write "Next: {next3}" when the style lists what is coming. Do not add a fourth name.

Event: ${facts.eventName}. Tokens will be filled from the record. Upcoming shows the Next list may use: ${upcoming.map((show) => show.eventName).join(", ") || "none"}.

Examples of the shape, not facts to copy:
${examples}`;
}

type Row = Record<string, unknown>;

async function rowsOf(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row[]> {
  const res = await db.from(table).select("*").eq(column, value);
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data ?? []) as Row[];
}

async function filmedShowTickets(db: ServiceRoleDb, clipId: string | undefined): Promise<number | null> {
  if (!clipId) return null;
  const clipRes = await db.from("creative_lab_clips").select("event_id").eq("id", clipId).maybeSingle();
  if (clipRes.error) throw new Error(`creative_lab_clips: ${clipRes.error.message}`);
  const eventId = (clipRes.data as { event_id?: string | null } | null)?.event_id ?? null;
  if (!eventId) return null;
  const eventRes = await db.from("events").select("tickets_sold").eq("id", eventId).maybeSingle();
  if (eventRes.error) throw new Error(`events: ${eventRes.error.message}`);
  const onEvent = (eventRes.data as { tickets_sold?: number | null } | null)?.tickets_sold;
  if (onEvent != null) return Number(onEvent);
  const snapRes = await db
    .from("ticket_sales_snapshots")
    .select("tickets_sold, snapshot_at")
    .eq("event_id", eventId)
    .order("snapshot_at", { ascending: false })
    .limit(1);
  if (snapRes.error) throw new Error(`ticket_sales_snapshots: ${snapRes.error.message}`);
  const snap = ((snapRes.data ?? []) as { tickets_sold?: number }[])[0];
  return snap?.tickets_sold == null ? null : Number(snap.tickets_sold);
}

async function emojiInPrimary(db: ServiceRoleDb, clientId: string, style: CaptionStyle): Promise<boolean> {
  const res = await db.from("creative_lab_style_settings").select("emoji_in_primary").eq("client_id", clientId).eq("style", style).maybeSingle();
  if (res.error) return true;
  const value = (res.data as { emoji_in_primary?: boolean } | null)?.emoji_in_primary;
  return value == null ? true : value;
}

function isUniqueClash(message: string): boolean {
  return /duplicate key|unique constraint|23505/i.test(message);
}

async function nextCaptionNo(db: ServiceRoleDb, eventId: string, style: CaptionStyle): Promise<number> {
  const existing = await rowsOf(db, "creative_lab_captions", "event_id", eventId);
  const nums = existing.filter((row) => row.style === style).map((row) => Number(row.caption_no) || 0);
  return Math.max(0, ...nums) + 1;
}

async function insertCaption(db: ServiceRoleDb, row: Row): Promise<Row> {
  const write = async (payload: Row): Promise<{ row: Row | null; error: string | null }> => {
    const res = await db.from("creative_lab_captions").insert(payload).select("id, caption_no").single();
    if (res.error || !res.data) return { row: null, error: res.error?.message ?? "no row" };
    return { row: { ...payload, ...(res.data as Row) }, error: null };
  };
  let written = await write(row);
  if (written.error && isUniqueClash(written.error)) {
    const captionNo = await nextCaptionNo(db, String(row.event_id), row.style as CaptionStyle);
    written = await write({ ...row, caption_no: captionNo });
  }
  if (written.error || !written.row) throw new Error(`creative_lab_captions insert: ${written.error ?? "no row"}`);
  return written.row;
}

export async function generateCaptions(
  db: ServiceRoleDb,
  args: GenerateCaptionsArgs,
  deps: GenerateCaptionsDeps = {},
): Promise<WrittenCaption[]> {
  if (!isCaptionStyle(args.style)) throw new Error(`unknown caption style: ${args.style}`);
  if (!Number.isInteger(args.n) || args.n < 1 || args.n > MAX_CAPTIONS) {
    throw new Error(`n must be from 1 to ${MAX_CAPTIONS}`);
  }
  const now = args.now ?? new Date();
  const facts = await loadEventFacts(db, args.eventId);
  const eventRes = await db.from("events").select("id, client_id, user_id").eq("id", args.eventId).maybeSingle();
  if (eventRes.error) throw new Error(`events: ${eventRes.error.message}`);
  const event = eventRes.data as { client_id: string; user_id: string } | null;
  if (!event) throw new Error(`no event ${args.eventId}`);

  let artistName = "";
  if (args.artistId) {
    const artistRes = await db.from("creative_lab_artists").select("name").eq("id", args.artistId).maybeSingle();
    if (artistRes.error) throw new Error(`creative_lab_artists: ${artistRes.error.message}`);
    artistName = (artistRes.data as { name?: string } | null)?.name?.trim() ?? "";
  }

  const [upcoming, tickets, emojiOk, existing, version] = await Promise.all([
    loadUpcomingLineups(db, event.client_id, londonDay(now)),
    filmedShowTickets(db, args.clipId),
    emojiInPrimary(db, event.client_id, args.style),
    rowsOf(db, "creative_lab_captions", "event_id", args.eventId),
    styleVersion(),
  ]);
  const values: PlaceholderValues = {
    venue: facts.venueName ?? "",
    city: facts.venueCity ?? "",
    date: formatCaptionDate(facts.eventDate),
    artist: artistName,
    lineup: joinNames(facts.lineup),
    next3: joinNames(nextThreeNames(upcoming)),
  };
  const extraNames = upcoming.flatMap((show) => show.lineup);
  const seen = new Set(existing.map((row) => normaliseCaption(String(row.text ?? ""))));

  const anthropic = deps.anthropic ?? (await defaultAnthropic());
  const model = deps.model ?? WRITER_MODEL;
  const response = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    temperature: 0.7,
    system: systemPrompt(args.style, facts, upcoming),
    tools: [
      {
        name: TOOL_NAME,
        description: "Submit caption candidates. Overlay and primary text still contain the placeholder tokens.",
        input_schema: {
          type: "object",
          properties: {
            candidates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  overlay: { type: "string" },
                  primary_text: { type: "string" },
                  declared_names: { type: "array", items: { type: "string" } },
                },
                required: ["overlay", "primary_text"],
              },
            },
          },
          required: ["candidates"],
        },
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: `Write ${args.n + 4} different ${args.style} candidates for ${facts.eventName}. Use the tokens. Do not invent a date, a price, a venue or a name.`,
      },
    ],
  });

  const kept: WrittenCaption[] = [];
  for (const candidate of toolInput(response.content)) {
    if (kept.length >= args.n) break;
    const overlay = substitutePlaceholders(candidate.overlay, values).trim();
    const primary = substitutePlaceholders(candidate.primaryText, values).trim();
    if (stillHasPlaceholder(overlay) || stillHasPlaceholder(primary)) continue;
    const key = normaliseCaption(overlay);
    if (!key || seen.has(key)) continue;
    const check = validateCaption(overlay, args.style, candidate.declaredNames, facts, { version }, {
      extraNames,
      crowdTicketsSold: tickets,
      primaryText: primary,
      emojiInPrimary: emojiOk,
    });
    if (!check.ok) continue;
    seen.add(key);
    const captionNo = await nextCaptionNo(db, args.eventId, args.style);
    const inserted = await insertCaption(db, {
      user_id: event.user_id,
      event_id: args.eventId,
      style: args.style,
      caption_no: captionNo,
      text: overlay,
      lines: check.lines,
      primary_text: primary,
      declared_names: candidate.declaredNames,
      size_variant: check.sizeVariant,
      style_version: version,
      generated_by: model,
      status: "proposed",
      facts_hash: factsHash(facts),
    });
    kept.push({
      id: String(inserted.id),
      style: args.style,
      text: overlay,
      lines: check.lines,
      primaryText: primary,
      sizeVariant: check.sizeVariant,
      declaredNames: candidate.declaredNames,
      captionNo: Number(inserted.caption_no ?? captionNo),
      ok: true,
    });
  }
  return kept;
}
