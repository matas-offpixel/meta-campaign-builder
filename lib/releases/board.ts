export type BoardStatus = "approved" | "proposed" | "locked" | "missing" | "na" | "held";

export type BoardCell = { status: BoardStatus; makeable?: boolean };

export function boardCounts(cells: readonly BoardCell[]): {
  approved: number;
  proposed: number;
  locked: number;
  missing: number;
  makeable: number;
} {
  const count = (status: BoardStatus) => cells.filter((cell) => cell.status === status).length;
  const missing = cells.filter((cell) => cell.status === "missing");
  return {
    approved: count("approved"),
    proposed: count("proposed"),
    locked: count("locked"),
    missing: missing.length,
    makeable: missing.filter((cell) => cell.makeable).length,
  };
}

/** Counts only missing cells that can be made. With none, it makes nothing and says so. */
export function makeMissing(cells: readonly BoardCell[]): { made: number; said: string } {
  const n = cells.filter((cell) => cell.status === "missing" && cell.makeable).length;
  if (n === 0) return { made: 0, said: "Nothing to make. The missing cells need a piece." };
  return { made: n, said: `Made ${n}.` };
}
