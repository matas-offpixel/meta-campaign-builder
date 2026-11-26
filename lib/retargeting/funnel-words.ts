/**
 * The words of the retargeting funnel (docs/design-record/2026-11-26-retargeting-funnel.html,
 * RF1–RF9): every row of scratch/retargeting/words-retargeting-2026-11-26.tsv
 * (sha256 fcbd2820…, 65 rows), word for word. The test pins each row against
 * the committed copy (__tests__/fixtures/words-retargeting-2026-11-26.tsv).
 *
 * `fill` puts values into a row's {slots}; every figure is formatted here
 * (money to the penny, "£15.00"; shares as whole numbers, "25"; dates
 * "Tue 13 Oct"). Any string that isn't a row is marked PENDING DESIGN where
 * it's written, and listed in the PR under "For design".
 *
 * Pure. Relative imports only (node:test).
 */

export const RF_WORDS = {
  "rt.tier.cold": "Cold",
  "rt.tier.warm": "Warm",
  "rt.tier.hot": "Hot",
  "rt.name.campaign": "{code} · Retargeting",
  "rt.name.adset": "{code} · Retargeting · {tier}",
  "rt.src.video75": "Video viewers 75 % · 180 days",
  "rt.src.engaged": "Page and Instagram engagers · {n} days",
  "rt.src.followers": "Followers · all time",
  "rt.src.visitors60": "Show page and ticket-link visitors · 60 days",
  "rt.src.video95": "Video viewers 95 % · 60 days",
  "rt.src.ticket30": "Ticket-link visitors · 30 days",
  "rt.src.checkout": "Checkout starters",
  "rt.src.signups": "Registrations · signup list",
  "rt.src.similar": "{n} similar lists",
  "rt.src.similar.one": "1 similar list",
  "rt.src.accounts": "{n} accounts",
  "rt.src.accounts.one": "1 account",
  "rt.m.freq": "Frequency {f}",
  "rt.m.leaves": "leaves out {x}",
  "rt.leaves.cold": "Warm · Hot · buyers",
  "rt.leaves.warm": "Hot · buyers",
  "rt.leaves.hot": "Buyers",
  "rt.stretch.announce": "announce",
  "rt.stretch.normally": "normally",
  "rt.stretch.payday": "payday week",
  "rt.stretch.final_month": "final month",
  "rt.stretch.final_2w": "final 2 weeks",
  "rt.stretch.final_week": "final week",
  "rt.share.line": "£{x} a day · {p} % of the show’s daily spend · {stretch}",
  "rt.share.split": "Cold £{c} · Warm £{w} · Hot £{h}",
  "rt.next": "Next: {stretch} from {date} · {p} % · moves £{x} a day from {from} to retargeting",
  "rt.next.none": "Last stretch: the show is {date}.",
  "rt.take": "Takes £{x} a day from prospecting, largest first: {from}. The show stays at £{s} a day.",
  "rt.take.from": "{name} £{a} → £{b}",
  "rt.take.short": "Prospecting can give £{y} of the £{x} without going under £1.00 an ad set, so retargeting starts at £{y} a day.",
  "rt.take.none": "Prospecting has nothing above £1.00 an ad set to give, so there’s no money for retargeting. Raise the show’s budget first.",
  "rt.cap": "Capped at £{c} a day: frequency {f} over 7 days. £{x} a day went to {to}.",
  "rt.cap.back": "Capped at £{c} a day: frequency {f} over 7 days. £{x} a day went back to {to}.",
  "rt.cap.plus": "Plus £{x} a day from {from}.",
  "rt.cap.lift": "It gets its share back once frequency is 3 or under.",
  "rt.access.missing": "No advertiser access to {n} accounts, so their followers, engagers and video viewers aren’t in any tier: {names}. Ask each artist’s team for advertiser access.",
  "rt.access.missing.one": "No advertiser access to {name}, so its followers, engagers and video viewers aren’t in any tier. Ask the artist’s team for advertiser access.",
  "rt.access.name": "{account} ({platform})",
  "cc.lineup.gone": "No lineup ad set: Cold retargeting reaches the lineup’s fans, and Broad takes the artists as suggestions.",
  "cc.lineup.suggestions": "Suggestions: {names} (lineup)",
  "cc.lineup.interests": "{n} of {m} artists are Meta interests. The rest are reached through Cold retargeting.",
  "cc.lineup.existing": "Cold retargeting replaces this ad set. Move its artists to Broad’s suggestions and remove it?",
  "cc.lineup.move": "Move to Broad",
  "cc.lineup.keep": "Keep",
  "rt.floor": "At the £1.00 floor, so it takes a little more than its share.",
  "claude.rt.plan.line": "{code} · {stretch} · {p} % · £{x} a day: Cold £{c} · Warm £{w} · Hot £{h} · from {from} · audiences {made} made, {make} to make, {missing} missing access",
  "claude.rt.plan.short": "Prospecting can give £{y} of the £{x}.",
  "claude.rt.plan.access": "Needs advertiser access: {names}.",
  "claude.rt.plan.next": "Then {stretch} from {date} at {p} %, as a scheduled change.",
  "claude.rt.plan.head": "{n} shows on sale: {a} to build, {c} skipped.",
  "claude.rt.skip": "{code} · skipped: {reason}.",
  "claude.rt.skip.no_pixel": "its ads optimise on no pixel",
  "claude.rt.skip.no_link": "it has no ticket link",
  "claude.rt.skip.soon": "the show is within 3 days",
  "claude.rt.skip.archived": "its client is archived",
  "claude.rt.skip.built": "it already has a Retargeting campaign",
  "claude.rt.skip.no_money": "prospecting has nothing above £1.00 an ad set to give",
  "claude.rt.done": "Done: {code} · Retargeting created {state} · 3 ad sets · {made} audiences made. Takes £{x} a day from prospecting{when}.",
  "claude.rt.done.when.paused": " once it’s live",
  "claude.rt.done.when.live": "",
} as const;

export type RfKey = keyof typeof RF_WORDS;

/** A row with its {slots} filled. A slot with no value is left as written (the test catches it). */
export function fill(key: RfKey, values: Record<string, string | number> = {}): string {
  return RF_WORDS[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** "15.00": money to the penny, from pennies, grouped in thousands ("1,250.00"). The row carries the £. */
export function money(minor: number): string {
  const value = Math.round(minor) / 100;
  const [int, frac] = value.toFixed(2).split(".");
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/** "Tue 13 Oct", from a London day (YYYY-MM-DD). */
export function rfDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${weekday} ${date.getUTCDate()} ${month}`;
}

/** A 7-day frequency to one decimal ("3.2"). */
export function freq(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** The rows' " · " join (rt.take's {from}, rt.access.missing's {names}). */
export const JOIN = " · ";
