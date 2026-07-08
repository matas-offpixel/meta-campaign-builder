/**
 * lib/d2c/render/email-html.ts
 *
 * Bug D fix (2026-07-08): extracted from the email branch of
 * components/dashboard/d2c/send-preview.tsx so the dashboard preview and the
 * REAL/test-send Mailchimp campaign HTML are byte-identical. Previously
 * `lib/d2c/mailchimp/provider.ts` shipped bare `markdownToBasicHtml(bodyMd)`
 * for the actual campaign content — none of the hero artwork, dark chassis,
 * or CTA button the preview showed ever reached a fan's inbox (live-verified
 * via PR #698's test-send: the [TEST] email arrived as plain text).
 *
 * No server-only import — safe to call from both the RSC-free dashboard
 * client component (preview) and server-side send paths (provider.ts,
 * the test-send route).
 *
 * Rendering choices (documented per the ask to justify the approach):
 *   - Table-based layout + inline styles throughout, for broad email-client
 *     compatibility (Gmail, Apple Mail, Outlook.com web all render this
 *     correctly without a <style> block, which many clients strip).
 *   - Body paragraph formatting (bold/italic/links) relies on
 *     `markdownToBasicHtml`'s own inline `<strong>`/`<em>`/`<a>` tags plus
 *     CSS INHERITANCE from the containing `<td>` for color/font/line-height,
 *     rather than re-styling every `<p>` individually — the same pattern
 *     Mailchimp's own campaign builder uses. Outlook DESKTOP (the Word
 *     rendering engine) is a known, accepted gap: Off Pixel's own test-sends
 *     and client review happen in Gmail / Apple Mail, and no client email
 *     provider used by this codebase is Outlook desktop.
 *   - No JS-powered "broken image" fallback for `artworkUrl` (unlike the old
 *     React preview's `onError` handler) — a real recipient's email client
 *     gets no such fallback either, so byte-for-byte preview/send parity
 *     wins over preview-only polish.
 */

import { isIntroParagraph, splitMarkdownParagraphs } from "../dashboard-view.ts";
import { markdownToBasicHtml, substituteTemplateVariables } from "../event-variables.ts";

export interface RenderD2CEmailHtmlInput {
  /** Raw (pre-substitution) subject — rendered as an in-body eyebrow line,
   *  matching the dashboard preview. This is NOT the Mailchimp campaign's
   *  `settings.subject_line` header (set separately by the caller). */
  subject: string | null;
  /** Raw (pre-substitution) markdown body. */
  bodyMarkdown: string;
  /** Resolved {{token}} → value map, applied to subject / body / buttonUrl. */
  variables: Record<string, string>;
  artworkUrl: string | null;
  eventName: string;
  buttonLabel: string | null;
  buttonUrl: string | null;
  /** Defaults to Throwback pink (#c81c68) — the only theme in use today;
   *  no client carries a stored theme colour yet. */
  themeColor?: string | null;
}

const DEFAULT_THEME = "#c81c68";
const FOOTER_NOTE = "Síguenos para saber más…";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Auto-bold a single-line intro paragraph (Throwback London reference).
 * Ported verbatim from the old SendPreview.withIntroBold so preview/send
 * parity holds for this heuristic too — reuses the same
 * isIntroParagraph/splitMarkdownParagraphs pure seams dashboard-view.ts
 * already exports (single source of truth, no duplicated regex).
 */
function withIntroBold(body: string): string {
  const paras = splitMarkdownParagraphs(body);
  if (
    paras.length > 0 &&
    isIntroParagraph(paras[0]!) &&
    !paras[0]!.includes("\n") &&
    !paras[0]!.startsWith("**")
  ) {
    paras[0] = `**${paras[0]}**`;
    return paras.join("\n\n");
  }
  return body;
}

/**
 * Render the full branded email HTML a fan actually receives (or an operator
 * previews): hero artwork or a themed placeholder, a subject eyebrow line,
 * the body markdown, an optional CTA button (>=44px tap target), and a fixed
 * footer note. Pure — deterministic for the same input.
 */
export function renderD2CEmailHtml(input: RenderD2CEmailHtmlInput): string {
  const theme = input.themeColor?.trim() || DEFAULT_THEME;
  const subject = input.subject
    ? substituteTemplateVariables(input.subject, input.variables)
    : null;
  const body = substituteTemplateVariables(input.bodyMarkdown, input.variables);
  const bodyHtml = markdownToBasicHtml(withIntroBold(body));
  const buttonUrl = input.buttonUrl
    ? substituteTemplateVariables(input.buttonUrl, input.variables)
    : null;
  const hasButton = Boolean(input.buttonLabel && buttonUrl);

  const heroHtml = input.artworkUrl
    ? `<img src="${escapeHtml(input.artworkUrl)}" width="640" alt="${escapeHtml(input.eventName)}" style="display:block;width:100%;max-width:640px;height:auto;border:0;" />`
    : `<div style="background-color:${escapeHtml(theme)};padding:48px 24px;text-align:center;">` +
      `<p style="margin:0;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;">${escapeHtml(input.eventName)}</p>` +
      `</div>`;

  const subjectHtml = subject
    ? `<p style="margin:0 0 16px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">${escapeHtml(subject)}</p>`
    : "";

  const buttonHtml = hasButton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>` +
      `<td style="border-radius:4px;background-color:${escapeHtml(theme)};">` +
      `<a href="${escapeHtml(buttonUrl!)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 28px;line-height:16px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-decoration:none;">${escapeHtml(input.buttonLabel!)}</a>` +
      `</td></tr></table>`
    : "";

  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;padding:24px 0;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background-color:#1a1a1a;">` +
    `<tr><td>${heroHtml}</td></tr>` +
    `<tr><td style="padding:24px;color:#e5e5e5;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">` +
    `${subjectHtml}<div>${bodyHtml}</div>${buttonHtml}` +
    `<p style="margin:16px 0 0;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-size:12px;">${escapeHtml(FOOTER_NOTE)}</p>` +
    `</td></tr>` +
    `</table>` +
    `</td></tr>` +
    `</table>`
  );
}
