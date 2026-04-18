/**
 * lib/discovery-diversity.ts
 *
 * DISCOVERY-ONLY ranking refinement layer.
 *
 * Purpose
 *   Make persona/scene-driven suggestions look more like Meta Ads Manager's own
 *   suggestor: less repetitive, more cluster-specific, balanced across
 *   sub-families, and visibly different across clusters.
 *
 * Three independent passes (apply in this order, all post-verification):
 *
 *   1. applyClusterAnchorBias(rows, clusterLabel)
 *        - Boosts rows that match the cluster's anchor concepts.
 *        - Penalises rows matching the cluster's downrank patterns
 *          (unless they already have very high relevance — strong support).
 *        - Annotates each row with `diversityReason` for diagnostics.
 *
 *   2. applySemanticFamilyPenalty(rows)
 *        - Groups rows into shallow semantic families (e.g. "fitness",
 *          "fashion-magazine", "house-genre"). After the first row from a
 *          family lands in the picked list, each subsequent same-family row
 *          gets a stacking penalty so they cannot crowd the top slice.
 *
 *   3. applyCrossClusterDifferentiation(allClusters)
 *        - When the same Meta interest ID lands in multiple clusters, it gets
 *          demoted in every cluster except the one where its anchor match is
 *          strongest (or, on tie, the cluster with the highest relevance).
 *
 * NOT used in launch-mode sanitisation. Launch keeps full strictness.
 */

// ── Cluster identity constants ─────────────────────────────────────────────────

export const CLUSTER_MUSIC = "Music & Nightlife";
export const CLUSTER_FASHION = "Fashion & Streetwear";
export const CLUSTER_LIFESTYLE = "Lifestyle & Nightlife";
export const CLUSTER_ACTIVITIES = "Activities & Culture";
export const CLUSTER_MEDIA = "Media & Entertainment";
export const CLUSTER_SPORTS = "Sports & Live Events";

// ── Anchor & downrank tables ───────────────────────────────────────────────────
//
// Each pattern is matched against the lowercased name + path.
// Anchor = +ANCHOR_BOOST.    Downrank = -DOWNRANK_PENALTY (unless strongly supported).
// "Strongly supported" means the row's existing relevance score is already
// well above the cluster median — only obvious downrank candidates get dinged.
//
// Keep entries SHORT and BROAD — these are coarse safety filters, not ML.

export const ANCHOR_BOOST = 18;
export const DOWNRANK_PENALTY = -22;
export const SAME_FAMILY_PENALTY = -8;
export const CROSS_CLUSTER_PENALTY = -14;

interface ClusterRules {
  anchors: RegExp[];
  downranks: RegExp[];
  /** Optional human-readable name for diagnostics */
  anchorTags: Record<string, string>;
}

export const CLUSTER_RULES: Record<string, ClusterRules> = {
  [CLUSTER_MUSIC]: {
    anchors: [
      /\b(nightclub|nightlife|clubbing|club\s+culture|after.?party|raver|rave\b)\b/i,
      /\b(festival|tomorrowland|coachella|glastonbury|burning\s*man|edc|creamfields|parklife|sonar|sónar|dekmantel|awakenings|field\s*day|movement\s*festival|houghton)\b/i,
      /\b(disc\s*jockey|dj\b|djing|record\s*label|sound\s*system|underground\s*music|underground\s*dance)\b/i,
      /\b(berghain|fabric\s*nightclub|panorama\s*bar|tresor|amnesia|pacha|ushua[iï]a|space\s*ibiza)\b/i,
      /\b(techno\s*music|house\s*music|tech.?house|deep.?house|drum.?and.?bass|jungle\s*music|psytrance|psy.?trance|trance\s*music|garage|edm|electronic\s*dance|electronic\s*music)\b/i,
      /\b(boiler\s*room|resident\s*advisor|mixmag|dj\s*mag|nts\s*radio|rinse\s*fm)\b/i,
    ],
    downranks: [
      /\b(rock\s*music\b(?!.*festival)|country\s*music|jazz\s*music|orchestra|opera|musical\s*theatre|choral)\b/i,
      /\b(pop\s*music$|adult\s*contemporary|easy\s*listening|christian\s*music|gospel)\b/i,
    ],
    anchorTags: {
      "nightclub|nightlife|clubbing": "nightlife",
      "festival|tomorrowland|coachella": "festival",
      "dj|disc\\s*jockey|record\\s*label": "dj_label",
      "berghain|fabric|panorama|tresor": "venue",
      "techno|house|trance|garage|edm": "dance_genre",
      "boiler\\s*room|resident\\s*advisor": "scene_media",
    },
  },

  [CLUSTER_FASHION]: {
    anchors: [
      /\b(street\s*fashion|streetwear|sneaker|sneakerhead|hypebeast|highsnobiety|designer\s*clothing|luxury\s*goods|luxury\s*fashion|fashion\s*design)\b/i,
      /\b(runway|haute\s*couture|fashion\s*week|fashion\s*magazine|editorial\s*fashion)\b/i,
      /\b(rick\s*owens|maison\s*margiela|comme\s*des\s*gar[çc]ons|raf\s*simons|balenciaga|gucci|prada|chanel|dior|louis\s*vuitton|fendi|saint\s*laurent|bottega\s*veneta|givenchy|vetements|ann\s*demeulemeester|yohji\s*yamamoto|helmut\s*lang)\b/i,
      /\b(supreme|stussy|stüssy|palace\s*skateboards|off.?white|fear\s*of\s*god|carhartt\s*wip|kith|aime\s*leon\s*dore|bape|bathing\s*ape|nigo)\b/i,
      /\b(nike|adidas|new\s*balance|jordan\b|yeezy|salomon\b|asics)\b/i,
      /\b(vogue|dazed|i.?d\s*(magazine|mag)|another\s*magazine|metal\s*magazine|032c|the\s*face|highsnobiety|complex\s*magazine)\b/i,
    ],
    downranks: [
      /\b(business\s*casual|formalwear|wedding\s*dress|bridal|maternity|kid'?s\s*fashion|toddler|baby\s*clothing)\b/i,
      /\b(hair\s*care|cosmetics|nail\s*polish|skincare|makeup|beauty\s*products)\b/i,
    ],
    anchorTags: {
      "streetwear|street\\s*fashion|sneaker": "streetwear",
      "luxury|designer\\s*clothing|haute\\s*couture": "luxury_designer",
      "vogue|dazed|i.?d|another|metal|032c": "fashion_media",
      "nike|adidas|jordan|yeezy": "sneaker_brand",
      "rick\\s*owens|margiela|raf\\s*simons|balenciaga|gucci|prada": "designer_house",
    },
  },

  [CLUSTER_LIFESTYLE]: {
    anchors: [
      /\b(nightlife|nightclub|going\s*out|partygoer|bar\b|cocktail|cocktails|natural\s*wine|craft\s*beer|brewery)\b/i,
      /\b(travel|city\s*break|weekend\s*break|boutique\s*hotel|airbnb|backpacking|wanderlust)\b/i,
      /\b(food\s*and\s*drink|restaurant|fine\s*dining|street\s*food|brunch|wine\s*tasting|coffee\s*culture|specialty\s*coffee)\b/i,
      /\b(subculture|alt\s*lifestyle|underground\s*community|queer\s*nightlife|lgbtq|drag|tattoo|piercing|vinyl\s*records)\b/i,
      /\b(slow\s*living|conscious\s*lifestyle|sustainable\s*lifestyle|urban\s*living|city\s*guide|time\s*out|monocle|vice\b)\b/i,
      /\b(festival|art\s*fair|gallery|exhibition|live\s*music|live\s*event)\b/i,
    ],
    downranks: [
      /\b(crossfit|powerlifting|weightlifting|weight\s*training|bodybuilding|boxing\s*fitness|kickboxing)\b/i,
      /\b(running\s*races|marathon|triathlon|cycling\s*sport|spinning|peloton)\b/i,
      /\b(gym\s*chain|fitness\s*chain|fitness\s*influencer|protein\s*shake|supplement)\b/i,
      /\b(parenting|toddler|stay.?at.?home|homeschool|housewife)\b/i,
    ],
    anchorTags: {
      "nightlife|cocktail|bar|brewery": "going_out",
      "travel|city\\s*break|boutique\\s*hotel": "travel",
      "restaurant|street\\s*food|brunch|coffee": "food_drink",
      "subculture|queer|lgbtq|tattoo|vinyl": "subculture",
      "slow\\s*living|conscious|sustainable|monocle|vice": "boutique_lifestyle",
    },
  },

  [CLUSTER_ACTIVITIES]: {
    anchors: [
      /\b(art\s*gallery|gallery|art\s*museum|museum|contemporary\s*art|modern\s*art|fine\s*art|art\s*collector)\b/i,
      /\b(art\s*fair|frieze|art\s*basel|venice\s*biennale|documenta|fri[ée]ze|moma|tate|guggenheim|serpentine)\b/i,
      /\b(exhibition|public\s*art|installation\s*art|street\s*art|sculpture|photography\s*exhibition|art\s*photography)\b/i,
      /\b(architecture|interior\s*design|product\s*design|industrial\s*design|graphic\s*design|design\s*museum|design\s*week)\b/i,
      /\b(immersive\s*experience|performance\s*art|cultural\s*venue|cultural\s*centre|theatre|opera\s*house|ballet)\b/i,
      /\b(film\s*festival|cinema|independent\s*film|art\s*house\s*cinema|literary\s*festival|book\s*fair|poetry)\b/i,
    ],
    downranks: [
      /\b(home\s*improvement|gardening|cooking\s*at\s*home|recipe|baking|knitting|crafts|diy)\b/i,
      /\b(parenting|toddler|family\s*activities|kids\s*activities)\b/i,
      /\b(gym|fitness|crossfit|weight\s*training|cardio)\b/i,
    ],
    anchorTags: {
      "gallery|museum|contemporary\\s*art|modern\\s*art": "gallery_museum",
      "art\\s*fair|frieze|art\\s*basel|venice\\s*biennale": "art_fair",
      "exhibition|public\\s*art|installation|sculpture": "exhibition",
      "architecture|design\\s*museum|design\\s*week|interior\\s*design": "design",
      "immersive|performance\\s*art|cultural\\s*venue|theatre|opera": "cultural_venue",
    },
  },

  [CLUSTER_MEDIA]: {
    anchors: [
      /\b(music\s*magazine|music\s*publication|music\s*media|music\s*journalism|music\s*critic|music\s*blog)\b/i,
      /\b(radio\s*station|internet\s*radio|community\s*radio|nts\s*radio|rinse\s*fm|kcrw|bbc\s*radio\s*[1-6])\b/i,
      /\b(podcast|podcasting|podcast\s*network|streaming\s*platform|streaming\s*service|spotify|apple\s*music|tidal|deezer|soundcloud|bandcamp|youtube\s*music|mixcloud)\b/i,
      /\b(mixmag|dj\s*mag|resident\s*advisor|fact\s*magazine|the\s*quietus|crack\s*magazine|wire\s*magazine|pitchfork|rolling\s*stone)\b/i,
      /\b(playlist\s*culture|music\s*discovery|tastemaker|music\s*curator|editorial\s*media)\b/i,
    ],
    downranks: [
      /\b(daytime\s*tv|reality\s*tv|morning\s*show|talk\s*show|sitcom)\b/i,
      /\b(sports\s*broadcasting|news\s*channel)\b/i,
      /\b(entertainment\s*\(media\s*and\s*entertainment\)|entertainment\s+industry)\b/i,
    ],
    anchorTags: {
      "magazine|publication|journalism|critic|blog": "publication",
      "radio|fm|nts|kcrw": "radio",
      "podcast|streaming|spotify|apple\\s*music|tidal|soundcloud|bandcamp|mixcloud": "streaming",
      "mixmag|dj\\s*mag|resident\\s*advisor|fact|quietus|wire|pitchfork": "music_press",
      "playlist|tastemaker|curator": "tastemaker",
    },
  },

  [CLUSTER_SPORTS]: {
    // Sports has its own dedicated entity-recovery / gym-first pipeline; the
    // diversity layer here is intentionally minimal so we don't perturb it.
    anchors: [
      /\b(premier\s*league|champions\s*league|world\s*cup|nba|nfl|mlb|formula\s*1|f1\b|moto\s*gp|olympics)\b/i,
      /\b(football\s*fans|soccer\s*fans|sports\s*fans|sports\s*bar|fan\s*zone|live\s*events)\b/i,
    ],
    downranks: [
      /\b(parenting|toddler|stay.?at.?home)\b/i,
    ],
    anchorTags: {
      "premier\\s*league|champions\\s*league|world\\s*cup": "competition",
      "football\\s*fans|sports\\s*fans|fan\\s*zone": "fan_identity",
    },
  },
};

// ── Semantic family index ─────────────────────────────────────────────────────
//
// Used by applySemanticFamilyPenalty to detect near-duplicate / same-narrow-
// scene rows. Each row resolves to AT MOST one family per pass, and only the
// 1st row in a family escapes the penalty.

const FAMILY_PATTERNS: Array<{ family: string; pattern: RegExp }> = [
  // Music
  { family: "house_genre",       pattern: /\b(house\s*music|deep.?house|tech.?house|vocal\s*house|progressive\s*house|electro\s*house|tribal\s*house)\b/i },
  { family: "techno_genre",      pattern: /\b(techno\s*music|hard\s*techno|minimal\s*techno|industrial\s*techno|melodic\s*techno)\b/i },
  { family: "trance_genre",      pattern: /\b(trance\s*music|psytrance|psy.?trance|goa\s*trance|hard\s*trance|uplifting\s*trance)\b/i },
  { family: "festival_named",    pattern: /\b(coachella|tomorrowland|glastonbury|lollapalooza|burning\s*man|edc|creamfields|parklife|sonar|sónar|dekmantel|awakenings|field\s*day|houghton|bonnaroo)\b/i },
  { family: "music_publication", pattern: /\b(mixmag|dj\s*mag|resident\s*advisor|fact\s*magazine|the\s*quietus|crack\s*magazine|wire\s*magazine|nts\s*radio|rinse\s*fm)\b/i },
  // Fitness (Lifestyle downrank family)
  { family: "fitness_strength",  pattern: /\b(crossfit|powerlifting|weightlifting|weight\s*training|bodybuilding|gym\b)\b/i },
  { family: "fitness_endurance", pattern: /\b(running\s*races|marathon|triathlon|cycling\s*sport|spinning|peloton)\b/i },
  { family: "fitness_combat",    pattern: /\b(boxing|mma|mixed\s*martial\s*arts|kickboxing|jiu.?jitsu|muay\s*thai|wrestling)\b/i },
  // Fashion
  { family: "luxury_house",      pattern: /\b(gucci|prada|chanel|dior|louis\s*vuitton|fendi|saint\s*laurent|bottega\s*veneta|givenchy|hermes|hermès|burberry)\b/i },
  { family: "designer_avant",    pattern: /\b(rick\s*owens|maison\s*margiela|comme\s*des\s*gar[çc]ons|raf\s*simons|ann\s*demeulemeester|yohji\s*yamamoto|helmut\s*lang|vetements)\b/i },
  { family: "streetwear_brand",  pattern: /\b(supreme|stussy|stüssy|palace\s*skateboards|off.?white|fear\s*of\s*god|carhartt\s*wip|kith|aime\s*leon\s*dore|bape|bathing\s*ape)\b/i },
  { family: "sneaker_brand",     pattern: /\b(nike|adidas|new\s*balance|jordan\b|yeezy|salomon|asics|puma\s*\(|reebok)\b/i },
  { family: "fashion_magazine",  pattern: /\b(vogue|dazed|i.?d\s*magazine|another\s*magazine|metal\s*magazine|032c|the\s*face|complex\s*magazine|highsnobiety)\b/i },
  // Lifestyle / Activities
  { family: "art_fair",          pattern: /\b(frieze|art\s*basel|venice\s*biennale|documenta|art\s*fair)\b/i },
  { family: "art_museum",        pattern: /\b(museum|moma|tate|guggenheim|whitney|pompidou|serpentine|hayward\s*gallery)\b/i },
  { family: "design_culture",    pattern: /\b(architecture|interior\s*design|product\s*design|industrial\s*design|graphic\s*design|design\s*week)\b/i },
  { family: "food_drink",        pattern: /\b(restaurant|fine\s*dining|street\s*food|brunch|coffee\s*culture|natural\s*wine|cocktail|brewery|craft\s*beer)\b/i },
  { family: "travel_hospitality",pattern: /\b(travel|city\s*break|boutique\s*hotel|airbnb|backpacking|wanderlust|hospitality)\b/i },
  // Media
  { family: "streaming_service", pattern: /\b(spotify|apple\s*music|tidal|deezer|soundcloud|bandcamp|youtube\s*music|mixcloud)\b/i },
  { family: "broadcast_radio",   pattern: /\b(radio\s*station|internet\s*radio|community\s*radio|kcrw|bbc\s*radio\s*[1-6]|nts\s*radio|rinse\s*fm)\b/i },
  // Sports
  { family: "football_competition", pattern: /\b(premier\s*league|champions\s*league|europa\s*league|world\s*cup|la\s*liga|serie\s*a|bundesliga|ligue\s*1)\b/i },
];

export interface DiversityRow {
  id: string;
  name: string;
  path?: string[];
  relevanceScore?: number;
  matchReason?: string;
  /** Annotated by applyClusterAnchorBias / applySemanticFamilyPenalty. */
  diversityReason?: string;
  /** Annotated when the row matches a downrank pattern (and was not strongly supported). */
  downranked?: boolean;
  /** Annotated when the row matches an anchor pattern. */
  anchorMatched?: string;
  /** Annotated when the row was demoted by the same-family penalty. */
  semanticFamily?: string;
  /** Annotated when the row was demoted by cross-cluster overlap. */
  crossClusterDemoted?: boolean;
}

// ── Pass 1: cluster anchor bias ────────────────────────────────────────────────

/**
 * Boost rows that match the cluster's anchors; penalise rows matching the
 * downrank patterns. Both passes are additive — they only adjust
 * relevanceScore and tag the row, never remove anything.
 *
 * "Strongly supported" downrank rows (relevanceScore already in the top
 * quartile of the pool) are NOT penalised — these are likely intentional.
 */
export function applyClusterAnchorBias<T extends DiversityRow>(
  rows: T[],
  clusterLabel: string,
): {
  rows: T[];
  anchorMatchedNames: string[];
  downrankedNames: string[];
} {
  const rules = CLUSTER_RULES[clusterLabel];
  if (!rules || rows.length === 0) {
    return { rows, anchorMatchedNames: [], downrankedNames: [] };
  }

  // Strong-support threshold: top-quartile relevance among current pool.
  const sortedScores = rows
    .map((r) => r.relevanceScore ?? 0)
    .sort((a, b) => b - a);
  const q3Index = Math.max(0, Math.floor(sortedScores.length * 0.25) - 1);
  const strongSupport = sortedScores[q3Index] ?? 0;

  const anchorNames: string[] = [];
  const downrankNames: string[] = [];

  for (const row of rows) {
    const haystack = `${row.name} ${(row.path ?? []).join(" ")}`.toLowerCase();
    let anchorTag: string | null = null;
    for (const [tagKey, tagName] of Object.entries(rules.anchorTags)) {
      if (new RegExp(tagKey, "i").test(haystack)) {
        anchorTag = tagName;
        break;
      }
    }
    if (!anchorTag) {
      // Fall through to the broader anchor patterns
      for (const pat of rules.anchors) {
        if (pat.test(haystack)) {
          anchorTag = "anchor_match";
          break;
        }
      }
    }
    if (anchorTag) {
      row.relevanceScore = (row.relevanceScore ?? 0) + ANCHOR_BOOST;
      row.matchReason = `${row.matchReason ?? ""};anchor:${anchorTag}`;
      row.anchorMatched = anchorTag;
      row.diversityReason = `anchor:${anchorTag}`;
      anchorNames.push(row.name);
      continue;
    }

    // Downrank check (only if not strongly supported)
    for (const pat of rules.downranks) {
      if (pat.test(haystack)) {
        const isStronglySupported = (row.relevanceScore ?? 0) >= strongSupport + 12;
        if (!isStronglySupported) {
          row.relevanceScore = (row.relevanceScore ?? 0) + DOWNRANK_PENALTY;
          row.matchReason = `${row.matchReason ?? ""};downrank-cluster`;
          row.downranked = true;
          row.diversityReason = "downrank";
          downrankNames.push(row.name);
        }
        break;
      }
    }
  }

  return { rows, anchorMatchedNames: anchorNames, downrankedNames: downrankNames };
}

// ── Pass 2: semantic-family penalty (post-sort) ────────────────────────────────

/**
 * Walk the score-sorted rows. The first row in each semantic family keeps its
 * score; every subsequent row in the same family gets a stacking penalty
 * (-SAME_FAMILY_PENALTY per prior member). Cap at 3× to avoid death spirals.
 *
 * Mutates rows in place; caller is responsible for re-sorting.
 */
export function applySemanticFamilyPenalty<T extends DiversityRow>(
  rows: T[],
): { demotedNames: string[]; familyCounts: Record<string, number> } {
  if (rows.length === 0) return { demotedNames: [], familyCounts: {} };

  const sorted = [...rows].sort(
    (a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0),
  );
  const familyCounts: Record<string, number> = {};
  const demoted: string[] = [];

  for (const row of sorted) {
    const haystack = `${row.name} ${(row.path ?? []).join(" ")}`.toLowerCase();
    let family: string | null = null;
    for (const { family: f, pattern } of FAMILY_PATTERNS) {
      if (pattern.test(haystack)) {
        family = f;
        break;
      }
    }
    if (!family) continue;

    row.semanticFamily = family;
    const priorCount = familyCounts[family] ?? 0;
    if (priorCount > 0) {
      const stack = Math.min(priorCount, 3);
      row.relevanceScore = (row.relevanceScore ?? 0) + SAME_FAMILY_PENALTY * stack;
      row.matchReason = `${row.matchReason ?? ""};family-${family}-${stack}x`;
      row.diversityReason = `family-dup:${family}`;
      demoted.push(row.name);
    }
    familyCounts[family] = priorCount + 1;
  }

  return { demotedNames: demoted, familyCounts };
}

// ── Pass 3: cross-cluster differentiation ─────────────────────────────────────

/**
 * Apply cross-cluster differentiation across the FULL multi-cluster output.
 * For any Meta interest ID that appears in more than one cluster:
 *   - The cluster where the row has the strongest anchor match (or, on tie,
 *     the highest relevance score) keeps the row at full strength.
 *   - Every other cluster's copy of that row gets -CROSS_CLUSTER_PENALTY and
 *     is tagged crossClusterDemoted.
 *
 * This makes Activities & Culture not look like Lifestyle, etc.
 *
 * Mutates rows in place; caller is responsible for re-sorting per cluster.
 */
export function applyCrossClusterDifferentiation<T extends DiversityRow>(
  byCluster: Record<string, T[]>,
): { demotionsByCluster: Record<string, string[]> } {
  const clusterLabels = Object.keys(byCluster);
  if (clusterLabels.length < 2) return { demotionsByCluster: {} };

  // Build id → list of (clusterLabel, row) entries
  const idToOccurrences = new Map<
    string,
    Array<{ cluster: string; row: T }>
  >();
  for (const cluster of clusterLabels) {
    for (const row of byCluster[cluster]) {
      const list = idToOccurrences.get(row.id) ?? [];
      list.push({ cluster, row });
      idToOccurrences.set(row.id, list);
    }
  }

  const demotions: Record<string, string[]> = {};
  for (const [, occurrences] of idToOccurrences.entries()) {
    if (occurrences.length < 2) continue;

    // Pick the "winner" cluster: highest (anchorMatched ? 1 : 0) then highest relevance.
    const winner = occurrences.reduce((best, cur) => {
      const bestAnchor = best.row.anchorMatched ? 1 : 0;
      const curAnchor = cur.row.anchorMatched ? 1 : 0;
      if (curAnchor !== bestAnchor) return curAnchor > bestAnchor ? cur : best;
      return (cur.row.relevanceScore ?? 0) > (best.row.relevanceScore ?? 0) ? cur : best;
    });

    for (const occ of occurrences) {
      if (occ === winner) continue;
      occ.row.relevanceScore = (occ.row.relevanceScore ?? 0) + CROSS_CLUSTER_PENALTY;
      occ.row.matchReason = `${occ.row.matchReason ?? ""};cross-cluster-demote`;
      occ.row.crossClusterDemoted = true;
      occ.row.diversityReason = "cross-cluster";
      (demotions[occ.cluster] ??= []).push(occ.row.name);
    }
  }

  return { demotionsByCluster: demotions };
}

// ── Result mix tagging (informational only) ───────────────────────────────────

export type MixTier = "exact" | "adjacent" | "broader";

/**
 * Lightly classify each row as exact / adjacent / broader for diagnostics
 * and for the result-mix log line. Does NOT change scores.
 */
export function tagResultMix<T extends DiversityRow>(
  rows: T[],
  clusterLabel: string,
): Record<MixTier, number> {
  const counts: Record<MixTier, number> = { exact: 0, adjacent: 0, broader: 0 };
  for (const row of rows) {
    const tier: MixTier = row.anchorMatched
      ? "exact"
      : row.semanticFamily
        ? "adjacent"
        : "broader";
    counts[tier]++;
    row.matchReason = `${row.matchReason ?? ""};mix-${tier}`;
  }
  // Suppress unused-clusterLabel warning if we ever stop using it
  void clusterLabel;
  return counts;
}
