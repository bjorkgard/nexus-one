import { z } from "zod";
import { Agent, Event, MAX_ID, MAX_SHORT, Project, Session, type ParseIssue } from "./schema";

// Wire protocol between the collector (4.4) and a LiveSource. Event shapes live only in
// schema.ts; this file adds the envelope messages and the snapshot.
export const PROTOCOL_VERSION = 1;
export const DEFAULT_LIVE_PORT = 47821;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const RECENT_IDS_CAP = 4096;

const id = z.string().min(1).max(MAX_ID);
const short = z.string().min(1).max(MAX_SHORT);
const count = z.int().min(0);

// Arrays of records, never objects keyed by wire ids (an id may be "__proto__").
export const OpenCall = z.strictObject({ agentId: id, callId: id, tool: short, startedAt: count });
export const QueuedTask = z.strictObject({
  taskId: id,
  sessionId: id,
  title: short,
  queuedAt: count,
});
export const Attention = z.strictObject({
  agentId: id,
  reason: z.enum(["permission", "question", "approval"]),
  since: count,
});
// Sums per agent AND model.
export const Usage = z.strictObject({
  agentId: id,
  model: short,
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite: count,
});

export const Snapshot = z.strictObject({
  projects: z.array(Project),
  sessions: z.array(Session),
  agents: z.array(Agent),
  openCalls: z.array(OpenCall),
  queuedTasks: z.array(QueuedTask),
  attention: z.array(Attention),
  usage: z.array(Usage),
  // Newest last. Seeds the client's apply-once ring so a replayed event is not applied twice.
  recentIds: z.array(id).max(RECENT_IDS_CAP),
});

export type OpenCall = z.infer<typeof OpenCall>;
export type QueuedTask = z.infer<typeof QueuedTask>;
export type Attention = z.infer<typeof Attention>;
export type Usage = z.infer<typeof Usage>;
export type Snapshot = z.infer<typeof Snapshot>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello"), v: z.int(), epoch: id }),
  z.strictObject({
    type: z.literal("snapshot"),
    epoch: id,
    seq: z.int().min(0),
    snapshot: Snapshot,
  }),
  z.strictObject({ type: z.literal("event"), epoch: id, seq: z.int().min(1), event: Event }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// Trust edge for frames from the collector: never throws, returns plain issues.
export function parseServerMessage(
  input: unknown,
): { ok: true; message: ServerMessage } | { ok: false; issues: ParseIssue[] } {
  let result: ReturnType<typeof ServerMessage.safeParse>;
  try {
    result = ServerMessage.safeParse(input);
  } catch {
    return { ok: false, issues: [{ path: "", code: "parse_threw" }] };
  }
  if (result.success) {
    return { ok: true, message: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    })),
  };
}
