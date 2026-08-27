import { PlatformGlyph } from "./platform-glyph";
import type { VizPlatform } from "@/lib/viz/tokens";

export function PlatformToggle({
  platform,
  checked,
  onChange,
}: {
  platform: VizPlatform;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={platform}
      />
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full border border-border ${
          checked ? "bg-success/40" : "bg-muted"
        }`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-foreground transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
      <PlatformGlyph
        platform={platform}
        size="sm"
        className={checked ? "" : "text-muted-foreground"}
      />
    </label>
  );
}
