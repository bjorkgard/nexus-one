import { describe, expect, it } from "vite-plus/test";
import { checkStream, type StreamIssueCode } from "./check-stream";
import { EVENT_TYPES, type Event } from "./schema";

type Draft = Record<string, unknown>;

// Builds a stream from drafts: ids are generated unless given, ts defaults to the previous ts + 1.
function build(drafts: Draft[]): Event[] {
  let ts = 0;
  return drafts.map((draft, i) => {
    ts = typeof draft.ts === "number" ? draft.ts : ts + 1;
    return { id: `e${i}`, sessionId: "s1", ...draft, ts } as Event;
  });
}

const sessionStart = {
  type: "session_start",
  projectId: "p1",
  projectName: "P",
  provider: "claude",
};
const spawnRoot = { type: "agent_spawn", agentId: "a1", parentId: null, name: "Root", model: null };
const spawnChild = { type: "agent_spawn", agentId: "a2", parentId: "a1", name: "Sub", model: "m" };

// A valid stream that contains all 13 event types.
const valid: Draft[] = [
  sessionStart,
  spawnRoot,
  { type: "task_queued", taskId: "t1", title: "Task" },
  { type: "message", agentId: "a1", role: "user", text: "hi" },
  { type: "tokens", agentId: "a1", model: "m", input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
  { type: "tool_call_start", agentId: "a1", callId: "c1", tool: "Read" },
  { type: "tool_call_end", agentId: "a1", callId: "c1", outcome: "ok" },
  spawnChild,
  { type: "handoff", fromAgentId: "a1", toAgentId: "a2", direction: "delegate" },
  { type: "needs_attention", agentId: "a2", reason: "permission" },
  { type: "attention_cleared", agentId: "a2" },
  { type: "task_dequeued", taskId: "t1", reason: "started" },
  { type: "agent_end", agentId: "a2", outcome: "ok" },
  { type: "agent_end", agentId: "a1", outcome: "ok" },
  { type: "session_end" },
];

function codesOf(drafts: Draft[], options?: { complete?: boolean }): StreamIssueCode[] {
  return checkStream(build(drafts), options).issues.map((issue) => issue.code);
}

describe("checkStream", () => {
  it("accepts a valid stream that uses every event type", () => {
    const events = build(valid);
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(EVENT_TYPES));
    expect(checkStream(events)).toEqual({ ok: true, issues: [], total: 0 });
  });

  it("accepts an empty stream", () => {
    expect(checkStream([])).toEqual({ ok: true, issues: [], total: 0 });
  });

  it("accepts any iterable, not only arrays", () => {
    function* lazy() {
      yield* build(valid);
    }
    expect(checkStream(lazy()).ok).toBe(true);
  });

  const without = (index: number) => valid.filter((_, i) => i !== index);
  const replace = (index: number, draft: Draft) => valid.map((d, i) => (i === index ? draft : d));
  const insertAfter = (index: number, ...drafts: Draft[]) => [
    ...valid.slice(0, index + 1),
    ...drafts,
    ...valid.slice(index + 1),
  ];
  const message = { type: "message", agentId: "a1", role: "user", text: "x" };

  const negatives: [StreamIssueCode, Draft[]][] = [
    ["parse", replace(3, { ...message, text: "" })],
    ["ts_decreased", replace(4, { ...valid[4], ts: 0 })],
    ["duplicate_id", replace(4, { ...valid[4], id: "e3" })],
    ["end_without_start", without(5)],
    ["orphan_subagent", replace(7, { ...spawnChild, parentId: "ghost" })],
    ["event_after_session_end", [...valid, message]],
    ["event_after_agent_end", insertAfter(13, message)],
    ["open_at_end", without(14)],
    ["handoff_endpoint", replace(8, { ...valid[8], toAgentId: "ghost" })],
    [
      "orphan_subagent",
      [
        sessionStart,
        spawnRoot,
        { type: "agent_end", agentId: "a1", outcome: "ok" },
        spawnChild,
        { type: "agent_end", agentId: "a2", outcome: "ok" },
        { type: "session_end" },
      ],
    ],
    [
      "handoff_endpoint",
      [
        sessionStart,
        spawnRoot,
        spawnChild,
        { type: "agent_end", agentId: "a2", outcome: "ok" },
        { type: "handoff", fromAgentId: "a1", toAgentId: "a2", direction: "delegate" },
        { type: "agent_end", agentId: "a1", outcome: "ok" },
        { type: "session_end" },
      ],
    ],
    [
      "dequeue_without_queue",
      replace(11, { type: "task_dequeued", taskId: "t9", reason: "started" }),
    ],
    [
      "agent_session_mismatch",
      insertAfter(
        1,
        { ...sessionStart, sessionId: "s2", projectId: "p2" },
        { ...message, sessionId: "s2" },
        { type: "session_end", sessionId: "s2" },
      ),
    ],
    ["attention_not_open", without(9)],
  ];

  it.each(negatives)("reports exactly %s for its broken stream", (code, drafts) => {
    expect(codesOf(drafts)).toEqual([code]);
  });

  it("flags a session that was never started, a duplicate session and a missing agent", () => {
    expect(codesOf([{ type: "message", agentId: "a1", role: "user", text: "x" }])).toContain(
      "unknown_session",
    );
    expect(codesOf([sessionStart, sessionStart])).toContain("duplicate_session");
    expect(
      codesOf([sessionStart, { type: "message", agentId: "ghost", role: "user", text: "x" }]),
    ).toContain("unknown_agent");
  });

  it("flags duplicate agents, duplicate calls, nested attention and duplicate tasks", () => {
    expect(codesOf([sessionStart, spawnRoot, spawnRoot])).toContain("duplicate_agent");
    const call = { type: "tool_call_start", agentId: "a1", callId: "c1", tool: "T" };
    expect(codesOf([sessionStart, spawnRoot, call, call])).toContain("duplicate_call");
    const attention = { type: "needs_attention", agentId: "a1", reason: "question" };
    expect(codesOf([sessionStart, spawnRoot, attention, attention])).toContain(
      "attention_already_open",
    );
    const task = { type: "task_queued", taskId: "t1", title: "T" };
    expect(codesOf([sessionStart, task, task])).toContain("duplicate_task");
  });

  it("reports a dequeued task dequeued twice", () => {
    const queued = { type: "task_queued", taskId: "t1", title: "T" };
    const dequeued = { type: "task_dequeued", taskId: "t1", reason: "cancelled" };
    expect(codesOf([sessionStart, queued, dequeued, dequeued])).toContain("dequeue_without_queue");
  });

  it("reports parse issues for non-object input without throwing", () => {
    const result = checkStream([null, 5, "x"] as unknown as Event[]);
    expect(result.issues.map((i) => i.code)).toEqual(["parse", "parse", "parse"]);
    expect(result.issues.map((i) => i.index)).toEqual([0, 1, 2]);
  });

  it("allows open items at the end when complete is false", () => {
    const prefix = valid.slice(0, 6);
    expect(codesOf(prefix, { complete: true })).toContain("open_at_end");
    expect(checkStream(build(prefix), { complete: false }).ok).toBe(true);
  });

  it("still reports ordering faults when complete is false", () => {
    const broken = replace(4, { ...valid[4], ts: 0 }).slice(0, 6);
    expect(checkStream(build(broken), { complete: false }).issues.map((i) => i.code)).toEqual([
      "ts_decreased",
    ]);
  });

  it.each([
    ["null", () => null],
    [
      "a revoked Proxy",
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      },
    ],
    [
      "a Proxy whose get trap throws",
      () =>
        new Proxy(
          {},
          {
            get: () => {
              throw new Error("trap");
            },
          },
        ),
    ],
  ])("maps %s as options to one bad_options issue", (_name, make) => {
    const result = checkStream([], make() as never);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["bad_options"]);
  });

  it("maps an iterable that throws to iterable_threw instead of throwing", () => {
    function* broken() {
      yield* build(valid.slice(0, 2));
      throw new Error("boom");
    }
    const result = checkStream(broken(), { complete: false });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { code: "iterable_threw", index: 2, message: expect.stringContaining("boom") },
    ]);
  });

  it("maps a thrown value without a usable toString to iterable_threw", () => {
    function* broken() {
      yield* build(valid.slice(0, 2));
      throw Object.create(null);
    }
    const result = checkStream(broken(), { complete: false });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["iterable_threw"]);
  });

  it.each([
    [
      "a revoked proxy",
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      },
    ],
    [
      "a proxy whose get trap throws",
      () =>
        new Proxy(
          {},
          {
            get() {
              throw new Error("trap");
            },
          },
        ),
    ],
  ])("maps %s thrown by the iterable to one iterable_threw", (_name, make) => {
    function* broken() {
      yield* build(valid.slice(0, 2));
      throw make();
    }
    const result = checkStream(broken(), { complete: false });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["iterable_threw"]);
  });

  it("caps reported issues at 100 and keeps the total", () => {
    const bad = Array.from({ length: 150 }, () => null) as unknown as Event[];
    const result = checkStream(bad);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(100);
    expect(result.total).toBe(150);
  });

  it("gives each issue the index of the offending event", () => {
    const result = checkStream(build(replace(4, { ...valid[4], ts: 0 })));
    expect(result.issues[0]).toMatchObject({ code: "ts_decreased", index: 4 });
  });
});
