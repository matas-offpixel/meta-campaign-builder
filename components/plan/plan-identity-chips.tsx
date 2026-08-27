import Link from "next/link";

import { MetricChip } from "@/components/viz/metric-chip";
import { PlatformGlyph } from "@/components/viz/platform-glyph";
import { StatusDot } from "@/components/viz/status-dot";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import {
  identityChipDisplay,
  planIdentityChips,
  type PlanIdentityChip,
} from "@/lib/plan/identity-chips";
import type { VizStatus } from "@/lib/viz/tokens";

function provenanceStatus(chip: PlanIdentityChip): VizStatus {
  if (chip.provenance === "operator-override") return "live";
  if (chip.provenance === "client-default") return "ready";
  return "idle";
}

function IdentityChip({ chip }: { chip: PlanIdentityChip }) {
  const body = (
    <MetricChip label={`${chip.platform} ${chip.field}`}>
      <PlatformGlyph platform={chip.platform} size="sm" />
      <span className="max-w-[9rem] truncate">{identityChipDisplay(chip.value)}</span>
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
}: {
  resolved: ResolvedChannelDefaults | null;
}) {
  if (!resolved?.clientId) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="plan-identity-chips">
      {planIdentityChips(resolved).map((chip) => (
        <IdentityChip key={chip.id} chip={chip} />
      ))}
    </div>
  );
}
