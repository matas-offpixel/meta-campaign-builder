import type { LadderRung } from "./types.ts";

/**
 * Matas's seed. 70% says "90% sold". The 90% rung says "99% sold" unless the
 * client's wording is final X. Selling fast waits 14 days (artwork refreshes
 * every 2 weeks) and says the % line unless the client's wording is final X.
 * After the rung-1 split this row is position 3; until then it is position 2.
 */
export function defaultLadder(): LadderRung[] {
  return [
    { position: 1, triggerKind: "state", triggerValue: "on_sale", claimTemplate: "{release} live · selling fast", options: { days: 0 } },
    {
      position: 2,
      triggerKind: "state_days",
      triggerValue: "selling_fast",
      claimTemplate: "{release} 90% sold out",
      options: { days: 14, wording: "percent", alt: "final X {release} tickets" },
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
      triggerKind: "roll_call",
      triggerValue: "roll_call",
      claimTemplate: "{sold} RELEASE SOLD OUT\n{live}",
      options: { preferred: true },
    },
    {
      position: 11,
      triggerKind: "velocity",
      triggerValue: "500",
      claimTemplate: "{n}+ TICKETS SOLD IN THE LAST 2 WEEKS",
      options: { windowDays: 14, threshold: 500 },
    },
    {
      position: 12,
      triggerKind: "price_rise_date",
      triggerValue: "4",
      claimTemplate: "PRICES RISE {DAY}",
      options: { days: 4, alt: "LAST CHANCE AT £{n}" },
    },
    {
      position: 13,
      triggerKind: "countdown_pct",
      triggerValue: "14",
      claimTemplate: "LESS THAN 2 WEEKS TO GO\nOVER 90% SOLD OUT",
      options: { days: 14 },
    },
    {
      position: 14,
      triggerKind: "lineup_add",
      triggerValue: "lineup",
      claimTemplate: "{ARTIST} (JUST ANNOUNCED)",
      options: {},
    },
  ];
}

/** A stored ladder from 211 still says kind state for the roll-call. Read it as roll_call, and add any derived rung the row set doesn't have yet. */
export function completeLadder(stored: readonly LadderRung[] | null | undefined): LadderRung[] {
  if (!stored?.length) return defaultLadder();
  const normalized = stored.map((rung) =>
    rung.triggerValue === "roll_call" ? { ...rung, triggerKind: "roll_call" as const } : rung,
  );
  const have = new Set(normalized.map((rung) => rung.triggerValue));
  const extra = defaultLadder().filter((rung) => rung.position >= 11 && !have.has(rung.triggerValue));
  return [...normalized, ...extra].sort((a, b) => a.position - b.position);
}

/** Puzzle's 70% line says "90% sold out". The 90% rung is the default: 14 days, which AB5 draws. */
export function puzzleLadder(): LadderRung[] {
  return defaultLadder().map((rung) => {
    if (rung.triggerValue === "70") return { ...rung, claimTemplate: "90% sold out" };
    return rung;
  });
}

export function resetLadder(): LadderRung[] {
  return defaultLadder();
}
