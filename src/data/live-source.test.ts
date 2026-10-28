import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it } from "vite-plus/test";
import events from "../shared/fixtures/events.json";
import {
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  RECENT_IDS_CAP,
  type Snapshot,
} from "../shared/protocol";
import { emptyState, reduce, toSnapshot } from "../shared/reduce";
import type { Event } from "../shared/schema";
import { liveTransport } from "./live-source";
import { createDataClient, type DataClient, type TransportInput } from "./source";

const E = events as unknown as Record<Event["type"], Event>;
const ev = (type: Event["type"], change: Record<string, unknown> = {}): Event =>
  ({ ...E[type], ...change }) as Event;

const reduceAll = (list: readonly Event[]) => {
  let state = emptyState();
  for (const event of list) state = reduce(state, event).state;
  return state;
};
const withoutIds = ({ recentIds: _ignored, ...rest }: Snapshot) => rest;

// ---- a collector model: one epoch, an event log, snapshots built from the log ----
function collector(epoch: string, initial: readonly Event[] = []) {
  const log = [...initial];
  const send = (ws: ServerSocket, message: unknown) => ws.send(JSON.stringify(message));
  return {
    log,
    greet(ws: ServerSocket) {
      send(ws, { type: "hello", v: PROTOCOL_VERSION, epoch });
      const recent = log.slice(-RECENT_IDS_CAP).map((e) => e.id);
      send(ws, {
        type: "snapshot",
        epoch,
        seq: log.length,
        snapshot: toSnapshot(reduceAll(log), recent),
      });
    },
    publish(ws: ServerSocket, event: Event) {
      log.push(event);
      send(ws, { type: "event", epoch, seq: log.length, event });
    },
    // Resends an event already in the log under a fresh seq (a replay).
    resend(ws: ServerSocket, event: Event, seq: number) {
      send(ws, { type: "event", epoch, seq, event });
    },
    send,
  };
}

// ---- real ws server ----
const servers: { close(): Promise<void> }[] = [];
const clients: DataClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of servers.splice(0)) await s.close();
});

async function listen(port: number, onConnection: (ws: ServerSocket, n: number) => void) {
  const wss = new WebSocketServer({ host: "127.0.0.1", port });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  let n = 0;
  wss.on("connection", (ws) => onConnection(ws, ++n));
  const server = {
    port: (wss.address() as { port: number }).port,
    connections: () => n,
    dropClients: () => {
      for (const ws of wss.clients) ws.terminate();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => resolve());
      }),
  };
  servers.push(server);
  return server;
}

const quiet = { info() {}, warn() {}, error() {} };
function liveClient(port: number, log = quiet) {
  const transport = liveTransport(port, { random: () => 0.5 });
  const client = createDataClient(transport, { log });
  clients.push(client);
  const snapshots: Snapshot[] = [];
  const received: Event[] = [];
  client.subscribe(
    (s) => snapshots.push(s),
    (e) => received.push(e),
  );
  return { client, snapshots, received };
}

async function waitFor(condition: () => boolean, ms = 2500) {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
const stateOf = (client: DataClient): Snapshot => {
  let snapshot!: Snapshot;
  client.subscribe(
    (s) => (snapshot = s),
    () => {},
  )();
  return snapshot;
};

// A valid synthetic stream: one session, one agent, then `n - 2` tokens events.
function synthetic(n: number, seed = 1): Event[] {
  let s = seed;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const list: Event[] = [
    ev("session_start", { id: "g0", ts: 1 }),
    ev("agent_spawn", { id: "g1", ts: 2 }),
  ];
  for (let i = 2; i < n; i++) {
    list.push(
      ev("tokens", {
        id: `g${i}`,
        ts: i + 1,
        model: rand() < 0.5 ? "m1" : "m2",
        input: Math.floor(rand() * 100),
        output: Math.floor(rand() * 100),
        cacheRead: Math.floor(rand() * 10),
        cacheWrite: Math.floor(rand() * 10),
      }),
    );
  }
  return list;
}

describe("liveTransport with a real ws server", () => {
  it("delivers hello, snapshot, then events", async () => {
    const c = collector("e1", [ev("session_start"), ev("agent_spawn")]);
    const server = await listen(0, (ws) => {
      c.greet(ws);
      c.publish(ws, ev("tokens"));
    });
    const { client, snapshots, received } = liveClient(server.port);
    await waitFor(() => received.length === 1);
    expect(client.status).toBe("open");
    expect(snapshots[0]!.agents).toHaveLength(1);
    expect(received[0]!.id).toBe(E.tokens.id);
    expect(stateOf(client).usage[0]).toMatchObject({ input: 10, output: 20 });
  });

  it("collector restart: reconnecting, then a new epoch replaces the state", async () => {
    const first = collector("e1", [ev("session_start"), ev("agent_spawn"), ev("tokens")]);
    const a = await listen(0, (ws) => first.greet(ws));
    const { client, snapshots } = liveClient(a.port);
    await waitFor(() => client.status === "open");
    await a.close();
    await waitFor(() => client.status === "reconnecting");
    const second = collector("e2", [ev("session_start", { id: "n1", sessionId: "s9" })]);
    await listen(a.port, (ws) => second.greet(ws));
    await waitFor(() => snapshots.length === 2);
    expect(client.status).toBe("open");
    expect(snapshots[1]!.sessions.map((s) => s.id)).toEqual(["s9"]);
    expect(stateOf(client).agents).toHaveLength(0);
    expect(stateOf(client).usage).toHaveLength(0);
    expect(client.stats().counters.reconnects).toBeGreaterThanOrEqual(1);
  });

  it("resending the last 5 events after a reconnect leaves usage unchanged (#91)", async () => {
    const list = synthetic(40);
    const c = collector("e1", list);
    const a = await listen(0, (ws, n) => {
      c.greet(ws);
      if (n === 1) return;
      list.slice(-5).forEach((event, i) => c.resend(ws, event, list.length + 1 + i));
    });
    const { client, snapshots } = liveClient(a.port);
    await waitFor(() => client.status === "open");
    const before = withoutIds(stateOf(client));
    expect(before.usage.length).toBeGreaterThan(0);
    a.dropClients();
    await waitFor(() => snapshots.length === 2 && a.connections() === 2);
    await waitFor(() => client.stats().counters.duplicates === 5);
    expect(client.stats().counters.duplicates).toBe(5);
    expect(withoutIds(stateOf(client))).toEqual(before);
    expect(client.stats().counters.resyncs).toBe(0);
  });

  it("restores open calls, queued tasks and attention from a snapshot (#90)", async () => {
    const base = [
      ev("session_start"),
      ev("agent_spawn"),
      ev("tool_call_start"),
      ev("task_queued"),
      ev("needs_attention"),
    ];
    const c = collector("e1", base);
    const a = await listen(0, (ws) => {
      c.greet(ws);
      c.publish(ws, ev("tool_call_end"));
      c.publish(ws, ev("task_dequeued"));
      c.publish(ws, ev("attention_cleared"));
    });
    const { client, snapshots, received } = liveClient(a.port);
    await waitFor(() => received.length === 3);
    expect(snapshots[0]!.openCalls).toHaveLength(1);
    expect(snapshots[0]!.queuedTasks).toHaveLength(1);
    expect(snapshots[0]!.attention).toHaveLength(1);
    const end = stateOf(client);
    expect(end.openCalls).toHaveLength(0);
    expect(end.queuedTasks).toHaveLength(0);
    expect(end.attention).toHaveLength(0);
    expect(client.stats().counters.inconsistent).toBe(0);
  });

  it("a seq gap triggers a resync and a clean second connection", async () => {
    const c = collector("e1", [ev("session_start"), ev("agent_spawn")]);
    const a = await listen(0, (ws, n) => {
      c.greet(ws);
      if (n === 1) c.resend(ws, ev("tokens"), 9);
    });
    const { client, snapshots } = liveClient(a.port);
    await waitFor(() => snapshots.length === 2);
    expect(client.stats().counters.resyncs).toBe(1);
    expect(client.status).toBe("open");
  });

  it("a rejected snapshot followed by silence recovers", async () => {
    const c = collector("e1", [ev("session_start")]);
    const a = await listen(0, (ws, n) => {
      if (n === 1) {
        c.send(ws, { type: "hello", v: PROTOCOL_VERSION, epoch: "e1" });
        c.send(ws, { type: "snapshot", epoch: "e1", seq: 0, snapshot: { nope: true } });
        return;
      }
      c.greet(ws);
    });
    const { client, snapshots } = liveClient(a.port);
    await waitFor(() => snapshots.length === 1);
    expect(client.stats().counters.rejected).toBe(1);
    expect(client.status).toBe("open");
  });

  it("a rejected final delta recovers", async () => {
    const c = collector("e1", [ev("session_start")]);
    const a = await listen(0, (ws, n) => {
      c.greet(ws);
      if (n === 1) c.send(ws, { type: "event", epoch: "e1", seq: 2, event: { type: "bogus" } });
    });
    const { client, snapshots } = liveClient(a.port);
    await waitFor(() => snapshots.length === 2);
    expect(client.stats().counters.rejected).toBe(1);
    expect(client.status).toBe("open");
  });
});

// ---- fakes for the time-dependent cases ----
class FakeSocket {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  closed = false;
  greeted = false;
  static all: FakeSocket[] = [];
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
  }
  recv(data: unknown) {
    this.onmessage?.({
      data: typeof data === "string" || data instanceof ArrayBuffer ? data : JSON.stringify(data),
    });
  }
  fail() {
    this.onclose?.({});
  }
}

function fakeTimers() {
  let now = 0;
  let next = 0;
  const pending = new Map<number, { fn: () => void; at: number }>();
  const delays: number[] = [];
  return {
    delays,
    pending: () => pending.size,
    setTimeout: (fn: () => void, ms: number) => {
      delays.push(ms);
      pending.set(++next, { fn, at: now + ms });
      return next;
    },
    clearTimeout: (handle: unknown) => {
      pending.delete(handle as number);
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        let pick: [number, { fn: () => void; at: number }] | null = null;
        for (const entry of pending)
          if (entry[1].at <= target && (!pick || entry[1].at < pick[1].at)) pick = entry;
        if (!pick) break;
        pending.delete(pick[0]);
        now = pick[1].at;
        pick[1].fn();
      }
      now = target;
    },
  };
}

function fakeNet(random: () => number = () => 0.5) {
  FakeSocket.all = [];
  const timers = fakeTimers();
  const transport = liveTransport(4321, {
    WebSocket: FakeSocket,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    random,
  });
  return { timers, transport, sockets: FakeSocket.all, latest: () => FakeSocket.all.at(-1)! };
}

const hello = (epoch = "e1", v = PROTOCOL_VERSION) => ({ type: "hello", v, epoch });
const snapMsg = (list: readonly Event[], epoch = "e1", seq = list.length) => ({
  type: "snapshot",
  epoch,
  seq,
  snapshot: toSnapshot(
    reduceAll(list),
    list.map((e) => e.id),
  ),
});

describe("liveTransport timing and guards", () => {
  it("connects to the fixed loopback url and reports statuses", () => {
    const { transport, sockets, latest } = fakeNet();
    const statuses: string[] = [];
    transport.start(
      () => {},
      (s) => statuses.push(s),
    );
    expect(transport.kind).toBe("live");
    expect(sockets[0]!.url).toBe("ws://127.0.0.1:4321");
    latest().open();
    latest().fail();
    expect(statuses).toEqual(["connecting", "connected", "disconnected"]);
  });

  // Value: protects=a throwing WebSocket constructor reports disconnected and retries with backoff; fails_when=the constructor catch is removed (start throws) or no retry is scheduled; why_new=no existing case makes the constructor itself throw; seam=none; no_claim=real browser WebSocket errors (fake constructor)
  it("a throwing WebSocket constructor reports disconnected and retries", () => {
    const timers = fakeTimers();
    let calls = 0;
    class Throwing {
      constructor() {
        calls += 1;
        throw new Error("blocked");
      }
    }
    const transport = liveTransport(4321, {
      WebSocket: Throwing as unknown as new (url: string) => FakeSocket,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      random: () => 0.5,
    });
    const statuses: string[] = [];
    const control = transport.start(
      () => {},
      (s) => statuses.push(s),
    );
    expect(statuses).toEqual(["connecting", "disconnected"]);
    expect(timers.pending()).toBe(1);
    timers.advance(250);
    expect(calls).toBe(2);
    control.stop();
    expect(timers.pending()).toBe(0);
  });

  it("backoff doubles to a 2 s cap, with jitter in [0.8, 1.2]", () => {
    for (const [r, factor] of [
      [0, 0.8],
      [1, 1.2],
      [0.5, 1],
    ] as const) {
      const { transport, timers, latest } = fakeNet(() => r);
      transport.start(
        () => {},
        () => {},
      );
      for (let i = 0; i < 6; i++) {
        latest().fail();
        timers.advance(10_000);
      }
      expect(timers.delays.map((d) => Math.round(d))).toEqual(
        [250, 500, 1000, 2000, 2000, 2000].map((d) => Math.round(d * factor)),
      );
    }
  });

  it("snapshotAccepted resets the attempt counter", () => {
    const { transport, timers, latest } = fakeNet();
    const control = transport.start(
      () => {},
      () => {},
    );
    for (let i = 0; i < 3; i++) {
      latest().fail();
      timers.advance(10_000);
    }
    control.snapshotAccepted();
    latest().fail();
    expect(timers.delays.at(-1)).toBe(250);
  });

  it("random is read once per delay, so jitter stays inside [0.8, 1.2]", () => {
    const values = [0.1, 0.9, 0.33];
    let i = 0;
    const { transport, timers, latest } = fakeNet(() => values[i++ % values.length]!);
    transport.start(
      () => {},
      () => {},
    );
    for (let k = 0; k < 3; k++) {
      latest().fail();
      timers.advance(10_000);
    }
    for (const [k, d] of timers.delays.entries()) {
      const base = [250, 500, 1000][k]!;
      expect(d).toBeGreaterThanOrEqual(base * 0.8);
      expect(d).toBeLessThanOrEqual(base * 1.2);
    }
  });

  it("no hello or snapshot within 5 s closes the socket and reconnects", () => {
    const { transport, timers, sockets, latest } = fakeNet();
    transport.start(
      () => {},
      () => {},
    );
    latest().open();
    timers.advance(4999);
    expect(latest().closed).toBe(false);
    timers.advance(1);
    expect(sockets[0]!.closed).toBe(true);
    expect(sockets).toHaveLength(1);
    timers.advance(250);
    expect(sockets).toHaveLength(2);
  });

  it("the deadline starts at socket open, not at creation", () => {
    const { transport, timers, sockets, latest } = fakeNet();
    transport.start(
      () => {},
      () => {},
    );
    timers.advance(10_000);
    expect(sockets[0]!.closed).toBe(false);
    latest().open();
    timers.advance(4999);
    expect(sockets[0]!.closed).toBe(false);
    timers.advance(1);
    expect(sockets[0]!.closed).toBe(true);
  });

  it("a hello alone leaves the deadline running: it expires and reconnects", () => {
    const { transport, timers, sockets, latest } = fakeNet();
    const client = createDataClient(transport, { log: quiet });
    client.subscribe(
      () => {},
      () => {},
    );
    latest().open();
    latest().recv(hello());
    timers.advance(4999);
    expect(sockets[0]!.closed).toBe(false);
    timers.advance(1);
    expect(sockets[0]!.closed).toBe(true);
    timers.advance(250);
    expect(sockets).toHaveLength(2);
    client.close();
  });

  it.each([Number.NaN, 1.5, 1023, 65536, -1, Number.POSITIVE_INFINITY])(
    "liveTransport(%s) throws RangeError instead of retrying forever",
    (port) => {
      expect(() => liveTransport(port)).toThrow(RangeError);
    },
  );

  it("snapshotAccepted cancels the deadline", () => {
    const { transport, timers, sockets, latest } = fakeNet();
    const control = transport.start(
      () => {},
      () => {},
    );
    latest().open();
    control.snapshotAccepted();
    timers.advance(60_000);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.closed).toBe(false);
  });

  it("hello with v 999 reports incompatible, then retries after 2 s", () => {
    const { transport, timers, sockets, latest } = fakeNet();
    const client = createDataClient(transport, { log: quiet });
    client.subscribe(
      () => {},
      () => {},
    );
    latest().open();
    latest().recv(hello("e1", 999));
    expect(client.status).toBe("incompatible");
    expect(sockets[0]!.closed).toBe(true);
    timers.advance(1999);
    expect(sockets).toHaveLength(1);
    timers.advance(1);
    expect(sockets).toHaveLength(2);
    client.close();
  });

  it("classifies binary, not-json and oversized frames", () => {
    const { transport, latest } = fakeNet();
    const inputs: TransportInput[] = [];
    transport.start(
      (i) => inputs.push(i),
      () => {},
    );
    latest().open();
    latest().recv(new ArrayBuffer(4));
    latest().recv("{not json");
    latest().recv("x".repeat(MAX_FRAME_BYTES + 1));
    latest().recv("é".repeat(MAX_FRAME_BYTES / 2 + 1));
    latest().recv(JSON.stringify({ ok: 1 }));
    expect(inputs).toEqual([
      { kind: "bad_frame", code: "binary" },
      { kind: "bad_frame", code: "not_json" },
      { kind: "bad_frame", code: "too_large" },
      { kind: "bad_frame", code: "too_large" },
      { kind: "frame", data: { ok: 1 } },
    ]);
  });

  it("an oversized frame through the client is rejected and counted", () => {
    const { transport, timers, sockets, latest } = fakeNet();
    const client = createDataClient(transport, { log: quiet });
    client.subscribe(
      () => {},
      () => {},
    );
    latest().open();
    latest().recv(hello());
    latest().recv("x".repeat(MAX_FRAME_BYTES + 1));
    expect(client.stats().counters.rejected).toBe(1);
    expect(sockets[0]!.closed).toBe(true);
    timers.advance(250);
    expect(sockets).toHaveLength(2);
    client.close();
  });

  it("ignores late events from a previous socket", () => {
    const { transport, timers, sockets } = fakeNet();
    const inputs: TransportInput[] = [];
    const statuses: string[] = [];
    transport.start(
      (i) => inputs.push(i),
      (s) => statuses.push(s),
    );
    const old = sockets[0]!;
    old.open();
    old.fail();
    timers.advance(250);
    const current = sockets[1]!;
    const before = [inputs.length, statuses.length, timers.pending()];
    old.recv(JSON.stringify(hello()));
    old.open();
    old.fail();
    old.onerror?.({});
    expect([inputs.length, statuses.length, timers.pending()]).toEqual(before);
    current.open();
    current.recv(JSON.stringify(hello()));
    expect(inputs).toHaveLength(1);
  });

  it("unsubscribe during backoff leaves no socket, timer or status call", () => {
    const { transport, timers, sockets, latest } = fakeNet();
    const client = createDataClient(transport, { log: quiet });
    const un = client.subscribe(
      () => {},
      () => {},
    );
    latest().open();
    latest().fail();
    expect(timers.pending()).toBe(1);
    un();
    expect(timers.pending()).toBe(0);
    timers.advance(60_000);
    expect(sockets).toHaveLength(1);
    expect(client.status).toBe("closed");
  });

  it("stop during an open connection closes it and clears the deadline", () => {
    const { transport, timers, sockets, latest } = fakeNet();
    const control = transport.start(
      () => {},
      () => {},
    );
    latest().open();
    expect(timers.pending()).toBe(1);
    control.stop();
    expect(sockets[0]!.closed).toBe(true);
    expect(timers.pending()).toBe(0);
  });

  it("warnings never contain event text", () => {
    const { transport, latest } = fakeNet();
    const logged: unknown[] = [];
    const log = {
      info: (...a: unknown[]) => logged.push(a),
      warn: (...a: unknown[]) => logged.push(a),
      error: (...a: unknown[]) => logged.push(a),
    };
    const client = createDataClient(transport, { log });
    client.subscribe(
      () => {},
      () => {},
    );
    latest().open();
    latest().recv(hello());
    latest().recv(snapMsg([]));
    latest().recv({
      type: "event",
      epoch: "e1",
      seq: 1,
      event: { type: "message", text: "SECRET-TEXT" },
    });
    latest().recv('{"text":"SECRET-TEXT');
    expect(client.stats().counters.rejected).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(logged)).not.toContain("SECRET-TEXT");
    client.close();
  });
});

describe("chaos (R2)", () => {
  // The same chaos through a real ws server and the real client. Timers run 100x faster (backoff
  // 2.5-20 ms, deadline 50 ms) so 20 reconnects fit well inside the budget.
  it.each([1, 2, 3])(
    "seed %i: real ws server, 1000 events, 20 server-side closes or gaps end in the one-pass state",
    async (seed) => {
      const list = synthetic(1000, seed);
      let s = seed * 7919;
      const rand = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
      const points = new Map<number, "close" | "gap">();
      while (points.size < 20)
        points.set(2 + Math.floor(rand() * 997), rand() < 0.5 ? "close" : "gap");
      const planned = points.size;

      let published = 0; // events [0, published) are in the server's log
      const server = await listen(0, async (ws, n) => {
        const epoch = `c${n}`;
        const send = (message: unknown) => ws.send(JSON.stringify(message));
        const head = list.slice(0, published);
        send({ type: "hello", v: PROTOCOL_VERSION, epoch });
        send({
          type: "snapshot",
          epoch,
          seq: head.length,
          snapshot: toSnapshot(
            reduceAll(head),
            head.slice(-RECENT_IDS_CAP).map((e) => e.id),
          ),
        });
        for (let i = published; i < list.length; i++) {
          if (ws.readyState !== ws.OPEN) return;
          const kind = points.get(i);
          points.delete(i); // each point fires once, so every reconnect makes progress
          if (kind === "close") {
            ws.terminate();
            return;
          }
          if (kind === "gap") {
            send({ type: "event", epoch, seq: i + 2, event: list[i] });
            return;
          }
          send({ type: "event", epoch, seq: i + 1, event: list[i] });
          published = i + 1;
          if (i % 25 === 0) await new Promise((r) => setImmediate(r));
        }
      });

      const transport = liveTransport(server.port, {
        random: () => 0.5,
        setTimeout: (fn, ms) => setTimeout(fn, ms / 100),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      });
      const client = createDataClient(transport, { log: quiet });
      clients.push(client);
      client.subscribe(
        () => {},
        () => {},
      );
      await waitFor(
        () => client.stats().lastEventId === list.at(-1)!.id && client.status === "open",
        4000,
      );
      expect(points.size).toBe(0);
      expect(server.connections()).toBeGreaterThan(planned);
      expect(withoutIds(stateOf(client))).toEqual(withoutIds(toSnapshot(reduceAll(list), [])));
      expect(client.stats().counters.inconsistent).toBe(0);
    },
    8000,
  );

  it.each([1, 2, 3])(
    "seed %i: 1000 events, 20 random closes or gaps end in the one-pass state",
    (seed) => {
      const list = synthetic(1000, seed);
      let s = seed * 7919;
      const rand = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
      const points = new Map<number, "close" | "gap">();
      while (points.size < 20)
        points.set(2 + Math.floor(rand() * 997), rand() < 0.5 ? "close" : "gap");

      const { transport, timers, sockets, latest } = fakeNet();
      const client = createDataClient(transport, { log: quiet });
      client.subscribe(
        () => {},
        () => {},
      );
      let published = 0;
      let epochs = 0;
      const connect = (sock: FakeSocket) => {
        sock.greeted = true;
        sock.open();
        epochs += 1;
        const head = list.slice(0, published);
        sock.recv(hello(`c${epochs}`));
        sock.recv(snapMsg(head, `c${epochs}`));
      };
      for (let i = 0; i < list.length; i++) {
        if (!latest().greeted || latest().closed) {
          if (latest().closed) timers.advance(5000);
          expect(latest().closed).toBe(false);
          connect(latest());
        }
        const sock = latest();
        published = i + 1;
        const kind = points.get(i);
        if (kind === "close") sock.fail();
        else if (kind === "gap")
          sock.recv({ type: "event", epoch: `c${epochs}`, seq: i + 2, event: list[i] });
        else sock.recv({ type: "event", epoch: `c${epochs}`, seq: i + 1, event: list[i] });
      }
      if (latest().closed) {
        timers.advance(5000);
        connect(latest());
      }
      expect(sockets.length).toBeGreaterThan(20);
      expect(withoutIds(stateOf(client))).toEqual(withoutIds(toSnapshot(reduceAll(list), [])));
      expect(client.stats().counters.inconsistent).toBe(0);
      client.close();
    },
  );
});
