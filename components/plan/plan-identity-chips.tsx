import Link from "next/link";

import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { PlatformGlyph } from "@/components/viz/platform-glyph";
import { StatusDot } from "@/components/viz/status-dot";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import {
  EMPTY_IDENTITY_NAMES,
  identityChipTip,
  identityChipVisibleLabel,
  planIdentityChips,
  withIdentityNames,
  type IdentityNameMap,
  type PlanIdentityChip,
} from "@/lib/plan/identity-chips";
import { VIZ_TYPE, VIZ_TYPE_NUM, type VizStatus } from "@/lib/viz/tokens";

function provenanceStatus(chip: PlanIdentityChip): VizStatus {
  if (chip.provenance === "operator-override") return "live";
  if (chip.provenance === "client-default") return "ready";
  return "idle";
}

function IdentityChip({ chip }: { chip: PlanIdentityChip }) {
  const visible = identityChipVisibleLabel(chip);
  const missing = visible == null;
  const unresolved = !!chip.value && !chip.name;

  if (missing) {
    const body = (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 ${VIZ_TYPE.label} text-muted-foreground`}
      >
        <span aria-hidden="true">┄</span>
        {chip.field} not set
      </span>
    );
    if (chip.href) {
      return (
        <Link href={chip.href} className="rounded-full hover:opacity-80">
          {body}
        </Link>
      );
    }
    return body;
  }

  const body = (
    <MetricChip label={`${chip.platform} ${chip.field}`}>
      <PlatformGlyph platform={chip.platform} size="sm" />
      <span
        className={`max-w-[11rem] truncate ${unresolved ? `${VIZ_TYPE_NUM.body} opacity-60` : VIZ_TYPE.body}`}
      >
        {visible}
      </span>
      {unresolved ? (
        <span aria-label="name unknown" title="name unknown" className={VIZ_TYPE.label}>
          ┄
        </span>
      ) : null}
      <InfoTip label={identityChipTip(chip)} />
      <StatusDot status={provenanceStatus(chip)} />
    </MetricChip>
  );
  if (chip.href) {
    return (
      <Link href={chip.href} className="rounded-full hover:opacity-80">
        {body}
      </Link>
    );
  }
  return body;
}

export function PlanIdentityChips({
  resolved,
  names = EMPTY_IDENTITY_NAMES,
}: {
  resolved: ResolvedChannelDefaults | null;
  names?: IdentityNameMap;
}) {
  if (!resolved?.clientId) return null;
  const chips = withIdentityNames(planIdentityChips(resolved), names);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="plan-identity-chips">
      {chips.map((chip) => (
        <IdentityChip key={chip.id} chip={chip} />
      ))}
    </div>
  );
}
