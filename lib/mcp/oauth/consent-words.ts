/**
 * lib/mcp/oauth/consent-words.ts
 *
 * Every word on the MCP consent page (app/oauth/authorize), in one place
 * so the PR can list them for design's verdict and a test can pin them.
 */
export const CONSENT_WORDS = {
  title: "Connect Claude to Off/Pixel",
  readOnly: "It can read events, spend, signups, tickets, drafts and learnings. It can't change anything.",
  stays: "It stays connected until you disconnect it in Claude.",
  allow: "Allow",
  cancel: "Cancel",
  invalid: "This connection link isn't valid. Start again from Claude.",
  signedOut: "Sign in to Off/Pixel first, then connect again from Claude.",
  signIn: "Sign in",
  notOperator: "This account can't connect Claude to Off/Pixel.",
} as const;

export function consentBody(input: { clientName: string | null; email: string | null; returnHost: string }): string[] {
  const who = input.clientName?.trim() || "An app";
  const as = input.email ? ` as ${input.email}` : "";
  return [
    `${who} is asking to read Off/Pixel${as}.`,
    CONSENT_WORDS.readOnly,
    CONSENT_WORDS.stays,
    `After you allow it, you go back to ${input.returnHost}.`,
  ];
}
