import type { ReactNode } from "react";

import {
  VIZ_CLIENT_SAFE,
  VIZ_LINE_TOKEN,
  VIZ_TYPE,
} from "@/lib/viz/tokens";

export type LockedReason =
  | {
      kind: "history";
      sentence: string;
      progress?: { n: number; of: number } | { days: number };
    }
  | { kind: "system"; sentence: string };

export function Locked({
  reason,
  role = "operator",
  children,
}: {
  reason: LockedReason;
  role?: "operator" | "client";
  children: ReactNode;
}) {
  const sentence =
    role === "client" && reason.kind === "system"
      ? VIZ_CLIENT_SAFE(reason.sentence)
      : reason.sentence;
  const progress =
    reason.kind === "history" && reason.progress
      ? "days" in reason.progress
        ? `(${reason.progress.days} days)`
        : `(${reason.progress.n} of ${reason.progress.of})`
      : null;

  return (
    <div
      className={`space-y-2 border p-3 ${VIZ_LINE_TOKEN["not-yet"]}`}
      data-locked={reason.kind}
      data-role={role}
    >
      <div className="text-foreground/35">{children}</div>
      <p className={VIZ_TYPE.body}>{sentence}</p>
      {progress ? <span className={VIZ_TYPE.micro}>{progress}</span> : null}
    </div>
  );
}
