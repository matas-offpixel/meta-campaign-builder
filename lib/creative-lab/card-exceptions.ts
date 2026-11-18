/**
 * Per-asset exceptions to the artist-card photo rules (O18–O21,
 * artist-card.ts and artist-card-cutout.ts). The rules themselves are never
 * loosened: an exception names one photo on one event, who ruled it and when,
 * which variant is drawn although it fails, and in which formats.
 *
 * scripts/artist-card.mts applies one only when neither A nor B passes, and
 * prints the failing rules with their measured values as the override line.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

export type CardExceptionFormat = "9x16" | "4x5" | "1x1";

export type CardRuleException = {
  eventCode: string;
  /** creative_assets.id of the press photo. */
  assetId: string;
  /** The variant drawn although it fails: A is the photo as shot. */
  variant: "A" | "B";
  formats: readonly CardExceptionFormat[];
  ruledBy: string;
  ruledOn: string;
  ruling: string;
};

// Ruled by Matas 17 Nov 2026 (9:16), widened by Matas 18 Nov 2026 to the 4:5 and 1:1 once the framing record's
// layouts (#1326) were drawn from this photo and approved. Same contrast override; no other rule is waived.
const P26_LUKE_PRESS_RULING =
  "Luke Dean's management sent two press photos on 17 Nov 2026; Matas grants an exception to the card rules for this one (the other, 14 00 31, he binned). 9:16 ruled 17 Nov; 4:5 and 1:1 added by Matas on 18 Nov 2026 after the framing record's layouts (#1326), with the same contrast override.";

export const CARD_RULE_EXCEPTIONS: readonly CardRuleException[] = [
  {
    eventCode: "P26-BDAY",
    assetId: "2a5fcf27-10c0-449c-b9e0-4358edf3527c", // Photo 14-06-2026, 19 09 42.jpg
    variant: "A",
    formats: ["9x16", "4x5", "1x1"], // 4x5 and 1x1: ruled by Matas 18 Nov 2026
    ruledBy: "Matas",
    ruledOn: "2026-11-17",
    ruling: P26_LUKE_PRESS_RULING,
  },
];

export function cardRuleException(
  eventCode: string,
  assetId: string,
  list: readonly CardRuleException[] = CARD_RULE_EXCEPTIONS,
): CardRuleException | null {
  return list.find((row) => row.eventCode === eventCode && row.assetId === assetId) ?? null;
}

/** The override line: who ruled, when, and every rule the drawn variant fails with its value. */
export function exceptionLine(exception: CardRuleException, failed: readonly { rule: string; detail: string }[]): string {
  const rules = failed.length ? failed.map((r) => `${r.rule}: ${r.detail}`).join("; ") : "none";
  return `EXCEPTION (${exception.ruledBy}, ${exception.ruledOn}): variant ${exception.variant} drawn although it fails, ${exception.formats.join(", ")} only. Overrides: ${rules}.`;
}
