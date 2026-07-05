import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { MetaPixelForm } from "@/components/admin/meta-pixel-form";
import { requireClientContext } from "@/lib/auth/get-client-context";
import { eventsManagerUrl } from "@/lib/admin/meta-pixel-schema";
import { getPixelHealth } from "@/lib/db/client-admin";

/**
 * app/admin/[clientSlug]/integrations/meta-pixel/page.tsx — self-service
 * Meta Pixel + CAPI setup (OP909 Phase 7). Status panel shows presence
 * only for the token; the raw value never crosses this boundary.
 */
export default async function MetaPixelPage({
  params,
}: {
  params: Promise<{ clientSlug: string }>;
}) {
  const { clientSlug } = await params;
  const membership = await requireClientContext(clientSlug);
  const pixel = await getPixelHealth(membership.clientId);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href={`/admin/${membership.clientSlug}/integrations`}
        className="text-xs text-muted-foreground underline hover:text-foreground"
      >
        ← Integrations
      </Link>
      <h1 className="mt-2 font-heading text-2xl tracking-wide">Meta Pixel</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect your own Meta Pixel so landing-page signups feed your ad
        account&apos;s optimisation — browser events and server
        (Conversions API) events fire to this pixel only.
      </p>

      {/* ── Status panel ─────────────────────────────────────────────── */}
      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Pixel</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {pixel?.pixelId ?? "not set"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">CAPI token</dt>
          <dd className="mt-1">
            {pixel?.capiTokenConfigured ? (
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                configured
              </span>
            ) : (
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                not configured
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Mode</dt>
          <dd className="mt-1 font-medium">
            {pixel?.testEventCode ? "test" : "live"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last verified</dt>
          <dd className="mt-1 font-medium">
            {pixel?.verifiedAt ? formatVerified(pixel.verifiedAt) : "never"}
          </dd>
        </div>
      </dl>

      {pixel?.pixelId && (
        <a
          href={eventsManagerUrl(pixel.pixelId)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline hover:text-foreground"
        >
          Open in Meta Events Manager <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <div className="mt-8">
        <MetaPixelForm
          pixelId={pixel?.pixelId ?? null}
          tokenConfigured={pixel?.capiTokenConfigured ?? false}
          testEventCode={pixel?.testEventCode ?? null}
        />
      </div>
    </div>
  );
}

function formatVerified(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
}
