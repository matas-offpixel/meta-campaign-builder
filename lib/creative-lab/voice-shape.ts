/**
 * The one line that says which copy shape the writer used.
 * Cross-client copy is operator-only: requireOperator() before the read.
 * A miss, or a page with no winning shape, keeps the seed line.
 */

import type { SaleStage } from "./caption-facts.ts";
import type { ServiceRoleDb } from "./load.ts";
import { voiceForStyle, type CaptionStyle } from "./tags.ts";
import { shapeLine } from "./voice-traits.ts";

export async function shapeNoteFor(
  db: ServiceRoleDb,
  style: CaptionStyle,
  stage: SaleStage,
  clientId: string,
): Promise<string> {
  try {
    const { requireOperator } = await import("../learning/cross-client/context.ts");
    const session = await requireOperator();
    if (!session.ok) return shapeLine(null, style);
    const { topCopyFeatures } = await import("../learning/cross-client/read.ts");
    const copyStage = stage === "on_sale" ? "ticket_sale" : "registration";
    const rows = await topCopyFeatures(
      session.context,
      { stage: copyStage, voice: voiceForStyle(style), clientId, limit: 1 },
      db,
    );
    const top = rows[0];
    return shapeLine(top ? { feature: top.feature, value: top.value } : null, style);
  } catch {
    return shapeLine(null, style);
  }
}
