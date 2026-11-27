/**
 * What a show's on-sale ad sets optimise on, Wider and Retargeting alike
 * (Matas, 27 Nov: "for electric group and campaigns we are using the cirqlin
 * landing pages - the on sale campaign objective should be initiate checkout
 * to ensure we generate enough data points for the ads to optimise").
 *
 *   - Electric shows (code prefix NX, ES, EBR: the same brands as
 *     ELECTRIC_IDENTITY) optimise on the pixel's INITIATED_CHECKOUT once on
 *     sale, with no custom conversion; every other client on PURCHASE (its
 *     custom conversion on an own domain), as before.
 *   - A presale show stays on COMPLETE_REGISTRATION (TC7).
 *   - `optimise_on` on plan_retargeting / create_show_campaigns overrides the
 *     default for an on-sale show.
 *   - A build whose ad sets already exist keeps the event they were made on
 *     (progress.optimisedOn, else Purchase / CompleteRegistration: what every
 *     build made before this optimised on). Nothing is changed on Meta.
 *   - InitiateCheckout is only built on a pixel that had it in the last 28
 *     days (the read's GET /{pixel}/stats?aggregation=host, RT13); none, or a
 *     read that failed or ran out of time, is a refusal, never a guess.
 *
 * Every sentence here is PENDING DESIGN (27 Nov, speed over design; design
 * Saturday). Pure. Relative imports only (node:test).
 */

import { ELECTRIC_IDENTITY } from "./show-creatives.ts";
import { showBrandOf } from "./show-brands.ts";
import type { PixelHosts } from "./links.ts";

export type OptimiseOn = "purchase" | "initiate_checkout";
export type OptimisationEvent = "PURCHASE" | "INITIATED_CHECKOUT" | "COMPLETE_REGISTRATION";
/** Whether the pixel had InitiateCheckout in 28 days: seen, none, or not read (failed or out of time). */
export type CheckoutSeen = "seen" | "none" | "unread";

export const OPTIMISE_ON_VALUES = ["purchase", "initiate_checkout"] as const;

/** The on-sale default for a show's code: InitiateCheckout for the Electric group, Purchase for every other client. */
export function defaultOptimiseOn(code: string | null | undefined): OptimiseOn {
  const brand = showBrandOf(code);
  return brand && brand.prefix in ELECTRIC_IDENTITY ? "initiate_checkout" : "purchase";
}

export function eventOf(on: OptimiseOn): OptimisationEvent {
  return on === "initiate_checkout" ? "INITIATED_CHECKOUT" : "PURCHASE";
}

/** The pixel's InitiateCheckout in 28 days from the read's host breakdown (null = the read failed or wasn't made). */
export function checkoutSeenOf(hosts: PixelHosts | undefined): CheckoutSeen {
  if (!hosts) return "unread";
  return hosts.checkout.length > 0 ? "seen" : "none";
}

export type Optimisation = {
  event: OptimisationEvent;
  /** The ad sets were made already: their event is kept. */
  kept: boolean;
  /** An optimise_on that was asked for and not used (presale, or kept ad sets on another event). */
  askedNotUsed: OptimiseOn | null;
};

/**
 * The event a build's ad sets are made on. `progress.adSetsMade` (any tier or
 * Wider ad set exists) keeps the event they were made on; else presale is
 * CompleteRegistration; else the override, the build's stored choice, then
 * the code's default.
 */
export function resolveOptimisation(args: { code: string; presale: boolean; asked?: OptimiseOn | null; stored?: OptimiseOn | null; madeOn?: OptimisationEvent | null; adSetsMade: boolean }): Optimisation {
  const asked = args.asked ?? null;
  if (args.adSetsMade) {
    // Builds made before 27 Nov didn't record it: they all optimised on Purchase (or CompleteRegistration in presale).
    const event = args.madeOn ?? (args.presale ? "COMPLETE_REGISTRATION" : "PURCHASE");
    return { event, kept: true, askedNotUsed: asked && eventOf(asked) !== event ? asked : null };
  }
  if (args.presale) return { event: "COMPLETE_REGISTRATION", kept: false, askedNotUsed: asked };
  return { event: eventOf(asked ?? args.stored ?? defaultOptimiseOn(args.code)), kept: false, askedNotUsed: null };
}

/** Any of the build's ad sets (Retargeting's tiers or Wider's) made already. */
export function adSetsMadeOf(progress: { adSets?: Record<string, unknown> | null; wider?: { adSets?: Record<string, unknown> | null } | null } | null | undefined): boolean {
  const some = (sets: Record<string, unknown> | null | undefined) => Object.values(sets ?? {}).some(Boolean);
  return some(progress?.adSets) || some(progress?.wider?.adSets);
}

const EVENT_NAME: Record<OptimisationEvent, string> = {
  PURCHASE: "Purchase",
  INITIATED_CHECKOUT: "InitiateCheckout",
  COMPLETE_REGISTRATION: "CompleteRegistration",
};
const ASKED_NAME: Record<OptimiseOn, string> = { purchase: "Purchase", initiate_checkout: "InitiateCheckout" };

/** PENDING DESIGN: the words of this file (rf-electric-initiate-checkout words TSV). */
export const OPTIMISE_WORDS = {
  /** claude.rt.optimises_on: the plan's one line. */
  line: (event: OptimisationEvent) => `Optimises on: ${EVENT_NAME[event]}.`,
  /** claude.rt.optimises_on.kept: ad sets already made keep their event. */
  kept: (code: string, event: OptimisationEvent) => `Optimises on: ${EVENT_NAME[event]}. ${code}’s ad sets were made on it, so they keep it; nothing on them is changed.`,
  /** claude.rt.optimises_on.kept_asked: optimise_on asked for, but the ad sets were made on another event. */
  keptAsked: (code: string, asked: OptimiseOn, event: OptimisationEvent) => `Asked for ${ASKED_NAME[asked]}, but ${code}’s ad sets were made on ${EVENT_NAME[event]}, so they keep it; nothing on them is changed.`,
  /** claude.rt.optimises_on.presale_asked: optimise_on on a presale show. */
  presaleAsked: (asked: OptimiseOn) => `A presale show optimises on CompleteRegistration, so ${ASKED_NAME[asked]} isn’t used until it’s on sale.`,
  /** claude.rt.optimises_on.no_checkout (plan): the pixel had no InitiateCheckout. */
  planNoCheckout: (code: string) => `${code}’s pixel had no InitiateCheckout in the last 28 days, so create_show_campaigns would refuse it. Pass optimise_on "purchase" to build on Purchase.`,
  /** claude.rt.optimises_on.unread (plan): the pixel's InitiateCheckout couldn't be read. */
  planUnread: (code: string) => `${code}’s pixel’s InitiateCheckout couldn’t be read in time, so create_show_campaigns would refuse it. Asking again tries it.`,
  /** claude.rt.refused.no_checkout: create refused, the pixel had no InitiateCheckout. */
  refusedNoCheckout: (code: string) => `Refused: ${code}’s pixel had no InitiateCheckout in the last 28 days, so the ad sets would have nothing to optimise on. Pass optimise_on "purchase" to build on Purchase. Nothing was sent to Meta.`,
  /** claude.rt.refused.checkout_unread: create refused, the read failed or ran out of time. */
  refusedUnread: (code: string) => `Refused: ${code}’s pixel’s InitiateCheckout couldn’t be read in time, so nothing was built. Asking again tries it. Nothing was sent to Meta.`,
} as const;

/** The plan's lines for one show: "Optimises on: …", then why it's kept, or why create would refuse. */
export function optimisationLines(code: string, opt: Optimisation, checkout: CheckoutSeen): string[] {
  const head = opt.kept ? OPTIMISE_WORDS.kept(code, opt.event) : OPTIMISE_WORDS.line(opt.event);
  const asked = opt.askedNotUsed ? [opt.kept ? OPTIMISE_WORDS.keptAsked(code, opt.askedNotUsed, opt.event) : OPTIMISE_WORDS.presaleAsked(opt.askedNotUsed)] : [];
  const check = !opt.kept && opt.event === "INITIATED_CHECKOUT" && checkout !== "seen" ? [checkout === "none" ? OPTIMISE_WORDS.planNoCheckout(code) : OPTIMISE_WORDS.planUnread(code)] : [];
  return [head, ...asked, ...check];
}

/** Create's refusal when InitiateCheckout would be built on a pixel without it (null = build). */
export function checkoutRefusal(code: string, opt: Optimisation, checkout: CheckoutSeen | null | undefined): string | null {
  if (opt.kept || opt.event !== "INITIATED_CHECKOUT" || checkout == null || checkout === "seen") return null;
  return checkout === "none" ? OPTIMISE_WORDS.refusedNoCheckout(code) : OPTIMISE_WORDS.refusedUnread(code);
}
