/**
 * A suggestion may only state facts that are in the scraped page or the
 * event row. Numbers, prices, dates and venue or artist names are checked
 * after generation. "Sold out", "last tickets" and a capacity are refused
 * unless those words are already in the source.
 */

const BANNED_PHRASES = ["sold out", "last tickets", "last ticket", "selling fast", "almost gone"] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Ad words that are not a venue or an artist. */
const STOP = new Set(
  [
    "a", "an", "the", "and", "or", "for", "from", "with", "your", "our", "this", "that",
    "tickets", "ticket", "get", "book", "buy", "official", "tonight", "tomorrow", "join",
    "see", "watch", "now", "new", "live", "music", "dance", "event", "show", "night",
    "doors", "only", "just", "on", "at", "in", "to", "be", "are", "is", "it", "we", "you",
    "of", "out", "sale", "presale", "general",
  ].map((word) => word.toLowerCase()),
);

export interface CopyEventFacts {
  name: string;
  artist: string;
  venue: string;
  city: string;
  /** ISO date, or empty. */
  date: string;
  ticketDate: string;
  saleDate: string;
  /** Major-unit price from the event row, or empty. */
  price: string;
  /** Capacity from the event row, or empty. */
  capacity: string;
  clientName: string;
}

export function expandIsoDate(value: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value.trim() ? [value.trim()] : [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return [value.trim()];
  const long = MONTHS[month - 1];
  const short = MONTHS_SHORT[month - 1];
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return [
    `${year}-${mm}-${dd}`,
    `${day} ${short} ${year}`,
    `${day} ${long} ${year}`,
    `${long} ${day}, ${year}`,
    `${short} ${day}, ${year}`,
    `${day} ${short}`,
    `${day} ${long}`,
    `${dd}/${mm}/${year}`,
    `${day}/${month}/${year}`,
  ];
}

/** Page text plus the event row, with each date written the ways a line might say it. */
export function factCorpus(pageText: string, event: CopyEventFacts): string {
  const dates = [event.date, event.ticketDate, event.saleDate].flatMap(expandIsoDate);
  const price = event.price.trim();
  const capacity = event.capacity.trim();
  const lines = [
    pageText,
    event.clientName,
    event.name,
    event.artist,
    event.venue,
    event.city,
    ...dates,
    price ? `price ${price}` : "",
    price ? `£${price}` : "",
    capacity ? `capacity ${capacity}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** First reason the line states a fact the corpus does not contain. */
export function unsupportedFact(suggestion: string, corpus: string): string | null {
  const text = suggestion.trim();
  if (!text) return "empty";
  const haystack = normalise(corpus);
  const lower = normalise(text);
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase) && !haystack.includes(phrase)) {
      return `"${phrase}" is not in the page or the event`;
    }
  }
  if (/\bcapacit(?:y|ies)\b/i.test(text) && !haystack.includes("capacity")) {
    return "capacity is not in the page or the event";
  }
  for (const raw of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const number = raw.replace(/,/g, "");
    if (!haystack.includes(number.toLowerCase())) {
      return `${raw} is not in the page or the event`;
    }
  }
  const words = text.match(/[A-Za-z][A-Za-z'’.-]*/g) ?? [];
  for (const word of words) {
    const claim = /^[A-Z]/.test(word) || /^[A-Z]{2,}$/.test(word);
    if (!claim) continue;
    if (STOP.has(word.toLowerCase())) continue;
    if (!haystack.includes(word.toLowerCase())) {
      return `${word} is not in the page or the event`;
    }
  }
  return null;
}
