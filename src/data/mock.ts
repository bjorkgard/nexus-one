import type { AgentOutcome, Event, Provider } from "../shared/schema";

// Deterministic mock event stream. Pure function of its options: no clock, no Math.random (the
// determinism lint covers this file). Time is simulated: every event has a sim time in ms, and the
// emitted `ts` is origin + round(simMs / timeScale). Spine guarantees hold at timeScale 1.

export type MockOptions = {
  seed?: number;
  agents?: number;
  durationMs?: number;
  timeScale?: number;
  origin?: number;
};

// Fixed agent ids of the scripted spine. They do not depend on the seed, so later steps
// (7.1, 4.10, 10.1) can find "the stuck agent" and the others by name.
export const MOCK_ROLES = {
  stuck: "mock-stuck",
  attention: "mock-attention",
  repeat: "mock-repeat",
  errorStreak: "mock-error-streak",
  slowTool: "mock-slow-tool",
  longSubagent: { claude: "mock-claude-long", codex: "mock-codex-long" },
} as const;

// Spine numbers copied from later steps' thresholds; the spine reads them, tests pin them.
export const MOCK_TIMING = {
  // 7.1: no progress for 5 min while not waiting on the user (docs/PLAN.md:555), plus margin.
  stuckSilenceMs: 360_000,
  // 7.1: waiting on the user never counts as stuck (docs/PLAN.md:556); silent longer than 5 min.
  attentionSilenceMs: 360_000,
  // 7.1: slow tool call, 3 min (decision D16).
  slowCallMs: 180_000,
  // 4.10: a character is seated within 15 s of the subagent spawn (docs/PLAN.md:330).
  longSubagentMs: 20_000,
  // 4.8: the waiting_on_tool stage needs a call open more than 2 s (docs/PLAN.md:313).
  waitingOnToolMs: 5_000,
} as const;

const DEFAULT_SEED = 20_261_028;
const DEFAULT_ORIGIN = 1_790_000_000_000;
const OPTION_KEYS = ["seed", "agents", "durationMs", "timeScale", "origin"];
const MIN_FILLER_DURATION_MS = 60_000;
// Filler agents start at sim 0 and finish at most this long after durationMs.
const FILLER_SLACK_MS = 30_000;

const PROJECT_ID = "mock-project-nexus";
const EXTRA_PROJECT_NAMES = ["Atlas", "Borealis", "Cinder", "Delta", "Ember", "Fjord"];
const TEXTS = [
  "Reading the failing test before changing anything.",
  "The fix touches two files; running the suite next.",
  "Plan: split the module, then move the callers.",
  "Checking the type errors after the rename.",
  "Summarising what changed for the reviewer.",
  "Looking for the earlier call site of this helper.",
];
const TOOLS = ["Read", "Grep", "Bash", "Edit", "Glob"];
const ERRORS = ["exit status 1", "file not found", "permission denied", "timed out"];

type Rng = () => number;
type Draft<E = Event> = E extends unknown ? Omit<E, "id" | "ts" | "sessionId"> : never;
type Pending = { t: number; sessionId: string; draft: Draft };

// mulberry32, seeded through a hash so seed 0 and negative seeds are not degenerate.
function mix(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const part of parts) {
    h = Math.imul(h ^ part, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

function rngFor(seed: number, ...salt: number[]): Rng {
  let a = mix(seed >>> 0, Math.floor(seed / 4_294_967_296) >>> 0, ...salt);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const int = (rng: Rng, low: number, high: number) => low + Math.floor(rng() * (high - low + 1));
const pick = <T>(rng: Rng, list: readonly T[]): T => list[int(rng, 0, list.length - 1)] as T;

// Builds one session's events as (simMs, draft) pairs; `finish` returns them in time order.
function createTimeline(sessionId: string, rng: Rng) {
  const items: Pending[] = [];
  const at = (t: number, draft: Draft) => {
    items.push({ t, sessionId, draft });
  };
  return {
    at,
    spawn: (t: number, agentId: string, parentId: string | null, name: string, model: string) =>
      at(t, { type: "agent_spawn", agentId, parentId, name, model }),
    end: (t: number, agentId: string, outcome: AgentOutcome = "ok") =>
      at(t, { type: "agent_end", agentId, outcome }),
    say: (t: number, agentId: string) =>
      at(t, { type: "message", agentId, role: "assistant", text: pick(rng, TEXTS) }),
    tokens: (t: number, agentId: string, model: string) =>
      at(t, {
        type: "tokens",
        agentId,
        model,
        input: int(rng, 100, 5000),
        output: int(rng, 50, 2000),
        cacheRead: int(rng, 0, 20_000),
        cacheWrite: int(rng, 0, 3000),
      }),
    call: (
      t: number,
      agentId: string,
      callId: string,
      tool: string,
      argsHash: string,
      durationMs: number,
      error?: string,
    ) => {
      at(t, { type: "tool_call_start", agentId, callId, tool, argsHash });
      at(
        t + durationMs,
        error === undefined
          ? { type: "tool_call_end", agentId, callId, outcome: "ok" }
          : { type: "tool_call_end", agentId, callId, outcome: "error", error },
      );
    },
    finish: () => items.toSorted((a, b) => a.t - b.t),
  };
}

// The fixed scenario (decision D4: 1 project, 3 sessions, 8 subagents). Timings are fixed, so every
// guarantee holds for every seed; the seed only picks message text and token counts. Sim time, ms:
//
//   session 1 (claude)   0 ........................................................ 377,000
//     root                 |------------------------------------------------------|
//     long (claude)        10,000 |--------| 30,000        handoff delegate / return
//     stuck                  12,000 |-- 14,000 ..silent 360,000.. 374,000 |-| 375,000
//     repeat                  16,000 |5 identical Grep calls, then one Read| 30,000
//     error streak             18,000 |3 failed Bash calls, then one ok| 30,000
//   session 2 (codex)   5,000 ....................................................... 381,000
//     root                 |-----------------------------------------------------|
//     slow tool              8,000 |-- call open 180,000 --| 191,000
//     attention                8,500 |-- needs_attention 360,000 --| 373,000
//     long (codex)           20,000 |------| 40,000        handoff delegate / return
//   session 3 (claude)  60,000 .. 121,000     queue: two tasks, one started, one cancelled
//     root, helper (cancelled), handoff delegate / return
function buildSpine(seed: number): Pending[][] {
  const t = MOCK_TIMING;

  const s1 = createTimeline("mock-session-1", rngFor(seed, 10));
  s1.at(0, {
    type: "session_start",
    projectId: PROJECT_ID,
    projectName: "Nexus",
    provider: "claude",
  });
  s1.spawn(0, "mock-s1-root", null, "Orchestrator", "claude-opus");
  s1.say(1000, "mock-s1-root");
  s1.tokens(2000, "mock-s1-root", "claude-opus");
  s1.call(3000, "mock-s1-root", "mock-call-s1-wait", "Bash", "args-s1-wait", t.waitingOnToolMs);
  const long1 = MOCK_ROLES.longSubagent.claude;
  s1.spawn(10_000, long1, "mock-s1-root", "Refactorer", "claude-sonnet");
  s1.at(10_000, {
    type: "handoff",
    fromAgentId: "mock-s1-root",
    toAgentId: long1,
    direction: "delegate",
  });
  s1.say(12_000, long1);
  s1.tokens(15_000, long1, "claude-sonnet");
  s1.call(18_000, long1, "mock-call-long1", "Edit", "args-long1", 4000);
  s1.at(10_000 + t.longSubagentMs - 1000, {
    type: "handoff",
    fromAgentId: long1,
    toAgentId: "mock-s1-root",
    direction: "return",
  });
  s1.end(10_000 + t.longSubagentMs, long1);
  const stuck = MOCK_ROLES.stuck;
  s1.spawn(12_000, stuck, "mock-s1-root", "Stalled", "claude-sonnet");
  s1.say(13_000, stuck);
  s1.tokens(14_000, stuck, "claude-sonnet");
  s1.say(14_000 + t.stuckSilenceMs, stuck);
  s1.end(15_000 + t.stuckSilenceMs, stuck);
  const repeat = MOCK_ROLES.repeat;
  s1.spawn(16_000, repeat, "mock-s1-root", "Looper", "claude-sonnet");
  for (let i = 0; i < 5; i++) {
    s1.call(17_000 + i * 2000, repeat, `mock-call-repeat-${i}`, "Grep", "args-repeat", 1000);
  }
  s1.call(28_000, repeat, "mock-call-repeat-clear", "Read", "args-repeat-clear", 1000);
  s1.end(30_000, repeat);
  const errors = MOCK_ROLES.errorStreak;
  s1.spawn(18_000, errors, "mock-s1-root", "Failer", "claude-sonnet");
  for (let i = 0; i < 3; i++) {
    const error = ERRORS[i] as string;
    s1.call(
      19_000 + i * 2000,
      errors,
      `mock-call-error-${i}`,
      "Bash",
      `args-error-${i}`,
      1000,
      error,
    );
  }
  s1.call(25_000, errors, "mock-call-error-clear", "Bash", "args-error-clear", 1000);
  s1.end(30_000, errors, "error");
  for (const when of [100_000, 200_000, 300_000]) s1.say(when, "mock-s1-root");
  s1.end(16_000 + t.stuckSilenceMs, "mock-s1-root");
  s1.at(17_000 + t.stuckSilenceMs, { type: "session_end" });

  const s2 = createTimeline("mock-session-2", rngFor(seed, 20));
  s2.at(5000, {
    type: "session_start",
    projectId: PROJECT_ID,
    projectName: "Nexus",
    provider: "codex",
  });
  s2.spawn(5000, "mock-s2-root", null, "Codex Lead", "gpt-codex");
  s2.say(6000, "mock-s2-root");
  s2.tokens(7000, "mock-s2-root", "gpt-codex");
  const slow = MOCK_ROLES.slowTool;
  s2.spawn(8000, slow, "mock-s2-root", "Builder", "gpt-codex");
  s2.call(9000, slow, "mock-call-slow", "Bash", "args-slow", t.slowCallMs);
  s2.say(9000 + t.slowCallMs + 1000, slow);
  s2.end(9000 + t.slowCallMs + 2000, slow);
  const attention = MOCK_ROLES.attention;
  s2.spawn(8500, attention, "mock-s2-root", "Asker", "gpt-codex");
  s2.say(9500, attention);
  s2.tokens(10_000, attention, "gpt-codex");
  s2.call(10_500, attention, "mock-call-attention", "Edit", "args-attention", 400);
  s2.at(11_000, { type: "needs_attention", agentId: attention, reason: "permission" });
  s2.at(11_000 + t.attentionSilenceMs, { type: "attention_cleared", agentId: attention });
  s2.say(12_000 + t.attentionSilenceMs, attention);
  s2.end(13_000 + t.attentionSilenceMs, attention);
  const long2 = MOCK_ROLES.longSubagent.codex;
  s2.spawn(20_000, long2, "mock-s2-root", "Tester", "gpt-codex");
  s2.at(20_000, {
    type: "handoff",
    fromAgentId: "mock-s2-root",
    toAgentId: long2,
    direction: "delegate",
  });
  s2.say(22_000, long2);
  s2.tokens(25_000, long2, "gpt-codex");
  s2.at(20_000 + t.longSubagentMs - 1000, {
    type: "handoff",
    fromAgentId: long2,
    toAgentId: "mock-s2-root",
    direction: "return",
  });
  s2.end(20_000 + t.longSubagentMs, long2);
  for (const when of [100_000, 200_000, 300_000]) s2.say(when, "mock-s2-root");
  s2.end(20_000 + t.attentionSilenceMs, "mock-s2-root");
  s2.at(21_000 + t.attentionSilenceMs, { type: "session_end" });

  const s3 = createTimeline("mock-session-3", rngFor(seed, 30));
  s3.at(60_000, {
    type: "session_start",
    projectId: PROJECT_ID,
    projectName: "Nexus",
    provider: "claude",
  });
  s3.spawn(60_000, "mock-s3-root", null, "Planner", "claude-opus");
  s3.at(61_000, { type: "task_queued", taskId: "mock-task-1", title: "Write the tests" });
  s3.at(61_500, { type: "task_queued", taskId: "mock-task-2", title: "Review the patch" });
  s3.say(62_000, "mock-s3-root");
  s3.at(70_000, { type: "task_dequeued", taskId: "mock-task-1", reason: "started" });
  s3.spawn(71_000, "mock-helper", "mock-s3-root", "Helper", "claude-haiku");
  s3.at(71_000, {
    type: "handoff",
    fromAgentId: "mock-s3-root",
    toAgentId: "mock-helper",
    direction: "delegate",
  });
  s3.tokens(72_000, "mock-helper", "claude-haiku");
  s3.at(75_000, { type: "task_dequeued", taskId: "mock-task-2", reason: "cancelled" });
  s3.at(89_000, {
    type: "handoff",
    fromAgentId: "mock-helper",
    toAgentId: "mock-s3-root",
    direction: "return",
  });
  s3.end(90_000, "mock-helper", "cancelled");
  s3.say(100_000, "mock-s3-root");
  s3.end(120_000, "mock-s3-root");
  s3.at(121_000, { type: "session_end" });

  return [s1.finish(), s2.finish(), s3.finish()];
}

// One filler agent in its own session: active from its start until durationMs, with a progress
// event at least every 30 s of sim time (E-D4), then it ends and the session closes.
function* fillerSession(
  seed: number,
  index: number,
  durationMs: number,
  extraProjects: { id: string; name: string }[],
): Generator<Pending> {
  const rng = rngFor(seed, 1, index);
  const sessionId = `mock-f${index}`;
  const agentId = `mock-f${index}-a`;
  const project = extraProjects[index % extraProjects.length] as { id: string; name: string };
  const provider: Provider = rng() < 0.5 ? "claude" : "codex";
  const model = provider === "claude" ? "claude-sonnet" : "gpt-codex";
  const pending = (t: number, draft: Draft): Pending => ({ t, sessionId, draft });

  let t = 0;
  yield pending(t, {
    type: "session_start",
    projectId: project.id,
    projectName: project.name,
    provider,
  });
  yield pending(t, { type: "agent_spawn", agentId, parentId: null, name: `Agent ${index}`, model });
  let calls = 0;
  while (t < durationMs) {
    t += int(rng, 2000, 10_000);
    const roll = rng();
    if (roll < 0.3) {
      yield pending(t, { type: "message", agentId, role: "assistant", text: pick(rng, TEXTS) });
    } else if (roll < 0.55) {
      yield pending(t, {
        type: "tokens",
        agentId,
        model,
        input: int(rng, 100, 5000),
        output: int(rng, 50, 2000),
        cacheRead: int(rng, 0, 20_000),
        cacheWrite: int(rng, 0, 3000),
      });
    } else {
      const callId = `mock-f${index}-c${calls++}`;
      yield pending(t, {
        type: "tool_call_start",
        agentId,
        callId,
        tool: pick(rng, TOOLS),
        argsHash: `h${int(rng, 0, 99_999)}`,
      });
      t += int(rng, 500, 15_000);
      yield pending(
        t,
        rng() < 0.15
          ? { type: "tool_call_end", agentId, callId, outcome: "error", error: pick(rng, ERRORS) }
          : { type: "tool_call_end", agentId, callId, outcome: "ok" },
      );
    }
  }
  yield pending(t, { type: "agent_end", agentId, outcome: "ok" });
  yield pending(t, { type: "session_end" });
}

type Config = {
  seed: number;
  agents: number;
  durationMs: number;
  timeScale: number;
  origin: number;
  extraProjects: { id: string; name: string }[];
};

const toTs = (config: Config, simMs: number) =>
  config.origin + Math.round(simMs / config.timeScale);

// String() throws for null-prototype objects and hostile values; an error message must not.
function describe(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "<unprintable value>";
  }
}

function integerOption(name: string, value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new RangeError(`${name} must be a safe integer >= ${min}, got ${describe(value)}`);
  }
  return value;
}

function resolveOptions(options: MockOptions): Config {
  if (typeof options !== "object" || options === null) {
    throw new TypeError(`options must be an object, got ${describe(options)}`);
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.includes(key)) {
      throw new TypeError(`unknown option "${key}" (allowed: ${OPTION_KEYS.join(", ")})`);
    }
  }
  // An option is given when its key holds anything but undefined; null then fails validation.
  // Only own keys count: an inherited key (prototype pollution) must not change the stream.
  const given = <K extends keyof MockOptions>(key: K, fallback: unknown): unknown =>
    !Object.hasOwn(options, key) || options[key] === undefined ? fallback : options[key];
  const seed = integerOption("seed", given("seed", DEFAULT_SEED), 0);
  const agents = integerOption("agents", given("agents", 0), 0);
  const origin = integerOption("origin", given("origin", DEFAULT_ORIGIN), 0);
  const timeScale = given("timeScale", 1);
  if (typeof timeScale !== "number" || !Number.isFinite(timeScale) || timeScale <= 0) {
    throw new RangeError(`timeScale must be a finite number > 0, got ${describe(timeScale)}`);
  }
  const durationMs = integerOption("durationMs", given("durationMs", 0), 0);
  if (agents > 0 && durationMs < MIN_FILLER_DURATION_MS) {
    throw new RangeError(
      `durationMs must be a safe integer >= ${MIN_FILLER_DURATION_MS} when agents > 0, got ${describe(options.durationMs)}`,
    );
  }
  const names = rngFor(seed, 2);
  const first = int(names, 0, EXTRA_PROJECT_NAMES.length - 1);
  const second =
    (first + int(names, 1, EXTRA_PROJECT_NAMES.length - 1)) % EXTRA_PROJECT_NAMES.length;
  const extraProjects = [first, second].slice(0, Math.min(2, agents)).map((n, i) => ({
    id: `mock-project-extra-${i}`,
    name: EXTRA_PROJECT_NAMES[n] as string,
  }));
  const config: Config = { seed, agents, durationMs, timeScale, origin, extraProjects };

  const spineEnd = Math.max(...buildSpine(0).map((s) => s.at(-1)?.t ?? 0));
  const last = Math.max(spineEnd, agents > 0 ? durationMs + FILLER_SLACK_MS : 0);
  if (toTs(config, last) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `origin ${origin}, durationMs ${durationMs} and timeScale ${timeScale} overflow the safe integer range`,
    );
  }
  return config;
}

type Entry = { t: number; source: number; item: Pending; rest: Iterator<Pending> };
const before = (a: Entry, b: Entry) => a.t < b.t || (a.t === b.t && a.source < b.source);

function siftUp(heap: Entry[], from: number) {
  let i = from;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!before(heap[i] as Entry, heap[parent] as Entry)) return;
    [heap[i], heap[parent]] = [heap[parent] as Entry, heap[i] as Entry];
    i = parent;
  }
}

function siftDown(heap: Entry[], from: number) {
  let i = from;
  for (;;) {
    let best = i;
    for (const child of [2 * i + 1, 2 * i + 2]) {
      if (child < heap.length && before(heap[child] as Entry, heap[best] as Entry)) best = child;
    }
    if (best === i) return;
    [heap[i], heap[best]] = [heap[best] as Entry, heap[i] as Entry];
    i = best;
  }
}

// Merges the sources on unscaled sim time (ties: source order), then maps to ts, so a timeScale
// that collapses timestamps cannot reorder causally related events. One entry per source in the
// heap keeps the merge O(log sources) per event, and sources build their events on demand.
function* generate(config: Config): Generator<Event> {
  const heap: Entry[] = [];
  let source = 0;
  const add = (iterator: Iterator<Pending>) => {
    const first = iterator.next();
    if (!first.done) {
      heap.push({ t: first.value.t, source, item: first.value, rest: iterator });
      siftUp(heap, heap.length - 1);
    }
    source += 1;
  };
  for (const session of buildSpine(config.seed)) add(session[Symbol.iterator]());
  for (let i = 0; i < config.agents; i++) {
    add(fillerSession(config.seed, i, config.durationMs, config.extraProjects));
  }

  for (let n = 0; heap.length > 0; n++) {
    const top = heap[0] as Entry;
    const { t, item } = top;
    const next = top.rest.next();
    if (next.done) {
      const lastEntry = heap.pop() as Entry;
      if (heap.length > 0) {
        heap[0] = lastEntry;
        siftDown(heap, 0);
      }
    } else {
      top.t = next.value.t;
      top.item = next.value;
      siftDown(heap, 0);
    }
    yield {
      id: `mock-${config.seed}-${n}`,
      ts: toTs(config, t),
      sessionId: item.sessionId,
      ...item.draft,
    } as Event;
  }
}

export function createMockStream(options: MockOptions = {}): Iterable<Event> {
  const config = resolveOptions(options);
  return { [Symbol.iterator]: () => generate(config) };
}
