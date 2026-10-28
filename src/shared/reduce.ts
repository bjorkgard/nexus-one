import type { Attention, OpenCall, QueuedTask, Snapshot, Usage } from "./protocol";
import type { Agent, Event, Project, Session } from "./schema";

// Pure reducer over the 13 event types. Maps (never plain objects) hold wire-id keys, so an id such
// as "__proto__" is an ordinary key. Copy-on-write: only the touched Map or record is copied.
export type NexusState = {
  readonly projects: ReadonlyMap<string, Project>;
  readonly sessions: ReadonlyMap<string, Session>;
  readonly agents: ReadonlyMap<string, Agent>;
  readonly openCalls: ReadonlyMap<string, OpenCall>;
  readonly queuedTasks: ReadonlyMap<string, QueuedTask>;
  readonly attention: ReadonlyMap<string, Attention>;
  // Keyed by usageKey(agentId, model).
  readonly usage: ReadonlyMap<string, Usage>;
};

export type ReduceResult = { state: NexusState; inconsistent: boolean };

export function emptyState(): NexusState {
  return {
    projects: new Map(),
    sessions: new Map(),
    agents: new Map(),
    openCalls: new Map(),
    queuedTasks: new Map(),
    attention: new Map(),
    usage: new Map(),
  };
}

export function usageKey(agentId: string, model: string): string {
  return JSON.stringify([agentId, model]);
}

function put<V>(map: ReadonlyMap<string, V>, key: string, value: V): Map<string, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

function drop<V>(map: ReadonlyMap<string, V>, key: string): Map<string, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

const ok = (state: NexusState): ReduceResult => ({ state, inconsistent: false });
const bad = (state: NexusState): ReduceResult => ({ state, inconsistent: true });

// Never mutates `state`, never throws. An event whose precondition fails leaves the state
// unchanged and sets `inconsistent`.
export function reduce(state: NexusState, event: Event): ReduceResult {
  // An agent counts only inside the session the event names.
  const own = (agentId: string): Agent | null => {
    const agent = state.agents.get(agentId);
    return agent && agent.sessionId === event.sessionId ? agent : null;
  };
  const touched = (agentId: string): Map<string, Agent> | null => {
    const agent = own(agentId);
    return agent ? put(state.agents, agentId, { ...agent, lastProgressAt: event.ts }) : null;
  };

  if (event.type !== "session_start" && !state.sessions.has(event.sessionId)) return bad(state);

  switch (event.type) {
    case "session_start": {
      if (state.sessions.has(event.sessionId)) return bad(state);
      const session: Session = {
        id: event.sessionId,
        projectId: event.projectId,
        provider: event.provider,
        startedAt: event.ts,
        endedAt: null,
      };
      const projects = state.projects.has(event.projectId)
        ? state.projects
        : put(state.projects, event.projectId, { id: event.projectId, name: event.projectName });
      return ok({ ...state, projects, sessions: put(state.sessions, event.sessionId, session) });
    }
    case "session_end": {
      const session = state.sessions.get(event.sessionId);
      if (!session) return bad(state);
      const inSession = (agentId: string) =>
        state.agents.get(agentId)?.sessionId === event.sessionId;
      let openCallsCopy: Map<string, OpenCall> | null = null;
      for (const [callId, call] of state.openCalls) {
        if (!inSession(call.agentId)) continue;
        openCallsCopy ??= new Map(state.openCalls);
        openCallsCopy.delete(callId);
      }
      const openCalls = openCallsCopy ?? state.openCalls;
      let attentionCopy: Map<string, Attention> | null = null;
      for (const agentId of state.attention.keys()) {
        if (!inSession(agentId)) continue;
        attentionCopy ??= new Map(state.attention);
        attentionCopy.delete(agentId);
      }
      const attention = attentionCopy ?? state.attention;
      return ok({
        ...state,
        sessions: put(state.sessions, event.sessionId, { ...session, endedAt: event.ts }),
        openCalls,
        attention,
      });
    }
    case "agent_spawn": {
      const session = state.sessions.get(event.sessionId);
      if (!session || state.agents.has(event.agentId)) return bad(state);
      const agent: Agent = {
        id: event.agentId,
        sessionId: event.sessionId,
        provider: session.provider,
        parentId: event.parentId,
        name: event.name,
        model: event.model,
        stage: "planning",
        lastProgressAt: event.ts,
      };
      return ok({ ...state, agents: put(state.agents, event.agentId, agent) });
    }
    case "agent_end": {
      const agent = own(event.agentId);
      if (!agent) return bad(state);
      return ok({
        ...state,
        agents: put(state.agents, event.agentId, { ...agent, stage: "done" }),
      });
    }
    case "message": {
      const agents = touched(event.agentId);
      return agents ? ok({ ...state, agents }) : bad(state);
    }
    case "tokens": {
      const agents = touched(event.agentId);
      if (!agents) return bad(state);
      const key = usageKey(event.agentId, event.model);
      const prev = state.usage.get(key);
      const usage: Usage = {
        agentId: event.agentId,
        model: event.model,
        input: (prev?.input ?? 0) + event.input,
        output: (prev?.output ?? 0) + event.output,
        cacheRead: (prev?.cacheRead ?? 0) + event.cacheRead,
        cacheWrite: (prev?.cacheWrite ?? 0) + event.cacheWrite,
      };
      return ok({ ...state, agents, usage: put(state.usage, key, usage) });
    }
    case "tool_call_start": {
      const agents = touched(event.agentId);
      if (!agents || state.openCalls.has(event.callId)) return bad(state);
      const call: OpenCall = {
        agentId: event.agentId,
        callId: event.callId,
        tool: event.tool,
        startedAt: event.ts,
      };
      return ok({ ...state, agents, openCalls: put(state.openCalls, event.callId, call) });
    }
    case "tool_call_end": {
      const call = state.openCalls.get(event.callId);
      if (!call || call.agentId !== event.agentId) return bad(state);
      const known = state.agents.has(event.agentId);
      const agents = touched(event.agentId);
      if (known && !agents) return bad(state);
      const openCalls = drop(state.openCalls, event.callId);
      return ok(agents ? { ...state, agents, openCalls } : { ...state, openCalls });
    }
    case "needs_attention": {
      const agents = touched(event.agentId);
      if (!agents || state.attention.has(event.agentId)) return bad(state);
      const entry: Attention = { agentId: event.agentId, reason: event.reason, since: event.ts };
      return ok({ ...state, agents, attention: put(state.attention, event.agentId, entry) });
    }
    case "attention_cleared":
      if (!own(event.agentId) || !state.attention.has(event.agentId)) return bad(state);
      return ok({ ...state, attention: drop(state.attention, event.agentId) });
    case "handoff":
      return ok(state);
    case "task_queued": {
      if (state.queuedTasks.has(event.taskId)) return bad(state);
      const task: QueuedTask = {
        taskId: event.taskId,
        sessionId: event.sessionId,
        title: event.title,
        queuedAt: event.ts,
      };
      return ok({ ...state, queuedTasks: put(state.queuedTasks, event.taskId, task) });
    }
    case "task_dequeued":
      if (state.queuedTasks.get(event.taskId)?.sessionId !== event.sessionId) return bad(state);
      return ok({ ...state, queuedTasks: drop(state.queuedTasks, event.taskId) });
    default: {
      const unreachable: never = event;
      void unreachable;
      return bad(state);
    }
  }
}

export function toSnapshot(state: NexusState, recentIds: readonly string[]): Snapshot {
  return {
    projects: [...state.projects.values()],
    sessions: [...state.sessions.values()],
    agents: [...state.agents.values()],
    openCalls: [...state.openCalls.values()],
    queuedTasks: [...state.queuedTasks.values()],
    attention: [...state.attention.values()],
    usage: [...state.usage.values()],
    recentIds: [...recentIds],
  };
}

export function fromSnapshot(snapshot: Snapshot): NexusState {
  return {
    projects: new Map(snapshot.projects.map((p) => [p.id, p])),
    sessions: new Map(snapshot.sessions.map((s) => [s.id, s])),
    agents: new Map(snapshot.agents.map((a) => [a.id, a])),
    openCalls: new Map(snapshot.openCalls.map((c) => [c.callId, c])),
    queuedTasks: new Map(snapshot.queuedTasks.map((t) => [t.taskId, t])),
    attention: new Map(snapshot.attention.map((a) => [a.agentId, a])),
    usage: new Map(snapshot.usage.map((u) => [usageKey(u.agentId, u.model), u])),
  };
}
