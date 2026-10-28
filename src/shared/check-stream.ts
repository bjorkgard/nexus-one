import { parseEvent, type Event } from "./schema";

export type StreamIssueCode =
  | "parse"
  | "bad_options"
  | "iterable_threw"
  | "ts_decreased"
  | "duplicate_id"
  | "duplicate_session"
  | "duplicate_agent"
  | "duplicate_call"
  | "duplicate_task"
  | "unknown_session"
  | "unknown_agent"
  | "end_without_start"
  | "orphan_subagent"
  | "event_after_session_end"
  | "event_after_agent_end"
  | "agent_session_mismatch"
  | "attention_already_open"
  | "attention_not_open"
  | "handoff_endpoint"
  | "dequeue_without_queue"
  | "open_at_end";

export type StreamIssue = { code: StreamIssueCode; index: number; message: string };
export type StreamCheck = { ok: boolean; issues: StreamIssue[]; total: number };

export const MAX_REPORTED_ISSUES = 100;

type AgentState = { sessionId: string; ended: boolean; calls: Set<string>; attention: boolean };
type TaskState = { dequeued: boolean };

// Single pass over a stream. Never throws: a broken invariant, an invalid event or an iterable that
// throws becomes an issue. Keeps every event id (duplicate detection), so memory is O(events), but
// only the first MAX_REPORTED_ISSUES issues are kept; `total` counts all of them.
// complete: false allows open items at the end (a prefix of a stream, as 1.6 replays).
// Options that cannot be read (null, a hostile proxy) give one bad_options issue.
export function checkStream(
  events: Iterable<Event>,
  options: { complete?: boolean } = {},
): StreamCheck {
  const issues: StreamIssue[] = [];
  let total = 0;
  const report = (code: StreamIssueCode, index: number, message: string) => {
    total += 1;
    if (issues.length < MAX_REPORTED_ISSUES) {
      issues.push({ code, index, message });
    }
  };

  let complete: boolean;
  try {
    complete = options.complete ?? true;
  } catch (error) {
    report("bad_options", 0, `options cannot be read: ${describeThrown(error)}`);
    return { ok: false, issues, total };
  }

  const ids = new Set<string>();
  const sessions = new Map<string, { ended: boolean }>();
  const agents = new Map<string, AgentState>();
  const tasks = new Map<string, TaskState>();
  let lastTs = 0;
  let index = 0;

  // Each handler returns the issue for one event, or null when the event is consistent.
  type Fault = [StreamIssueCode, string] | null;

  const live = (agentId: string, sessionId: string): AgentState | [StreamIssueCode, string] => {
    const agent = agents.get(agentId);
    if (!agent) return ["unknown_agent", `agent ${agentId} was never spawned`];
    if (agent.ended) return ["event_after_agent_end", `agent ${agentId} already ended`];
    if (agent.sessionId !== sessionId) {
      return ["agent_session_mismatch", `agent ${agentId} belongs to ${agent.sessionId}`];
    }
    return agent;
  };

  const withAgent = (
    agentId: string,
    sessionId: string,
    use: (agent: AgentState) => Fault,
  ): Fault => {
    const agent = live(agentId, sessionId);
    return Array.isArray(agent) ? agent : use(agent);
  };

  const handle = (e: Event): Fault => {
    switch (e.type) {
      case "session_start":
        if (sessions.has(e.sessionId))
          return ["duplicate_session", `session ${e.sessionId} restarted`];
        sessions.set(e.sessionId, { ended: false });
        return null;
      case "session_end":
        sessions.get(e.sessionId)!.ended = true;
        return null;
      case "agent_spawn":
        return spawn(e);
      case "agent_end":
        return withAgent(e.agentId, e.sessionId, (agent) => {
          agent.ended = true;
          return null;
        });
      case "message":
      case "tokens":
        return withAgent(e.agentId, e.sessionId, () => null);
      case "tool_call_start":
        return withAgent(e.agentId, e.sessionId, (agent) => {
          if (agent.calls.has(e.callId)) return ["duplicate_call", `call ${e.callId} already open`];
          agent.calls.add(e.callId);
          return null;
        });
      case "tool_call_end":
        return withAgent(e.agentId, e.sessionId, (agent) =>
          agent.calls.delete(e.callId)
            ? null
            : ["end_without_start", `call ${e.callId} is not open`],
        );
      case "needs_attention":
        return withAgent(e.agentId, e.sessionId, (agent) => {
          if (agent.attention) return ["attention_already_open", `agent ${e.agentId} is waiting`];
          agent.attention = true;
          return null;
        });
      case "attention_cleared":
        return withAgent(e.agentId, e.sessionId, (agent) => {
          if (!agent.attention) return ["attention_not_open", `agent ${e.agentId} is not waiting`];
          agent.attention = false;
          return null;
        });
      case "handoff":
        return handoff(e.fromAgentId, e.toAgentId);
      case "task_queued":
        if (tasks.has(e.taskId)) return ["duplicate_task", `task ${e.taskId} already queued`];
        tasks.set(e.taskId, { dequeued: false });
        return null;
      case "task_dequeued": {
        const task = tasks.get(e.taskId);
        if (!task || task.dequeued)
          return ["dequeue_without_queue", `task ${e.taskId} is not queued`];
        task.dequeued = true;
        return null;
      }
    }
  };

  const spawn = (e: Extract<Event, { type: "agent_spawn" }>): Fault => {
    if (agents.has(e.agentId)) return ["duplicate_agent", `agent ${e.agentId} spawned twice`];
    const parent = e.parentId === null ? undefined : agents.get(e.parentId);
    // Register the agent even when orphaned, so one fault does not cascade into later events.
    agents.set(e.agentId, {
      sessionId: e.sessionId,
      ended: false,
      calls: new Set(),
      attention: false,
    });
    if (e.parentId !== null && (!parent || parent.ended)) {
      return ["orphan_subagent", `parent ${e.parentId} is not live`];
    }
    return null;
  };

  const handoff = (from: string, to: string): Fault => {
    for (const agentId of [from, to]) {
      const agent = agents.get(agentId);
      if (!agent || agent.ended) return ["handoff_endpoint", `agent ${agentId} is not live`];
    }
    return null;
  };

  // Faults every event shares: id, ts order, and the state of its session.
  const envelope = (e: Event): Fault => {
    if (ids.has(e.id)) return ["duplicate_id", `id ${e.id} seen before`];
    ids.add(e.id);
    const decreased = e.ts < lastTs;
    const previous = lastTs;
    lastTs = e.ts;
    if (decreased) return ["ts_decreased", `ts ${e.ts} is before ${previous}`];
    if (e.type === "session_start") return null;
    const session = sessions.get(e.sessionId);
    if (!session) return ["unknown_session", `session ${e.sessionId} was never started`];
    if (session.ended) return ["event_after_session_end", `session ${e.sessionId} already ended`];
    return null;
  };

  try {
    for (const input of events) {
      const parsed = parseEvent(input);
      if (!parsed.ok) {
        const detail = parsed.issues.map((issue) => `${issue.path}:${issue.code}`).join(", ");
        report("parse", index, `event does not parse (${detail})`);
      } else {
        const fault = envelope(parsed.event) ?? handle(parsed.event);
        if (fault) report(fault[0], index, fault[1]);
      }
      index += 1;
    }
  } catch (error) {
    report("iterable_threw", index, `iterable threw: ${describeThrown(error)}`);
    return { ok: false, issues, total };
  }

  if (complete) {
    reportOpen(sessions, agents, index, report);
  }
  return { ok: total === 0, issues, total };
}

// Never throws: String() and toString.call() both fail on revoked or hostile proxies.
function describeThrown(error: unknown): string {
  try {
    return String(error);
  } catch {
    try {
      return Object.prototype.toString.call(error);
    } catch {
      return "<unprintable value>";
    }
  }
}

function reportOpen(
  sessions: Map<string, { ended: boolean }>,
  agents: Map<string, AgentState>,
  index: number,
  report: (code: StreamIssueCode, index: number, message: string) => void,
): void {
  for (const [id, session] of sessions) {
    if (!session.ended) report("open_at_end", index, `session ${id} never ended`);
  }
  for (const [id, agent] of agents) {
    if (!agent.ended) report("open_at_end", index, `agent ${id} never ended`);
    for (const callId of agent.calls) report("open_at_end", index, `call ${callId} never ended`);
    if (agent.attention) report("open_at_end", index, `attention of ${id} never cleared`);
  }
}
