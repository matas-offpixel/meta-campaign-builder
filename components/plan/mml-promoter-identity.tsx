import Link from "next/link";

import { PlatformGlyph } from "@/components/viz/platform-glyph";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import { EMPTY_IDENTITY_NAMES, type IdentityNameMap } from "@/lib/plan/identity-chips";
import { channelDefaultsHref, mmlPromoterIdentityRows } from "@/lib/plan/mml-sections";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * Who the ads run as on each channel. Read-only: the client's channel
 * defaults are the one place to change it.
 */
export function MmlPromoterIdentity({
  hasEvent,
  resolved,
  names = EMPTY_IDENTITY_NAMES,
  editLink = true,
}: {
  hasEvent: boolean;
  resolved: ResolvedChannelDefaults | null;
  names?: IdentityNameMap;
  editLink?: boolean;
}) {
  if (!hasEvent) {
    return (
      <span className={`block ${VIZ_TYPE.body} text-muted-foreground`}>
        Pick a show to see who the ads run as.
      </span>
    );
  }
  if (!resolved) {
    return <span className="block h-2 w-40 bg-foreground/35" aria-hidden="true" data-pending />;
  }
  if (!resolved.clientId) {
    return (
      <span className={`block ${VIZ_TYPE.body} text-muted-foreground`}>
        This event has no client, so there are no channel defaults to run as.
      </span>
    );
  }
  const href = editLink ? channelDefaultsHref(resolved.clientId) : null;
  return (
    <div data-mml-promoter className="space-y-1.5">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
        {mmlPromoterIdentityRows(resolved, names).map((row) => (
          <div key={row.id} className="contents">
            <dt className={`inline-flex items-center gap-1.5 ${VIZ_TYPE.label} text-muted-foreground`}>
              <PlatformGlyph platform={row.adapter} size="sm" />
              {row.label}
            </dt>
            <dd className={`min-w-0 truncate ${VIZ_TYPE.body}`}>
              {row.value ?? <span className="text-muted-foreground">not set</span>}
            </dd>
          </div>
        ))}
      </dl>
      {href ? (
        <Link href={href} className={`inline-block ${VIZ_TYPE.label} text-muted-foreground underline underline-offset-2 hover:text-foreground`}>
          Change in {resolved.clientName?.trim() || "client"} channel defaults →
        </Link>
      ) : null}
    </div>
  );
}
