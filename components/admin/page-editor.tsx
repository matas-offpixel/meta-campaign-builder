"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";

import {
  reorderPageImage,
  removePageImage,
  savePageEvent,
  uploadPageImage,
} from "@/lib/actions/update-page-event";
import {
  isoToLondonWallTime,
  type PageEventActionState,
} from "@/lib/admin/page-event-schema";
import type { PageEventEditView } from "@/lib/db/client-admin";

/**
 * components/admin/page-editor.tsx — the full LP content editor.
 *
 * Sprint 1 PR 3: reorganised into TABS (details / dates / media / form /
 * countdown / visibility / customisation / status). All non-image fields
 * live in ONE autosave form (tab panels toggle `hidden`, so inputs in
 * inactive tabs still post); the image upload/reorder/remove forms are
 * physically separate (forms can't nest) and surface under the Media tab.
 * Visibility + customisation are new (page_events.visibility /
 * .customisation, migration 139). 800ms debounced auto-save on text fields,
 * immediate on selects/checkboxes; reorder stays up/down buttons.
 */

const IDLE: PageEventActionState = { status: "idle", errors: {} };
const AUTOSAVE_DELAY_MS = 800;

type TabId =
  | "details"
  | "dates"
  | "media"
  | "form"
  | "countdown"
  | "visibility"
  | "customisation"
  | "status";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "details", label: "details" },
  { id: "dates", label: "dates" },
  { id: "media", label: "media" },
  { id: "form", label: "form" },
  { id: "countdown", label: "countdown" },
  { id: "visibility", label: "visibility" },
  { id: "customisation", label: "customisation" },
  { id: "status", label: "status" },
];

export function PageEditor({
  view,
  clientSlug,
}: {
  view: PageEventEditView;
  clientSlug: string;
}) {
  const [state, formAction, pending] = useActionState(savePageEvent, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<TabId>("details");
  const [countdownEnabled, setCountdownEnabled] = useState(
    view.countdownTargetAt != null,
  );
  // Visibility checkboxes are CONTROLLED (not defaultChecked): the debounced
  // autosave + revalidatePath re-render would otherwise drop an uncontrolled
  // checkbox's live state before it serialises, saving it as unchecked.
  const [visibility, setVisibility] = useState({
    show_event_date: view.visibility.showEventDate,
    show_venue: view.visibility.showVenue,
    show_description: view.visibility.showDescription,
  });

  // Debounced autosave: any input/change inside the main form schedules a
  // save; selects and checkboxes flush immediately.
  const scheduleSave = (immediate = false) => {
    setDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => {
        formRef.current?.requestSubmit();
        setDirty(false);
      },
      immediate ? 0 : AUTOSAVE_DELAY_MS,
    );
  };
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const err = state.errors;
  const content = view.content;
  const str = (key: string): string => {
    const value = content[key];
    return typeof value === "string" ? value : "";
  };
  const artworkUrl = str("artwork_url");

  return (
    <div className="space-y-6">
      {/* ── Status bar ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/${clientSlug}/pages`}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            ← All pages
          </Link>
          <Link
            href={`/l/${clientSlug}/${view.eventSlug}?preview=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Preview <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {pending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </>
          ) : dirty ? (
            "Unsaved changes…"
          ) : state.status === "saved" ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Saved
            </>
          ) : state.status === "error" ? (
            <span className="text-destructive">Check errors below</span>
          ) : null}
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px whitespace-nowrap px-3 py-2 text-xs lowercase ${
              tab === t.id
                ? "border-b-2 border-[color:var(--admin-accent)] font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        ref={formRef}
        action={formAction}
        onInput={() => scheduleSave()}
        className="space-y-6"
      >
        <input type="hidden" name="page_event_id" value={view.pageEventId} />

        {/* ── Details ─────────────────────────────────────────────── */}
        <TabPanel active={tab === "details"}>
          <Section title="Event basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Event name" error={err.name}>
                <input
                  name="name"
                  type="text"
                  defaultValue={view.eventName}
                  required
                  className={inputCls}
                />
              </Field>
              <Field
                label="URL slug"
                error={err.slug}
                hint={`/l/${clientSlug}/{slug}`}
              >
                <input
                  name="slug"
                  type="text"
                  defaultValue={view.eventSlug}
                  className={`${inputCls} font-mono`}
                />
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Venue" error={err.venue}>
                <input
                  name="venue"
                  type="text"
                  defaultValue={str("venue")}
                  className={inputCls}
                />
              </Field>
              <Field
                label="Venue (short)"
                hint="Header label — defaults to the part before the first comma"
              >
                <input
                  name="venue_short"
                  type="text"
                  defaultValue={str("venue_short")}
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>

          <Section title="Content">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Title"
                error={err.title}
                hint="Defaults to the event name when empty"
              >
                <input
                  name="title"
                  type="text"
                  defaultValue={str("title")}
                  className={inputCls}
                />
              </Field>
              <Field
                label="Subtitle"
                error={err.subtitle}
                hint="Marketing tagline — keep date info out of it"
              >
                <input
                  name="subtitle"
                  type="text"
                  defaultValue={str("subtitle")}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Description" error={err.description}>
                <textarea
                  name="description"
                  rows={5}
                  defaultValue={str("description")}
                  className={`${inputCls} h-auto py-2`}
                />
              </Field>
            </div>
          </Section>
        </TabPanel>

        {/* ── Dates ───────────────────────────────────────────────── */}
        <TabPanel active={tab === "dates"}>
          <Section title="Key dates" hint="All times are Europe/London.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Presale opens (UK)" error={err.presale_at}>
                <input
                  name="presale_at"
                  type="datetime-local"
                  defaultValue={isoToLondonWallTime(view.presaleAt)}
                  className={inputCls}
                />
              </Field>
              <Field label="General sale (UK)" error={err.general_sale_at}>
                <input
                  name="general_sale_at"
                  type="datetime-local"
                  defaultValue={isoToLondonWallTime(view.generalSaleAt)}
                  className={inputCls}
                />
              </Field>
              <Field label="Event start (UK)" error={err.event_start_at}>
                <input
                  name="event_start_at"
                  type="datetime-local"
                  defaultValue={isoToLondonWallTime(view.eventStartAt)}
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>
        </TabPanel>

        {/* ── Media (youtube here; images are separate forms below) ── */}
        <TabPanel active={tab === "media"}>
          <Section title="Video">
            <Field
              label="YouTube URL"
              error={err.youtube_url}
              hint="Embedded at the bottom of the page"
            >
              <input
                name="youtube_url"
                type="url"
                defaultValue={view.youtubeUrl ?? ""}
                placeholder="https://youtube.com/watch?v=…"
                className={inputCls}
              />
            </Field>
          </Section>
        </TabPanel>

        {/* ── Form (confirmation + brand socials) ─────────────────── */}
        <TabPanel active={tab === "form"}>
          <Section
            title="Confirmation message"
            hint="Shown to fans after they successfully sign up. Leave blank to use the default."
          >
            <Field label="Message" error={err.confirmation_body}>
              <textarea
                name="confirmation_body"
                rows={3}
                maxLength={200}
                defaultValue={str("confirmation_body")}
                placeholder="Your registration has been confirmed. Join the WhatsApp community group to access tickets 30 minutes early."
                className={`${inputCls} h-auto py-2`}
              />
            </Field>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Button text"
                error={err.confirmation_cta_label}
                hint="Keep it action-oriented — max 24 characters"
              >
                <input
                  name="confirmation_cta_label"
                  type="text"
                  maxLength={24}
                  defaultValue={str("confirmation_cta_label")}
                  placeholder="JOIN WHATSAPP COMMUNITY"
                  className={inputCls}
                />
              </Field>
              <Field label="Button URL" error={err.confirmation_cta_url}>
                <input
                  name="confirmation_cta_url"
                  type="url"
                  defaultValue={str("confirmation_cta_url")}
                  placeholder="https://chat.whatsapp.com/…"
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>

          <Section
            title="Brand socials (this page)"
            hint="Overrides the client-level defaults from Settings for this page only."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Instagram URL" error={err.brand_instagram_url}>
                <input
                  name="brand_instagram_url"
                  type="url"
                  defaultValue={str("brand_instagram_url")}
                  placeholder="https://instagram.com/…"
                  className={inputCls}
                />
              </Field>
              <Field label="TikTok URL" error={err.brand_tiktok_url}>
                <input
                  name="brand_tiktok_url"
                  type="url"
                  defaultValue={str("brand_tiktok_url")}
                  placeholder="https://tiktok.com/@…"
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>
        </TabPanel>

        {/* ── Countdown ───────────────────────────────────────────── */}
        <TabPanel active={tab === "countdown"}>
          <Section title="Countdown">
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="countdown_enabled"
                checked={countdownEnabled}
                onChange={(e) => {
                  setCountdownEnabled(e.target.checked);
                  scheduleSave(true);
                }}
              />
              Show a countdown on the page
            </label>
            {countdownEnabled && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Counts down to (UK)"
                  error={err.countdown_target_at}
                >
                  <input
                    name="countdown_target_at"
                    type="datetime-local"
                    defaultValue={
                      isoToLondonWallTime(view.countdownTargetAt) ||
                      isoToLondonWallTime(view.presaleAt)
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Label" error={err.countdown_label}>
                  <input
                    name="countdown_label"
                    type="text"
                    defaultValue={view.countdownLabel ?? "presale opens in"}
                    className={inputCls}
                  />
                </Field>
              </div>
            )}
          </Section>
        </TabPanel>

        {/* ── Visibility ──────────────────────────────────────────── */}
        <TabPanel active={tab === "visibility"}>
          <Section
            title="Section visibility"
            hint="Hide individual sections of the page without deleting their content."
          >
            <div className="space-y-3">
              <ToggleRow
                name="show_event_date"
                label="Event date (header)"
                checked={visibility.show_event_date}
                onToggle={(v) => {
                  setVisibility((s) => ({ ...s, show_event_date: v }));
                  scheduleSave(true);
                }}
              />
              <ToggleRow
                name="show_venue"
                label="Venue (header)"
                checked={visibility.show_venue}
                onToggle={(v) => {
                  setVisibility((s) => ({ ...s, show_venue: v }));
                  scheduleSave(true);
                }}
              />
              <ToggleRow
                name="show_description"
                label="Description block"
                checked={visibility.show_description}
                onToggle={(v) => {
                  setVisibility((s) => ({ ...s, show_description: v }));
                  scheduleSave(true);
                }}
              />
            </div>
          </Section>
        </TabPanel>

        {/* ── Customisation ───────────────────────────────────────── */}
        <TabPanel active={tab === "customisation"}>
          <Section
            title="Appearance"
            hint="Leave the colours blank to use the page's accent (from the artwork)."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Primary button colour"
                error={err.primary_button_bg}
                hint="Hex, e.g. #E5322D"
              >
                <input
                  name="primary_button_bg"
                  type="text"
                  defaultValue={view.customisation.primaryButtonBg ?? ""}
                  placeholder="#E5322D"
                  className={`${inputCls} font-mono`}
                />
              </Field>
              <Field
                label="Primary button text colour"
                error={err.primary_button_text}
                hint="Hex, e.g. #FFFFFF"
              >
                <input
                  name="primary_button_text"
                  type="text"
                  defaultValue={view.customisation.primaryButtonText ?? ""}
                  placeholder="#FFFFFF"
                  className={`${inputCls} font-mono`}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Description alignment">
                <select
                  name="description_align"
                  defaultValue={view.customisation.descriptionAlign}
                  onChange={() => scheduleSave(true)}
                  className={`${inputCls} max-w-xs`}
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                </select>
              </Field>
            </div>
          </Section>
        </TabPanel>

        {/* ── Status ──────────────────────────────────────────────── */}
        <TabPanel active={tab === "status"}>
          <Section title="Status">
            <Field label="Page status" error={err.status}>
              <select
                name="status"
                defaultValue={view.status}
                onChange={() => scheduleSave(true)}
                className={`${inputCls} max-w-xs`}
              >
                <option value="draft">Draft — not publicly visible</option>
                <option value="live">Live — fans can sign up</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
          </Section>
        </TabPanel>

        {err._form && <p className="text-sm text-destructive">{err._form}</p>}

        <button
          type="submit"
          disabled={pending}
          className="flex h-10 items-center gap-2 rounded-md bg-foreground px-5 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-40"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save now
        </button>
      </form>

      {/* ── Media images — separate forms (cannot nest in the main form) */}
      <div hidden={tab !== "media"} className="space-y-6">
        <Section title="Artwork">
          <p className="text-xs text-muted-foreground">
            The main image — drives the page&apos;s accent color (re-extracted
            automatically after upload).
          </p>
          {artworkUrl ? (
            <div className="mt-3 flex items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artworkUrl}
                alt="Artwork"
                className="h-32 w-32 rounded-md border border-border object-cover"
              />
              <RemoveImageButton
                pageEventId={view.pageEventId}
                kind="artwork"
                url={artworkUrl}
              />
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No artwork yet.</p>
          )}
          <UploadForm
            pageEventId={view.pageEventId}
            kind="artwork"
            label={artworkUrl ? "Replace artwork" : "Upload artwork"}
          />
        </Section>

        <Section title="Hero carousel">
          <ImageList
            pageEventId={view.pageEventId}
            kind="hero"
            images={view.heroImages}
            emptyLabel="No hero images — the artwork is shown instead."
          />
          <UploadForm
            pageEventId={view.pageEventId}
            kind="hero"
            label="Add hero image"
          />
        </Section>

        <Section title="Bottom image grid">
          <ImageList
            pageEventId={view.pageEventId}
            kind="bottom"
            images={view.bottomImages}
            emptyLabel="No bottom images — the grid is hidden."
          />
          <UploadForm
            pageEventId={view.pageEventId}
            kind="bottom"
            label="Add bottom image"
          />
        </Section>
      </div>
    </div>
  );
}

function TabPanel({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div hidden={!active} className="space-y-6">
      {children}
    </div>
  );
}

function ToggleRow({
  name,
  label,
  checked,
  onToggle,
}: {
  name: string;
  label: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2.5 text-sm">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
      />
      {label}
    </label>
  );
}

const inputCls =
  "mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function UploadForm({
  pageEventId,
  kind,
  label,
}: {
  pageEventId: string;
  kind: "artwork" | "hero" | "bottom";
  label: string;
}) {
  const [state, formAction, pending] = useActionState(uploadPageImage, IDLE);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="mt-3">
      <input type="hidden" name="page_event_id" value={pageEventId} />
      <input type="hidden" name="kind" value={kind} />
      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-background px-3 text-sm hover:bg-muted">
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
          </>
        ) : (
          label
        )}
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            if (e.target.files?.length) formRef.current?.requestSubmit();
          }}
        />
      </label>
      {state.errors._image && (
        <p className="mt-1 text-xs text-destructive">{state.errors._image}</p>
      )}
    </form>
  );
}

function ImageList({
  pageEventId,
  kind,
  images,
  emptyLabel,
}: {
  pageEventId: string;
  kind: "hero" | "bottom";
  images: string[];
  emptyLabel: string;
}) {
  if (images.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-2">
      {images.map((url, index) => (
        <li
          key={url}
          className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="h-12 w-12 rounded object-cover border border-border"
          />
          <span className="flex-1 truncate text-xs text-muted-foreground">
            {index + 1}. {url.split("/").pop()}
          </span>
          <form action={reorderPageImage}>
            <input type="hidden" name="page_event_id" value={pageEventId} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="url" value={url} />
            <input type="hidden" name="direction" value="up" />
            <IconButton disabled={index === 0} label="Move up">
              <ArrowUp className="h-3.5 w-3.5" />
            </IconButton>
          </form>
          <form action={reorderPageImage}>
            <input type="hidden" name="page_event_id" value={pageEventId} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="url" value={url} />
            <input type="hidden" name="direction" value="down" />
            <IconButton disabled={index === images.length - 1} label="Move down">
              <ArrowDown className="h-3.5 w-3.5" />
            </IconButton>
          </form>
          <RemoveImageButton pageEventId={pageEventId} kind={kind} url={url} />
        </li>
      ))}
    </ul>
  );
}

function RemoveImageButton({
  pageEventId,
  kind,
  url,
}: {
  pageEventId: string;
  kind: "artwork" | "hero" | "bottom";
  url: string;
}) {
  return (
    <form action={removePageImage}>
      <input type="hidden" name="page_event_id" value={pageEventId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="url" value={url} />
      <IconButton label="Remove image">
        <Trash2 className="h-3.5 w-3.5 text-destructive/80" />
      </IconButton>
    </form>
  );
}

function IconButton({
  children,
  label,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-muted disabled:opacity-30"
    >
      {children}
    </button>
  );
}
