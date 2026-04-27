import Link from "next/link";

/**
 * app/coming-soon/page.tsx
 *
 * Placeholder destination for staged features where the UI affordance
 * (a link, a CTA) is shipped ahead of the underlying page. Currently
 * referenced by the "View full venue report" CTA on the multi-venue
 * client portal; a follow-up PR replaces those hrefs with the real
 * per-venue report route and this page can then be retired or
 * repurposed for other staged links.
 *
 * Intentionally minimal — no per-feature branching inline, since the
 * querystring hints (`from=venue-report&event_code=…`) are purely
 * contextual breadcrumbs for a human visitor rather than template
 * inputs.
 */
export const metadata = {
  title: "Coming soon",
};

interface Props {
  searchParams: Promise<{ from?: string; event_code?: string }>;
}

export default async function ComingSoonPage({ searchParams }: Props) {
  const { from, event_code: eventCode } = await searchParams;
  const contextLabel = labelFor(from);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="font-heading text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Off Pixel
      </p>
      <h1 className="font-heading text-3xl tracking-tight text-foreground">
        Coming soon
      </h1>
      {contextLabel && (
        <p className="text-sm text-muted-foreground">
          {contextLabel}
          {eventCode && (
            <>
              {" "}for{" "}
              <span className="font-mono text-foreground">{eventCode}</span>
            </>
          )}
          .
        </p>
      )}
      <p className="max-w-md text-sm text-muted-foreground">
        We&rsquo;re still building this surface. In the meantime, head
        back to the main report — every metric on this link is already
        rolled into the venue card you came from.
      </p>
      <Link
        href="/"
        className="mt-4 inline-flex items-center rounded-md border border-border-strong bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
      >
        Go back
      </Link>
    </main>
  );
}

function labelFor(from: string | undefined): string | null {
  switch (from) {
    case "venue-report":
      return "Dedicated per-venue report pages are on the way";
    default:
      return null;
  }
}
