"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DEFAULT_GOOGLE_BUDGET_PCT,
  GOOGLE_ADS_BIDDING_STRATEGIES,
  GOOGLE_ADS_PRIORITIES,
  type GoogleAdCampaign,
  type GoogleAdsAccount,
  type GoogleAdsBiddingStrategy,
  type GoogleAdsCampaignPriority,
  type GoogleAdsGeoTarget,
  type GoogleAdsRlsaAdjustments,
  type GoogleAdsScheduling,
} from "@/lib/types/google-ads";

interface EventOption {
  id: string;
  name: string;
  venue_city: string | null;
}

interface Props {
  events: EventOption[];
  defaultEventId?: string | null;
}

const PRIORITY_BADGE_COLOURS: Record<GoogleAdsCampaignPriority, string> = {
  "must-run": "bg-red-100 text-red-800 border-red-200",
  highest: "bg-orange-100 text-orange-800 border-orange-200",
  high: "bg-yellow-100 text-yellow-800 border-yellow-200",
  medium: "bg-blue-100 text-blue-800 border-blue-200",
  low: "bg-zinc-100 text-zinc-700 border-zinc-200",
};

function makeCampaignId() {
  return `c_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyCampaign(): GoogleAdCampaign {
  return {
    id: makeCampaignId(),
    name: "",
    focus: "",
    ad_groups: [],
    monthly_budget: 0,
    priority: "medium",
    bidding_strategy: "max_conversions",
    notes: null,
  };
}

export function GoogleAdsPlanBuilder({ events, defaultEventId }: Props) {
  const router = useRouter();

  // ── Section 1: Strategy ────────────────────────────────────────────────
  const [eventId, setEventId] = useState<string>(defaultEventId ?? "");
  const [accounts, setAccounts] = useState<GoogleAdsAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [totalBudget, setTotalBudget] = useState<string>("");
  const [googleBudgetPct, setGoogleBudgetPct] = useState<string>(
    String(DEFAULT_GOOGLE_BUDGET_PCT),
  );
  const [biddingStrategy, setBiddingStrategy] =
    useState<GoogleAdsBiddingStrategy>("max_conversions");
  const [targetCpa, setTargetCpa] = useState<string>("");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");

  // ── Section 2: Campaigns ───────────────────────────────────────────────
  const [campaigns, setCampaigns] = useState<GoogleAdCampaign[]>([
    emptyCampaign(),
  ]);

  // ── Section 3: Geo ─────────────────────────────────────────────────────
  const [geoTargets, setGeoTargets] = useState<GoogleAdsGeoTarget[]>([]);

  // ── Section 4: RLSA & Scheduling ───────────────────────────────────────
  const [rlsa, setRlsa] = useState<GoogleAdsRlsaAdjustments>({
    visitors: 40,
    checkout_abandoners: 60,
  });
  const [scheduling, setScheduling] = useState<GoogleAdsScheduling>({
    weekends_boost: 20,
    payday_stretch: 0,
    offpeak_reduction: 30,
  });

  // ── Section 5: Conversion ──────────────────────────────────────────────
  const [conversionUrl, setConversionUrl] = useState("");
  const [trackingMethod, setTrackingMethod] = useState("google_tag");
  const [conversionNotes, setConversionNotes] = useState("");

  // ── Submit state ───────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-populate first geo target from selected event's venue city.
  useEffect(() => {
    if (!eventId || geoTargets.length > 0) return;
    const ev = events.find((e) => e.id === eventId);
    if (ev?.venue_city) {
      setGeoTargets([
        {
          country: "United Kingdom",
          city: ev.venue_city,
          bid_adjustment: 20,
        },
      ]);
    }
  }, [eventId, events, geoTargets.length]);

  useEffect(() => {
    fetch("/api/google-ads/accounts")
      .then((r) => r.json())
      .then((json) => {
        if (json?.ok) setAccounts(json.accounts as GoogleAdsAccount[]);
      })
      .catch(() => undefined);
  }, []);

  // Derived numbers
  const totalBudgetNum = Number(totalBudget) || 0;
  const googleBudgetPctNum = Number(googleBudgetPct) || 0;
  const suggestedGoogleBudget = useMemo(
    () => round2((totalBudgetNum * googleBudgetPctNum) / 100),
    [totalBudgetNum, googleBudgetPctNum],
  );
  const sumCampaignBudgets = useMemo(
    () => round2(campaigns.reduce((s, c) => s + (Number(c.monthly_budget) || 0), 0)),
    [campaigns],
  );

  // ── Mutators ────────────────────────────────────────────────────────────
  const addCampaign = () => {
    setCampaigns((prev) => [...prev, emptyCampaign()]);
  };
  const removeCampaign = (id: string) => {
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  };
  const updateCampaign = (id: string, patch: Partial<GoogleAdCampaign>) => {
    setCampaigns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  };

  const addGeoTarget = () => {
    setGeoTargets((prev) => [
      ...prev,
      { country: "", city: "", bid_adjustment: 0 },
    ]);
  };
  const updateGeoTarget = (
    idx: number,
    patch: Partial<GoogleAdsGeoTarget>,
  ) => {
    setGeoTargets((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
    );
  };
  const removeGeoTarget = (idx: number) => {
    setGeoTargets((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!eventId) {
      setError("Pick an event first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/google-ads/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          google_ads_account_id: accountId || null,
          total_budget: totalBudgetNum || null,
          google_budget: suggestedGoogleBudget || null,
          google_budget_pct: googleBudgetPctNum || null,
          bidding_strategy: biddingStrategy,
          target_cpa:
            biddingStrategy === "target_cpa"
              ? Number(targetCpa) || null
              : null,
          geo_targets: geoTargets,
          rlsa_adjustments: rlsa,
          ad_scheduling: scheduling,
          campaigns,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Failed to save plan.");
        return;
      }
      router.push("/google-ads");
      router.refresh();
    } catch {
      setError("Network error — couldn't reach the API.");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="space-y-6"
    >
      {/* Section 1 */}
      <Section
        title="1 · Strategy summary"
        description="Pick the event, account and bidding stance."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Select
            id="ga-event"
            label="Event"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="Select an event…"
            options={events.map((e) => ({
              value: e.id,
              label: e.venue_city ? `${e.name} · ${e.venue_city}` : e.name,
            }))}
          />
          <Select
            id="ga-account"
            label="Google Ads account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder={
              accounts.length === 0
                ? "No accounts linked yet"
                : "Select an account…"
            }
            options={accounts.map((a) => ({
              value: a.id,
              label: a.account_name,
            }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input
            id="ga-total-budget"
            label="Total digital budget (£)"
            inputMode="decimal"
            value={totalBudget}
            onChange={(e) => setTotalBudget(e.target.value)}
            placeholder="11450"
          />
          <Input
            id="ga-google-pct"
            label="Google allocation (%)"
            inputMode="decimal"
            value={googleBudgetPct}
            onChange={(e) => setGoogleBudgetPct(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              Suggested Google budget
            </label>
            <div className="flex h-9 items-center rounded-md border border-border bg-muted/50 px-3 text-sm font-medium">
              £{suggestedGoogleBudget.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Select
            id="ga-bidding"
            label="Bidding strategy"
            value={biddingStrategy}
            onChange={(e) =>
              setBiddingStrategy(e.target.value as GoogleAdsBiddingStrategy)
            }
            options={GOOGLE_ADS_BIDDING_STRATEGIES.map((b) => ({
              value: b.value,
              label: b.label,
            }))}
          />
          {biddingStrategy === "target_cpa" && (
            <Input
              id="ga-target-cpa"
              label="Target CPA (£)"
              inputMode="decimal"
              value={targetCpa}
              onChange={(e) => setTargetCpa(e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <Input
              id="ga-period-start"
              label="Start"
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
            <Input
              id="ga-period-end"
              label="End"
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
        </div>
      </Section>

      {/* Section 2 */}
      <Section
        title="2 · Campaigns"
        description="One row per Google Ads campaign in the plan. Reference the J2 Melodic mix: Brand, per-artist, Genre, RLSA."
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3">Campaign</th>
                <th className="py-2 pr-3">Focus</th>
                <th className="py-2 pr-3">Ad groups</th>
                <th className="py-2 pr-3">Monthly £</th>
                <th className="py-2 pr-3">Priority</th>
                <th className="py-2 pr-3">Notes</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="py-2 pr-3">
                    <input
                      value={c.name}
                      onChange={(e) =>
                        updateCampaign(c.id, { name: e.target.value })
                      }
                      placeholder="Brand: Junction 2"
                      className="h-8 w-44 rounded-md border border-border-strong bg-background px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={c.focus}
                      onChange={(e) =>
                        updateCampaign(c.id, { focus: e.target.value })
                      }
                      placeholder="Always-on brand"
                      className="h-8 w-40 rounded-md border border-border-strong bg-background px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {c.ad_groups.length} group{c.ad_groups.length === 1 ? "" : "s"}
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={c.monthly_budget || ""}
                      onChange={(e) =>
                        updateCampaign(c.id, {
                          monthly_budget: Number(e.target.value) || 0,
                        })
                      }
                      inputMode="decimal"
                      placeholder="80"
                      className="h-8 w-20 rounded-md border border-border-strong bg-background px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      value={c.priority}
                      onChange={(e) =>
                        updateCampaign(c.id, {
                          priority: e.target
                            .value as GoogleAdsCampaignPriority,
                        })
                      }
                      className={`h-8 rounded-md border px-2 text-xs font-medium ${
                        PRIORITY_BADGE_COLOURS[c.priority]
                      }`}
                    >
                      {GOOGLE_ADS_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={c.notes ?? ""}
                      onChange={(e) =>
                        updateCampaign(c.id, { notes: e.target.value || null })
                      }
                      placeholder="Optional"
                      className="h-8 w-48 rounded-md border border-border-strong bg-background px-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={() => removeCampaign(c.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove campaign"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="py-3 text-xs text-muted-foreground">
                  Sum of campaign budgets vs Google allocation
                </td>
                <td
                  className={`py-3 text-sm font-semibold ${
                    Math.abs(sumCampaignBudgets - suggestedGoogleBudget) < 0.01
                      ? "text-foreground"
                      : "text-amber-700"
                  }`}
                >
                  £{sumCampaignBudgets.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    / £{suggestedGoogleBudget.toLocaleString()}
                  </span>
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addCampaign}>
          <Plus className="h-3.5 w-3.5" />
          Add campaign
        </Button>
      </Section>

      {/* Section 3 */}
      <Section
        title="3 · Geographic targeting"
        description="Country + city stack with bid adjustments. The first row pre-populates from the event's venue city."
      >
        <div className="space-y-2">
          {geoTargets.map((g, idx) => (
            <div key={idx} className="flex flex-wrap items-end gap-2">
              <div className="w-44">
                <Input
                  id={`ga-geo-country-${idx}`}
                  label={idx === 0 ? "Country" : ""}
                  value={g.country}
                  onChange={(e) =>
                    updateGeoTarget(idx, { country: e.target.value })
                  }
                  placeholder="United Kingdom"
                />
              </div>
              <div className="w-44">
                <Input
                  id={`ga-geo-city-${idx}`}
                  label={idx === 0 ? "City (optional)" : ""}
                  value={g.city ?? ""}
                  onChange={(e) =>
                    updateGeoTarget(idx, { city: e.target.value || null })
                  }
                  placeholder="London"
                />
              </div>
              <div className="w-32">
                <Input
                  id={`ga-geo-bid-${idx}`}
                  label={idx === 0 ? "Bid adjustment %" : ""}
                  inputMode="decimal"
                  value={g.bid_adjustment}
                  onChange={(e) =>
                    updateGeoTarget(idx, {
                      bid_adjustment: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => removeGeoTarget(idx)}
                className="mb-2 text-muted-foreground hover:text-destructive"
                aria-label="Remove geo target"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addGeoTarget}>
          <Plus className="h-3.5 w-3.5" />
          Add location
        </Button>
      </Section>

      {/* Section 4 */}
      <Section
        title="4 · RLSA & Scheduling"
        description="Audience + day-parting modifiers. Numbers are bid adjustments in percent."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="ga-rlsa-visitors"
            label="Website visitors boost (%)"
            inputMode="decimal"
            value={rlsa.visitors ?? 0}
            onChange={(e) =>
              setRlsa((prev) => ({
                ...prev,
                visitors: Number(e.target.value) || 0,
              }))
            }
          />
          <Input
            id="ga-rlsa-abandoners"
            label="Checkout abandoners boost (%)"
            inputMode="decimal"
            value={rlsa.checkout_abandoners ?? 0}
            onChange={(e) =>
              setRlsa((prev) => ({
                ...prev,
                checkout_abandoners: Number(e.target.value) || 0,
              }))
            }
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Input
            id="ga-sched-weekend"
            label="Weekend boost (%)"
            inputMode="decimal"
            value={scheduling.weekends_boost ?? 0}
            onChange={(e) =>
              setScheduling((prev) => ({
                ...prev,
                weekends_boost: Number(e.target.value) || 0,
              }))
            }
          />
          <Input
            id="ga-sched-payday"
            label="Payday stretch (%)"
            inputMode="decimal"
            value={scheduling.payday_stretch ?? 0}
            onChange={(e) =>
              setScheduling((prev) => ({
                ...prev,
                payday_stretch: Number(e.target.value) || 0,
              }))
            }
          />
          <Input
            id="ga-sched-offpeak"
            label="Off-peak reduction (%)"
            inputMode="decimal"
            value={scheduling.offpeak_reduction ?? 0}
            onChange={(e) =>
              setScheduling((prev) => ({
                ...prev,
                offpeak_reduction: Number(e.target.value) || 0,
              }))
            }
          />
        </div>
      </Section>

      {/* Section 5 */}
      <Section
        title="5 · Conversion tracking"
        description="Where conversions are measured. This drives the CPA optimisation downstream."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            id="ga-conv-url"
            label="Conversion URL"
            type="url"
            value={conversionUrl}
            onChange={(e) => setConversionUrl(e.target.value)}
            placeholder="https://www.seetickets.com/event/.../confirmation"
          />
          <Select
            id="ga-conv-method"
            label="Tracking method"
            value={trackingMethod}
            onChange={(e) => setTrackingMethod(e.target.value)}
            options={[
              { value: "google_tag", label: "Google Tag (gtag.js)" },
              { value: "gtm", label: "Google Tag Manager" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ga-conv-notes" className="text-sm font-medium">
            Notes
          </label>
          <textarea
            id="ga-conv-notes"
            value={conversionNotes}
            onChange={(e) => setConversionNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm
              focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Any quirks the next person on the desk should know about."
          />
        </div>
      </Section>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <Button type="submit" disabled={saving || !eventId}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save Plan
        </Button>
        <Button
          type="button"
          disabled
          variant="outline"
          title="API credentials required"
        >
          <Search className="h-3.5 w-3.5" />
          Launch on Google Ads
        </Button>
        <span className="text-xs text-muted-foreground">
          Launch is gated until the Google Ads OAuth + API integration
          is connected.
        </span>
      </div>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-heading text-base tracking-wide">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
