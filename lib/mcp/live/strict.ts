/**
 * lib/mcp/live/strict.ts — "runs strict while its draft asked for
 * suggestions" (M3b get_live; the strict audit reads the same rule).
 *
 * The draft asked for Advantage+ suggestions on an ad set when its
 * suggestion row (adSetSuggestions, matched by the launched name in
 * launchSummary.adSetsCreated) has advantagePlus on, or, with no row, the
 * launch recorded ageMode "suggested". Meta runs it strict when the live
 * targeting's targeting_automation.advantage_audience is 0 (or absent).
 *
 * Pure. Relative imports only (node:test).
 */

export interface DraftAdSetAsk {
  metaAdSetId: string;
  name: string;
  askedSuggestions: boolean;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Every launched ad set of a draft (its draft_json), with whether the draft asked for suggestions. */
export function draftAdSetAsks(draftJson: unknown): DraftAdSetAsk[] {
  const d = obj(draftJson);
  if (!d) return [];
  const byName = new Map<string, boolean>();
  for (const s of arr(d.adSetSuggestions)) {
    const row = obj(s);
    if (row && typeof row.name === "string") byName.set(row.name.trim(), row.advantagePlus === true);
  }
  const summary = obj(d.launchSummary);
  const created: unknown[] = [...arr(summary?.adSetsCreated)];
  for (const r of arr(summary?.campaignAttachResults)) created.push(...arr(obj(r)?.adSetsCreated));
  const out: DraftAdSetAsk[] = [];
  for (const c of created) {
    const row = obj(c);
    const id = typeof row?.metaAdSetId === "string" ? row.metaAdSetId : null;
    const name = typeof row?.name === "string" ? row.name : null;
    if (!id || !name) continue;
    const asked = byName.has(name.trim()) ? byName.get(name.trim())! : row!.ageMode === "suggested";
    out.push({ metaAdSetId: id, name, askedSuggestions: asked });
  }
  return out;
}

/** Meta's Advantage+ audience flag on a live targeting: 1, 0, or null when targeting wasn't read. */
export function advantageAudience(targeting: Json | null | undefined): 0 | 1 | null {
  if (!targeting) return null;
  const auto = obj(targeting.targeting_automation);
  return auto && Number(auto.advantage_audience) === 1 ? 1 : 0;
}

export interface TargetingSummary {
  advantagePlus: boolean | null;
  customAudiences: string[];
  excludedAudiences: string[];
  /** The age range Meta holds (age_min / age_max: the control on Advantage+). */
  ageControl: { min: number | null; max: number | null };
  /** The age suggestion (age_range), when one is set. */
  ageSuggestion: { min: number; max: number } | null;
}

const names = (v: unknown) =>
  arr(v)
    .map((a) => obj(a))
    .filter((a): a is Json => Boolean(a))
    .map((a) => (typeof a.name === "string" && a.name ? a.name : String(a.id ?? "")));

export function targetingSummary(targeting: Json | null | undefined): TargetingSummary {
  const t = targeting ?? null;
  const range = arr(t?.age_range).map(Number);
  return {
    advantagePlus: t ? advantageAudience(t) === 1 : null,
    customAudiences: names(t?.custom_audiences),
    excludedAudiences: names(t?.excluded_custom_audiences),
    ageControl: { min: t?.age_min == null ? null : Number(t.age_min), max: t?.age_max == null ? null : Number(t.age_max) },
    ageSuggestion: range.length === 2 && range.every(Number.isFinite) ? { min: range[0]!, max: range[1]! } : null,
  };
}
