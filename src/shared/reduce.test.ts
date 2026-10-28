import { describe, expect, it } from "vite-plus/test";
import events from "./fixtures/events.json";
import { emptyState, fromSnapshot, reduce, toSnapshot, usageKey, type NexusState } from "./reduce";
import type { Event } from "./schema";

const E = events as unknown as Record<Event["type"], Event>;
const ev = (type: Event["type"], change: Record<string, unknown> = {}): Event =>
  ({ ...E[type], ...change }) as Event;

function run(list: Event[], from: NexusState = emptyState()) {
  let state = from;
  let inconsistent = 0;
  for (const e of list) {
    const r = reduce(state, e);
    state = r.state;
    if (r.inconsistent) inconsistent += 1;
  }
  return { state, inconsistent };
}

// Ids and ts from the fixtures are reused; this builds one consistent session.
const sid = E.session_start.sessionId;
const aid = (E.agent_spawn as Extract<Event, { type: "agent_spawn" }>).agentId;
const base = () => run([ev("session_start"), ev("agent_spawn", { parentId: null })]).state;

describe("reduce", () => {
  it("session_start adds the project and the session", () => {
    const { state, inconsistent } = run([ev("session_start")]);
    expect(inconsistent).toBe(0);
    expect(state.projects.size).toBe(1);
    expect(state.sessions.get(sid)).toMatchObject({ endedAt: null });
  });

  it("agent_spawn adds a planning agent with the session provider", () => {
    const state = base();
    const agent = state.agents.get(aid)!;
    expect(agent.stage).toBe("planning");
    expect(agent.provider).toBe(state.sessions.get(sid)!.provider);
    expect(agent.lastProgressAt).toBe(E.agent_spawn.ts);
  });

  it("agent_end sets stage done", () => {
    const { state, inconsistent } = run([ev("agent_end")], base());
    expect(inconsistent).toBe(0);
    expect(state.agents.get(aid)!.stage).toBe("done");
  });

  it("message, tokens and tool calls set lastProgressAt", () => {
    for (const type of ["message", "tokens", "tool_call_start"] as const) {
      const { state, inconsistent } = run([ev(type, { ts: 999_999_999_999_999 })], base());
      expect(inconsistent, type).toBe(0);
      expect(state.agents.get(aid)!.lastProgressAt, type).toBe(999_999_999_999_999);
    }
    const open = run([ev("tool_call_start")], base()).state;
    const closed = run([ev("tool_call_end", { ts: 42 })], open);
    expect(closed.inconsistent).toBe(0);
    expect(closed.state.agents.get(aid)!.lastProgressAt).toBe(42);
  });

  it("tool_call_start/end open and close a call", () => {
    const open = run([ev("tool_call_start")], base()).state;
    const call = E.tool_call_start as Extract<Event, { type: "tool_call_start" }>;
    expect(open.openCalls.get(call.callId)).toMatchObject({ tool: call.tool, agentId: aid });
    const closed = run([ev("tool_call_end")], open).state;
    expect(closed.openCalls.size).toBe(0);
  });

  it("tokens add into usage per agent and model", () => {
    const t = E.tokens as Extract<Event, { type: "tokens" }>;
    const { state } = run(
      [ev("tokens"), ev("tokens", { id: "t2" }), ev("tokens", { id: "t3", model: "other" })],
      base(),
    );
    expect(state.usage.size).toBe(2);
    expect(state.usage.get(usageKey(aid, t.model))).toMatchObject({
      input: t.input * 2,
      output: t.output * 2,
      cacheRead: t.cacheRead * 2,
      cacheWrite: t.cacheWrite * 2,
    });
  });

  it("needs_attention / attention_cleared set and clear attention", () => {
    const on = run([ev("needs_attention")], base()).state;
    expect(on.attention.get(aid)).toMatchObject({ since: E.needs_attention.ts });
    const off = run([ev("attention_cleared")], on);
    expect(off.state.attention.size).toBe(0);
    expect(off.inconsistent).toBe(0);
  });

  it("task_queued / task_dequeued add and remove a task", () => {
    const queued = run([ev("task_queued")], base()).state;
    expect(queued.queuedTasks.size).toBe(1);
    expect(run([ev("task_dequeued")], queued).state.queuedTasks.size).toBe(0);
  });

  it("handoff is accepted and changes nothing", () => {
    const s = base();
    const r = reduce(s, ev("handoff"));
    expect(r).toEqual({ state: s, inconsistent: false });
  });

  it("session_end sets endedAt and closes that session's calls and attention", () => {
    const s = run([ev("tool_call_start"), ev("needs_attention")], base()).state;
    const r = reduce(s, ev("session_end", { ts: 777 }));
    expect(r.inconsistent).toBe(false);
    expect(r.state.sessions.get(sid)!.endedAt).toBe(777);
    expect(r.state.openCalls.size).toBe(0);
    expect(r.state.attention.size).toBe(0);
    expect(s.openCalls.size).toBe(1);
  });

  it.each([
    ["session_end without session", "session_end"],
    ["agent_spawn without session", "agent_spawn"],
    ["agent_end for unknown agent", "agent_end"],
    ["message for unknown agent", "message"],
    ["tokens for unknown agent", "tokens"],
    ["tool_call_start for unknown agent", "tool_call_start"],
    ["tool_call_end without start", "tool_call_end"],
    ["needs_attention for unknown agent", "needs_attention"],
    ["attention_cleared without attention", "attention_cleared"],
    ["task_dequeued without queue", "task_dequeued"],
  ] as const)("%s leaves state unchanged and is inconsistent", (_name, type) => {
    const s = emptyState();
    const r = reduce(s, ev(type));
    expect(r.inconsistent).toBe(true);
    expect(r.state).toBe(s);
  });

  it.each(
    (Object.keys(E) as Event["type"][])
      .filter((type) => type !== "session_start")
      .map((type) => [type] as const),
  )("%s with an unknown sessionId leaves state unchanged and is inconsistent", (type) => {
    const s = run([ev("tool_call_start"), ev("needs_attention"), ev("task_queued")], base()).state;
    const r = reduce(s, ev(type, { sessionId: "nope" }));
    expect(r.inconsistent).toBe(true);
    expect(r.state).toBe(s);
  });

  it.each(["agent_end", "message", "tokens", "tool_call_start", "needs_attention"] as const)(
    "%s for an agent of another session is inconsistent",
    (type) => {
      const s = run([ev("session_start", { sessionId: "s2", projectId: "p1" })], base()).state;
      const r = reduce(s, ev(type, { sessionId: "s2" }));
      expect(r.inconsistent).toBe(true);
      expect(r.state).toBe(s);
    },
  );

  it("attention_cleared for an agent of another session is inconsistent", () => {
    const s = run(
      [ev("needs_attention"), ev("session_start", { id: "x", sessionId: "s2" })],
      base(),
    ).state;
    const r = reduce(s, ev("attention_cleared", { sessionId: "s2" }));
    expect(r.inconsistent).toBe(true);
    expect(r.state).toBe(s);
  });

  it("tool_call_end with another agentId than the open call is inconsistent", () => {
    const s = run(
      [ev("tool_call_start"), ev("agent_spawn", { id: "x", agentId: "a2", parentId: null })],
      base(),
    ).state;
    const r = reduce(s, ev("tool_call_end", { agentId: "a2" }));
    expect(r.inconsistent).toBe(true);
    expect(r.state).toBe(s);
    expect(r.state.openCalls.size).toBe(1);
  });

  it("task_dequeued with another sessionId than the queued task is inconsistent", () => {
    const s = run(
      [ev("task_queued"), ev("session_start", { id: "x", sessionId: "s2", projectId: "p1" })],
      base(),
    ).state;
    const r = reduce(s, ev("task_dequeued", { sessionId: "s2" }));
    expect(r.inconsistent).toBe(true);
    expect(r.state).toBe(s);
    expect(r.state.queuedTasks.size).toBe(1);
  });

  it("tool_call_end for an agent of another session is inconsistent", () => {
    const s = run(
      [ev("tool_call_start"), ev("session_start", { id: "x", sessionId: "s2", projectId: "p1" })],
      base(),
    ).state;
    const r = reduce(s, ev("tool_call_end", { sessionId: "s2" }));
    expect(r.inconsistent).toBe(true);
    expect(r.state).toBe(s);
    expect(r.state.openCalls.size).toBe(1);
  });

  it("flags duplicate session, agent, call, attention and task", () => {
    const s = run([ev("tool_call_start"), ev("needs_attention"), ev("task_queued")], base()).state;
    for (const type of [
      "session_start",
      "agent_spawn",
      "tool_call_start",
      "needs_attention",
      "task_queued",
    ] as const) {
      const r = reduce(s, ev(type));
      expect(r.inconsistent, type).toBe(true);
      expect(r.state, type).toBe(s);
    }
  });

  it("never mutates its input and shares untouched maps", () => {
    const s = base();
    const before = toSnapshot(s, []);
    const r = reduce(s, ev("message", { ts: 5 }));
    expect(toSnapshot(s, [])).toEqual(before);
    expect(r.state.agents).not.toBe(s.agents);
    expect(r.state.sessions).toBe(s.sessions);
    expect(r.state.usage).toBe(s.usage);
  });

  it("accepts __proto__ as session and agent id", () => {
    const state = run([
      ev("session_start", { sessionId: "__proto__" }),
      ev("agent_spawn", { sessionId: "__proto__", agentId: "__proto__", parentId: null }),
      ev("message", { sessionId: "__proto__", agentId: "__proto__", ts: 9 }),
    ]);
    expect(state.inconsistent).toBe(0);
    expect(state.state.agents.get("__proto__")!.lastProgressAt).toBe(9);
    const round = fromSnapshot(toSnapshot(state.state, []));
    expect(round.agents.get("__proto__")).toBeDefined();
  });
});
