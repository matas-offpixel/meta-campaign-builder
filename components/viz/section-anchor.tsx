import type { ReactNode } from "react";
import { ArrowLeftRight, Image } from "lucide-react";

import { InfoTip } from "./info-tip";

const ICONS = {
  assets: Image,
  derive: ArrowLeftRight,
} as const;

export function SectionAnchor({
  kind,
  tip,
  icon,
  label,
}: {
  kind?: keyof typeof ICONS;
  tip: string;
  icon?: ReactNode;
  label: string;
}) {
  const Glyph = kind ? ICONS[kind] : null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex text-muted-foreground" aria-label={label}>
        {icon ??
          (Glyph ? <Glyph className="h-4 w-4" aria-hidden="true" /> : null)}
      </span>
      <InfoTip label={tip} />
    </div>
  );
}
