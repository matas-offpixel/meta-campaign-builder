/**
 * lib/mcp/live/targeting-check.ts — the two targeting rules every launch path
 * keeps (Matas, 26 Nov plan, item 2), read back on the ad sets M3b's stage
 * adds reach.
 *
 *   - Location expansion off on every ad set: Meta's
 *     `targeting.targeting_automation.individual_setting.geo` ("Reach people
 *     interested in selected cities and regions"; Ads Manager's "Reach more
 *     people likely to respond to your ads"). 1 is on, 0 is off; Meta
 *     documents no default, and most live ad sets carry no `geo` key at all.
 *   - Retargeting ad sets strict: `targeting_automation.advantage_audience`
 *     0 ("Use as a suggestion" off). Wider keeps Advantage+ on.
 *
 * add_creatives_to_stage and add_audience_to_stage never make an ad set, and
 * they don't change the targeting of one the app didn't make: they read
 * each ad set they reached back and report what doesn't keep the rules, one
 * line per ad set for Matas to fix in Ads Manager. `geo` 1 is a mismatch; no
 * `geo` key is "not set" (counted for the action log, not told: Meta shows no
 * default, so it can't be called on).
 *
 * Pure. Relative imports only (node:test).
 */
import type { LiveObject } from "./types.ts";
import { LIVE_WORDS } from "./words.ts";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

/** `individual_setting.geo`: 1 on, 0 off, null not set. */
export function locationExpansion(targeting: unknown): 0 | 1 | null {
  const geo = obj(obj(obj(targeting)?.targeting_automation)?.individual_setting)?.geo;
  return geo === 1 || geo === "1" ? 1 : geo === 0 || geo === "0" ? 0 : null;
}

/** `advantage_audience`: 1 on (suggestions), anything else off. */
export function advantageOn(targeting: unknown): boolean {
  const v = obj(obj(targeting)?.targeting_automation)?.advantage_audience;
  return v === 1 || v === "1";
}

/** A retargeting ad set: its name or its campaign's says so (RT1's "{code} · Retargeting · …", the refresh's /retarget/i). */
export const RETARGETING = /retarget/i;
export function isRetargeting(adSetName: string | null | undefined, campaignName: string | null | undefined): boolean {
  return RETARGETING.test(adSetName ?? "") || RETARGETING.test(campaignName ?? "");
}

export interface TargetingReadBack {
  /** Ad sets read back. */
  read: number;
  /** Ad sets with location expansion on (geo 1). */
  locationOn: string[];
  /** Ad sets with no geo key (Meta's default, unknown). */
  locationUnset: string[];
  /** Retargeting ad sets with Advantage+ audience on. */
  retargetingSuggestions: string[];
  /** One line per mismatch, for Claude to relay (PENDING DESIGN). */
  lines: string[];
  /** Meta couldn't be read after the write (nothing reported, the write stands). */
  unread?: true;
}

/** The read-back of the ad sets a stage add reached: what doesn't keep the two rules. */
export function checkTargeting(sets: readonly Pick<LiveObject, "id" | "name" | "targeting">[], campaignNameOf: (adSetId: string) => string | null): TargetingReadBack {
  const out: TargetingReadBack = { read: sets.length, locationOn: [], locationUnset: [], retargetingSuggestions: [], lines: [] };
  for (const s of sets) {
    const name = s.name || s.id;
    const geo = locationExpansion(s.targeting);
    if (geo === 1) {
      out.locationOn.push(s.id);
      out.lines.push(LIVE_WORDS.locationOn(name));
    } else if (geo === null) out.locationUnset.push(s.id);
    if (isRetargeting(s.name, campaignNameOf(s.id)) && advantageOn(s.targeting)) {
      out.retargetingSuggestions.push(s.id);
      out.lines.push(LIVE_WORDS.retargetingSuggestions(name));
    }
  }
  return out;
}
