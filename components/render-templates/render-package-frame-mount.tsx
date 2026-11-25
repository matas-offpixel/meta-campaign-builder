import { ES27, ES27_MUTED, MA4_ROWS, P26, P26_MUTED, RT_B_ROWS, RY_A, type RenderPackageFrameId } from "@/scripts/plan-frames/render-package-fixtures";
import { pickerHeader, recipeCards } from "@/lib/render-templates/package-view";
import { refusedTodayRow, renderRowView, todayRow } from "@/lib/render-templates/report";
import { today } from "@/lib/render-templates/words";
import { busyRefusal, tooSoonRefusal } from "@/lib/render-templates/store";
import { RenderPackagePicker, RenderRowsList, TodayClaudeLog, type TodayLogEntry } from "@/components/render-templates/render-package-view";

/** The frames for M4a (RT-A, RT-B, RY-A), drawn by the live components from fixtures. */
export function RenderPackageFrameMount({ id }: { id: RenderPackageFrameId }) {
  const shell = (title: string, body: React.ReactNode) => (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <p className="text-xs text-muted-foreground">{title}</p>
      {body}
    </main>
  );
  if (id === "rt-a-p26") return shell("Events › P26-BDAY › Creative Lab", <RenderPackagePicker header={pickerHeader(P26)} cards={recipeCards(P26, P26_MUTED)} />);
  if (id === "rt-a-es27") return shell("Events › ES27-ENZOSIRAGUSA › Creative Lab", <RenderPackagePicker header={pickerHeader(ES27)} cards={recipeCards(ES27, ES27_MUTED)} />);
  if (id === "ma1-busy") return shell("Events › P26-BDAY › Creative Lab", <RenderPackagePicker header={pickerHeader(P26)} cards={recipeCards(P26, P26_MUTED).slice(0, 1)} error={busyRefusal("P26-BDAY").lab} />);
  if (id === "ma1-too-soon") return shell("Events › P26-BDAY › Creative Lab", <RenderPackagePicker header={pickerHeader(P26)} cards={recipeCards(P26, P26_MUTED).slice(0, 1)} error={tooSoonRefusal("P26-BDAY", "montage", 42).lab} />);
  if (id === "ma4-not-filed") return shell("Events › P26-BDAY › Creative Lab › Renders", <RenderRowsList rows={MA4_ROWS.map((r) => renderRowView(r, "Puzzle"))} />);
  if (id === "rt-b") return shell("Events › P26-BDAY › Creative Lab › Renders", <RenderRowsList rows={RT_B_ROWS.map((r) => renderRowView(r, "Puzzle"))} />);
  const entries: TodayLogEntry[] = [
    { kind: "package", row: todayRow(RY_A.glitter.pkg, RY_A.glitter.files) },
    { kind: "package", row: todayRow(RY_A.p26.pkg, RY_A.p26.files), open: id === "ry-a-open" },
    ...RY_A.refused.map((r) => ({ kind: "refused" as const, row: refusedTodayRow(r) })),
  ];
  return shell("Today", <TodayClaudeLog title={today("today.mcp.title")} count={today("today.mcp.count.changes", { n: entries.length })} entries={entries} />);
}
