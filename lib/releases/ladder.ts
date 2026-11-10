import type { LadderRung } from "./types.ts";

/** The 90% rung waits this many selling-fast days unless a client sets their own. */
export const SELLING_FAST_DEFAULT_DAYS = 14;

const DERIVED_KINDS = new Set(["velocity", "price_rise_date", "countdown_pct", "lineup_add"]);

/**
 * Matas's seed. Fifteen rungs. Rung 1 is "{release} live", only for the latest
 * release whose list time has passed. Rung 2 is "{release} selling fast".
 * The 90% rung is position 3 and waits 14 days (artwork refreshes every 2 weeks).
 * 70% says "90% sold". The 90% count says "99% sold" unless the wording is final X.
 */
export function defaultLadder(): LadderRung[] {
  return [
    { position: 1, triggerKind: "state", triggerValue: "on_sale", claimTemplate: "{release} live", options: { days: 0 } },
    {
      position: 2,
      triggerKind: "state",
      triggerValue: "selling_fast",
      claimTemplate: "{release} selling fast",
      options: { days: 0, or_earlier_sold_out: true },
    },
    {
      position: 3,
      triggerKind: "state_days",
      triggerValue: "selling_fast",
      claimTemplate: "{release} 90% sold out",
      options: { days: SELLING_FAST_DEFAULT_DAYS, wording: "percent", alt: "final X {release} tickets" },
    },
    { position: 4, triggerKind: "count_pct", triggerValue: "50", claimTemplate: "75% sold", options: {} },
    { position: 5, triggerKind: "count_pct", triggerValue: "60", claimTemplate: "80% sold", options: {} },
    { position: 6, triggerKind: "count_pct", triggerValue: "70", claimTemplate: "90% sold", options: {} },
    { position: 7, triggerKind: "count_pct", triggerValue: "80", claimTemplate: "95% sold", options: {} },
    { position: 8, triggerKind: "count_pct", triggerValue: "90", claimTemplate: "99% sold", options: { wording: "percent", alt: "final X" } },
    { position: 9, triggerKind: "state", triggerValue: "final_x", claimTemplate: "final X", options: {} },
    { position: 10, triggerKind: "state", triggerValue: "sold_out", claimTemplate: "sold out", options: {} },
    {
      position: 11,
      triggerKind: "roll_call",
      triggerValue: "roll_call",
      claimTemplate: "{sold} RELEASE SOLD OUT\n{live}",
      options: { preferred: true },
    },
    {
      position: 12,
      triggerKind: "velocity",
      triggerValue: "500",
      claimTemplate: "{n}+ TICKETS SOLD IN THE LAST 2 WEEKS",
      options: { windowDays: 14, threshold: 500 },
    },
    {
      position: 13,
      triggerKind: "price_rise_date",
      triggerValue: "4",
      claimTemplate: "PRICES RISE {DAY}",
      options: { days: 4, alt: "LAST CHANCE AT £{n}" },
    },
    {
      position: 14,
      triggerKind: "countdown_pct",
      triggerValue: "14",
      claimTemplate: "LESS THAN 2 WEEKS TO GO\nOVER 90% SOLD OUT",
      options: { days: 14 },
    },
    {
      position: 15,
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
  const have = new Set(normalized.map((rung) => `${rung.triggerKind}:${rung.triggerValue}`));
  const extra = defaultLadder().filter((rung) => DERIVED_KINDS.has(rung.triggerKind) && !have.has(`${rung.triggerKind}:${rung.triggerValue}`));
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
