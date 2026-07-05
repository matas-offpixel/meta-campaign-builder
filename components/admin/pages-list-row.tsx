"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { BarChart3, Copy, Eye, Pencil, Trash2 } from "lucide-react";

import { archivePage } from "@/lib/actions/update-page-event";
import { fanUrl, type PagesListItem } from "@/lib/admin/pages-list";
import { CopyPathButton } from "./copy-path-button";

/**
 * components/admin/pages-list-row.tsx
 *
 * One Pages-list row (OP909 Sprint 1): [thumbnail] | [title + path] |
 * [metadata] | [5 icon actions]. Supreme aesthetic — hairline separator,
 * no zebra, mono metadata, Futura Bold Italic title. Title + Pencil route
 * to the editor; Eye opens the fan page; Copy copies the URL; BarChart
 * goes to per-page insights; Trash soft-deletes (status=archived) via the
 * existing archivePage server action, behind a confirm dialog.
 */

const STATUS_STYLES: Record<string, string> = {
  live: "bg-[#e8f5e9] text-[#1b5e20]",
  draft: "bg-[#fff8e1] text-[#8d6e00]",
  archived: "bg-[#f0f0f0] text-[#666]",
};

function metaDate(iso: string | null, prefix: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(d);
  return `${prefix} ${label}`;
}

export function PagesListRow({
  page,
  clientSlug,
  origin,
  accent,
  boxLogoText,
}: {
  page: PagesListItem;
  clientSlug: string;
  origin: string;
  accent: string;
  boxLogoText: string;
}) {
  const router = useRouter();
  const editHref = `/admin/${clientSlug}/pages/${page.pageEventId}/edit`;
  const insightsHref = `/admin/${clientSlug}/pages/${page.pageEventId}/insights`;

  const meta = [
    metaDate(page.presaleAt, "Presale"),
    metaDate(page.updatedAt, "Edited"),
  ].filter((s): s is string => s !== null);

  const openFanPage = () => {
    window.open(fanUrl(origin, clientSlug, page.eventSlug), "_blank", "noopener,noreferrer");
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(fanUrl(origin, clientSlug, page.eventSlug));
    } catch {
      /* clipboard blocked — path text remains manually selectable */
    }
  };

  return (
    <div className="flex items-center gap-4 border-b-[0.5px] border-black py-4">
      {/* Thumbnail */}
      <button
        type="button"
        onClick={() => router.push(editHref)}
        className="relative h-12 w-12 shrink-0 overflow-hidden"
        style={{ backgroundColor: accent }}
        aria-label={`Edit ${page.eventName}`}
      >
        {page.artworkUrl ? (
          <Image
            src={page.artworkUrl}
            alt=""
            fill
            sizes="48px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <span className="admin-heading flex h-full w-full items-center justify-center text-[14px] text-white">
            {boxLogoText.slice(0, 3).toUpperCase()}
          </span>
        )}
      </button>

      {/* Title + path */}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => router.push(editHref)}
          className="admin-heading block max-w-full truncate text-left text-[14px] text-black hover:opacity-70"
        >
          {page.eventName}
        </button>
        <CopyPathButton origin={origin} clientSlug={clientSlug} eventSlug={page.eventSlug} />
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-[family-name:var(--admin-mono)] text-[10px] text-[#666]">
          <span
            className={`px-1.5 py-0.5 uppercase tracking-[0.5px] ${STATUS_STYLES[page.status] ?? STATUS_STYLES.draft}`}
          >
            {page.status}
          </span>
          <span>·</span>
          <span>
            {page.signupCount} signup{page.signupCount === 1 ? "" : "s"}
          </span>
          {meta.map((m) => (
            <span key={m}>· {m}</span>
          ))}
        </div>
      </div>

      {/* Icon actions */}
      <div className="flex shrink-0 items-center gap-2">
        <IconAction label="Edit" onClick={() => router.push(editHref)}>
          <Pencil className="h-4 w-4" />
        </IconAction>
        <IconAction label="Preview" onClick={openFanPage}>
          <Eye className="h-4 w-4" />
        </IconAction>
        <IconAction label="Copy URL" onClick={copyUrl}>
          <Copy className="h-4 w-4" />
        </IconAction>
        <IconAction label="Insights" onClick={() => router.push(insightsHref)}>
          <BarChart3 className="h-4 w-4" />
        </IconAction>
        {page.status !== "archived" && (
          <form
            action={archivePage}
            onSubmit={(e) => {
              if (!window.confirm(`Archive "${page.eventName}"? Fans can no longer reach this page.`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="page_event_id" value={page.pageEventId} />
            <button
              type="submit"
              aria-label="Delete"
              title="Delete"
              className="p-1.5 text-[#666] transition-colors hover:text-[#d33]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-1.5 text-[#666] transition-colors hover:text-black"
    >
      {children}
    </button>
  );
}
