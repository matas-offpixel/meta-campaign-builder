/**
 * Recover artist names for one event from what the event already has:
 * the Lab lineup, the event's own ad copy, and its campaign and ad-set
 * names. A name found here is a candidate; Spotify (artist-confirm.ts)
 * says whether it is an artist. Pure: no database, no network.
 *
 * Ad copy: a capitalised run ("Job de Jong", "Horse Meat Disco", "MiNNA")
 * is a candidate when it is not the venue, the city, the client, a date
 * word or an ad word, and the event has it in at least MIN_COPY_ADS ads.
 * In a sentence-case segment a capitalised ad word inside a run stays in
 * it ("Horse Meat Disco", "Girls Don't Sync"); in an ALL-CAPS segment the
 * casing says nothing, so ad words end a run. A name the copy only
 * mentions in passing ("Last weekend, Eric Prydz delivered …") is not on
 * the lineup: a copy-only name needs a list ("with X, Y and more"), a
 * lineup verb ("X joins …") or a tenth of the event's ads. A one-word run
 * ("Voyager", "Jake", "Purpose") is a name only in a lineup list (a comma
 * or an "and" / "&" / "b2b" beside it), with a lineup verb, in a campaign
 * or ad-set name, as the event's own name, or already in the library;
 * Spotify is not asked otherwise. "& more",
 * "and friends", "residents" and "b2b" end a run, so "AZYR b2b
 * Partiboi69" is two names.
 *
 * Campaign and ad-set names: the [CODE], the "261204 Name |" prefix and
 * the ad-ops words (On Sale, Signup, Lineup, Adv+, 1% LL, London 30km)
 * are dropped; the capitalised groups left are names. A Meta interest
 * list ("Techno (music), House music (music)") is skipped whole. A
 * campaign name can make a candidate on its own; it is the noisiest
 * source, so one the copy never carries is never accepted without
 * Spotify, and a single word there is only a candidate when it is the
 * event's own name. An ad-set name is an audience ("Jamie Jones &
 * Paradise Lookalikes"), so it only corroborates a name the copy has.
 */

export type ArtistSource = "lineup" | "ad_copy" | "campaign_name";

export type ExtractionEvent = {
  eventId: string;
  eventCode: string | null;
  eventName: string | null;
  venueName: string | null;
  venueCity: string | null;
  clientName: string | null;
  campaignNames: readonly string[];
  adSetNames: readonly string[];
  /** One entry per ad: every body and title the ad ran. */
  ads: readonly { metaAdId: string; texts: readonly string[] }[];
  /** creative_lab_event_facts.lineup / headliners. */
  labLineup: readonly string[];
  labHeadliners: readonly string[];
  /** Names already in event_artists for this event. */
  linked: readonly string[];
};

export type ExtractionWorld = {
  venues: readonly string[];
  cities: readonly string[];
  clients: readonly string[];
  /** Every name in the artists table. A known name needs no Spotify. */
  knownArtists: readonly string[];
};

export type Candidate = {
  name: string;
  sources: ArtistSource[];
  /** Ads of this event whose copy carries the name. */
  ads: number;
  inCampaignName: boolean;
  isHeadliner: boolean;
  /** Already in the artists table: link without a Spotify search. */
  known: boolean;
  /** Not a Lab lineup name and not in the library: Spotify must confirm. */
  needsConfirmation: boolean;
};

export type Rejected = { name: string; reason: string; ads: number };

export type Extraction = {
  eventId: string;
  candidates: Candidate[];
  rejected: Rejected[];
  /** Names already linked to this event; nothing to do. */
  alreadyLinked: string[];
};

export const MIN_COPY_ADS = 3;
/** A copy-only name with no list or lineup verb around it must be in this share of the event's ads. */
export const MIN_COPY_SHARE = 0.1;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"];
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "tues", "wed", "weds", "thu", "thur", "thurs", "fri", "sat", "sun"];
const PLACES_LIST = ["uk", "eu", "usa", "us", "uae", "europe", "england", "scotland", "wales", "ireland", "britain", "america", "australia", "asia", "africa", "spain", "france", "germany", "italy", "portugal", "netherlands", "belgium", "egypt", "brazil", "mexico", "canada", "india", "japan", "china", "croatia", "greece", "ibiza", "mallorca", "nyc", "london", "newcastle", "sheffield", "brighton", "dubai", "manchester", "leeds", "bristol", "birmingham", "glasgow", "edinburgh", "liverpool", "nottingham", "southampton"];

/** Words a sentence or an ad-ops name is made of. Never an artist on their own. */
const AD_WORDS = [
  "tickets", "ticket", "final", "last", "presale", "pre", "sale", "on", "sign", "signup", "signups", "sign-up", "sign-ups", "up", "now", "live", "soon", "out", "sold", "selling", "running", "low", "fast", "quick", "moving", "flying",
  "release", "releases", "tier", "tiers", "early", "bird", "limited", "remaining", "access", "priority", "exclusive", "info", "more", "details", "announcement", "announcements", "announced", "announce", "announcing", "reveal", "revealed", "revealing", "dropping", "drop", "drops", "coming", "countdown", "giveaway", "giveaways", "competition", "win", "winners", "gold", "passes", "pass", "link", "bio", "table", "reservations", "via", "partnership", "demand", "crazy", "chance", "miss", "missing", "avoid", "grab", "catch", "join", "joins", "joined", "joining", "see", "you", "there", "here", "it", "is", "this", "that", "these", "those", "the", "a", "an", "and", "or", "of", "for", "to", "in", "at", "with", "from", "by", "as", "we", "we're", "were", "we've", "our", "us", "i", "i'm", "im", "my", "me", "your", "you're", "they", "their", "them", "he", "his", "she", "her", "who", "who's", "whos", "which", "what", "when", "where", "why", "how", "all", "any", "some", "many", "much", "every", "each", "one", "two", "three", "first", "second", "third", "fourth", "fifth", "next", "new", "newest", "back", "again", "still", "yet", "already", "just", "only", "very", "so", "too", "also", "not", "no", "yes", "be", "been", "being", "are", "was", "will", "would", "can", "can't", "cant", "could", "don't", "dont", "do", "does", "did", "get", "got", "make", "makes", "making", "made", "take", "takes", "taking", "took", "over", "takeover", "take-over", "lands", "land", "landing", "returns", "return", "returning", "presents", "present", "bring", "brings", "bringing", "kick", "off", "kicks", "set", "sets", "extended", "special", "huge", "big", "biggest", "massive", "stacked", "heavyweight", "heavyweights", "legendary", "iconic", "incredible", "unreal", "anticipated", "highly", "excited", "gassed", "proud", "proudly", "pleased", "happy", "thrilled", "delighted", "ready", "wait", "waiting", "expect", "expected", "head", "headline", "headliner", "headliners", "headlining", "show", "shows", "showcase", "night", "nights", "party", "parties", "event", "events", "season", "summer", "winter", "spring", "autumn", "weekend", "weekends", "tonight", "tomorrow", "today", "year", "years", "month", "months", "week", "weeks", "day", "days", "time", "times", "hour", "hours", "am", "pm", "bst", "gmt", "open", "air", "opening", "closing", "close", "debut", "edition", "part", "full", "lineup", "line-up", "line", "lineups", "stage", "stages", "room", "rooms", "venue", "venues", "warehouse", "club", "clubs", "beach", "seafront", "city", "cities", "town", "capital", "heart", "home", "house", "music", "sound", "soundsystem", "sounds", "dj", "djs", "b2b", "x", "vs", "v", "friends", "friend", "residents", "resident", "guests", "guest", "plus", "selectors", "artists", "artist", "records", "record", "label", "imprint", "tour", "world", "worldwide", "global", "international", "marketing", "brand", "awareness", "always-on", "traffic", "reach", "engagement", "purchase", "purchases", "conversion", "conversions", "registration", "registrations", "lead", "leads", "gen", "initiate", "checkout", "add", "cart", "offer", "lifetime", "daily", "copy", "test", "manual", "primary", "secondary", "wider", "wide", "direct", "suggested", "suggestion", "suggestions", "adv", "adv+", "advantage", "ll", "lookalike", "lookalikes", "similar", "pages", "page", "data", "customs", "custom", "email", "pixel", "retargeting", "prospecting", "interests", "interest", "streaming", "students", "student", "feed", "feeds", "stories", "reels", "ig", "fb", "ads", "ad", "core", "older", "younger", "latest", "phone", "users", "gym", "bros", "hot", "past", "cold", "warm", "funnel", "mid", "top", "bottom", "curated", "main", "sugges", "excl", "incl", "disc", "genre", "genres", "media", "entertainment", "lifestyle", "fashion", "fashionistas", "streetwear", "nightlife", "activities", "culture", "platforms", "publications", "radio", "news", "labels", "other", "commercial", "festival", "festivals", "electronic", "dance", "techno", "tech", "deep", "disco", "garage", "melodic", "dnb", "drum", "bass", "classic", "edm", "halloween", "christmas", "nye", "birthday", "anniversary", "bank", "holiday", "sun's", "suns", "rain", "price", "prices", "move", "moves", "vip", "free", "entry", "doors", "age", "ages", "km", "mile", "miles", "spotify", "deezer", "soundcloud", "youtube", "apple", "iphone", "android", "instagram", "facebook", "tiktok", "boiler", "mixmag", "nts", "glastonbury", "gala", "vogue", "asos", "gucci", "prada", "hypebeast", "balance", "margiela", "owens", "lang", "simons", "nx", "ldn", "nhs", "lwe", "j2", "irw", "ohd",
  "super", "sell", "sells", "has", "have", "had", "begun", "begin", "begins", "began", "wrapup", "wrap-up", "production", "update", "blue", "light", "version", "v2", "v3", "v4", "fun", "lets", "let's", "let", "go", "goes", "going", "gone", "come", "comes", "came", "play", "plays", "playing", "played", "deliver", "delivered", "delivers", "built", "building", "build", "ground", "entire", "unique", "location", "skyline", "backdrop", "beachfront", "experience", "scenes", "moments", "moment", "duo", "trio", "collective", "crew", "team", "studio", "partner", "partners", "partnered", "site", "batch", "response", "whole", "simple", "steps", "step", "follow", "tag", "share", "post", "comment", "counts", "below", "above", "wild", "list", "lists", "stay", "tuned", "keep", "eyes", "peeled", "mark", "calendars", "calendar", "save", "date", "dates", "introducing", "welcome", "welcomes", "welcoming", "honoured", "honored", "prepare", "prepared", "loves", "love", "presents:", "official", "nightclubs", "bars", "clubs", "finally", "officially", "massive", "insane", "unbelievable", "wow", "yes", "ok", "okay",
];

const PLACES = new Set(PLACES_LIST);
const STOP = new Set([...AD_WORDS, ...MONTHS, ...WEEKDAYS, ...PLACES_LIST]);

/** Never inside a name, whatever the casing: a date, a place, a holiday, a claim, a verb that introduces a name. */
const BREAKERS = new Set([
  ...MONTHS, ...WEEKDAYS, ...PLACES_LIST,
  "halloween", "christmas", "xmas", "nye", "easter", "tickets", "ticket", "presale", "pre-sale", "sale", "signup", "sign-up", "lineup", "line-up", "until", "till", "before", "after", "during", "since", "about", "into", "onto", "through", "between", "under", "without", "within", "across", "along", "around", "behind", "beyond", "despite", "except", "inside", "outside", "toward", "towards", "upon", "versus",
  "joining", "joins", "join", "featuring", "feat", "ft", "with", "and", "or", "plus", "alongside", "including", "welcomes", "welcome", "presents", "announcing", "introducing", "catch", "see", "watch", "hear",
  "more", "many", "friends", "friend", "residents", "resident", "guests", "guest", "family", "crew",
]);

/** Lowercase particles that sit inside a name: Job de Jong, Charlotte de Witte. */
const JOINERS = new Set(["de", "da", "van", "von", "del", "della", "di", "la", "le", "du", "y", "of", "&"]);

/** Ad words that may open a name anyway: DJ EZ, MC Fats. */
const NAME_PREFIXES = new Set(["dj", "mc", "dr", "lil", "the"]);

/** A one-word sentence opener is a name when one of these follows it. */
const LINEUP_VERBS = new Set([
  "joins", "join", "joining", "takes", "take", "headline", "headlines", "headlining", "presents", "lands", "land", "returns", "return", "plays", "play", "closes", "close", "opens", "open", "makes", "make", "brings", "bring", "b2b", "x", "vs", "&", "and", "live", "at",
]);

/**
 * Words before a run that make it one item of a lineup list: "Sim0ne and
 * SUDIK", "feat. Saoirse". "with" is not one: "A Space With Purpose".
 */
const LIST_LEADS = new Set(["featuring", "feat", "feat.", "ft", "ft.", "plus", "&", "and", "b2b", "x", "vs", "alongside"]);

/** Two to four capitals or digits: DHB, IPC, CDW, but also SHDW. The event's, client's and venue's own initials are never names; another needs a list or a lineup verb. */
const ABBREVIATION = /^[A-Z0-9]{2,4}$/;

/** "Deep House Bible" → "dhb", "Charlotte de Witte" → "cdw". */
export function initialsOf(name: string | null | undefined): string | null {
  const words = (name ?? "").split(/[^\p{L}\p{N}]+/u).filter((word) => word && !["the", "and", "of", "at"].includes(word.toLowerCase()));
  if (words.length < 2) return null;
  return words.map((word) => word[0]!.toLowerCase()).join("");
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function trimToken(token: string): string {
  if (token === "&") return token;
  return token
    .replace(/[’‘`]/g, "'")
    .replace(/^[^\p{L}\p{N}@#&]+|[^\p{L}\p{N}'!?+]+$/gu, "")
    .replace(/[!?]+$/u, "")
    .replace(/['’]s$/u, "")
    .replace(/['’]$/u, "");
}

function hasLetters(token: string, n = 1): boolean {
  return (token.match(/\p{L}/gu) ?? []).length >= n;
}

function isCapitalised(token: string): boolean {
  if (!token || !/^\p{Lu}/u.test(token)) return false;
  if (!hasLetters(token, 2) && !/^\p{Lu}\p{N}+$/u.test(token)) return false;
  if (/^\p{Lu}\.$/u.test(token)) return false;
  return true;
}

function isStop(token: string): boolean {
  const lower = token.toLowerCase();
  if (STOP.has(lower)) return true;
  // "Pre-Sale", "Sign-Up": every part an ad word.
  const parts = lower.split(/[-/]/).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => STOP.has(part))) return true;
  // "I've", "We'll", "Can't": a contraction is never a name.
  return /^\p{L}+'(?:s|t|ve|re|ll|d|m)$/u.test(lower) && !/^\p{L}{3,}'s$/u.test(lower) ? true : /^(?:i|we|you|they|it|that|there|here|what|who|let|don|won|can|isn|aren|didn|doesn|wasn|weren|couldn|wouldn|shouldn)'/.test(lower);
}

/** A word no name contains, in any casing. An ALL-CAPS ad word is one too: "SOLD OUT Jamie Jones". */
function breaks(token: string): boolean {
  const lower = token.toLowerCase();
  if (NAME_PREFIXES.has(lower)) return false;
  if (BREAKERS.has(lower)) return true;
  const parts = lower.split(/[-/]/).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => BREAKERS.has(part) || STOP.has(part))) return true;
  return allCaps(token) && token.length > 1 && isStop(token);
}

/** A capitalised word that is not an ad word. */
function isNameToken(token: string): boolean {
  return isCapitalised(token) && !isStop(token);
}

function endsRun(raw: string): boolean {
  return /[,;]$/.test(raw) || raw === "+" || raw === "/";
}

/** Sentence-sized pieces of one text, with URLs, handles, hashtags and emoji removed. */
export function segments(text: string): string[] {
  const cleaned = text
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/(\p{Ll}{2})([.!?])(?=\p{Lu})/gu, "$1$2 ")
    .replace(/(^|[^\p{L}\p{N}])[@#][\p{L}\p{N}._]+/gu, "$1 ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[“”"()\[\]{}*]/g, " ");
  return cleaned
    .split(/[.!?\n•|]+(?=\s|$)|\s[-—–]\s|\s[—–]|[—–]\s|\/\/|:\s|\s\|\s/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Most letters upper case and more than one word: casing carries no name signal. */
export function isShouting(segment: string): boolean {
  const letters = segment.match(/\p{L}/gu) ?? [];
  if (letters.length < 6 || !/\s/.test(segment.trim())) return false;
  const upper = letters.filter((letter) => letter === letter.toUpperCase() && letter !== letter.toLowerCase()).length;
  return upper / letters.length >= 0.8;
}

export type Run = { name: string; atStart: boolean; nextWord: string | null; inList: boolean };

/** Capitalised runs in one segment. */
export function capitalisedRuns(segment: string): Run[] {
  const raw = segment.split(/\s+/).filter(Boolean);
  const strict = isShouting(segment);
  const runs: Run[] = [];
  let current: string[] = [];
  let startIndex = -1;
  let listLead = false;
  const flush = (index: number) => {
    while (current.length && (JOINERS.has(current[current.length - 1]!.toLowerCase()) || (!strict && isStop(current[current.length - 1]!) && !hasNameToken(current)))) current.pop();
    if (current.length && hasNameToken(current)) {
      const nextRaw = raw[index] ?? null;
      const next = nextRaw ? trimToken(nextRaw).toLowerCase() : null;
      const endedByComma = index > 0 && endsRun(raw[index - 1]!);
      runs.push({
        name: current.join(" "),
        atStart: startIndex === 0,
        nextWord: next,
        inList: listLead || endedByComma || next === "&" || next === "and" || next === "b2b",
      });
    }
    current = [];
    startIndex = -1;
    listLead = false;
  };
  for (let i = 0; i < raw.length; i++) {
    const token = trimToken(raw[i]!);
    const lower = token.toLowerCase();
    const previous = i > 0 ? trimToken(raw[i - 1]!).toLowerCase() : "";
    const breaker = breaks(token);
    const starts =
      !breaker &&
      (isNameToken(token) ||
        (!current.length &&
          isCapitalised(token) &&
          (NAME_PREFIXES.has(lower) || (!strict && i + 1 < raw.length && isCapitalised(trimToken(raw[i + 1]!)) && !breaks(trimToken(raw[i + 1]!))))));
    const continues = !breaker && current.length > 0 && isCapitalised(token) && (!strict || !isStop(token));
    if (starts || continues) {
      if (!current.length) {
        startIndex = i;
        listLead = LIST_LEADS.has(previous);
      }
      current.push(token);
    } else if (current.length && JOINERS.has(lower) && i + 1 < raw.length && isNameToken(trimToken(raw[i + 1]!))) {
      current.push(token);
    } else {
      flush(i);
    }
    if (current.length && endsRun(raw[i]!)) flush(i + 1);
  }
  flush(raw.length);
  return runs;
}

function hasNameToken(tokens: readonly string[]): boolean {
  return tokens.some((token) => isNameToken(token));
}

function stripBrackets(name: string): string {
  return name.replace(/\[[^\]]*\]/g, " ").replace(/^\s*\d{6}\s+/, " ");
}

/** Capitalised names left in a campaign or ad-set name once the ad-ops words are gone. */
export function namesInCampaignName(name: string): string[] {
  const stripped = stripBrackets(name);
  if (/\(/.test(stripped) || (stripped.match(/,/g) ?? []).length >= 3) return [];
  const out: string[] = [];
  for (const piece of stripped.split(/\s[-—–]\s|[—–|/+:,]|\s&\s|\s-$|^-\s|\sb2b\s|\sx\s|\svs\s/u)) {
    const tokens = piece.trim().split(/\s+/).filter(Boolean).map(trimToken).filter(Boolean);
    if (!tokens.length) continue;
    let group: string[] = [];
    const flush = () => {
      while (group.length && JOINERS.has(group[group.length - 1]!.toLowerCase())) group.pop();
      while (group.length && NAME_PREFIXES.has(group[0]!.toLowerCase()) && group.length === 1) group.pop();
      if (group.length) out.push(group.join(" "));
      group = [];
    };
    tokens.forEach((token, index) => {
      const lower = token.toLowerCase();
      const numeric = (/\p{N}/u.test(token) && !hasLetters(token, 2)) || /^\d+%|km$|^\d+-\d+$/u.test(token);
      if (numeric) flush();
      else if (isNameToken(token)) group.push(token);
      else if (group.length && JOINERS.has(lower) && index + 1 < tokens.length && isNameToken(tokens[index + 1]!)) group.push(token);
      else if (!group.length && NAME_PREFIXES.has(lower) && isCapitalised(token) && index + 1 < tokens.length && isNameToken(tokens[index + 1]!)) group.push(token);
      else flush();
    });
    flush();
  }
  return out.filter((candidate) => candidate.length >= 3);
}

function eventNameParts(name: string | null): string[] {
  if (!name) return [];
  const parts = name.split(/\s+[-–—|:]\s+|:\s+/).map((part) => part.trim()).filter(Boolean);
  return [name.trim(), ...parts];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type KnownKind = "venue" | "city" | "client";

/**
 * Take the venue, city and client names out of a text before runs are
 * read, so "Skydive Dubai" never reaches the run finder as "Skydive".
 * Returns the names that were there, by kind.
 */
export function stripKnownNames(text: string, known: readonly { name: string; kind: KnownKind }[]): { text: string; found: { name: string; kind: KnownKind }[] } {
  let next = text;
  const found: { name: string; kind: KnownKind }[] = [];
  for (const item of known) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(item.name)}(?=$|[^\\p{L}\\p{N}])`, "giu");
    if (!pattern.test(next)) continue;
    pattern.lastIndex = 0;
    found.push(item);
    next = next.replace(pattern, "$1 ");
  }
  return { text: next, found };
}

function phraseIn(haystack: string, needle: string): boolean {
  const pattern = new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "u");
  return pattern.test(haystack);
}

function excluded(name: string, world: ExtractionWorld, event: ExtractionEvent): string | null {
  const key = nameKey(name);
  const words = key.split(" ");
  const is = (list: readonly (string | null | undefined)[]) => list.some((item) => item && nameKey(item) === key);
  if (is([event.venueName, ...world.venues])) return "venue";
  if (is([event.venueCity, ...world.cities])) return "city";
  if (is([event.clientName, ...world.clients])) return "client";
  if (words.every((word) => STOP.has(word))) return "ad word";
  if (words.every((word) => MONTHS.includes(word) || WEEKDAYS.includes(word))) return "date word";
  if (key.length < 3) return "too short";
  if (!hasLetters(key, 2)) return "no letters";
  const clients = [event.clientName, ...world.clients].filter((item): item is string => Boolean(item)).map(nameKey);
  if (words.length > 1 && clients.some((client) => client.length >= 4 && phraseIn(key, client))) return "contains the client name";
  const venues = [event.venueName, ...world.venues].filter((item): item is string => Boolean(item)).map(nameKey);
  if (words.length > 1 && venues.some((venue) => venue.length >= 4 && phraseIn(key, venue))) return "contains the venue name";
  const placeWords = [event.venueName, event.venueCity, ...world.venues, ...world.cities].filter(Boolean).flatMap((item) => nameKey(item as string).split(" "));
  if (words.length > 1 && words.every((word) => STOP.has(word) || placeWords.includes(word))) return "venue words";
  return null;
}

function allCaps(value: string): boolean {
  return value === value.toUpperCase() && value !== value.toLowerCase();
}

/** The casing the copy uses most; a mixed-case spelling beats an all-caps one. */
export function preferredCasing(variants: ReadonlyMap<string, number>): string {
  let best = "";
  let bestScore = -1;
  for (const [variant, count] of variants) {
    const score = allCaps(variant) ? count : count + 1_000_000;
    if (score > bestScore) {
      best = variant;
      bestScore = score;
    }
  }
  return best;
}

export function extractArtists(event: ExtractionEvent, world: ExtractionWorld): Extraction {
  const known = new Set(world.knownArtists.map(nameKey));
  const linked = new Set(event.linked.map(nameKey));
  const headliners = new Set(event.labHeadliners.map(nameKey));
  const eventNames = new Set(eventNameParts(event.eventName).map(nameKey));
  const initials = new Set(
    [...eventNameParts(event.eventName), event.clientName, event.venueName, ...world.clients, ...world.venues].map(initialsOf).filter((item): item is string => Boolean(item)),
  );
  const totalAds = Math.max(1, event.ads.length);

  type Seen = { casing: Map<string, number>; ads: Set<string>; midSegment: boolean; verbAfter: boolean; inList: boolean; sources: Set<ArtistSource> };
  const seen = new Map<string, Seen>();
  const touch = (name: string, source: ArtistSource): Seen => {
    const key = nameKey(name);
    const have = seen.get(key) ?? { casing: new Map(), ads: new Set(), midSegment: false, verbAfter: false, inList: false, sources: new Set() };
    have.casing.set(name.trim(), (have.casing.get(name.trim()) ?? 0) + 1);
    have.sources.add(source);
    seen.set(key, have);
    return have;
  };

  // "Louder / Parable" and "Circuit & Engine Rooms" are also known by their parts.
  const withParts = (names: readonly (string | null | undefined)[]) =>
    names
      .filter((name): name is string => Boolean(name?.trim()))
      .flatMap((name) => [name.trim(), ...name.split(/\s+[/|&]\s+|\s+-\s+/).map((part) => part.trim()).filter((part) => part.length >= 4)]);
  const knownNames: { name: string; kind: KnownKind }[] = [
    ...withParts([event.venueName, ...world.venues]).map((name) => ({ name, kind: "venue" as const })),
    ...withParts([event.venueCity, ...world.cities]).map((name) => ({ name, kind: "city" as const })),
    ...withParts([event.clientName, ...world.clients]).map((name) => ({ name, kind: "client" as const })),
  ]
    .filter((item) => item.name.length >= 3 && !PLACES.has(item.name.toLowerCase()) && !STOP.has(item.name.toLowerCase()))
    .filter((item, index, all) => all.findIndex((other) => nameKey(other.name) === nameKey(item.name)) === index)
    .sort((a, b) => b.name.length - a.name.length);
  const knownSeen = new Map<string, { kind: KnownKind; ads: Set<string> }>();

  for (const name of event.labLineup) if (name.trim()) touch(name, "lineup");
  for (const ad of event.ads) {
    for (const raw of ad.texts) {
      const stripped = stripKnownNames(raw, knownNames);
      for (const item of stripped.found) {
        const have = knownSeen.get(nameKey(item.name)) ?? { kind: item.kind, ads: new Set<string>() };
        have.ads.add(ad.metaAdId);
        knownSeen.set(nameKey(item.name), have);
      }
      for (const segment of segments(stripped.text)) {
        for (const run of capitalisedRuns(segment)) {
          const entry = touch(run.name, "ad_copy");
          entry.ads.add(ad.metaAdId);
          if (!run.atStart) entry.midSegment = true;
          if (run.nextWord && LINEUP_VERBS.has(run.nextWord)) entry.verbAfter = true;
          if (run.inList) entry.inList = true;
        }
      }
    }
  }
  // A campaign name can name a performer ("[IRW0001] Adam Ten - Signups"). An ad-set name is an
  // audience ("Jamie Jones & Paradise Lookalikes"), so it only corroborates a name the copy has.
  const inCampaign = new Set<string>();
  for (const name of event.campaignNames) {
    for (const found of namesInCampaignName(name)) {
      inCampaign.add(nameKey(found));
      touch(found, "campaign_name");
    }
  }
  for (const name of event.adSetNames) for (const found of namesInCampaignName(name)) inCampaign.add(nameKey(found));

  const candidates: Candidate[] = [];
  const rejected: Rejected[] = [];
  const alreadyLinked: string[] = [];
  for (const [key, entry] of knownSeen) {
    if (seen.has(key)) continue;
    const spelled = knownNames.find((item) => nameKey(item.name) === key)?.name ?? key;
    rejected.push({ name: spelled, reason: entry.kind, ads: entry.ads.size });
  }
  for (const [key, entry] of seen) {
    const name = preferredCasing(entry.casing);
    const ads = entry.ads.size;
    if (linked.has(key)) {
      alreadyLinked.push(name);
      continue;
    }
    const isLineup = entry.sources.has("lineup");
    const isKnown = known.has(key);
    const isEventName = eventNames.has(key);
    const why = isLineup ? null : excluded(name, world, event);
    if (why) {
      rejected.push({ name, reason: why, ads });
      continue;
    }
    const oneWord = !key.includes(" ");
    if (!isLineup && !isKnown) {
      const campaignOnly = ads === 0;
      if (!isEventName && ABBREVIATION.test(name)) {
        if (initials.has(key)) {
          rejected.push({ name, reason: "initials of the event, client or venue", ads });
          continue;
        }
        if (ads === 0 || !(entry.inList || entry.verbAfter)) {
          rejected.push({ name, reason: "abbreviation" + (ads > 0 ? " with no list or lineup verb around it" : ""), ads });
          continue;
        }
      }
      if (campaignOnly && !isEventName && oneWord) {
        rejected.push({ name, reason: "one word only in a campaign name", ads });
        continue;
      }
      if (ads > 0 && ads < MIN_COPY_ADS && !inCampaign.has(key) && !isEventName) {
        rejected.push({ name, reason: `in ${ads} ad${ads === 1 ? "" : "s"}, fewer than ${MIN_COPY_ADS}`, ads });
        continue;
      }
      if (ads > 0 && !inCampaign.has(key) && !isEventName && !entry.inList && !entry.verbAfter && ads / totalAds < MIN_COPY_SHARE) {
        rejected.push({ name, reason: "mentioned in passing", ads });
        continue;
      }
      if (ads > 0 && oneWord && !entry.inList && !entry.verbAfter && !inCampaign.has(key) && !isEventName) {
        rejected.push({ name, reason: entry.midSegment ? "one word with no list or lineup verb around it" : "one word that only opens a sentence", ads });
        continue;
      }
    }
    const sources = [...entry.sources].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    candidates.push({
      name,
      sources,
      ads,
      inCampaignName: inCampaign.has(key),
      isHeadliner: headliners.has(key) || isEventName,
      known: isKnown,
      needsConfirmation: !isLineup && !isKnown,
    });
  }
  candidates.sort(
    (a, b) => Number(b.sources.includes("lineup")) - Number(a.sources.includes("lineup")) || b.ads - a.ads || a.name.localeCompare(b.name),
  );
  rejected.sort((a, b) => b.ads - a.ads || a.name.localeCompare(b.name));
  return { eventId: event.eventId, candidates, rejected, alreadyLinked };
}

const ORDER: ArtistSource[] = ["lineup", "ad_copy", "campaign_name"];

/** The source written on event_artists: the strongest one the candidate has. */
export function primarySource(candidate: Pick<Candidate, "sources">): ArtistSource {
  for (const source of ORDER) if (candidate.sources.includes(source)) return source;
  return "campaign_name";
}

/** "Eli & Fur" that Spotify does not know → ["Eli", "Fur"]; a name with no "&" has no parts. */
export function compoundParts(name: string): string[] {
  if (!/\s&\s/.test(name)) return [];
  return name.split(/\s&\s/).map((part) => part.trim()).filter((part) => part.length >= 3);
}
