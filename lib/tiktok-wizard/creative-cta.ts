/**
 * Per-creative CTA on Step 5. The add-a-creative form's dropdown is
 * not attached to existing rows, so an imported draft with `cta: null`
 * launched without `call_to_action` on the wire.
 *
 * Enum: TikTok OpenAPI package CallToAction
 * `1807533165224961`. Preview docs:
 * https://business-api.tiktok.com/portal/docs?id=1739403070695426
 * WEB_CONVERSIONS / TRAFFIC require `call_to_action` or
 * `call_to_action_id`. This writer does not send `call_to_action_id`.
 */

import type {
  TikTokCampaignDraft,
  TikTokCreativeDraft,
  TikTokObjective,
} from "../types/tiktok-draft.ts";

/**
 * Documented Call-to-Action keys. Not a guess — the OpenAPI enum
 * (package 1807533165224961). `BUY_TICKETS` / `DOWNLOAD` are Meta
 * spellings and are not in this list.
 */
export const TIKTOK_CALL_TO_ACTIONS = [
  "APPLY_NOW",
  "BOOK_NOW",
  "CALL_NOW",
  "CHECK_AVAILABILITY",
  "CONTACT_US",
  "DOWNLOAD_NOW",
  "EXPERIENCE_NOW",
  "GET_QUOTE",
  "GET_SHOWTIMES",
  "GET_TICKETS_NOW",
  "INSTALL_NOW",
  "INTERESTED",
  "JOIN_THIS_HASHTAG",
  "LEARN_MORE",
  "LISTEN_NOW",
  "ORDER_NOW",
  "PLAY_GAME",
  "PREORDER_NOW",
  "READ_MORE",
  "SEND_MESSAGE",
  "SHOOT_WITH_THIS_EFFECT",
  "SHOP_NOW",
  "SIGN_UP",
  "SUBSCRIBE",
  "VIEW_NOW",
  "VIEW_PROFILE",
  "VIEW_VIDEO_WITH_THIS_EFFECT",
  "VISIT_STORE",
  "WATCH_LIVE",
  "WATCH_NOW",
] as const;

export type TikTokCallToAction = (typeof TIKTOK_CALL_TO_ACTIONS)[number];

const TIKTOK_CALL_TO_ACTION_SET = new Set<string>(TIKTOK_CALL_TO_ACTIONS);

/** Preview docs: live shopping ads must use WATCH_LIVE. We do not create those. */
const LIVE_SHOPPING_ONLY = new Set<string>(["WATCH_LIVE"]);

/**
 * Preview docs: SEND_MESSAGE is required for
 * LEAD_GEN_CLICK_TO_TT_DIRECT_MESSAGE. This writer uses website
 * promotion, not that promotion type.
 */
const DIRECT_MESSAGE_ONLY = new Set<string>(["SEND_MESSAGE"]);

function labelFromKey(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function isTikTokCallToAction(value: string | null | undefined): boolean {
  return Boolean(value && TIKTOK_CALL_TO_ACTION_SET.has(value));
}

/**
 * Portal 1739403070695426: TRAFFIC, WEB_CONVERSIONS, and website
 * LEAD_GENERATION require `call_to_action` or `call_to_action_id`.
 * Draft CONVERSIONS is WEB_CONVERSIONS. This writer always sends a
 * landing page, so the REACH/VIDEO_VIEW landing-page clause does not
 * apply — those objectives are already a launcher block.
 */
export function tikTokCtaRequiredForObjective(
  objective: TikTokObjective | null | undefined,
): boolean {
  return (
    objective === "TRAFFIC" ||
    objective === "CONVERSIONS" ||
    objective === "LEAD_GENERATION"
  );
}

export function tikTokCtaOptionsForDraft(input: {
  objective: TikTokObjective | null;
  mode: TikTokCreativeDraft["mode"];
}): { value: string; label: string }[] {
  void input.mode;
  return TIKTOK_CALL_TO_ACTIONS.filter((value) => {
    if (LIVE_SHOPPING_ONLY.has(value)) return false;
    if (DIRECT_MESSAGE_ONLY.has(value)) return false;
    return true;
  }).map((value) => ({ value, label: labelFromKey(value) }));
}

export function tikTokCreativeCtaMissingMessage(name: string): string {
  return `Creative "${name}" needs a call to action. TikTok requires one for this objective and omits the field when it is unset.`;
}

export function patchTikTokCreativeCta(
  items: readonly TikTokCreativeDraft[],
  creativeId: string,
  cta: string | null,
): TikTokCreativeDraft[] {
  return items.map((item) =>
    item.id === creativeId ? { ...item, cta } : item,
  );
}

export function patchTikTokEveryCreativeCta(
  items: readonly TikTokCreativeDraft[],
  cta: string,
): TikTokCreativeDraft[] {
  return items.map((item) => ({ ...item, cta }));
}

export function persistTikTokCreativeCtaPatch(
  creatives: TikTokCampaignDraft["creatives"],
  creativeId: string,
  cta: string | null,
): TikTokCampaignDraft["creatives"] {
  return {
    ...creatives,
    items: patchTikTokCreativeCta(creatives.items, creativeId, cta),
  };
}

/**
 * A `<select>` fires `change` once per choice — there is no per-segment
 * keystroke freeze. Persist on change, not blur.
 */
export function shouldPersistTikTokCreativeCta(
  eventType: "change" | "blur",
): boolean {
  return eventType === "change";
}

export function applyTikTokCreativeCtaChange(
  writes: { persist: (value: string | null) => void },
  eventType: "change" | "blur",
  raw: string,
): void {
  if (!shouldPersistTikTokCreativeCta(eventType)) return;
  writes.persist(raw.trim() ? raw : null);
}

/** A write in flight does not disable the field. */
export function tikTokCreativeCtaFieldDisabled(_input: {
  saving: boolean;
}): boolean {
  return false;
}

export function tikTokSetEveryCreativeCtaLine(input: {
  cta: string;
  count: number;
}): { text: string; action: string } {
  const label = labelFromKey(input.cta);
  return {
    text: `${input.count} creatives. None of them get a CTA unless you click.`,
    action: `Set every creative to ${label}`,
  };
}
