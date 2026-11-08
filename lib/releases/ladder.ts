import type { LadderRung } from "./types.ts";

/**
 * Matas's seed. 70% says "90% sold". The 90% rung says "99% sold" unless the
 * client's wording is final X. Selling fast waits 7 days and says the % line
 * unless the client's wording is final X.
 */
export function defaultLadder(): LadderRung[] {
  return [
    { position: 1, triggerKind: "state", triggerValue: "on_sale", claimTemplate: "{release} live · selling fast", options: { days: 0 } },
    {
      position: 2,
      triggerKind: "state_days",
      triggerValue: "selling_fast",
      claimTemplate: "{release} 90% sold out",
      options: { days: 7, wording: "percent", alt: "final X {release} tickets" },
    },
    { position: 3, triggerKind: "count_pct", triggerValue: "50", claimTemplate: "75% sold", options: {} },
    { position: 4, triggerKind: "count_pct", triggerValue: "60", claimTemplate: "80% sold", options: {} },
    { position: 5, triggerKind: "count_pct", triggerValue: "70", claimTemplate: "90% sold", options: {} },
    { position: 6, triggerKind: "count_pct", triggerValue: "80", claimTemplate: "95% sold", options: {} },
    { position: 7, triggerKind: "count_pct", triggerValue: "90", claimTemplate: "99% sold", options: { wording: "percent", alt: "final X" } },
    { position: 8, triggerKind: "state", triggerValue: "final_x", claimTemplate: "final X", options: {} },
    { position: 9, triggerKind: "state", triggerValue: "sold_out", claimTemplate: "sold out", options: {} },
    {
      position: 10,
      triggerKind: "state",
      triggerValue: "roll_call",
      claimTemplate: "{sold} SOLD OUT\n{live}",
      options: { preferred: true },
    },
  ];
}

/** Puzzle's ladder, as AB5 draws it: 5 days, and the % line rather than final X. */
export function puzzleLadder(): LadderRung[] {
  return defaultLadder().map((rung) => {
    if (rung.triggerValue === "selling_fast") {
      return { ...rung, options: { ...rung.options, days: 5, wording: "percent" } };
    }
    if (rung.triggerValue === "70") return { ...rung, claimTemplate: "90% sold out" };
    return rung;
  });
}

export function resetLadder(): LadderRung[] {
  return defaultLadder();
}
