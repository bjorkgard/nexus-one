import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import events from "../shared/fixtures/events.json";
import { parseServerMessage } from "../shared/protocol";
import { emptyState, fromSnapshot, reduce, toSnapshot, type NexusState } from "../shared/reduce";
import { createMockStream } from "./mock";
import { DEFAULT_LIVE_PORT, PROTOCOL_VERSION, type Snapshot } from "../shared/protocol";
import type { Event } from "../shared/schema";
import {
  createDataClient,
  selectSource,
  type ResyncReason,
  type Transport,
  type TransportInput,
} from "./source";

const E = events as unknown as Record<Event["type"], Event>;
const ev = (type: Event["type"], change: Record<string, unknown> = {}): Event =>
  ({ ...E[type], ...change }) as Event;

const emptySnapshot: Snapshot = {
  projects: [],
  sessions: [],
  agents: [],
  openCalls: [],
  queuedTasks: [],
  attention: [],
  usage: [],
  recentIds: [],
};
const hello = (epoch = "e1", v = PROTOCOL_VERSION) => ({ type: "hello", v, epoch });
const snap = (seq = 0, snapshot: Snapshot = emptySnapshot, epoch = "e1") => ({
  type: "snapshot",
  epoch,
  seq,
  snapshot,
});
const evMsg = (seq: number, event: Event, epoch = "e1") => ({ type: "event", epoch, seq, event });

function setup(opts: { startThrows?: boolean; logThrows?: boolean; reportThrows?: boolean } = {}) {
  const calls = {
    resync: [] as ResyncReason[],
    snapshotAccepted: 0,
    stop: 0,
    start: 0,
  };
  let sink!: (i: TransportInput) => void;
  let onStatus!: (s: "connecting" | "connected" | "disconnected") => void;
  const transport: Transport = {
    kind: "live",
    start(s, st) {
      calls.start += 1;
      if (opts.startThrows) throw new Error("start failed");
      sink = s;
      onStatus = st;
      return {
        stop: () => void (calls.stop += 1),
        resync: (r) => void calls.resync.push(r),
        snapshotAccepted: () => void (calls.snapshotAccepted += 1),
      };
    },
  };
  const down = () => {
    throw new Error("down");
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const reportError = vi.fn();
  if (opts.logThrows) for (const fn of [log.info, log.warn, log.error]) fn.mockImplementation(down);
  if (opts.reportThrows) reportError.mockImplementation(down);
  const client = createDataClient(transport, { log, reportError });
  const frame = (data: unknown) => sink({ kind: "frame", data });
  const connect = () => {
    onStatus("connecting");
    onStatus("connected");
  };
  const ready = (seq = 0, snapshot: Snapshot = emptySnapshot) => {
    connect();
    frame(hello());
    frame(snap(seq, snapshot));
  };
  const subscribe = () => {
    const snaps: Snapshot[] = [];
    const evs: Event[] = [];
    const unsub = client.subscribe(
      (s) => snaps.push(s),
      (e) => evs.push(e),
    );
    return { snaps, evs, unsub };
  };
  return {
    client,
    calls,
    log,
    reportError,
    frame,
    connect,
    ready,
    subscribe,
    bad: (code: "too_large" | "not_json" | "binary") => sink({ kind: "bad_frame", code }),
    status: (s: "connecting" | "connected" | "disconnected") => onStatus(s),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("lifecycle and status", () => {
  it("starts idle; first subscribe starts the transport once", () => {
    const t = setup();
    expect(t.client.status).toBe("idle");
    t.subscribe();
    t.subscribe();
    expect(t.calls.start).toBe(1);
  });

  it("follows transport status and the snapshot", () => {
    const t = setup();
    t.subscribe();
    t.status("connecting");
    expect(t.client.status).toBe("connecting");
    t.status("connected");
    expect(t.client.status).toBe("syncing");
    t.frame(hello());
    expect(t.client.status).toBe("syncing");
    t.frame(snap());
    expect(t.client.status).toBe("open");
    t.status("disconnected");
    expect(t.client.status).toBe("reconnecting");
    expect(t.client.stats().counters.reconnects).toBe(1);
  });

  it("last unsubscribe stops the transport and closes for good; unsubscribe is idempotent", () => {
    const t = setup();
    const a = t.subscribe();
    const b = t.subscribe();
    a.unsub();
    expect(t.calls.stop).toBe(0);
    b.unsub();
    b.unsub();
    expect(t.calls.stop).toBe(1);
    expect(t.client.status).toBe("closed");
    expect(() =>
      t.client.subscribe(
        () => {},
        () => {},
      ),
    ).toThrow();
    expect(() => t.client.emit(ev("session_start"))).toThrow();
  });

  it("close() stops the transport once", () => {
    const t = setup();
    t.subscribe();
    t.client.close();
    t.client.close();
    expect(t.calls.stop).toBe(1);
    expect(t.client.status).toBe("closed");
  });

  it("a throwing start makes subscribe throw and status stays idle", () => {
    const t = setup({ startThrows: true });
    expect(() => t.subscribe()).toThrow("start failed");
    expect(t.client.status).toBe("idle");
  });
});

describe("gate", () => {
  it("accepts snapshot: state, snapshotAccepted, fan-out", () => {
    const t = setup();
    const s = t.subscribe();
    const withProject = { ...emptySnapshot, projects: [{ id: "p", name: "P" }], recentIds: ["x"] };
    t.ready(5, withProject);
    expect(t.calls.snapshotAccepted).toBe(1);
    expect(s.snaps).toEqual([withProject]);
    expect(t.client.stats().counts.projects).toBe(1);
  });

  it("incompatible hello: status, log.error, resync, then ignores frames until next hello", () => {
    const t = setup();
    t.subscribe();
    t.connect();
    t.frame(hello("e1", 99));
    expect(t.client.status).toBe("incompatible");
    expect(t.log.error).toHaveBeenCalledTimes(1);
    expect(t.calls.resync).toEqual(["incompatible"]);
    t.frame(snap());
    t.bad("not_json");
    expect(t.calls.resync).toEqual(["incompatible"]);
    expect(t.client.stats().counters.rejected).toBe(0);
    t.frame(hello("e2"));
    t.frame(snap(0, emptySnapshot, "e2"));
    expect(t.client.status).toBe("open");
  });

  it("bad frames and unparsable messages: rejected++, one warn per kind, resync rejected", () => {
    const t = setup();
    t.subscribe();
    t.connect();
    t.bad("too_large");
    expect(t.calls.resync).toEqual(["rejected"]);
    t.frame(hello());
    t.bad("too_large");
    t.frame(hello());
    t.frame({ type: "nope" });
    t.frame(hello());
    t.frame({ type: "nope" });
    const c = t.client.stats().counters;
    expect(c.rejected).toBe(4);
    expect(c.resyncs).toBe(4);
    expect(t.log.warn).toHaveBeenCalledTimes(2); // too_large once, invalid_message once
  });

  it("reconnect resets the once-per-kind warning set", () => {
    const t = setup();
    t.subscribe();
    t.connect();
    t.bad("binary");
    t.connect();
    t.frame(hello());
    t.bad("binary");
    expect(t.log.warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["first message not hello", (t: ReturnType<typeof setup>) => t.frame(snap())],
    [
      "snapshot epoch differs",
      (t: ReturnType<typeof setup>) => {
        t.frame(hello("e1"));
        t.frame(snap(0, emptySnapshot, "other"));
      },
    ],
    [
      "event epoch differs",
      (t: ReturnType<typeof setup>) => {
        t.frame(hello("e1"));
        t.frame(snap());
        t.frame(evMsg(1, ev("session_start"), "other"));
      },
    ],
    [
      "event before snapshot",
      (t: ReturnType<typeof setup>) => {
        t.frame(hello());
        t.frame(evMsg(1, ev("session_start")));
      },
    ],
  ])("order: %s -> resync order", (_name, act) => {
    const t = setup();
    t.subscribe();
    t.connect();
    act(t);
    expect(t.calls.resync).toEqual(["order"]);
    expect(t.client.stats().counters.resyncs).toBe(1);
  });

  it("events: seq cursor+1 applies and fans out; seq <= cursor is a duplicate; gap resyncs", () => {
    const t = setup();
    const s = t.subscribe();
    t.ready(10);
    const a = ev("session_start", { id: "a" });
    t.frame(evMsg(11, a));
    t.frame(evMsg(11, a));
    t.frame(evMsg(3, ev("session_start", { id: "z" })));
    t.frame(evMsg(11, ev("session_start", { id: "fresh" }))); // seq == cursor, new id
    expect(s.evs).toEqual([a]);
    expect(t.client.stats().counters.duplicates).toBe(3);
    expect(t.client.stats().lastEventId).toBe("a");
    t.frame(evMsg(13, ev("session_start", { id: "b" })));
    expect(t.calls.resync).toEqual(["gap"]);
    expect(s.evs).toHaveLength(1);
    t.frame(evMsg(12, ev("session_start", { id: "c" }))); // ignored until next hello
    expect(s.evs).toHaveLength(1);
  });

  it("duplicate id at cursor+1 advances the cursor and counts once", () => {
    const t = setup();
    const s = t.subscribe();
    t.ready(0);
    const a = ev("session_start", { id: "a" });
    t.frame(evMsg(1, a));
    t.frame(evMsg(2, a));
    t.frame(evMsg(3, ev("session_start", { id: "b", sessionId: "s2" })));
    expect(s.evs.map((e) => e.id)).toEqual(["a", "b"]);
    expect(t.client.stats().counters.duplicates).toBe(1);
    expect(t.calls.resync).toEqual([]);
  });

  it("snapshot recentIds seed the ring: a replayed id is not applied", () => {
    const t = setup();
    const s = t.subscribe();
    t.ready(4, { ...emptySnapshot, recentIds: ["seen"] });
    t.frame(evMsg(5, ev("session_start", { id: "seen" })));
    expect(s.evs).toEqual([]);
    expect(t.client.stats().counters.duplicates).toBe(1);
  });

  it("an accepted snapshot resets lastEventId to the last recent id (or null)", () => {
    const t = setup();
    t.subscribe();
    t.ready(0);
    t.frame(evMsg(1, ev("session_start", { id: "a" })));
    expect(t.client.stats().lastEventId).toBe("a");
    t.ready(5, { ...emptySnapshot, recentIds: ["x", "y"] });
    expect(t.client.stats().lastEventId).toBe("y");
    t.ready(0);
    expect(t.client.stats().lastEventId).toBeNull();
  });

  it("an inconsistent event is counted and still fanned out", () => {
    const t = setup();
    const s = t.subscribe();
    t.ready(0);
    t.frame(evMsg(1, ev("tool_call_end")));
    expect(t.client.stats().counters.inconsistent).toBe(1);
    expect(s.evs).toHaveLength(1);
  });

  it("a new snapshot after reconnect replaces state", () => {
    const t = setup();
    const s = t.subscribe();
    t.ready(0, { ...emptySnapshot, projects: [{ id: "p", name: "P" }] });
    t.status("disconnected");
    t.connect();
    t.frame(hello("e2"));
    t.frame(snap(7, emptySnapshot, "e2"));
    expect(t.client.stats().counts.projects).toBe(0);
    expect(s.snaps).toHaveLength(2);
    t.frame(evMsg(8, ev("session_start", { id: "n" }), "e2"));
    expect(s.evs).toHaveLength(1);
  });

  it("stats count entities after events", () => {
    const t = setup();
    t.subscribe();
    t.ready(0);
    t.frame(evMsg(1, ev("session_start")));
    t.frame(evMsg(2, ev("agent_spawn", { parentId: null })));
    expect(t.client.stats().counts).toEqual({ projects: 1, sessions: 1, agents: 1 });
  });
});

describe("subscribers and emit", () => {
  it("a late subscriber is handed the current state at once", () => {
    const t = setup();
    t.subscribe();
    t.ready(0);
    t.frame(evMsg(1, ev("session_start", { id: "a" })));
    const late = t.subscribe();
    expect(late.snaps).toHaveLength(1);
    expect(late.snaps[0]!.sessions).toHaveLength(1);
    expect(late.snaps[0]!.recentIds).toEqual(["a"]);
  });

  it("no snapshot yet: nothing handed at subscribe", () => {
    const t = setup();
    expect(t.subscribe().snaps).toEqual([]);
  });

  it("a throwing subscriber is isolated and goes to reportError", () => {
    const t = setup();
    const boom = new Error("boom");
    t.client.subscribe(
      () => {},
      () => {
        throw boom;
      },
    );
    const ok = t.subscribe();
    t.ready(0);
    t.frame(evMsg(1, ev("session_start")));
    expect(ok.evs).toHaveLength(1);
    expect(t.reportError).toHaveBeenCalledWith(boom);
  });

  it("falls back to console.error when reportError is absent (Node)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = (globalThis as { reportError?: unknown }).reportError;
    delete (globalThis as { reportError?: unknown }).reportError;
    try {
      let sink!: (i: TransportInput) => void;
      const client = createDataClient(
        {
          kind: "mock",
          start: (s) => {
            sink = s;
            return { stop() {}, resync() {}, snapshotAccepted() {} };
          },
        },
        { log: { info() {}, warn() {}, error() {} } },
      );
      const boom = new Error("boom");
      client.subscribe(
        () => {
          throw boom;
        },
        () => {},
      );
      sink({ kind: "frame", data: hello() });
      sink({ kind: "frame", data: snap() });
      expect(spy).toHaveBeenCalledWith(boom);
    } finally {
      if (saved) (globalThis as { reportError?: unknown }).reportError = saved;
    }
  });

  it("uses the browser reportError when present", () => {
    const saved = (globalThis as { reportError?: unknown }).reportError;
    const report = vi.fn();
    (globalThis as { reportError?: unknown }).reportError = report;
    try {
      let sink!: (i: TransportInput) => void;
      const client = createDataClient(
        {
          kind: "mock",
          start: (s) => {
            sink = s;
            return { stop() {}, resync() {}, snapshotAccepted() {} };
          },
        },
        { log: { info() {}, warn() {}, error() {} } },
      );
      const boom = new Error("boom");
      client.subscribe(
        () => {
          throw boom;
        },
        () => {},
      );
      sink({ kind: "frame", data: hello() });
      sink({ kind: "frame", data: snap() });
      expect(report).toHaveBeenCalledWith(boom);
    } finally {
      if (saved) (globalThis as { reportError?: unknown }).reportError = saved;
      else delete (globalThis as { reportError?: unknown }).reportError;
    }
  });

  it("nested emit from a callback is delivered in order to all subscribers", () => {
    const t = setup();
    const seenA: string[] = [];
    const seenB: string[] = [];
    t.client.subscribe(
      () => {},
      (e) => {
        seenA.push(e.id);
        if (e.id === "first") t.client.emit(ev("session_start", { id: "nested", sessionId: "s2" }));
      },
    );
    t.client.subscribe(
      () => {},
      (e) => seenB.push(e.id),
    );
    t.ready(0);
    t.frame(evMsg(1, ev("session_start", { id: "first" })));
    t.frame(evMsg(2, ev("session_start", { id: "second", sessionId: "s3" })));
    expect(seenA).toEqual(["first", "nested", "second"]);
    expect(seenB).toEqual(seenA);
  });

  it("emit validates, throws on invalid input, applies and fans out valid input", () => {
    const t = setup();
    const s = t.subscribe();
    expect(() => t.client.emit({ type: "bogus", secret: "TOPSECRET" })).toThrow(/type/);
    try {
      t.client.emit({ type: "bogus", secret: "TOPSECRET" });
    } catch (error) {
      expect(String(error)).not.toContain("TOPSECRET");
    }
    t.client.emit(ev("session_start"));
    expect(s.evs).toHaveLength(1);
    expect(t.client.stats().counts.sessions).toBe(1);
    t.client.emit(ev("session_start")); // same id: once
    expect(s.evs).toHaveLength(1);
    expect(t.client.stats().counters.duplicates).toBe(1);
  });

  it("input from the transport during a fan-out is queued behind it", () => {
    const t = setup();
    const order: string[] = [];
    let injected = false;
    t.client.subscribe(
      () => {},
      (e) => {
        order.push(`a:${e.id}`);
        if (!injected) {
          injected = true;
          t.frame(evMsg(2, ev("session_start", { id: "two", sessionId: "s2" })));
        }
      },
    );
    t.client.subscribe(
      () => {},
      (e) => order.push(`b:${e.id}`),
    );
    t.ready(0);
    t.frame(evMsg(1, ev("session_start", { id: "one" })));
    expect(order).toEqual(["a:one", "b:one", "a:two", "b:two"]);
  });

  it("log and warning text never carries event text", () => {
    const t = setup();
    t.subscribe();
    t.connect();
    t.frame(hello());
    t.frame({
      type: "event",
      epoch: "e1",
      seq: 1,
      event: { ...ev("message"), text: "TOPSECRET", extra: 1 },
    });
    t.frame(hello());
    t.frame(snap());
    t.frame(evMsg(1, { ...ev("message"), text: "TOPSECRET" } as Event));
    const all = JSON.stringify([
      t.log.info.mock.calls,
      t.log.warn.mock.calls,
      t.log.error.mock.calls,
    ]);
    expect(all).not.toContain("TOPSECRET");
    expect(t.log.warn).toHaveBeenCalled();
  });
});

describe("synchronous and queued transport input", () => {
  it("snapshotAccepted fires when hello + snapshot arrive synchronously inside start", () => {
    let accepted = 0;
    const transport: Transport = {
      kind: "mock",
      start(sink, onStatus) {
        onStatus("connecting");
        onStatus("connected");
        sink({ kind: "frame", data: hello() });
        sink({ kind: "frame", data: snap(0) });
        return {
          stop() {},
          resync() {},
          snapshotAccepted: () => void (accepted += 1),
        };
      },
    };
    const client = createDataClient(transport, {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reportError: vi.fn(),
    });
    const snaps: Snapshot[] = [];
    client.subscribe(
      (x) => snaps.push(x),
      () => {},
    );
    expect(accepted).toBe(1);
    expect(client.status).toBe("open");
    expect(snaps).toHaveLength(1);
  });

  it("a resync raised synchronously inside start reaches the control handle", () => {
    const resyncs: ResyncReason[] = [];
    const transport: Transport = {
      kind: "mock",
      start(sink, onStatus) {
        onStatus("connected");
        sink({ kind: "bad_frame", code: "not_json" });
        return { stop() {}, resync: (r) => void resyncs.push(r), snapshotAccepted() {} };
      },
    };
    const client = createDataClient(transport, {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reportError: vi.fn(),
    });
    client.subscribe(
      () => {},
      () => {},
    );
    expect(resyncs).toEqual(["rejected"]);
  });

  it("a status change during a fan-out waits behind frames already queued", () => {
    const t = setup();
    const evs: Event[] = [];
    t.client.subscribe(
      () => {},
      (e) => {
        evs.push(e);
        if (evs.length === 1) {
          t.frame(evMsg(2, ev("session_start", { id: "b", sessionId: "s2" })));
          t.status("connected");
        }
      },
    );
    t.ready(0);
    t.frame(evMsg(1, ev("session_start", { id: "a" })));
    expect(evs.map((e) => e.id)).toEqual(["a", "b"]);
    expect(t.calls.resync).toEqual([]);
    expect(t.client.status).toBe("syncing");
  });

  it("a throwing logger does not stop the queue from draining", () => {
    const t = setup();
    const evs: Event[] = [];
    t.client.subscribe(
      () => {},
      (e) => {
        evs.push(e);
        if (evs.length === 1) {
          t.status("disconnected"); // setStatus logs info, which throws
          t.frame(evMsg(2, ev("session_start", { id: "b", sessionId: "s2" })));
        }
      },
    );
    t.ready(0);
    t.log.info.mockImplementation(() => {
      throw new Error("log down");
    });
    t.frame(evMsg(1, ev("session_start", { id: "a" })));
    expect(evs.map((e) => e.id)).toEqual(["a", "b"]);
    expect(t.reportError).toHaveBeenCalled();
  });
});

describe("injected callbacks cannot break the client", () => {
  it("a throwing reportError does not strand queued input", () => {
    const t = setup({ reportThrows: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const evs: Event[] = [];
    t.client.subscribe(
      () => {},
      (e) => {
        evs.push(e);
        if (evs.length === 1) {
          t.frame(evMsg(2, ev("session_start", { id: "b", sessionId: "s2" })));
          throw new Error("subscriber failed");
        }
      },
    );
    t.ready(0);
    t.frame(evMsg(1, ev("session_start", { id: "a" })));
    expect(evs.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("a gap still resyncs when every log method throws", () => {
    const t = setup({ logThrows: true });
    t.subscribe();
    t.ready(0);
    t.frame(evMsg(5, ev("session_start", { id: "a" })));
    expect(t.calls.resync).toEqual(["gap"]);
  });

  it("a not_json bad frame still resyncs when every log method throws", () => {
    const t = setup({ logThrows: true });
    t.subscribe();
    t.connect();
    t.bad("not_json");
    expect(t.calls.resync).toEqual(["rejected"]);
  });

  it("a good snapshot is still accepted and delivered when every log method throws", () => {
    const t = setup({ logThrows: true });
    const s = t.subscribe();
    t.ready(0);
    expect(t.client.status).toBe("open");
    expect(t.calls.snapshotAccepted).toBe(1);
    expect(s.snaps).toHaveLength(1);
  });

  it("an incompatible hello still resyncs when every log method throws", () => {
    const t = setup({ logThrows: true });
    t.subscribe();
    t.connect();
    t.frame(hello("e1", PROTOCOL_VERSION + 1));
    expect(t.calls.resync).toEqual(["incompatible"]);
    expect(t.client.status).toBe("incompatible");
  });
});

describe("close during transport.start", () => {
  it("stops the handle start returns, and subscribe throws", () => {
    let stops = 0;
    let client!: ReturnType<typeof createDataClient>;
    const transport: Transport = {
      kind: "mock",
      start() {
        client.close();
        return { stop: () => void (stops += 1), resync() {}, snapshotAccepted() {} };
      },
    };
    client = createDataClient(transport, {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reportError: vi.fn(),
    });
    expect(() =>
      client.subscribe(
        () => {},
        () => {},
      ),
    ).toThrow();
    expect(stops).toBe(1);
    expect(client.status).toBe("closed");
  });
});

describe("selectSource", () => {
  it("defaults to mock with no warning", () => {
    expect(selectSource("")).toEqual({ kind: "mock", port: DEFAULT_LIVE_PORT, warnings: [] });
  });
  it("picks live and mock exactly", () => {
    expect(selectSource("?source=live").kind).toBe("live");
    expect(selectSource("?source=mock").warnings).toEqual([]);
  });
  it("uses the first source value", () => {
    expect(selectSource("?source=live&source=mock").kind).toBe("live");
  });
  it.each(["LIVE", "Mock", "", "ws", "live "])(
    "unknown source %j -> mock + warning naming it",
    (v) => {
      const r = selectSource(`?source=${encodeURIComponent(v)}`);
      expect(r.kind).toBe("mock");
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain(JSON.stringify(v).slice(1, -1));
    },
  );
  it("accepts a port in range", () => {
    expect(selectSource("?source=live&port=1024").port).toBe(1024);
    expect(selectSource("?port=65535").port).toBe(65535);
    expect(selectSource("?port=50000").warnings).toEqual([]);
  });
  it.each(["1023", "65536", "abc", "12.5", "-5", "", "1e4", "0x500"])(
    "bad port %j -> default + warning",
    (v) => {
      const r = selectSource(`?port=${v}`);
      expect(r.port).toBe(DEFAULT_LIVE_PORT);
      expect(r.warnings).toHaveLength(1);
    },
  );
});

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

describe("default mock stream", () => {
  const list = [...createMockStream()];

  it("reduces to 1 project, 3 sessions, 11 agents (8 with a parent), no inconsistency", () => {
    expect(list).toHaveLength(92);
    const { state, inconsistent } = run(list);
    expect(inconsistent).toBe(0);
    expect(state.projects.size).toBe(1);
    expect(state.sessions.size).toBe(3);
    expect(state.agents.size).toBe(11);
    expect([...state.agents.values()].filter((a) => a.parentId !== null)).toHaveLength(8);
  });

  it("toSnapshot / fromSnapshot round trip is lossless and parses as a snapshot message", () => {
    const { state } = run(list);
    const snap = toSnapshot(
      state,
      list.slice(-5).map((e) => e.id),
    );
    const back = fromSnapshot(snap);
    expect(back).toEqual(state);
    expect(toSnapshot(back, snap.recentIds)).toEqual(snap);
    expect(parseServerMessage({ type: "snapshot", epoch: "e", seq: 92, snapshot: snap }).ok).toBe(
      true,
    );
    console.info(`default mock snapshot JSON bytes: ${JSON.stringify(snap).length}`);
  });

  it("a retained snapshot is unchanged after 100 more events", () => {
    const { state } = run(list.slice(0, 40));
    const snap = toSnapshot(state, []);
    const frozen = JSON.stringify(snap);
    const retained = fromSnapshot(snap);
    const target = [...retained.agents.values()][0]!;
    const later = run(list.slice(40, 92), retained);
    const extra = run(
      Array.from({ length: 100 }, (_, i) =>
        ev("message", {
          id: `m${i}`,
          ts: 10 ** 12 + i,
          sessionId: target.sessionId,
          agentId: target.id,
        }),
      ),
      later.state,
    );
    expect(extra.inconsistent).toBe(0);
    expect(extra.state.agents.get(target.id)!.lastProgressAt).toBe(10 ** 12 + 99);
    expect(JSON.stringify(toSnapshot(extra.state, []))).not.toBe(frozen);
    expect(JSON.stringify(snap)).toBe(frozen);
    expect(JSON.stringify(toSnapshot(retained, []))).toBe(frozen);
  });
});
