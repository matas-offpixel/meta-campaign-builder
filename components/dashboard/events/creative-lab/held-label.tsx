import type { ReactNode } from "react";

/** The pending word sits on the resting word, so the button does not change width. */
export function HeldLabel({
  idle,
  pending,
  active,
}: {
  idle: ReactNode;
  pending: ReactNode;
  active: boolean;
}) {
  return (
    <span className={`inline-grid place-items-center ${active ? "opacity-60" : ""}`}>
      <span className={`col-start-1 row-start-1 ${active ? "invisible" : ""}`}>{idle}</span>
      <span className={`col-start-1 row-start-1 inline-flex items-center gap-1 ${active ? "" : "invisible"}`}>{pending}</span>
    </span>
  );
}
