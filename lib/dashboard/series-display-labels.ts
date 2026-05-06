/**
 * Friendly titles for branded multi-fixture `event_code` rows on the client
 * dashboard / share portal. Grouping keys are unchanged — this is display-only.
 */

export const SERIES_DISPLAY_LABELS: Record<string, string> = {
  "4TF-TITLERUNIN-LONDON": "Arsenal Title Run In",
  "4TF26-ARSENAL-CL-FL": "Arsenal Champions League Final – London",
  "4TF26-ARSENAL-CL-DUBLIN": "Arsenal Champions League Final – Dublin",
  "4TF26-ARSENAL-CL-SF": "Arsenal Champions League Semi Final",
  "4TF26-ARSENAL-CL-QF": "Arsenal Champions League Quarter Final",
  "4TF26-CPFC-CL-FINAL": "Crystal Palace Conference League Final",
  "4TF26-NFFC-UEL-FINAL": "Nottingham Forest Europa League Final",
  "4TF26-VILLA-UEL-FINAL": "Aston Villa Europa League Final",
  "LEEDS26-FACUP": "Leeds FA Cup Semi Final",
};

export function getSeriesDisplayLabel(
  eventCode: string | null | undefined,
): string | null {
  if (!eventCode) return null;
  return SERIES_DISPLAY_LABELS[eventCode] ?? null;
}
