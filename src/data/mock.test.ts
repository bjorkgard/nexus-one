import { describe, expect, it } from "vite-plus/test";
import { checkStream } from "../shared/check-stream";
import { EVENT_TYPES, type Event } from "../shared/schema";
import { createMockStream, MOCK_ROLES, MOCK_TIMING, type MockOptions } from "./mock";

const collect = (options?: MockOptions): Event[] => [...createMockStream(options)];
const lines = (events: Event[]) => events.map((e) => JSON.stringify(e)).join("\n");
const expectValid = (events: Iterable<Event>, label: string) => {
  const result = checkStream(events);
  expect(result.issues, label).toEqual([]);
  expect(result.ok, label).toBe(true);
};

// Per-agent view of a stream: all events that name the agent, in stream order.
const forAgent = (events: Event[], agentId: string) =>
  events.filter((e) => "agentId" in e && e.agentId === agentId);
const isProgress = (e: Event) =>
  e.type === "message" ||
  e.type === "tokens" ||
  e.type === "tool_call_start" ||
  e.type === "tool_call_end";
const spawnOf = (events: Event[], agentId: string) =>
  events.find((e) => e.type === "agent_spawn" && e.agentId === agentId);
const endOf = (events: Event[], agentId: string) =>
  events.find((e) => e.type === "agent_end" && e.agentId === agentId);
const providerOf = (events: Event[], sessionId: string) => {
  const start = events.find((e) => e.type === "session_start" && e.sessionId === sessionId);
  return start?.type === "session_start" ? start.provider : undefined;
};
// Strips fields that carry the seed or ids, so only payload and timing remain.
const withoutIds = (events: Event[]) =>
  events.map((e) => {
    const { id: _id, ...rest } = e;
    return rest;
  });

const defaultStream = collect();

describe("default scenario", () => {
  it("matches the committed file snapshot, one JSON line per event", () => {
    expect(lines(defaultStream)).toMatchSnapshot();
  });

  it("matches the committed snapshot for seed 1 with 2 filler agents", () => {
    expect(lines(collect({ seed: 1, agents: 2, durationMs: 60_000 }))).toMatchSnapshot();
  });

  it("contains every event type and no other", () => {
    expect(new Set(defaultStream.map((e) => e.type))).toEqual(new Set(EVENT_TYPES));
  });

  it("is valid under checkStream, so every event passes parseEvent", () => {
    expectValid(defaultStream, "default");
  });

  it("has the 10.1 shape: 1 project, 3 sessions, 8 subagents", () => {
    const starts = defaultStream.filter((e) => e.type === "session_start");
    expect(new Set(starts.map((e) => e.projectId)).size).toBe(1);
    expect(starts).toHaveLength(3);
    expect(new Set(starts.map((e) => e.provider))).toEqual(new Set(["claude", "codex"]));
    const subagents = defaultStream.filter((e) => e.type === "agent_spawn" && e.parentId !== null);
    expect(subagents).toHaveLength(8);
  });

  it("restarts from the seed on every iteration", () => {
    const stream = createMockStream({ seed: 3, agents: 3, durationMs: 60_000 });
    expect([...stream]).toEqual([...stream]);
  });

  it("is identical across 3 builds", () => {
    const builds = [collect(), collect(), collect()];
    expect(builds[1]).toEqual(builds[0]);
    expect(builds[2]).toEqual(builds[0]);
  });

  it("closes fully: every session, agent and call ends and ts never decreases", () => {
    const ends = defaultStream.filter((e) => e.type === "session_end");
    expect(ends).toHaveLength(3);
    for (let i = 1; i < defaultStream.length; i++) {
      expect((defaultStream[i] as Event).ts).toBeGreaterThanOrEqual(
        (defaultStream[i - 1] as Event).ts,
      );
    }
  });
});

describe("MOCK_TIMING", () => {
  it("pins each value to its approved number", () => {
    expect(MOCK_TIMING).toEqual({
      stuckSilenceMs: 360_000,
      attentionSilenceMs: 360_000,
      slowCallMs: 180_000,
      longSubagentMs: 20_000,
      waitingOnToolMs: 5_000,
    });
    expect(MOCK_TIMING.stuckSilenceMs).toBeGreaterThan(300_000);
    expect(MOCK_TIMING.attentionSilenceMs).toBeGreaterThan(300_000);
    expect(MOCK_TIMING.longSubagentMs).toBeGreaterThan(15_000);
    expect(MOCK_TIMING.waitingOnToolMs).toBeGreaterThan(2_000);
  });
});

describe("spine roles", () => {
  const roleIds = [
    MOCK_ROLES.stuck,
    MOCK_ROLES.attention,
    MOCK_ROLES.repeat,
    MOCK_ROLES.errorStreak,
    MOCK_ROLES.slowTool,
    MOCK_ROLES.longSubagent.claude,
    MOCK_ROLES.longSubagent.codex,
  ];

  it("names 7 distinct agents that all exist as subagents", () => {
    expect(new Set(roleIds).size).toBe(7);
    for (const id of roleIds) {
      const spawn = spawnOf(defaultStream, id);
      expect(spawn, `role ${id} missing`).toBeDefined();
      expect(spawn?.type === "agent_spawn" && spawn.parentId).not.toBeNull();
    }
  });

  it("keeps the role ids for every seed", () => {
    for (const seed of [0, 1, 2, 7]) {
      const events = collect({ seed });
      for (const id of roleIds)
        expect(spawnOf(events, id), `seed ${seed} role ${id}`).toBeDefined();
    }
  });

  it("stuck: silent over 5 min while alive, then resumes, then ends ok", () => {
    const own = forAgent(defaultStream, MOCK_ROLES.stuck);
    const progress = own.filter(isProgress);
    const gaps = progress.slice(1).map((e, i) => e.ts - (progress[i] as Event).ts);
    expect(Math.max(...gaps)).toBeGreaterThan(300_000);
    const gapIndex = gaps.indexOf(Math.max(...gaps));
    const gapStart = (progress[gapIndex] as Event).ts;
    const gapEnd = (progress[gapIndex + 1] as Event).ts;
    expect(own.filter((e) => e.ts > gapStart && e.ts < gapEnd)).toEqual([]);
    const end = endOf(defaultStream, MOCK_ROLES.stuck);
    expect(end?.type === "agent_end" && end.outcome).toBe("ok");
    expect((end as Event).ts).toBeGreaterThan(gapEnd - 1);
  });

  it("attention: needs_attention stays open over 5 min with no events, then clears", () => {
    const own = forAgent(defaultStream, MOCK_ROLES.attention);
    const open = own.findIndex((e) => e.type === "needs_attention");
    expect(open).toBeGreaterThanOrEqual(0);
    const next = own[open + 1] as Event;
    expect(next.type).toBe("attention_cleared");
    expect(next.ts - (own[open] as Event).ts).toBeGreaterThan(300_000);
  });

  it("repeat: 5 consecutive starts with equal tool and argsHash, all ok, then a different call", () => {
    const own = forAgent(defaultStream, MOCK_ROLES.repeat);
    const starts = own.filter((e) => e.type === "tool_call_start");
    const key = (e: Event) => (e.type === "tool_call_start" ? `${e.tool}|${e.argsHash}` : "");
    expect(new Set(starts.slice(0, 5).map(key)).size).toBe(1);
    expect(key(starts[5] as Event)).not.toBe(key(starts[0] as Event));
    const ends = own.filter((e) => e.type === "tool_call_end");
    expect(ends.map((e) => e.type === "tool_call_end" && e.outcome)).toEqual(Array(6).fill("ok"));
  });

  it("error streak: 3 consecutive failed calls with distinct argsHash, then an ok call", () => {
    const own = forAgent(defaultStream, MOCK_ROLES.errorStreak);
    const hashOf = (callId: string) =>
      own.find((e) => e.type === "tool_call_start" && e.callId === callId);
    const ends = own.filter((e) => e.type === "tool_call_end");
    expect(ends.map((e) => e.type === "tool_call_end" && e.outcome)).toEqual([
      "error",
      "error",
      "error",
      "ok",
    ]);
    const hashes = ends.slice(0, 3).map((e) => {
      const start = e.type === "tool_call_end" ? hashOf(e.callId) : undefined;
      return start?.type === "tool_call_start" ? start.argsHash : undefined;
    });
    expect(new Set(hashes).size).toBe(3);
    expect(hashes).not.toContain(undefined);
  });

  it("slow tool: one call open for the slow-call time, then it ends", () => {
    const own = forAgent(defaultStream, MOCK_ROLES.slowTool);
    const start = own.find((e) => e.type === "tool_call_start") as Event;
    const end = own.find((e) => e.type === "tool_call_end") as Event;
    expect(end.ts - start.ts).toBe(MOCK_TIMING.slowCallMs);
    expect(end.ts - start.ts).toBeGreaterThanOrEqual(180_000);
  });

  it("long subagents: one per provider, each living over 15 s", () => {
    const check = (id: string, provider: "claude" | "codex") => {
      const spawn = spawnOf(defaultStream, id) as Event;
      expect(providerOf(defaultStream, spawn.sessionId)).toBe(provider);
      const end = endOf(defaultStream, id) as Event;
      expect(end.ts - spawn.ts).toBeGreaterThan(15_000);
    };
    check(MOCK_ROLES.longSubagent.claude, "claude");
    check(MOCK_ROLES.longSubagent.codex, "codex");
  });

  it("has a subagent spawn and end for each provider", () => {
    for (const provider of ["claude", "codex"]) {
      const subs = defaultStream.filter(
        (e) =>
          e.type === "agent_spawn" &&
          e.parentId !== null &&
          providerOf(defaultStream, e.sessionId) === provider,
      );
      expect(subs.length, provider).toBeGreaterThan(0);
      for (const spawn of subs) {
        const id = spawn.type === "agent_spawn" ? spawn.agentId : "";
        expect(endOf(defaultStream, id), id).toBeDefined();
      }
    }
  });

  it("has a tool call open over 2 s and an agent ending ok", () => {
    const opened = new Map<string, number>();
    let longest = 0;
    for (const e of defaultStream) {
      if (e.type === "tool_call_start") opened.set(e.callId, e.ts);
      if (e.type === "tool_call_end")
        longest = Math.max(longest, e.ts - (opened.get(e.callId) ?? e.ts));
    }
    expect(longest).toBeGreaterThan(2_000);
    expect(defaultStream.some((e) => e.type === "agent_end" && e.outcome === "ok")).toBe(true);
  });
});

describe("seeds", () => {
  it("accepts seed 0 and large seeds and keeps them valid", () => {
    for (const seed of [0, 2 ** 40]) {
      expectValid(createMockStream({ seed, agents: 2, durationMs: 60_000 }), `seed ${seed}`);
    }
  });

  it("rejects negative seeds with a RangeError naming seed", () => {
    for (const seed of [-1, -2_147_483_648]) {
      expect(() => createMockStream({ seed })).toThrow(/^seed must be a safe integer >= 0/);
    }
  });

  it("makes seed 1 and seed 2 differ in payload or timing, not only in ids", () => {
    const a = withoutIds(collect({ seed: 1, agents: 5, durationMs: 120_000 }));
    const b = withoutIds(collect({ seed: 2, agents: 5, durationMs: 120_000 }));
    expect(a).not.toEqual(b);
    expect(defaultStream.map((e) => e.id)).not.toEqual(collect({ seed: 2 }).map((e) => e.id));
  });

  it("is valid and deterministic over 25 seeds with 20 agents", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const options = { seed, agents: 20, durationMs: 120_000 };
      const first = collect(options);
      expectValid(first, `seed ${seed}`);
      expect(collect(options), `seed ${seed}`).toEqual(first);
      expect(collect(options), `seed ${seed}`).toEqual(first);
    }
  });
});

describe("filler and projects", () => {
  const projects = (options: MockOptions) =>
    new Set(
      collect(options)
        .filter((e) => e.type === "session_start")
        .map((e) => e.projectId),
    ).size;

  it("adds min(2, agents) projects", () => {
    expect(projects({})).toBe(1);
    expect(projects({ agents: 1, durationMs: 60_000 })).toBe(2);
    expect(projects({ agents: 2, durationMs: 60_000 })).toBe(3);
    expect(projects({ agents: 20, durationMs: 60_000 })).toBe(3);
  });

  it("ignores durationMs when agents is 0", () => {
    expect(collect({ durationMs: 5 })).toEqual(defaultStream);
    expect(collect({ durationMs: 10 ** 9 })).toEqual(defaultStream);
  });

  it("keeps each filler agent progressing across the whole duration", () => {
    const durationMs = 300_000;
    const progress = new Map<string, number[]>();
    for (const e of createMockStream({ seed: 4, agents: 10, durationMs })) {
      if (e.type === "agent_spawn" && e.agentId.startsWith("mock-f"))
        progress.set(e.agentId, [e.ts]);
      if (isProgress(e) && "agentId" in e && progress.has(e.agentId))
        progress.get(e.agentId)?.push(e.ts);
    }
    expect(progress.size).toBe(10);
    for (const [id, times] of progress) {
      const gaps = times.slice(1).map((ts, i) => ts - (times[i] as number));
      expect(Math.max(...gaps), id).toBeLessThanOrEqual(30_000);
      expect(times.length, id).toBeGreaterThan(1);
    }
  });
});

describe("large and lazy streams", () => {
  it("runs 100 agents for 1 h through checkStream without collecting an array", () => {
    const durationMs = 3_600_000;
    const stream = createMockStream({ seed: 9, agents: 100, durationMs });
    const lastProgress = new Map<string, number>();
    const spawnedAt = new Map<string, number>();
    const endedAt = new Map<string, number>();
    let maxGap = 0;
    let count = 0;
    let origin = -1;
    function* tap() {
      for (const e of stream) {
        count += 1;
        if (origin < 0) origin = e.ts;
        if (e.type === "agent_spawn" && e.agentId.startsWith("mock-f")) {
          spawnedAt.set(e.agentId, e.ts);
          lastProgress.set(e.agentId, e.ts);
        }
        if (e.type === "agent_end" && e.agentId.startsWith("mock-f")) endedAt.set(e.agentId, e.ts);
        if (isProgress(e) && "agentId" in e && lastProgress.has(e.agentId)) {
          maxGap = Math.max(maxGap, e.ts - (lastProgress.get(e.agentId) as number));
          lastProgress.set(e.agentId, e.ts);
        }
        yield e;
      }
    }
    expectValid(tap(), "100 agents 1 h");
    expect(count).toBeGreaterThan(10_000);
    expect(maxGap).toBeLessThanOrEqual(30_000);
    expect(spawnedAt.size).toBe(100);
    for (const [id, spawned] of spawnedAt) {
      expect(spawned - origin, `${id} spawn`).toBe(0);
      expect((endedAt.get(id) as number) - spawned, `${id} end`).toBeGreaterThanOrEqual(durationMs);
    }
  });

  it("yields the first 10 events of 100000 agents over 24 h without building the rest", () => {
    const first: Event[] = [];
    for (const e of createMockStream({ agents: 100_000, durationMs: 86_400_000 })) {
      first.push(e);
      if (first.length === 10) break;
    }
    expect(first).toHaveLength(10);
  });
});

describe("timeScale and origin", () => {
  it("timeScale 2 halves every offset from the origin", () => {
    const one = collect({ origin: 1000, timeScale: 1 });
    const two = collect({ origin: 1000, timeScale: 2 });
    expect(two).toHaveLength(one.length);
    one.forEach((e, i) => {
      expect((two[i] as Event).ts - 1000).toBe(Math.round((e.ts - 1000) / 2));
      expect((two[i] as Event).id).toBe(e.id);
    });
  });

  it("origin shifts every ts by the same amount", () => {
    const a = collect({ origin: 1000 });
    const b = collect({ origin: 5000 });
    a.forEach((e, i) => expect((b[i] as Event).ts - e.ts).toBe(4000));
  });

  it("stays valid when timeScale collapses the whole stream into a few timestamps", () => {
    for (const timeScale of [1000, 1e6, 1e12]) {
      const events = collect({ seed: 5, agents: 6, durationMs: 120_000, timeScale });
      expectValid(events, `timeScale ${timeScale}`);
    }
    expect(new Set(collect({ timeScale: 1e12 }).map((e) => e.ts)).size).toBe(1);
  });
});

describe("option validation", () => {
  const bad = (options: unknown) => () => createMockStream(options as MockOptions);

  it("accepts valid options and defaults", () => {
    expect(bad({})).not.toThrow();
    expect(bad(undefined)).not.toThrow();
    expect(
      bad({ seed: 7, agents: 3, durationMs: 60_000, timeScale: 0.5, origin: 0 }),
    ).not.toThrow();
  });

  it.each([
    ["seed", { seed: 0.5 }],
    ["seed", { seed: Number.NaN }],
    ["seed", { seed: Infinity }],
    ["seed", { seed: "1" }],
    ["seed", { seed: null }],
    ["agents", { agents: null }],
    ["timeScale", { timeScale: null }],
    ["origin", { origin: null }],
    ["durationMs", { durationMs: null }],
    ["agents", { agents: -1 }],
    ["agents", { agents: 1.5 }],
    ["agents", { agents: Infinity }],
    ["durationMs", { durationMs: -1 }],
    ["durationMs", { durationMs: Infinity }],
    ["durationMs", { durationMs: Number.NaN }],
    ["durationMs", { durationMs: 0.5 }],
    ["origin", { origin: -1 }],
    ["origin", { origin: 1.5 }],
    ["timeScale", { timeScale: 0 }],
    ["timeScale", { timeScale: -1 }],
    ["timeScale", { timeScale: Number.NaN }],
    ["timeScale", { timeScale: Infinity }],
    ["seed", { seed: Object.create(null) }],
    ["timeScale", { timeScale: Object.create(null) }],
  ])("throws a RangeError naming %s for %j", (name, options) => {
    expect(bad(options)).toThrow(RangeError);
    expect(bad(options)).toThrow(name);
  });

  it("throws a TypeError for an unknown option key, naming the key", () => {
    expect(bad({ agent: 3 })).toThrow(TypeError);
    expect(bad({ agent: 3 })).toThrow("agent");
    expect(bad(null)).toThrow(TypeError);
  });

  it("throws before the first event, not while iterating", () => {
    expect(bad({ seed: 0.5 })).toThrow(RangeError);
  });

  it.each([
    ["omitted", undefined, true],
    ["0", 0, true],
    ["59999", 59_999, true],
    ["60000", 60_000, false],
  ])("agents 1 with durationMs %s", (_label, durationMs, throws) => {
    const run = bad({ agents: 1, durationMs });
    if (throws) {
      expect(run).toThrow(RangeError);
      expect(run).toThrow("durationMs");
    } else {
      expect(run).not.toThrow();
    }
  });

  it("rejects options whose largest ts would be unsafe", () => {
    expect(bad({ origin: Number.MAX_SAFE_INTEGER })).toThrow(RangeError);
    expect(bad({ origin: Number.MAX_SAFE_INTEGER })).toThrow("overflow");
    expect(bad({ timeScale: 1e-300 })).toThrow(RangeError);
    expect(bad({ agents: 1, durationMs: Number.MAX_SAFE_INTEGER })).toThrow(RangeError);
    expect(bad({ origin: Number.MAX_SAFE_INTEGER - 400_000 })).not.toThrow();
  });
});
