import { MCP_TODAY, type McpTodayFrameId } from "@/scripts/plan-frames/mcp-today-fixtures";
import { TODAY_META_WORDS } from "@/lib/mcp/today/words";
import { ClaudeChanges } from "./claude-changes";
import { ClaudeMetaRow } from "./claude-meta-row";

/** MB-A, MB-B, FC-A and FC-B, drawn by Today's own components from the records' rows. */
export function McpTodayFrameMount({ id }: { id: McpTodayFrameId }) {
  const shell = (body: React.ReactNode) => (
    <main data-frame-ready={`mcp-today/${id}`} className="mx-auto w-full max-w-[1280px] space-y-4 px-4 py-6">
      <p className="text-xs text-muted-foreground">Today</p>
      {body}
    </main>
  );
  if (id === "mb-a" || id === "fc-a") {
    const { log, count } = id === "mb-a" ? MCP_TODAY.mbA() : MCP_TODAY.fcA();
    return shell(<ClaudeChanges title={TODAY_META_WORDS["today.mcp.title"]} count={count} waiting={log.waiting} entries={log.rows.map((row) => ({ kind: "meta" as const, at: row.at, row }))} />);
  }
  const groups: Array<{ lead: string; row: Parameters<typeof ClaudeMetaRow>[0]["row"]; openAsked?: boolean; confirmOpen?: boolean }> = id === "mb-b" ? MCP_TODAY.mbB() : MCP_TODAY.fcB();
  return shell(
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.lead} className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{g.lead}</p>
          <ul className="space-y-2">
            <ClaudeMetaRow row={g.row} openAsked={g.openAsked} confirmOpen={g.confirmOpen} />
          </ul>
        </div>
      ))}
    </div>,
  );
}
