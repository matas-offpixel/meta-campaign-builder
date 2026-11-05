/**
 * caption_style as a creative tag (roadmap §2 rule 7).
 *
 * The dimension lives in CREATIVE_LAB_DIMENSIONS, never in
 * CREATIVE_TAG_DIMENSIONS: the AI auto-tagger builds its prompt and
 * schema from that list, and a caption's style is known when the Lab
 * writes it, not guessed. tag_performance reads every creative_tags row
 * with a dimension, so caption_style flows through learning unchanged.
 *
 * The assignment is written on the event the ad resolves to through
 * resolveAdContext (P26 ads resolve to the umbrella P26-BDAY, not the
 * show event), with the ad's meta_ad_id and the Meta ad name as
 * creative_name, so both learning join keys find it.
 */

import { upsertCreativeTagAssignment } from "../db/creative-tags.ts";
import { resolveAdEvent, type ServiceRoleDb } from "./load.ts";

export const CAPTION_STYLES = ["lineup", "question", "scarcity", "social_proof"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const CAPTION_STYLE_LABELS: Readonly<Record<CaptionStyle, string>> = {
  lineup: "Lineup",
  question: "Question",
  scarcity: "Scarcity",
  social_proof: "Social proof",
};

export const CREATIVE_LAB_DIMENSIONS = ["caption_style"] as const;
export type CreativeLabDimension = (typeof CREATIVE_LAB_DIMENSIONS)[number];

export const CREATIVE_LAB_TAG_SOURCE = "creative_lab";

export function isCaptionStyle(value: unknown): value is CaptionStyle {
  return typeof value === "string" && (CAPTION_STYLES as readonly string[]).includes(value);
}

export type AssignCaptionStyleTagArgs = {
  userId: string;
  /** The round's event; used only when the ad resolves to no event. */
  eventId: string;
  metaAdId: string;
  /** The Meta ad name, exactly as launched. */
  creativeName: string;
  style: CaptionStyle;
};

export type AssignCaptionStyleTagResult = {
  tagId: string;
  eventId: string;
  eventSource: "launched_ads" | "launched_ad_sets" | "campaign_code" | "round";
};

/** Service role: resolving the ad's event reads ad_daily_insights and the launch ledgers. */
export async function assignCaptionStyleTag(
  db: ServiceRoleDb,
  args: AssignCaptionStyleTagArgs,
): Promise<AssignCaptionStyleTagResult> {
  if (!isCaptionStyle(args.style)) throw new Error(`unknown caption style: ${String(args.style)}`);
  const resolved = await resolveAdEvent(db, args.metaAdId);
  const eventId = resolved.eventId ?? args.eventId;

  const { data, error } = await db
    .from("creative_tags")
    .upsert(
      {
        user_id: args.userId,
        dimension: "caption_style",
        value_key: args.style,
        value_label: CAPTION_STYLE_LABELS[args.style],
        description: "Creative Lab caption style, set when the caption is written.",
        source: CREATIVE_LAB_TAG_SOURCE,
      },
      { onConflict: "user_id,dimension,value_key" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`creative_tags caption_style:${args.style}: ${error.message}`);
  const tagId = (data as { id: string }).id;

  await upsertCreativeTagAssignment(db, {
    userId: args.userId,
    eventId,
    creativeName: args.creativeName,
    tagId,
    source: CREATIVE_LAB_TAG_SOURCE,
    confidence: 1,
    metaAdId: args.metaAdId,
  });

  return { tagId, eventId, eventSource: resolved.eventId ? (resolved.source ?? "round") : "round" };
}
