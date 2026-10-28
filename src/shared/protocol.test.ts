import { describe, expect, it } from "vite-plus/test";
import events from "./fixtures/events.json";
import {
  DEFAULT_LIVE_PORT,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  RECENT_IDS_CAP,
  parseServerMessage,
} from "./protocol";

const emptySnapshot = {
  projects: [],
  sessions: [],
  agents: [],
  openCalls: [],
  queuedTasks: [],
  attention: [],
  usage: [],
  recentIds: [],
};
const hello = { type: "hello", v: PROTOCOL_VERSION, epoch: "e1" };
const snapshot = { type: "snapshot", epoch: "e1", seq: 0, snapshot: emptySnapshot };
const event = { type: "event", epoch: "e1", seq: 1, event: events.message };

describe("protocol constants", () => {
  it("pins the documented values", () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(DEFAULT_LIVE_PORT).toBe(47821);
    expect(MAX_FRAME_BYTES).toBe(8 * 1024 * 1024);
    expect(RECENT_IDS_CAP).toBe(4096);
  });
});

describe("parseServerMessage", () => {
  it.each([
    ["hello", hello],
    ["snapshot", snapshot],
    ["event", event],
    ["snapshot with seq 0", { ...snapshot, seq: 0 }],
  ])("accepts %s", (_name, input) => {
    const result = parseServerMessage(input);
    expect(result.ok).toBe(true);
  });

  it("accepts every event type inside an event message", () => {
    for (const e of Object.values(events)) {
      expect(parseServerMessage({ type: "event", epoch: "e", seq: 1, event: e }).ok).toBe(true);
    }
  });

  it.each([
    ["unknown type", { type: "bye" }],
    ["missing epoch", { type: "hello", v: 1 }],
    [
      "missing field in snapshot",
      { ...snapshot, snapshot: { ...emptySnapshot, usage: undefined } },
    ],
    ["non-integer version", { ...hello, v: 1.5 }],
    ["string version", { ...hello, v: "1" }],
    ["event seq 0", { ...event, seq: 0 }],
    ["snapshot negative seq", { ...snapshot, seq: -1 }],
    ["extra key", { ...hello, extra: 1 }],
    ["invalid inner event", { ...event, event: { ...events.message, text: "" } }],
    [
      "id-keyed object instead of array",
      { ...snapshot, snapshot: { ...emptySnapshot, agents: {} } },
    ],
    ["null", null],
    ["string", "hello"],
  ])("rejects %s", (_name, input) => {
    const result = parseServerMessage(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it("accepts a hello with another version (the client decides)", () => {
    expect(parseServerMessage({ ...hello, v: 2 }).ok).toBe(true);
  });

  it("accepts __proto__ as an id value", () => {
    const result = parseServerMessage({
      ...snapshot,
      snapshot: {
        ...emptySnapshot,
        projects: [{ id: "__proto__", name: "p" }],
        recentIds: ["__proto__"],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts recentIds at the cap and rejects one more", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
    const at = { ...snapshot, snapshot: { ...emptySnapshot, recentIds: ids(RECENT_IDS_CAP) } };
    const over = {
      ...snapshot,
      snapshot: { ...emptySnapshot, recentIds: ids(RECENT_IDS_CAP + 1) },
    };
    expect(parseServerMessage(at).ok).toBe(true);
    expect(parseServerMessage(over).ok).toBe(false);
  });

  it("never throws on hostile input", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
        ownKeys() {
          throw new Error("boom");
        },
        getPrototypeOf() {
          throw new Error("boom");
        },
      },
    );
    expect(() => parseServerMessage(hostile)).not.toThrow();
    expect(parseServerMessage(hostile).ok).toBe(false);
  });
});
