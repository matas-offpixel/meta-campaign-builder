/**
 * ⓘ dismissal — one behaviour, both variants.
 * Same #871 closer as OverflowMenu / BlockerBadge: portal, exempt
 * trigger + panel, defer pointerdown one tick so the opening click
 * cannot close it (feedback_react19_outside_click_closer_self_closes).
 */

export const INFO_TIP_OPEN = "offpixel:info-tip-open";
export const INFO_TIP_CLOSE_LABEL = "close";

export type InfoTipGesture = "trigger" | "outside" | "escape" | "close" | "other-tip";

export function infoTipAfterGesture(gesture: InfoTipGesture): {
  open: boolean;
  closesOthers: boolean;
} {
  switch (gesture) {
    case "trigger":
      return { open: true, closesOthers: true };
    case "outside":
    case "escape":
    case "close":
    case "other-tip":
      return { open: false, closesOthers: false };
  }
}
