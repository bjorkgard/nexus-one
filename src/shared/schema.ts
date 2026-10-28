import { z } from "zod";

// String caps. Producers may truncate display strings (name, title, text, error, model, tool,
// projectName) to these caps. Ids are never truncated: an over-cap id is rejected, and
// producers hash long native ids to a fixed length before emitting.
export const MAX_ID = 256;
export const MAX_SHORT = 200;
export const MAX_TEXT = 4000;
export const MAX_ERROR = 1000;
const MAX_ARGS_HASH = 64;

const id = z.string().min(1).max(MAX_ID);
const short = z.string().min(1).max(MAX_SHORT);
const count = z.int().min(0);

export const Provider = z.enum(["claude", "codex"]);
export const Stage = z.enum([
  "queued",
  "planning",
  "executing",
  "waiting_on_tool",
  "reviewing",
  "done",
]);
export const AgentOutcome = z.enum(["ok", "error", "cancelled"]);
export const ToolOutcome = z.enum(["ok", "error"]);
export const AttentionReason = z.enum(["permission", "question", "approval"]);
export const HandoffDirection = z.enum(["delegate", "return"]);
export const DequeueReason = z.enum(["started", "cancelled"]);
export const MessageRole = z.enum(["assistant", "user"]);

export type Provider = z.infer<typeof Provider>;
export type Stage = z.infer<typeof Stage>;
export type AgentOutcome = z.infer<typeof AgentOutcome>;
export type ToolOutcome = z.infer<typeof ToolOutcome>;
export type AttentionReason = z.infer<typeof AttentionReason>;
export type HandoffDirection = z.infer<typeof HandoffDirection>;
export type DequeueReason = z.infer<typeof DequeueReason>;
export type MessageRole = z.infer<typeof MessageRole>;

export const Project = z.strictObject({ id, name: short });
export const Session = z.strictObject({
  id,
  projectId: id,
  provider: Provider,
  startedAt: count,
  endedAt: count.nullable(),
});
export const Agent = z.strictObject({
  id,
  sessionId: id,
  provider: Provider,
  parentId: id.nullable(),
  name: short,
  model: short.nullable(),
  stage: Stage,
  lastProgressAt: count,
});

export type Project = z.infer<typeof Project>;
export type Session = z.infer<typeof Session>;
export type Agent = z.infer<typeof Agent>;

const envelope = { id, ts: count, sessionId: id };

export const SessionStart = z.strictObject({
  ...envelope,
  type: z.literal("session_start"),
  projectId: id,
  projectName: short,
  provider: Provider,
});
export const SessionEnd = z.strictObject({ ...envelope, type: z.literal("session_end") });
// The root agent is an agent_spawn with parentId null, sent right after session_start.
export const AgentSpawn = z.strictObject({
  ...envelope,
  type: z.literal("agent_spawn"),
  agentId: id,
  parentId: id.nullable(),
  name: short,
  model: short.nullable(),
});
export const AgentEnd = z.strictObject({
  ...envelope,
  type: z.literal("agent_end"),
  agentId: id,
  outcome: AgentOutcome,
});
export const Message = z.strictObject({
  ...envelope,
  type: z.literal("message"),
  agentId: id,
  role: MessageRole,
  text: z.string().min(1).max(MAX_TEXT),
});
// Usage of one model call. `input` excludes cached reads; total = input + output + cacheRead + cacheWrite.
export const Tokens = z.strictObject({
  ...envelope,
  type: z.literal("tokens"),
  agentId: id,
  model: short,
  input: count,
  output: count,
  cacheRead: count,
  cacheWrite: count,
});
// argsHash is hashed by the producer; raw tool arguments are never sent.
export const ToolCallStart = z.strictObject({
  ...envelope,
  type: z.literal("tool_call_start"),
  agentId: id,
  callId: id,
  tool: short,
  argsHash: z.string().min(1).max(MAX_ARGS_HASH).optional(),
});
export const ToolCallEnd = z.strictObject({
  ...envelope,
  type: z.literal("tool_call_end"),
  agentId: id,
  callId: id,
  outcome: ToolOutcome,
  error: z.string().min(1).max(MAX_ERROR).optional(),
});
export const NeedsAttention = z.strictObject({
  ...envelope,
  type: z.literal("needs_attention"),
  agentId: id,
  reason: AttentionReason,
});
export const AttentionCleared = z.strictObject({
  ...envelope,
  type: z.literal("attention_cleared"),
  agentId: id,
});
export const Handoff = z.strictObject({
  ...envelope,
  type: z.literal("handoff"),
  fromAgentId: id,
  toAgentId: id,
  direction: HandoffDirection,
});
export const TaskQueued = z.strictObject({
  ...envelope,
  type: z.literal("task_queued"),
  taskId: id,
  title: short,
});
export const TaskDequeued = z.strictObject({
  ...envelope,
  type: z.literal("task_dequeued"),
  taskId: id,
  reason: DequeueReason,
});

export const Event = z.discriminatedUnion("type", [
  SessionStart,
  SessionEnd,
  AgentSpawn,
  AgentEnd,
  Message,
  Tokens,
  ToolCallStart,
  ToolCallEnd,
  NeedsAttention,
  AttentionCleared,
  Handoff,
  TaskQueued,
  TaskDequeued,
]);
export type Event = z.infer<typeof Event>;
export type SessionStart = z.infer<typeof SessionStart>;
export type SessionEnd = z.infer<typeof SessionEnd>;
export type AgentSpawn = z.infer<typeof AgentSpawn>;
export type AgentEnd = z.infer<typeof AgentEnd>;
export type Message = z.infer<typeof Message>;
export type Tokens = z.infer<typeof Tokens>;
export type ToolCallStart = z.infer<typeof ToolCallStart>;
export type ToolCallEnd = z.infer<typeof ToolCallEnd>;
export type NeedsAttention = z.infer<typeof NeedsAttention>;
export type AttentionCleared = z.infer<typeof AttentionCleared>;
export type Handoff = z.infer<typeof Handoff>;
export type TaskQueued = z.infer<typeof TaskQueued>;
export type TaskDequeued = z.infer<typeof TaskDequeued>;

export const EVENT_TYPES: readonly Event["type"][] = Event.options.map(
  (option) => option.shape.type.value,
);

export type ParseIssue = { path: string; code: string };

// Trust edges (1.6 LiveSource, 4.1/4.2 adapters) must call parseEvent, not Event.parse:
// it never throws (even on hostile input) and returns plain issues.
export function parseEvent(
  input: unknown,
): { ok: true; event: Event } | { ok: false; issues: ParseIssue[] } {
  let result: ReturnType<typeof Event.safeParse>;
  try {
    result = Event.safeParse(input);
  } catch {
    return { ok: false, issues: [{ path: "", code: "parse_threw" }] };
  }
  if (result.success) {
    return { ok: true, event: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    })),
  };
}
