/**
 * lib/d2c/mailchimp/brand-clone.ts
 *
 * "Approach B": clone a brand template's rendered HTML and substitute
 * per-event content at structurally-identified anchors.
 *
 * Brand templates in this account are drag-and-drop builds with NO named
 * content sections (`default-content` returns `{"sections":{}}`), so content
 * cannot be injected through Mailchimp's own template API. Cloning the
 * rendered HTML of a campaign built from the template is the only way to keep
 * the brand look. See `docs/D2C_MAILCHIMP_ADAPTER_SCOPE.md`.
 *
 * ── Two anchors, both structural, neither positional ───────────────────────
 *
 * 1. **Poster** = the `<img>` whose enclosing `<a>` points at a ticket or
 *    community URL. NOT "the first .mcnImage": on `j26-HALLOWEEN` the first
 *    .mcnImage is a 1080x175 header strip, so position-based selection put the
 *    event poster in the banner slot and left the old poster visible.
 *
 * 2. **Text colour** = derived from the DEEPEST element that actually wraps
 *    the text, not from the `<p>`. On `j26-HALLOWEEN` the `<p>` carries
 *    `color:#FFFFFF`, so copying the `<p>` style happened to work. On
 *    `K26-HALLOWEEN V2` the `<p>` carries `color:#202020` (dark) and the white
 *    lives in a nested `<span style="color:#FFFFFF">` — copying the `<p>`
 *    style faithfully reproduced the WRONG colour and rendered dark text on
 *    the template's red background. Reading colour from whichever element
 *    happens to hold it in one template is luck, not preservation.
 *
 * So the transform reproduces the source's nesting: it captures the `<p>`
 * style AND the innermost coloured wrapper, and emits
 * `<p style="…"><span style="…">text</span></p>`.
 *
 * If no element at any depth carries a colour, `deriveTextStyles` throws
 * rather than blanket-applying white — a template we cannot read is a
 * template we must not guess at.
 */

/** Matches the CTA hrefs that mark the event-poster image. */
export const CTA_HREF_RE = /ra\.co\/events\/|app\.offpixel\.co\.uk\/j\/|chat\.whatsapp\.com\//;

export class BrandCloneError extends Error {
  readonly code = "D2C_MAILCHIMP_BRAND_CLONE_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "BrandCloneError";
  }
}

export interface TextStyles {
  /** Inline style of the source `<p>`. */
  paragraph: string;
  /** Tag name of the innermost coloured wrapper, e.g. "span". */
  innerTag: string | null;
  /** Inline style of that wrapper. */
  inner: string | null;
  /** The colour that will actually render, for assertions. */
  renderedColor: string;
}

function styleOf(tag: string): string {
  return /style="([^"]*)"/i.exec(tag)?.[1] ?? "";
}

export function colorIn(style: string): string | null {
  const m = /(?:^|[;\s])color\s*:\s*([^;]+)/i.exec(style);
  return m ? m[1].trim() : null;
}

/**
 * Read the paragraph style and the innermost coloured wrapper from a source
 * body block's inner HTML.
 *
 * @throws BrandCloneError when no colour is present at any nesting level.
 */
export function deriveTextStyles(blockInnerHtml: string): TextStyles {
  const pTag = /<p[^>]*>/i.exec(blockInnerHtml)?.[0];
  if (!pTag) throw new BrandCloneError("source body block has no <p> to derive text styles from");
  const paragraph = styleOf(pTag);

  // Walk inward through the wrappers the brand templates actually use. The
  // LAST one carrying a colour wins — that is what the reader sees.
  let innerTag: string | null = null;
  let inner: string | null = null;
  for (const tag of ["strong", "em", "span"]) {
    const re = new RegExp(`<${tag}[^>]*style="[^"]*"[^>]*>`, "i");
    const found = re.exec(blockInnerHtml)?.[0];
    if (!found) continue;
    const st = styleOf(found);
    if (colorIn(st)) { innerTag = tag; inner = st; }
  }

  const renderedColor = (inner && colorIn(inner)) || colorIn(paragraph) || "";
  if (!renderedColor) {
    throw new BrandCloneError(
      "no colour found on the <p> or any nested wrapper in the source body block — " +
        "refusing to guess a text colour (would blanket-apply white).",
    );
  }
  return { paragraph, innerTag, inner, renderedColor };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Render one paragraph reproducing the source's nesting, so the rendered
 * colour matches the source at the same depth.
 */
export function renderParagraph(text: string, st: TextStyles, opts: { bold?: boolean } = {}): string {
  const body = opts.bold ? `<strong>${esc(text)}</strong>` : esc(text);
  const wrapped = st.innerTag && st.inner
    ? `<${st.innerTag} style="${st.inner}">${body}</${st.innerTag}>`
    : body;
  return `<p dir="ltr" style="${st.paragraph}">${wrapped}</p>`;
}

/** Headline + paragraphs, all carrying the source's rendered colour. */
export function renderBodyBlock(headline: string, paragraphs: string[], st: TextStyles): string {
  return [
    renderParagraph(headline, st, { bold: true }),
    ...paragraphs.map((p) => renderParagraph(p, st)),
  ].join("\n");
}

/**
 * Assert the substituted block renders the same colour as the source block.
 * Presence-based: checks the new colour is there, not that the old one is gone.
 */
export function assertColorMatches(
  substitutedInnerHtml: string,
  expected: TextStyles,
): string[] {
  const problems: string[] = [];
  const derived = (() => {
    try { return deriveTextStyles(substitutedInnerHtml); } catch { return null; }
  })();
  if (!derived) {
    problems.push("substituted block has no derivable text colour");
    return problems;
  }
  const a = derived.renderedColor.toLowerCase().replace(/\s+/g, "");
  const b = expected.renderedColor.toLowerCase().replace(/\s+/g, "");
  if (a !== b) problems.push(`rendered colour ${derived.renderedColor} != source ${expected.renderedColor}`);
  return problems;
}
