"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AD_COPY_SLOTS,
  AD_FIELD_LABELS,
  AD_LIMITS,
  CONNECTED_TV,
  type AdLimitField,
  type GoogleVideoAd,
  type GoogleVideoEntityStatus,
  type GoogleVideoPlan,
  type GoogleVideoPlanTree,
} from "@/lib/google-video/types";
import { addPlanLocation, editorLocation, editorLocationChoices, removePlanLocation } from "@/lib/google-video/locations";
import { effectivePlanDailyBudget, reviewGoogleVideoPlan } from "@/lib/google-video/validation";
import { parseYouTubeRef } from "@/lib/google-video/youtube-url";

const STEPS = ["Settings", "Targeting", "Placements", "Ads", "Review"] as const;
type Step = (typeof STEPS)[number];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function numberOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="block font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function StatusToggle({
  status,
  onChange,
}: {
  status: GoogleVideoEntityStatus;
  onChange: (next: GoogleVideoEntityStatus) => void;
}) {
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as GoogleVideoEntityStatus)}
      className="h-8 rounded-md border border-border-strong bg-background px-2 text-xs"
    >
      <option value="enabled">Enabled</option>
      <option value="paused">Paused</option>
    </select>
  );
}

function LocationAdd({
  taken,
  onAdd,
}: {
  taken: GoogleVideoPlan["geo_targets"];
  onAdd: (name: string) => void;
}) {
  const choices = editorLocationChoices().filter(
    (choice) => !taken.some((g) => !g.negative && editorLocation(g.name)?.id === choice.id),
  );
  const [picked, setPicked] = useState("");
  const selected = choices.some((choice) => choice.name === picked) ? picked : (choices[0]?.name ?? "");
  if (choices.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        aria-label="Add a location"
        value={selected}
        onChange={(e) => setPicked(e.target.value)}
        className="h-8 max-w-md rounded-md border border-border-strong bg-background px-2 text-xs"
      >
        {choices.map((choice) => (
          <option key={choice.id} value={choice.name}>
            {choice.location} ({choice.id})
          </option>
        ))}
      </select>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd(selected)}>
        Add location
      </Button>
    </div>
  );
}

function CharCount({ value, limit }: { value: string | null; limit: number }) {
  const length = value?.length ?? 0;
  return (
    <span className={`text-[11px] ${length > limit ? "font-medium text-destructive" : "text-muted-foreground"}`}>
      {length}/{limit}
    </span>
  );
}

export function GoogleVideoPlanEditor({ initialTree }: { initialTree: GoogleVideoPlanTree }) {
  const router = useRouter();
  const [tree, setTree] = useState(initialTree);
  const [step, setStep] = useState<Step>("Settings");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "export" | "live" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const review = useMemo(() => reviewGoogleVideoPlan(tree, today()), [tree]);
  const plan = tree.plan;

  function patchPlan(patch: Partial<GoogleVideoPlan>) {
    setTree((t) => ({ ...t, plan: { ...t.plan, ...patch } }));
    setDirty(true);
  }

  function patchAd(id: string, patch: Partial<GoogleVideoAd>) {
    setTree((t) => ({ ...t, ads: t.ads.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
    setDirty(true);
  }

  function setPlacement(campaignId: string, adGroupId: string, placementId: string, patch: { value?: string; status?: GoogleVideoEntityStatus }) {
    setTree((t) => ({
      ...t,
      campaigns: t.campaigns.map((c) =>
        c.id !== campaignId
          ? c
          : {
              ...c,
              ad_groups: c.ad_groups.map((ag) =>
                ag.id !== adGroupId
                  ? ag
                  : { ...ag, placements: ag.placements.map((p) => (p.id === placementId ? { ...p, ...patch } : p)) },
              ),
            },
      ),
    }));
    setDirty(true);
  }

  function setCampaignStatus(campaignId: string, status: GoogleVideoEntityStatus) {
    setTree((t) => ({
      ...t,
      campaigns: t.campaigns.map((c) =>
        c.id !== campaignId ? c : { ...c, status, ad_groups: c.ad_groups.map((ag) => ({ ...ag, status })) },
      ),
    }));
    setDirty(true);
  }

  async function save(): Promise<boolean> {
    setError(null);
    setBusy("save");
    try {
      const res = await fetch(`/api/google-video/${plan.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tree }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!json?.ok) {
        setError(json?.error ?? "Save failed.");
        return false;
      }
      setDirty(false);
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    if (dirty && !(await save())) return;
    setError(null);
    setBusy("export");
    try {
      const res = await fetch(`/api/google-video/${plan.id}/export`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(json?.error ?? "Export failed.");
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "google-ads-editor.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
      setTree((t) => ({
        ...t,
        plan: { ...t.plan, status: t.plan.status === "draft" ? "exported" : t.plan.status, exported_at: new Date().toISOString() },
      }));
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function markLive() {
    setError(null);
    setBusy("live");
    try {
      const res = await fetch(`/api/google-video/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "live" }),
      });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!json?.ok) {
        setError(json?.error ?? "Update failed.");
        return;
      }
      setTree((t) => ({ ...t, plan: { ...t.plan, status: "live" } }));
    } finally {
      setBusy(null);
    }
  }

  const derivedDaily = effectivePlanDailyBudget(plan);
  const ctvExcluded = plan.device_exclusions.includes(CONNECTED_TV);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Link href="/google-ads" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Google Ads
            </Link>
            <h1 className="font-heading text-lg tracking-wide">{plan.name}</h1>
            <p className="text-xs text-muted-foreground">
              YouTube video plan · {plan.status}
              {plan.exported_at ? ` · exported ${new Date(plan.exported_at).toLocaleString("en-GB")}` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={save} disabled={!dirty || busy !== null}>
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {dirty ? "Save" : "Saved"}
          </Button>
        </div>
        <nav className="mx-auto mt-4 flex max-w-5xl gap-1">
          {STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                step === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {i + 1}. {s}
              {s === "Review" && review.blockers.length > 0 ? ` (${review.blockers.length})` : ""}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        {step === "Settings" && (
          <section className="grid gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-2">
            <Field label="Plan name">
              <Input value={plan.name} onChange={(e) => patchPlan({ name: e.target.value })} />
            </Field>
            <Field label="Target CPV (£)" hint="Target CPV bidding; written on every ad group.">
              <Input value={plan.cpv_bid ?? ""} inputMode="decimal" onChange={(e) => patchPlan({ cpv_bid: numberOrNull(e.target.value) })} />
            </Field>
            <Field label="Business name" hint="On every ad. Required by Editor.">
              <Input value={plan.business_name ?? ""} onChange={(e) => patchPlan({ business_name: e.target.value || null })} />
            </Field>
            <Field
              label="Total budget (£)"
              hint={
                plan.total_budget != null
                  ? `Split across the enabled campaigns${derivedDaily != null ? ` (about £${derivedDaily.toFixed(2)} a day in total)` : ""}. A paused campaign does not get another copy.`
                  : "Blank: the daily budget is used."
              }
            >
              <Input value={plan.total_budget ?? ""} inputMode="decimal" onChange={(e) => patchPlan({ total_budget: numberOrNull(e.target.value) })} />
            </Field>
            <Field label="Daily budget (£)" hint={
                plan.total_budget != null
                  ? "Weights the split when every enabled campaign has its own daily budget. Otherwise the total is split equally."
                  : plan.start_date && plan.end_date
                    ? "Written as a campaign total: this × the days from start to end."
                    : "No end date: written as an average daily budget."
              }
            >
              <Input value={plan.daily_budget ?? ""} inputMode="decimal" onChange={(e) => patchPlan({ daily_budget: numberOrNull(e.target.value) })} />
            </Field>
            <Field label="Start date">
              <Input type="date" value={plan.start_date ?? ""} onChange={(e) => patchPlan({ start_date: e.target.value || null })} />
            </Field>
            <Field label="End date">
              <Input type="date" value={plan.end_date ?? ""} onChange={(e) => patchPlan({ end_date: e.target.value || null })} />
            </Field>
            <Field label="Default final URL" hint="Used by an ad with no final URL of its own.">
              <Input value={plan.final_url ?? ""} onChange={(e) => patchPlan({ final_url: e.target.value || null })} />
            </Field>
            <Field label="Default call to action" hint={`${plan.call_to_action?.length ?? 0}/${AD_LIMITS.call_to_action}`}>
              <Input value={plan.call_to_action ?? ""} onChange={(e) => patchPlan({ call_to_action: e.target.value || null })} />
            </Field>
            <div className="space-y-2 text-xs">
              <Checkbox
                id="video-partners"
                checked={plan.include_video_partners}
                onChange={(e) => patchPlan({ include_video_partners: e.target.checked })}
                label="Include video partners"
              />
              <p className="text-muted-foreground">
                Frequency cap from the sheet: {plan.frequency_cap_per_day ?? "–"} per day, {plan.frequency_cap_per_week ?? "–"} per week.
                Set it in Editor; the CSV has no column for it.
              </p>
            </div>
          </section>
        )}

        {step === "Targeting" && (
          <section className="space-y-4 rounded-md border border-border bg-card p-4 text-sm">
            <Checkbox
              id="ctv"
              checked={!ctvExcluded}
              onChange={(e) =>
                patchPlan({
                  device_exclusions: e.target.checked
                    ? plan.device_exclusions.filter((d) => d !== CONNECTED_TV)
                    : [...plan.device_exclusions, CONNECTED_TV],
                })
              }
              label="Show ads on connected TV screens"
            />
            <p className="text-xs text-muted-foreground">
              Off by default: a click on a TV cannot reach a checkout. The file cannot carry this; Review lists
              &quot;Include Google TV: Disabled&quot; to set in Editor. Location bid adjustments are set there too.
            </p>
            <div>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Locations</h2>
              <table className="min-w-full text-xs">
                <tbody>
                  {plan.geo_targets.map((g) => {
                    const known = editorLocation(g.name);
                    return (
                      <tr key={g.name} className="border-t border-border">
                        <td className="py-1.5">{g.name}</td>
                        <td className="py-1.5 text-muted-foreground">
                          {g.negative ? "Excluded" : g.bid_modifier_pct != null ? `${g.bid_modifier_pct > 0 ? "+" : ""}${g.bid_modifier_pct}%` : "Base"}
                        </td>
                        <td className="py-1.5 text-muted-foreground">{known ? known.id : "no Google location ID"}</td>
                        <td className="py-1.5 text-right">
                          <button
                            type="button"
                            className="text-muted-foreground underline"
                            onClick={() => patchPlan({ geo_targets: removePlanLocation(plan.geo_targets, g.name) })}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <LocationAdd
                taken={plan.geo_targets}
                onAdd={(name) => {
                  const next = addPlanLocation(plan.geo_targets, name);
                  if (!next || next === plan.geo_targets) return;
                  patchPlan({ geo_targets: [...next] });
                }}
              />
            </div>
            <Field label="Languages (codes, comma-separated)">
              <Input
                value={plan.language_codes.join(", ")}
                onChange={(e) => patchPlan({ language_codes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            </Field>
            {plan.targeting_rows.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Targeting rows as written on the sheet</summary>
                <ul className="mt-2 space-y-1">
                  {plan.targeting_rows.map((r, i) => (
                    <li key={i}>
                      <span className="font-medium">{r.type}</span>: {r.setting} {r.value ? `(${r.value})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {step === "Placements" &&
          tree.campaigns.map((c) => (
            <section key={c.id} className="space-y-3 rounded-md border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium">{c.name}</h2>
                <StatusToggle status={c.status} onChange={(s) => setCampaignStatus(c.id, s)} />
              </div>
              {c.ad_groups.map((ag) => (
                <table key={ag.id} className="min-w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1">Placement</th>
                      <th className="py-1">YouTube link</th>
                      <th className="py-1">Read as</th>
                      <th className="py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ag.placements.map((p) => {
                      const ref = parseYouTubeRef(p.value);
                      return (
                        <tr key={p.id} className="border-t border-border align-top">
                          <td className="py-1.5 pr-2">{p.label}</td>
                          <td className="w-1/2 py-1.5 pr-2">
                            <Input value={p.value} onChange={(e) => setPlacement(c.id, ag.id, p.id, { value: e.target.value })} />
                          </td>
                          <td className={`py-1.5 pr-2 ${ref ? "text-muted-foreground" : "text-destructive"}`}>
                            {ref ? `${ref.kind} ${ref.id}` : "not a link"}
                          </td>
                          <td className="py-1.5">
                            <StatusToggle status={p.status} onChange={(s) => setPlacement(c.id, ag.id, p.id, { status: s })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ))}
            </section>
          ))}

        {step === "Ads" && (
          <>
            <p className="text-xs text-muted-foreground">Every ad runs in every ad group.</p>
            {tree.ads.map((ad) => (
              <section key={ad.id} className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2 sm:col-span-2">
                  <h2 className="text-sm font-medium">{ad.name}</h2>
                  <StatusToggle status={ad.status} onChange={(s) => patchAd(ad.id, { status: s })} />
                </div>
                <Field label="YouTube video link" hint={parseYouTubeRef(ad.video_value)?.kind === "video" ? undefined : "Paste the video's YouTube link."}>
                  <Input value={ad.video_value ?? ""} onChange={(e) => patchAd(ad.id, { video_value: e.target.value || null })} />
                </Field>
                <Field label="Final URL" hint={ad.final_url ? undefined : "Blank: the plan default final URL."}>
                  <Input value={ad.final_url ?? ""} onChange={(e) => patchAd(ad.id, { final_url: e.target.value || null })} />
                </Field>
                {(Object.keys(AD_LIMITS) as AdLimitField[]).map((field) => {
                  const extra = ad.extra_copy[field] ?? [];
                  const setSlot = (i: number, value: string) => {
                    const next = Array.from({ length: AD_COPY_SLOTS - 1 }, (_, j) => (j === i ? value : (extra[j] ?? "")));
                    while (next.length > 0 && next[next.length - 1] === "") next.pop();
                    patchAd(ad.id, { extra_copy: { ...ad.extra_copy, [field]: next } });
                  };
                  return (
                    <Field key={field} label={`${AD_FIELD_LABELS[field]} (up to ${AD_COPY_SLOTS})`}>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Input value={ad[field] ?? ""} onChange={(e) => patchAd(ad.id, { [field]: e.target.value || null })} />
                          <CharCount value={ad[field]} limit={AD_LIMITS[field]} />
                        </div>
                        {Array.from({ length: Math.min(extra.length + 1, AD_COPY_SLOTS - 1) }, (_, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <Input
                              value={extra[i] ?? ""}
                              placeholder={`${AD_FIELD_LABELS[field]} ${i + 2}`}
                              onChange={(e) => setSlot(i, e.target.value)}
                            />
                            <CharCount value={extra[i] ?? null} limit={AD_LIMITS[field]} />
                          </div>
                        ))}
                      </div>
                    </Field>
                  );
                })}
                {ad.note && <p className="text-[11px] text-muted-foreground sm:col-span-2">Sheet note: {ad.note}</p>}
              </section>
            ))}
          </>
        )}

        {step === "Review" && (
          <section className="space-y-4 rounded-md border border-border bg-card p-4 text-sm">
            {review.budgets.length > 0 && (
              <div>
                <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Budget in the file</h2>
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  {review.budgets.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.blockers.length > 0 && (
              <div>
                <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-destructive">Fix before download</h2>
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  {review.blockers.map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.warnings.length > 0 && (
              <div>
                <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-700">Warnings</h2>
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  {review.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {review.editorOnly.length > 0 && (
              <div>
                <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Set by hand in Editor after the import (not in the file)
                </h2>
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  {review.editorOnly.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button size="sm" onClick={download} disabled={review.blockers.length > 0 || busy !== null}>
                {busy === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Download Editor file
              </Button>
              {plan.status === "exported" && (
                <Button size="sm" variant="outline" onClick={markLive} disabled={busy !== null}>
                  {busy === "live" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Mark as live (posted from Editor)
                </Button>
              )}
              {downloaded && <span className="text-xs text-muted-foreground">Downloaded.</span>}
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Open Google Ads Editor and select the account.</li>
              <li>Get recent changes, so Editor has the account as it is now.</li>
              <li>Account → Import → From file, and pick the downloaded CSV.</li>
              <li>Review the proposed changes. Fix anything Editor flags, and set the items listed above.</li>
              <li>Post.</li>
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}
