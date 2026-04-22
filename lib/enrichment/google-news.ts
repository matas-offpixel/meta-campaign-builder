import "server-only";

/**
 * lib/enrichment/google-news.ts
 *
 * Tiny RSS reader for Google News Search. No API key required.
 * We bias the results to en-GB / GB locale so Matas's events surface
 * UK press first, with international hits as a tiebreaker.
 *
 * The RSS parser is intentionally inline (no xml2js, no fast-xml-parser)
 * because the format we care about is dead simple: a flat list of
 * `<item>` blocks with `<title>`, `<link>`, `<pubDate>`, and a
 * `<source>` element. Anything more exotic (CDATA, namespaces) is
 * either ignored or matched by a tolerant regex — we'd rather miss
 * a row than crash the whole route.
 */

const GOOGLE_NEWS_RSS = "https://news.google.com/rss/search";

export interface NewsItem {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string;
}

interface SearchOptions {
  lookbackDays?: number;
  limit?: number;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripCdata(s: string): string {
  // The `s` (dotAll) flag isn't available at our TS target — use
  // [\s\S] instead so this works without bumping the lib target.
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return m ? m[1] : s;
}

function pickTag(block: string, tag: string): string | null {
  // Tag values may or may not be CDATA-wrapped. We grab everything
  // between the opening and closing tag and post-process.
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  return decodeHtmlEntities(stripCdata(m[1].trim()));
}

function pickSource(block: string): string | null {
  // <source url="...">BBC News</source>
  const m = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
  if (!m) return null;
  return decodeHtmlEntities(stripCdata(m[1].trim())) || null;
}

export async function searchNews(
  q: string,
  opts: SearchOptions = {},
): Promise<NewsItem[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const lookbackDays = Math.max(opts.lookbackDays ?? 30, 1);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);

  const url = new URL(GOOGLE_NEWS_RSS);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("hl", "en-GB");
  url.searchParams.set("gl", "GB");
  url.searchParams.set("ceid", "GB:en");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "offpixel-dashboard/1.0 (matt.liebus@gmail.com)" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Google News RSS failed: HTTP ${res.status}`);
  }
  const xml = await res.text();

  // Split on <item> blocks. The Google News feed wraps every entry
  // in a top-level <item>, no nesting, so the naive split is safe.
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const items: NewsItem[] = [];
  let m: RegExpExecArray | null;
  const cutoff = Date.now() - lookbackDays * 86_400_000;
  const seenUrls = new Set<string>();

  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = pickTag(block, "title");
    const link = pickTag(block, "link");
    const pubDate = pickTag(block, "pubDate");
    if (!title || !link || !pubDate) continue;
    const ts = Date.parse(pubDate);
    if (Number.isNaN(ts) || ts < cutoff) continue;
    if (seenUrls.has(link)) continue;
    seenUrls.add(link);
    items.push({
      title,
      url: link,
      source: pickSource(block),
      publishedAt: new Date(ts).toISOString(),
    });
  }

  // Recency-sorted, capped at `limit`.
  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return items.slice(0, limit);
}
