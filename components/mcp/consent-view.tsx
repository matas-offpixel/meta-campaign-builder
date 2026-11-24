/**
 * The MCP consent page's body, shared by app/oauth/authorize and its
 * fixture frames (app/(dev)/frames/mcp-consent). App tokens only: Allow is
 * the primary Button, Cancel the outline one. On this page only, Allow has a
 * 1 px border in the page's ink (--foreground) so its edge clears 3:1 on the
 * page background (design round 2 on #1371; the app-wide fix is its own
 * record). No dark: classes: a light page in a dark sheet is fine (ruling 1).
 * Long emails and registered names wrap inside the column
 * (overflow-wrap: anywhere), never overflow.
 */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CONSENT_WORDS, type ConsentContent } from "@/lib/mcp/oauth/consent-words";

export type ConsentViewState =
  | { state: "consent"; content: ConsentContent }
  | { state: "invalid" }
  | { state: "signed_out" }
  | { state: "not_operator" };

export function ConsentView({
  view,
  action,
  hidden,
  frameId,
}: {
  view: ConsentViewState;
  /** The server action; the fixture frames pass none. */
  action?: (form: FormData) => Promise<void>;
  /** The request's parameters, as hidden inputs. */
  hidden?: ReactNode;
  /** Set on fixture frames only (data-frame-ready for the runner). */
  frameId?: string;
}) {
  const title = view.state === "consent" ? view.content.title : CONSENT_WORDS.titleClaude;
  return (
    <main
      className="min-h-screen bg-background text-foreground"
      {...(frameId ? { "data-frame-ready": frameId } : {})}
    >
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 px-4 py-10 [overflow-wrap:anywhere]">
        <h1 className="text-xl font-semibold">{title}</h1>
        {view.state === "consent" ? (
          <>
            {view.content.lines.map((line) => (
              <p key={line} className="text-sm leading-relaxed">
                {line}
              </p>
            ))}
            <form action={action} className="flex flex-wrap gap-3">
              {hidden}
              <Button type="submit" name="decision" value="allow" className="border border-foreground">
                {CONSENT_WORDS.allow}
              </Button>
              <Button type="submit" name="decision" value="deny" variant="outline">
                {CONSENT_WORDS.cancel}
              </Button>
            </form>
          </>
        ) : view.state === "signed_out" ? (
          <>
            <p className="text-sm leading-relaxed">{CONSENT_WORDS.signedOut}</p>
            <a className="text-sm underline" href="/login">
              {CONSENT_WORDS.signIn}
            </a>
          </>
        ) : (
          <p className="text-sm leading-relaxed">{view.state === "invalid" ? CONSENT_WORDS.invalid : CONSENT_WORDS.notOperator}</p>
        )}
      </div>
    </main>
  );
}
