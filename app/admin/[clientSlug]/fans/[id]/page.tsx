import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { getFanDetail } from "@/lib/db/fan-detail";
import {
  getClientConsentConfig,
  getPixelHealth,
} from "@/lib/db/client-admin";
import {
  buildTimeline,
  completeRegistrationEventId,
  extractClickIds,
  fanStatus,
  formatGeo,
  utmParams,
} from "@/lib/admin/fan-detail-view";
import { Section } from "@/components/admin/ui/section";
import { AdminStatusPill } from "@/components/admin/ui/table";
import { FanDetailActions } from "@/components/admin/fan-detail-actions";

/**
 * app/admin/[clientSlug]/fans/[id]/page.tsx — single-fan detail view (OP909
 * Sprint 2 PR 6). Full attribution + coarse geo + signup timeline + consent +
 * a DERIVED Meta event correlation (no per-event pixel log is stored — Meta
 * Events Manager is the source of truth), plus the delete/anonymise danger
 * zone. Decrypted PII renders server-side only; nothing sensitive crosses to
 * a client component (the danger-zone actions take only the signup id).
 */
export default async function FanDetailPage({
  params,
}: {
  params: Promise<{ clientSlug: string; id: string }>;
}) {
  const { clientSlug, id } = await params;
  const membership = await requireClientContext(clientSlug);

  const [detail, pixel, consent] = await Promise.all([
    getFanDetail(membership.clientId, id),
    getPixelHealth(membership.clientId),
    getClientConsentConfig(membership.clientId),
  ]);
  if (!detail) notFound();

  const status = fanStatus(detail.deletedAt, detail.anonymizedAt);
  const removed = status !== "active";
  const clickIds = extractClickIds(detail.utm);
  const utms = utmParams(detail.utm);
  const timeline = buildTimeline(detail.timeline);
  const base = `/admin/${membership.clientSlug}/fans`;
  const crEventId = completeRegistrationEventId(detail.id);

  const social = detail.igHandle
    ? { label: `@${detail.igHandle}`, kind: "Instagram" }
    : detail.ttHandle
      ? { label: `@${detail.ttHandle}`, kind: "TikTok" }
      : null;

  const heading =
    status === "anonymized"
      ? "Anonymised fan"
      : (detail.email ?? detail.phone ?? social?.label ?? "Fan");

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link
        href={base}
        className="inline-flex items-center gap-1.5 font-[family-name:var(--admin-mono)] text-[11px] text-[#666] hover:text-black"
      >
        <ArrowLeft className="h-3 w-3" />
        back to fans
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="admin-heading text-[28px] leading-none">{heading}</h1>
        {status === "anonymized" && (
          <AdminStatusPill tone="muted">anonymised</AdminStatusPill>
        )}
        {status === "deleted" && (
          <AdminStatusPill tone="warning">deleted</AdminStatusPill>
        )}
        {detail.consentWaOptInAt && !removed && (
          <AdminStatusPill tone="positive">whatsapp opt-in</AdminStatusPill>
        )}
      </div>
      <p className="mt-2 font-[family-name:var(--admin-mono)] text-[12px] text-[#666]">
        Signed up {absoluteTime(detail.createdAt)} · {detail.eventName}
      </p>

      {/* ── Contact ─────────────────────────────────────────────────────── */}
      <Section title="Contact">
        <Fields>
          <Field label="Email" value={detail.email} mono />
          <Field
            label="Phone"
            value={
              detail.phone
                ? `${detail.phone}${detail.phoneCountryCode ? ` (${detail.phoneCountryCode})` : ""}`
                : null
            }
            mono
          />
          <Field
            label="Social"
            value={social ? `${social.label} · ${social.kind}` : null}
          />
        </Fields>
      </Section>

      {/* ── Attribution ─────────────────────────────────────────────────── */}
      <Section title="Attribution">
        <Fields>
          <Field label="Source" value={detail.source} />
          <Field label="Meta click id (fbclid)" value={clickIds.fbclid} mono />
          <Field label="TikTok click id (ttclid)" value={clickIds.ttclid} mono />
          <Field label="Google click id (gclid)" value={clickIds.gclid} mono />
          {utms.map((u) => (
            <Field key={u.key} label={u.key} value={u.value} mono />
          ))}
          <Field label="Referrer" value={detail.referrerUrl} mono />
          <Field label="User agent" value={detail.userAgent} mono />
        </Fields>
        <p className="mt-4 font-[family-name:var(--admin-mono)] text-[10px] leading-relaxed text-[#999]">
          fbc / fbp browser cookies aren&apos;t stored — fbclid (above) is the
          retained Meta click signal.
        </p>
      </Section>

      {/* ── Location ────────────────────────────────────────────────────── */}
      <Section title="Location">
        <Fields>
          <Field
            label="IP-derived location"
            value={formatGeo(detail.geoCountry, detail.geoRegion, detail.geoCity)}
          />
        </Fields>
        <p className="mt-4 font-[family-name:var(--admin-mono)] text-[10px] leading-relaxed text-[#999]">
          Coarse, from the request&apos;s IP-geo headers at signup. The raw IP
          is never stored (hash only).
        </p>
      </Section>

      {/* ── Consent history ─────────────────────────────────────────────── */}
      <Section title="Consent history">
        <Fields>
          <Field
            label="Marketing (privacy policy)"
            value={
              detail.consentGdprAt
                ? `Agreed · ${absoluteTime(detail.consentGdprAt)}`
                : "—"
            }
          />
          <Field
            label="WhatsApp opt-in"
            value={
              detail.consentWaOptInAt
                ? `Opted in · ${absoluteTime(detail.consentWaOptInAt)}`
                : "Not opted in"
            }
          />
          {consent.partnerConsentEnabled && (
            <Field
              label={`Partner${consent.partnerName ? ` (${consent.partnerName})` : ""}`}
              value="Not captured per-signup yet"
            />
          )}
        </Fields>
      </Section>

      {/* ── Signup timeline ─────────────────────────────────────────────── */}
      <Section title="Signup timeline">
        <ol className="space-y-3">
          {timeline.map((entry, i) => (
            <li
              key={`${entry.at}-${i}`}
              className="flex items-baseline gap-3 font-[family-name:var(--admin-mono)] text-[12px]"
            >
              <span className="w-44 shrink-0 text-[#666]">
                {absoluteTime(entry.at)}
              </span>
              <span className="text-black">
                {entry.kind === "signup" ? "Signed up" : "Returned"} ·{" "}
                {entry.eventName}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── Meta pixel (derived) ────────────────────────────────────────── */}
      <Section title="Meta pixel event">
        <Fields>
          <Field label="Pixel id" value={pixel?.pixelId ?? null} mono />
          <Field
            label="CAPI token"
            value={pixel?.capiTokenConfigured ? "Configured" : "Not configured"}
          />
          <Field label="CompleteRegistration event id" value={crEventId} mono />
          {pixel?.testEventCode ? (
            <Field
              label="Test event code"
              value={`${pixel.testEventCode} — QA routing active`}
              mono
            />
          ) : null}
        </Fields>
        <p className="mt-4 font-[family-name:var(--admin-mono)] text-[10px] leading-relaxed text-[#999]">
          On signup, the browser pixel fires PageView + CompleteRegistration and
          the server sends a matching CompleteRegistration via CAPI (deduped on
          the event id above). Per-event delivery isn&apos;t logged here — check
          Meta Events Manager for confirmed receipt.
        </p>
      </Section>

      {/* ── Danger zone ─────────────────────────────────────────────────── */}
      <Section title="Danger zone">
        <FanDetailActions signupId={detail.id} listHref={base} disabled={removed} />
      </Section>
    </div>
  );
}

function Fields({ children }: { children: ReactNode }) {
  return <dl className="divide-y-[0.5px] divide-[#eee]">{children}</dl>;
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 py-2.5">
      <dt className="font-[family-name:var(--admin-mono)] text-[10px] uppercase tracking-[1.5px] text-[#666]">
        {label}
      </dt>
      <dd
        className={
          mono
            ? "break-all font-[family-name:var(--admin-mono)] text-[12px] text-black"
            : "text-[13px] text-black"
        }
      >
        {value && value.length > 0 ? value : "—"}
      </dd>
    </div>
  );
}

function absoluteTime(iso: string): string {
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
