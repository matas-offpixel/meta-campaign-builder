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
  assetId?: string;
  /**
   * The photo's sha256, as the import stores it (images/creative-lab/{artistId}/{sha256}.{ext}): matches those exact
   * bytes, before or after they're imported.
   */
  photoSha256?: string;
  /**
   * The only rules this exception lets fail. Absent: every failing rule of the variant (the #1307 exception, as ruled).
   * With `caps`, each named figure must stay within its cap at the measured value, or the exception doesn't apply.
   */
  overrides?: readonly string[];
  caps?: { faceAlphaShare?: { min: number }; spillShare?: { max: number } };
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


// Ruled by Matas 18 Nov 2026: Luke Dean's management sent new press photos on 18 Nov and asked that only those be used.
// He accepted card 5, the cut-out (B), from the preferred one, "Ronaldas- copy 2.JPG", with its ghosting. Only the
// cut-out's two failing rules are overridden, capped just past their measured values (face box 97.71 % solid against
// 99 %, edge spill 20.40 % against 2 %). Every other rule still holds. The 19 09 42 photo's exception doesn't carry over.
const P26_LUKE_CARD5_RULING =
  "Luke Dean's management asked on 18 Nov 2026 that only their new press photos be used. Matas accepts card 5, the cut-out (B) of \"Ronaldas- copy 2.JPG\", with its ghosting: face box solid at least 97.7 % (rule 99 %), edge spill at most 20.5 % (rule 2 %).";

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
  {
    eventCode: "P26-BDAY",
    // Ronaldas- copy 2.JPG (management, 18 Nov 2026), 87,489,699 bytes, 9344 × 11706.
    photoSha256: "bf617e7c613761aa7504ace368b09c08770e67df6e6fe24249c18d2dd0357df6",
    variant: "B",
    formats: ["9x16", "4x5", "1x1"],
    overrides: ["faceAlpha", "spill"],
    caps: { faceAlphaShare: { min: 0.977 }, spillShare: { max: 0.205 } },
    ruledBy: "Matas",
    ruledOn: "2026-11-18",
    ruling: P26_LUKE_CARD5_RULING,
  },
];

/** The sha256 in a stored photo's path (images/creative-lab/{artistId}/{sha256}.{ext}), else null. */
export function storedPhotoSha256(storagePath: string | null | undefined): string | null {
  const m = /(?:^|\/)([0-9a-f]{64})\.[a-z0-9]+$/i.exec(storagePath ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

export function cardRuleException(
  eventCode: string,
  assetId: string,
  storagePath?: string | null,
  list: readonly CardRuleException[] = CARD_RULE_EXCEPTIONS,
): CardRuleException | null {
  const sha = storedPhotoSha256(storagePath);
  return list.find((row) => row.eventCode === eventCode && ((row.assetId != null && row.assetId === assetId) || (row.photoSha256 != null && row.photoSha256 === sha))) ?? null;
}

/**
 * Whether the exception covers what actually failed: every failing rule is one it overrides, and each capped figure
 * is within its cap. An exception with no `overrides` covers every failing rule (the #1307 exception, as ruled).
 */
export function exceptionAllows(
  exception: CardRuleException,
  failedRules: readonly string[],
  figures: { faceAlphaShare?: number | null; spillShare?: number | null },
): { ok: true } | { ok: false; why: string } {
  if (!exception.overrides) return { ok: true };
  const other = failedRules.filter((rule) => !exception.overrides!.includes(rule));
  if (other.length) return { ok: false, why: `it doesn't cover ${other.join(", ")}` };
  const fa = exception.caps?.faceAlphaShare;
  if (fa && failedRules.includes("faceAlpha") && !(figures.faceAlphaShare != null && figures.faceAlphaShare >= fa.min - 1e-9)) {
    return { ok: false, why: `face box solid ${pct(figures.faceAlphaShare)} is under its cap ${pct(fa.min)}` };
  }
  const sp = exception.caps?.spillShare;
  if (sp && failedRules.includes("spill") && !(figures.spillShare != null && figures.spillShare <= sp.max + 1e-9)) {
    return { ok: false, why: `edge spill ${pct(figures.spillShare)} is over its cap ${pct(sp.max)}` };
  }
  return { ok: true };
}

const pct = (v: number | null | undefined) => (v == null ? "unmeasured" : `${(v * 100).toFixed(2)} %`);

/** The override line: who ruled, when, and every rule the drawn variant fails with its value. */
export function exceptionLine(exception: CardRuleException, failed: readonly { rule: string; detail: string }[]): string {
  const rules = failed.length ? failed.map((r) => `${r.rule}: ${r.detail}`).join("; ") : "none";
  return `EXCEPTION (${exception.ruledBy}, ${exception.ruledOn}): variant ${exception.variant} drawn although it fails, ${exception.formats.join(", ")} only. Overrides: ${rules}.`;
}
