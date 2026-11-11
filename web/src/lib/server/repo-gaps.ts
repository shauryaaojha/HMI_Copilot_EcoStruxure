/**
 * What the product could not do when it was asked: the gap log.
 *
 * When Claude (through the connector) or the Copilot asks for something the
 * ops cannot express - an object type there is no part for, a property OTE
 * has but this app does not write, a tool that failed - the answer goes back
 * to the model as a refusal and is then forgotten. This keeps one row per
 * refusal so the next round of work can start from what people actually
 * asked for. Rows are global, not project data: they outlive the project,
 * because the point is the product, not the project.
 *
 * Read with `npm run db -- gaps`.
 */
import { type Row } from "./storage";
import type { Clock, Tx } from "./repo-collab";

/** Where the refusal came from. */
export type GapSource = "mcp-proposal" | "mcp-direct" | "mcp-tool";

export type Gap = Row & {
  at: number;
  source: GapSource;
  /** The tool that was called, for an MCP refusal. */
  tool?: string;
  projectId?: string;
  userId?: string;
  /** What the change was for, as the caller put it. */
  request?: string;
  /** The refusal itself, one line. */
  detail: string;
  /** A refusal code, when the failure had one. */
  code?: string;
};

/** What recording a gap needs; `Omit` would collapse over Row's index signature. */
export type GapInput = Pick<Gap, "source" | "detail"> & Partial<Pick<Gap, "tool" | "projectId" | "userId" | "request" | "code">>;

export interface GapsRepo {
  record(rows: GapInput[]): Promise<void>;
  /** Newest first. */
  list(limit?: number): Promise<Gap[]>;
}

/** Long enough for a refusal reason, short enough that one bad call cannot fill the database. */
const DETAIL_MAX = 600;
const REQUEST_MAX = 300;
/** One call never writes more than this many rows. */
const ROWS_MAX = 50;

const cut = (text: string | undefined, max: number) => (text === undefined ? undefined : text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function gapsRepo(tx: Tx, now: Clock, read: Tx = tx): GapsRepo {
  return {
    record: rows => tx(async d => {
      if (rows.length === 0) return;
      const at = now();
      await d.putMany(
        "gaps",
        rows.slice(0, ROWS_MAX).map(row => {
          const out: Gap = { _id: crypto.randomUUID(), at, source: row.source, detail: cut(row.detail, DETAIL_MAX) ?? "" };
          if (row.tool) out.tool = row.tool;
          if (row.projectId) out.projectId = row.projectId;
          if (row.userId) out.userId = row.userId;
          if (row.request) out.request = cut(row.request, REQUEST_MAX);
          if (row.code) out.code = row.code;
          return out;
        }),
      );
    }),
    list: (limit = 200) => read(d => d.list<Gap>("gaps", {}, { sort: { at: -1 }, limit })),
  };
}
