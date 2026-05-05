"use client";

import { Info } from "lucide-react";

import { CopyToClipboard } from "@/components/dashboard/events/copy-to-clipboard";
import { TicketTierChannelEditCell } from "@/components/dashboard/events/ticket-tier-channel-breakdown";
import type { EventTicketTierRow } from "@/lib/db/ticketing";
import {
  activeChannelsForTiers,
  channelCellForTier,
  tierPctFromRollup,
  tierSalesRollup,
  type TierChannelDescriptor,
} from "@/lib/dashboard/tier-channel-rollups";
import { suggestedCommsPhrase, type CommsPhrase } from "@/lib/dashboard/comms-phrase";
import {
  suggestedPct,
  tierSaleStatus,
  type SuggestedPct,
} from "@/lib/dashboard/suggested-pct";

interface Props {
  tiers: EventTicketTierRow[];
  title?: string;
  emptyMessage?: string;
  compact?: boolean;
  eventId?: string;
  channelEditApiBase?: string;
  canEditChannels?: boolean;
  onAfterChannelMutate?: () => void;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-GB");
const CHANNEL_TINT: Record<string, string> = {
  "4TF": "bg-emerald-50 text-emerald-950",
  Eventbrite: "bg-emerald-50 text-emerald-950",
  Venue: "bg-blue-50 text-blue-950",
  SeeTickets: "bg-amber-50 text-amber-950",
  CP: "bg-purple-50 text-purple-950",
  DS: "bg-purple-50 text-purple-950",
  Other: "bg-slate-50 text-slate-950",
};

export function TicketTiersSection({
  tiers,
  title = "Ticket Tiers",
  emptyMessage = "No ticket tier breakdown has been synced yet.",
  compact = false,
  eventId,
  channelEditApiBase,
  canEditChannels = false,
  onAfterChannelMutate,
}: Props) {
  const sortedTiers = [...tiers].sort(compareTierRows);
  const activeChannels = activeChannelsForTiers(tiers);

  return (
    <section className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          className={
            compact
              ? "font-heading text-sm tracking-wide text-foreground"
              : "font-heading text-lg tracking-wide text-foreground"
          }
        >
          {title}
        </h2>
        <span
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          title="Marketing comms figure. Floor 60%, +20% padding through to 95% suggested at 75% actual, then linear to 99%. Sold-out tiers show SOLD OUT."
        >
          <Info className="h-3 w-3" />
          Suggested comms %
        </span>
      </div>
      {tiers.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/70 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2 text-right">Sold / Allocation</th>
                {activeChannels.map((channel) => (
                  <th
                    key={channel.channel_id}
                    className="px-3 py-2 text-right"
                  >
                    {channel.display_label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">% sold</th>
                <th className="px-3 py-2 text-right">Suggested</th>
                <th className="px-3 py-2 text-right">Comms</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Edit</th>
              </tr>
            </thead>
            <tbody>
              {sortedTiers.map((tier) => {
                const price = tier.price == null ? null : Number(tier.price);
                const rollup = tierSalesRollup(tier);
                const actualPct = tierPctFromRollup(rollup);
                const saleStatus = tierSaleStatus(
                  rollup.sold,
                  rollup.allocation,
                );
                const soldOut =
                  rollup.allocation != null &&
                  rollup.allocation > 0 &&
                  rollup.sold >= rollup.allocation;
                const suggested =
                  saleStatus === "on_sale_soon"
                    ? "ON SALE SOON"
                    : actualPct == null
                      ? null
                      : suggestedPct(actualPct, { isSoldOut: soldOut });
                const comms = suggestedCommsPhrase(suggested, saleStatus);
                return (
                  <tr key={tier.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {tier.tier_name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      <span>{NUM.format(rollup.sold)}</span>
                      {" / "}
                      {rollup.allocation == null
                        ? "—"
                        : NUM.format(rollup.allocation)}
                      {soldOut ? (
                        <span className="ml-2 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive">
                          Sold out
                        </span>
                      ) : null}
                    </td>
                    {activeChannels.map((channel) => (
                      <ChannelValueCell
                        key={channel.channel_id}
                        channel={channel}
                        tier={tier}
                      />
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {actualPct == null ? "—" : `${Math.round(actualPct)}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <SuggestedValue value={suggested} suffix=" sold" />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CommsChip phrase={comms} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {price == null || !Number.isFinite(price)
                        ? "—"
                        : GBP.format(price)}
                    </td>
                    <TicketTierChannelEditCell
                      eventId={eventId}
                      tier={tier}
                      canEdit={canEditChannels}
                      apiBase={channelEditApiBase}
                      onAfterMutate={onAfterChannelMutate}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ChannelValueCell({
  channel,
  tier,
}: {
  channel: TierChannelDescriptor;
  tier: EventTicketTierRow;
}) {
  const value = channelCellForTier(tier, channel.channel_id);
  const oversold = value.allocation == null && value.sold > 0;
  const tint =
    CHANNEL_TINT[channel.channel_name] ?? "bg-muted text-muted-foreground";
  return (
    <td className="px-3 py-2 text-right tabular-nums">
      {value.hasData ? (
        <span
          className={`inline-flex rounded px-1.5 py-0.5 text-[11px] ${oversold ? "bg-destructive/10 text-destructive" : tint}`}
          title={oversold ? "Sold count exists without a channel allocation" : undefined}
        >
          {NUM.format(value.sold)}
          {" / "}
          {value.allocation == null ? "—" : NUM.format(value.allocation)}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </td>
  );
}

function CommsChip({ phrase }: { phrase: CommsPhrase }) {
  const display = phrase.primary === "SOLD OUT" ? "SOLD OUT" : phrase.short;
  return (
    <CopyToClipboard
      text={phrase.primary}
      title={`${phrase.primary} — click to copy`}
      className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
    >
      {display}
    </CopyToClipboard>
  );
}

function tierPct(tier: EventTicketTierRow): number | null {
  return tierPctFromRollup(tierSalesRollup(tier));
}

function SuggestedValue({
  value,
  suffix = "",
}: {
  value: SuggestedPct | null;
  suffix?: string;
}) {
  if (value == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (value === "SOLD OUT") {
    return (
      <span className="font-semibold uppercase tracking-wide text-destructive">
        SOLD OUT
      </span>
    );
  }
  if (value === "ON SALE SOON") {
    return <span className="italic text-muted-foreground">On Sale Soon</span>;
  }
  return (
    <span className="text-muted-foreground">
      {Math.round(value)}%{suffix}
    </span>
  );
}

function compareTierRows(a: EventTicketTierRow, b: EventTicketTierRow): number {
  const aPct = tierPct(a);
  const bPct = tierPct(b);
  const aBucket = tierSortBucket(aPct);
  const bBucket = tierSortBucket(bPct);
  if (aBucket !== bBucket) return aBucket - bBucket;
  if (aPct != null && bPct != null && aPct !== bPct) return bPct - aPct;
  return a.tier_name.localeCompare(b.tier_name);
}

function tierSortBucket(pct: number | null): number {
  if (pct != null && pct >= 100) return 0;
  if (pct != null && pct > 0) return 1;
  return 2;
}
