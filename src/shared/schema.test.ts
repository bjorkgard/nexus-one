import { describe, expect, it } from "vite-plus/test";
import entities from "./fixtures/entities.json";
import events from "./fixtures/events.json";
import invalid from "./fixtures/invalid.json";
import {
  Agent,
  EVENT_TYPES,
  MAX_ERROR,
  MAX_ID,
  MAX_TEXT,
  Project,
  Session,
  parseEvent,
} from "./schema";

type Json = Record<string, unknown>;
const eventMap = events as Record<string, Json>;
const patch = (base: Json, change: Json): Json => ({ ...base, ...change });
const codes = (input: unknown) => {
  const result = parseEvent(input);
  return result.ok ? [] : result.issues.map((i) => i.code);
};

describe("canonical event schema", () => {
  it("fixture keys match EVENT_TYPES and each entry parses with its own type", () => {
    expect(new Set(Object.keys(events))).toEqual(new Set(EVENT_TYPES));
    expect(EVENT_TYPES).toHaveLength(13);
    for (const [key, event] of Object.entries(eventMap)) {
      const result = parseEvent(event);
      expect(result.ok, key).toBe(true);
      expect(event.type).toBe(key);
      if (result.ok) {
        expect(result.event.type).toBe(key);
      }
    }
  });

  it.each([
    ["project", Project],
    ["session", Session],
    ["agent", Agent],
  ] as const)("entity %s parses and rejects an extra key", (key, schema) => {
    const entity = entities[key];
    expect(schema.safeParse(entity).success).toBe(true);
    const bad = schema.safeParse({ ...entity, extra: 1 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it.each([[null], [undefined], [42], [[]]])(
    "parseEvent(%j) returns ok false without throwing",
    (v) => {
      expect(parseEvent(v).ok).toBe(false);
    },
  );

  const throwing = () => {
    throw new Error("boom");
  };
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  it.each([
    ["Proxy get trap throws", new Proxy({}, { get: throwing })],
    ["Proxy ownKeys trap throws", new Proxy({ ...eventMap.session_end }, { ownKeys: throwing })],
    ["throwing getter on type", Object.defineProperty({}, "type", { get: throwing })],
    ["revoked Proxy", revoked.proxy],
  ])("parseEvent never throws: %s", (_label, input) => {
    expect(parseEvent(input)).toEqual({ ok: false, issues: [{ path: "", code: "parse_threw" }] });
  });

  it("__proto__ own key is rejected as unrecognized_keys", () => {
    const input = JSON.parse(
      '{"id":"e1","ts":1,"type":"session_end","sessionId":"s1","__proto__":{}}',
    );
    expect(codes(input)).toContain("unrecognized_keys");
  });

  it.each(invalid)("invalid case: $name", ({ name, input, expectCode }) => {
    const result = parseEvent(input);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.map((i) => i.code)).toContain(expectCode);
    if (name === "missing id") {
      expect(result.issues).toContainEqual({ path: "id", code: "invalid_type" });
    }
    if (name === "extra key") {
      expect(result.issues).toContainEqual({ path: "", code: "unrecognized_keys" });
    }
  });

  const badEnum = "__bad__";
  it.each([
    ["provider", "session_start", "provider"],
    ["agent outcome", "agent_end", "outcome"],
    ["tool outcome", "tool_call_end", "outcome"],
    ["attention reason", "needs_attention", "reason"],
    ["handoff direction", "handoff", "direction"],
    ["dequeue reason", "task_dequeued", "reason"],
    ["message role", "message", "role"],
  ])("bad enum %s", (_label, type, field) => {
    expect(codes(patch(eventMap[type]!, { [field]: badEnum }))).toContain("invalid_value");
  });

  it("bad enum stage on the Agent entity", () => {
    const result = Agent.safeParse({ ...entities.agent, stage: badEnum });
    expect(result.error?.issues[0]?.code).toBe("invalid_value");
  });

  it.each([
    ["id", "session_end", "id", MAX_ID],
    ["message.text", "message", "text", MAX_TEXT],
    ["tool_call_end.error", "tool_call_end", "error", MAX_ERROR],
  ])("cap %s: at cap passes, cap+1 fails with too_big", (_label, type, field, cap) => {
    expect(parseEvent(patch(eventMap[type]!, { [field]: "x".repeat(cap) })).ok).toBe(true);
    expect(codes(patch(eventMap[type]!, { [field]: "x".repeat(cap + 1) }))).toContain("too_big");
  });

  it("rejects negative ts and fractional token counts", () => {
    expect(codes(patch(eventMap.session_end!, { ts: -1 }))).toContain("too_small");
    expect(codes(patch(eventMap.tokens!, { input: 1.5 }))).toContain("invalid_type");
  });

  const { argsHash: _omit, ...withoutArgsHash } = eventMap.tool_call_start!;
  it.each([
    ["argsHash omitted", withoutArgsHash],
    ["error present", patch(eventMap.tool_call_end!, { outcome: "error", error: "boom" })],
    ["parentId string", patch(eventMap.agent_spawn!, { parentId: "a0" })],
    ["model null", patch(eventMap.agent_spawn!, { model: null })],
    ["model string", patch(eventMap.agent_spawn!, { model: "m1" })],
    ...["claude", "codex"].map(
      (v) => [`provider ${v}`, patch(eventMap.session_start!, { provider: v })] as const,
    ),
    ...["ok", "error", "cancelled"].map(
      (v) => [`agent outcome ${v}`, patch(eventMap.agent_end!, { outcome: v })] as const,
    ),
    ...["ok", "error"].map(
      (v) => [`tool outcome ${v}`, patch(eventMap.tool_call_end!, { outcome: v })] as const,
    ),
    ...["permission", "question", "approval"].map(
      (v) => [`reason ${v}`, patch(eventMap.needs_attention!, { reason: v })] as const,
    ),
    ...["delegate", "return"].map(
      (v) => [`direction ${v}`, patch(eventMap.handoff!, { direction: v })] as const,
    ),
    ...["started", "cancelled"].map(
      (v) => [`dequeue ${v}`, patch(eventMap.task_dequeued!, { reason: v })] as const,
    ),
    ...["assistant", "user"].map(
      (v) => [`role ${v}`, patch(eventMap.message!, { role: v })] as const,
    ),
  ] as const)("valid variant: %s", (_label, input) => {
    expect(parseEvent(input).ok).toBe(true);
  });

  it.each(["queued", "planning", "executing", "waiting_on_tool", "reviewing", "done"])(
    "valid agent stage %s",
    (stage) => {
      expect(Agent.safeParse({ ...entities.agent, stage }).success).toBe(true);
    },
  );

  it("valid session endedAt number", () => {
    expect(Session.safeParse({ ...entities.session, endedAt: 2000 }).success).toBe(true);
  });
});
