/**
 * lib/d2c/mailchimp/templates/builder.ts
 *
 * Pure, deterministic builder: MailchimpTemplateDefinition → email-safe HTML.
 * Uses table layout + inline styles for Outlook/Gmail compatibility. Merge
 * tags (*|VAR|*) are emitted verbatim so Mailchimp / send-time substitution
 * can fill them.
 *
 * No side effects, no network — trivially unit-testable.
 */

import type { MailchimpTemplateDefinition } from "./types.ts";

/** HTML-escape static copy. Merge tags contain only [A-Z0-9_|*] so survive intact. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface BuiltTemplate {
  name: string;
  subject: string;
  preheader: string;
  html: string;
}

export function buildTemplateHtml(def: MailchimpTemplateDefinition, theme: {
  bgColor: string;
  fgColor: string;
  logoUrl: string;
  ctaBg: string;
  ctaColor: string;
  footerImageUrl?: string;
}): BuiltTemplate {
  const preheader = def.preheader ?? def.headline;

  const artworkBlock = def.showArtwork
    ? `
          <tr>
            <td style="padding:0;">
              <img src="*|ARTWORK_URL|*" alt="${esc(def.headline)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
            </td>
          </tr>`
    : "";

  const paragraphs = def.paragraphs
    .map(
      (p) =>
        `
              <p style="margin:0 0 16px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:${theme.fgColor};">${esc(p)}</p>`,
    )
    .join("");

  const ctaBlock = def.cta
    ? `
          <tr>
            <td align="center" style="padding:8px 24px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="center" bgcolor="${theme.ctaBg}" style="border-radius:4px;">
                  <a href="${esc(def.cta.url)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;color:${theme.ctaColor};text-decoration:none;">${esc(def.cta.label)}</a>
                </td>
              </tr></table>
            </td>
          </tr>`
    : "";

  const footerImg = theme.footerImageUrl
    ? `
          <tr>
            <td style="padding:0;">
              <img src="${esc(theme.footerImageUrl)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
            </td>
          </tr>`
    : "";

  const footerNote = def.footerNote
    ? `<p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.4;color:${theme.fgColor};opacity:0.75;">${esc(def.footerNote)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${esc(def.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${theme.bgColor};">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${theme.bgColor};">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${theme.bgColor};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          <tr>
            <td align="center" style="padding:8px 24px 20px;">
              <img src="${esc(theme.logoUrl)}" alt="logo" height="40" style="display:block;height:40px;width:auto;border:0;" />
            </td>
          </tr>${artworkBlock}
          <tr>
            <td style="padding:24px 24px 8px;">
              <h1 style="margin:0 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:1.2;font-weight:800;color:${theme.fgColor};">${esc(def.headline)}</h1>${paragraphs}
            </td>
          </tr>${ctaBlock}${footerImg}
          <tr>
            <td style="padding:20px 24px 8px;">
              ${footerNote}
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.4;color:${theme.fgColor};opacity:0.75;">*|EVENT_VENUE|* · *|EVENT_CITY|*</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { name: def.name, subject: def.subject, preheader, html };
}
