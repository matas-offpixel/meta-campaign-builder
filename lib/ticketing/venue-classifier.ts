export type ExpectedTicketingProvider = "fourthefans" | "eventbrite";

const O2_VENUE_KEYWORDS = [
  /^o2\s+/i,
  /\bo2\s+(institute|academy|apollo|forum|shepherd|city\s+hall|brixton|ritz|victoria|kentish)/i,
  /kentish\s+town\s+forum/i,
];

export function detectExpectedProvider(
  venueName: string | null,
  eventCode: string | null,
): ExpectedTicketingProvider | null {
  if (!venueName && !eventCode) return null;
  const text = `${venueName ?? ""} ${eventCode ?? ""}`.toLowerCase();
  if (O2_VENUE_KEYWORDS.some((re) => re.test(text))) return "eventbrite";
  return null;
}
