/**
 * The MML canvas (`/mml/[id]`) is one scrolling page of numbered sections,
 * top to bottom. Spec: docs/session-logs/mml-multi-media-launcher-spec-2026-10-08.md.
 *
 * A section with `placeholder` has no controls yet; the card says which PR
 * brings them. Placeholders are operator-only — a client share link never
 * sees a roadmap note.
 */

import { clientSettingsHref, type ResolvedChannelDefaults } from "../clients/channel-defaults.ts";
import {
  identityChipVisibleLabel,
  planIdentityChips,
  withIdentityNames,
  type IdentityNameMap,
  type PlanIdentityChip,
} from "./identity-chips.ts";
import type { PlanAdapterName } from "./types.ts";

export type MmlSectionId =
  | "event"
  | "creatives"
  | "copy"
  | "budget"
  | "locations"
  | "channels"
  | "launch";

export interface MmlSectionSpec {
  id: MmlSectionId;
  n: number;
  title: string;
  placeholder?: string;
}

export const MML_SECTIONS: readonly MmlSectionSpec[] = [
  { id: "event", n: 1, title: "Event & promoter" },
  {
    id: "creatives",
    n: 2,
    title: "Creatives",
    placeholder:
      "Coming in M2: drop every file once. Files sort into 4:5, 1:1 and 9:16 by their pixels, you match them into Meta creatives, and 9:16 videos go to TikTok too.",
  },
  {
    id: "copy",
    n: 3,
    title: "Copy",
    placeholder:
      "Coming in M3: paste the event URL, pick from suggested captions, headlines and descriptions, and copy them across every creative and the Google Search plan.",
  },
  { id: "budget", n: 4, title: "Budget & schedule" },
  {
    id: "locations",
    n: 5,
    title: "Locations & placements",
    placeholder:
      "Coming in M4: one set of primary and secondary locations and placements, mapped to Meta, TikTok and Google. Until then, set them per channel with Adjust in ⑥.",
  },
  { id: "channels", n: 6, title: "Channels" },
  { id: "launch", n: 7, title: "Launch" },
];

export const MML_SECTION = Object.fromEntries(
  MML_SECTIONS.map((section) => [section.id, section]),
) as Record<MmlSectionId, MmlSectionSpec>;

const CIRCLED_DIGITS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"] as const;

export function mmlSectionMarker(n: number): string {
  return CIRCLED_DIGITS[n - 1] ?? `${n}.`;
}

export function mmlSectionDomId(id: MmlSectionId): string {
  return `mml-${id}`;
}

/** The channel-defaults card on the client overview tab. */
export function channelDefaultsHref(clientId: string | null | undefined): string | null {
  const base = clientSettingsHref(clientId);
  return base ? `${base}#channel-defaults` : null;
}

export interface MmlPromoterIdentityRow {
  id: "meta-page" | "meta-ig" | "tiktok-identity";
  adapter: PlanAdapterName;
  label: string;
  /** Name, else the raw id, else null when the client has none set. */
  value: string | null;
  provenance: PlanIdentityChip["provenance"];
}

const PROMOTER_ROWS: ReadonlyArray<{ id: MmlPromoterIdentityRow["id"]; label: string }> = [
  { id: "meta-page", label: "Facebook Page" },
  { id: "meta-ig", label: "Instagram" },
  { id: "tiktok-identity", label: "TikTok identity" },
];

/** Who the ads run as, per channel. Read-only on the canvas; set on the client. */
export function mmlPromoterIdentityRows(
  resolved: ResolvedChannelDefaults,
  names: IdentityNameMap,
): MmlPromoterIdentityRow[] {
  const chips = withIdentityNames(planIdentityChips(resolved), names);
  return PROMOTER_ROWS.map(({ id, label }) => {
    const chip = chips.find((row) => row.id === id);
    return {
      id,
      adapter: chip?.platform === "tiktok" ? "tiktok" : "meta",
      label,
      value: chip ? identityChipVisibleLabel(chip) : null,
      provenance: chip?.provenance ?? "unset",
    };
  });
}
