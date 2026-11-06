/**
 * The artist's starting caption is the control, through the same validator
 * as a written caption. It is stored proposed so Matas approves it in the
 * card. First person is artist_first_person; anything else, including
 * "our", is lineup.
 */

import { factsHash, loadEventFacts, normaliseCaption, saleStageFromStatus, validateCaption, type CaptionError } from "./caption-facts.ts";
import type { ServiceRoleDb } from "./load.ts";
import { loadPastAppearances } from "./past.ts";
import type { CaptionStyle } from "./tags.ts";
import { loadUpcomingLineups, londonDay } from "./upcoming.ts";
import { styleVersion } from "../../src/remotion/caption-style/profile.ts";

export const STARTING_PRIMARY = "Who's coming?";

type Row = Record<string, unknown>;

export type StartingCaptionResult = {
  ok: boolean;
  inserted: boolean;
  id: string | null;
  style: "artist_first_person" | "lineup";
  sizeVariant: "default" | "long" | null;
  lines: string[];
  errors: CaptionError[];
};

export function startingCaptionStyle(text: string): "artist_first_person" | "lineup" {
  const normalised = text.replace(/[’]/g, "'");
  if (/\bI(?:'m|'ll|'ve|'d)?\b/.test(normalised) || /\b(?:me|my)\b/i.test(normalised)) return "artist_first_person";
  return "lineup";
}

export async function recordStartingCaption(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; artistName: string; text: string; now?: Date },
): Promise<StartingCaptionResult | null> {
  const text = args.text.trim();
  if (!text) return null;
  const style = startingCaptionStyle(text);
  const now = args.now ?? new Date();
  const facts = await loadEventFacts(db, args.eventId);
  const eventRes = await db.from("events").select("id, client_id, status").eq("id", args.eventId).maybeSingle();
  if (eventRes.error) throw new Error(`events: ${eventRes.error.message}`);
  const event = eventRes.data as { client_id: string | null; status?: string | null } | null;
  if (!event) throw new Error(`no event ${args.eventId}`);
  const [upcoming, past, existing, version] = await Promise.all([
    event.client_id ? loadUpcomingLineups(db, event.client_id, londonDay(now)) : Promise.resolve([]),
    event.client_id ? loadPastAppearances(db, event.client_id, londonDay(now)) : Promise.resolve([]),
    db.from("creative_lab_captions").select("*").eq("event_id", args.eventId),
    styleVersion(),
  ]);
  if (existing.error) throw new Error(`creative_lab_captions: ${existing.error.message}`);
  const declared = args.artistName.trim() && text.toLowerCase().includes(args.artistName.trim().toLowerCase()) ? [args.artistName.trim()] : [];
  const check = validateCaption(text, style, declared, facts, { version }, {
    primaryText: STARTING_PRIMARY,
    saleStage: saleStageFromStatus(event.status),
    upcomingEvents: upcoming.map((show) => show.eventName),
    pastAppearances: past,
    extraNames: upcoming.flatMap((show) => [show.eventName, ...show.headliners]),
  });
  const rows = (existing.data ?? []) as Row[];
  const key = normaliseCaption(text);
  const already = rows.find((row) => normaliseCaption(String(row.text ?? "")) === key);
  if (!check.ok) {
    return { ok: false, inserted: false, id: already ? String(already.id) : null, style, sizeVariant: check.sizeVariant, lines: check.lines, errors: check.errors };
  }
  if (already) {
    return { ok: true, inserted: false, id: String(already.id), style, sizeVariant: check.sizeVariant, lines: check.lines, errors: [] };
  }
  const captionNo = nextNo(rows, style);
  const inserted = await db
    .from("creative_lab_captions")
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      style,
      caption_no: captionNo,
      text,
      lines: check.lines,
      primary_text: STARTING_PRIMARY,
      declared_names: declared,
      size_variant: check.sizeVariant,
      style_version: version,
      generated_by: "starting_caption",
      status: "proposed",
      facts_hash: factsHash(facts),
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error(`creative_lab_captions insert: ${inserted.error?.message ?? "no row"}`);
  return {
    ok: true,
    inserted: true,
    id: String((inserted.data as Row).id),
    style,
    sizeVariant: check.sizeVariant,
    lines: check.lines,
    errors: [],
  };
}

function nextNo(rows: Row[], style: CaptionStyle): number {
  const nums = rows.filter((row) => row.style === style).map((row) => Number(row.caption_no) || 0);
  return Math.max(0, ...nums) + 1;
}
