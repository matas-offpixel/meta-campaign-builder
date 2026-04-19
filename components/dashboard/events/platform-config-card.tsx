"use client";

import { ExternalLink, FolderOpen, Music2, Search } from "lucide-react";

interface PlatformLine {
  label: string;
  icon: React.ReactNode;
  /** Resolved value (e.g. "Louder TikTok"). Null = nothing wired. */
  value: string | null;
  /** True when the resolved value comes from the parent client row. */
  inherited: boolean;
  /** Optional outbound link (e.g. drive folder URL). */
  href?: string | null;
}

interface Props {
  /** Resolved Meta ad account id (event override → client default). */
  metaAdAccount: { value: string | null; inherited: boolean };
  /** Resolved TikTok account name (event override → client default). */
  tiktokAccount: { value: string | null; inherited: boolean };
  /** Resolved Google Ads account name (event override → client default). */
  googleAdsAccount: { value: string | null; inherited: boolean };
  /** Drive folder URL stored on events.google_drive_folder_url. */
  driveFolderUrl: string | null;
}

/**
 * Per-event platform config summary. Reads four resolved values and
 * surfaces inheritance — anything inherited from the client carries an
 * "inherited" badge so the editor knows whether changing it touches
 * just this event or every event under the client.
 *
 * Mutation is intentionally NOT wired here yet; the underlying FK
 * columns (events.tiktok_account_id, events.google_ads_account_id)
 * land in migration 018, and per-event override flows fan into a PATCH
 * endpoint that does not exist yet. This card is the read-side surface
 * the next change in the chain plugs into.
 */
export function PlatformConfigCard({
  metaAdAccount,
  tiktokAccount,
  googleAdsAccount,
  driveFolderUrl,
}: Props) {
  const lines: PlatformLine[] = [
    {
      label: "Meta ad account",
      icon: (
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#1877F2] text-[10px] font-bold text-white">
          f
        </span>
      ),
      value: metaAdAccount.value,
      inherited: metaAdAccount.inherited,
    },
    {
      label: "TikTok account",
      icon: <Music2 className="h-4 w-4" style={{ color: "#FF0050" }} />,
      value: tiktokAccount.value,
      inherited: tiktokAccount.inherited,
    },
    {
      label: "Google Ads account",
      icon: <Search className="h-4 w-4" style={{ color: "#4285F4" }} />,
      value: googleAdsAccount.value,
      inherited: googleAdsAccount.inherited,
    },
    {
      label: "Drive folder",
      icon: <FolderOpen className="h-4 w-4 text-muted-foreground" />,
      value: driveFolderUrl,
      inherited: false,
      href: driveFolderUrl,
    },
  ];

  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-3">
      <div>
        <h2 className="font-heading text-base tracking-wide">
          Platform config
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Accounts driving paid spend + asset storage for this event.
          Anything marked &ldquo;inherited&rdquo; comes from the client
          and changing it requires editing the client.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {lines.map((line) => (
          <li
            key={line.label}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              {line.icon}
              <span className="text-sm font-medium">{line.label}</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              {line.value ? (
                <>
                  {line.href ? (
                    <a
                      href={line.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline truncate max-w-xs"
                    >
                      {line.value}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-sm truncate max-w-xs">
                      {line.value}
                    </span>
                  )}
                  {line.inherited && (
                    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      inherited
                    </span>
                  )}
                </>
              ) : (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Not configured
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
