import { describe, expect, it, vi } from "vite-plus/test";
import { RECENT_IDS_CAP } from "../shared/protocol";
import type { Event } from "../shared/schema";
import { createMockStream } from "./mock";
import { mockTransport } from "./mock-source";
import { createDataClient, type TransportInput } from "./source";

const OPTIONS = { seed: 1, agents: 3, durationMs: 60_000 };
const stream = [...createMockStream(OPTIONS)].sort((a, b) => a.ts - b.ts);

function harness() {
  let wall = 0;
  let tick: (() => void) | null = null;
  let cleared = false;
  const transport = mockTransport({
    ...OPTIONS,
    now: () => wall,
    setInterval: (fn) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  });
  const inputs: TransportInput[] = [];
  const statuses: string[] = [];
  const control = transport.start(
    (i) => inputs.push(i),
    (s) => statuses.push(s),
  );
  const messages = () => inputs.map((i) => (i.kind === "frame" ? (i.data as any) : null));
  const advance = (ms: number) => {
    wall += ms;
    tick?.();
  };
  return { transport, control, inputs, statuses, messages, advance, wasCleared: () => cleared };
}

describe("mockTransport", () => {
  it("sends status, hello and an empty snapshot on start", () => {
    const h = harness();
    expect(h.transport.kind).toBe("mock");
    expect(h.statuses).toEqual(["connecting", "connected"]);
    const [hello, snapshot] = h.messages();
    expect(hello).toMatchObject({ type: "hello", v: 1, epoch: "mock-1" });
    expect(snapshot).toMatchObject({ type: "snapshot", epoch: "mock-1", seq: 0 });
    expect(snapshot.snapshot.agents).toEqual([]);
  });

  it("plays in ts order from the first event without setClock", () => {
    const h = harness();
    expect(h.transport.clock()).toBe(stream[0]!.ts);
    h.advance(0);
    const first = h.messages().slice(2);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((m) => m.type === "event")).toBe(true);
    expect(first.map((m) => m.seq)).toEqual(first.map((_, i) => i + 1));
    expect(first.every((m) => m.event.ts <= stream[0]!.ts)).toBe(true);
    const before = h.inputs.length;
    h.advance(5_000);
    const sent = h.messages().slice(2);
    expect(sent.length).toBeGreaterThan(before - 2);
    const ts = sent.map((m) => m.event.ts);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(Math.max(...ts)).toBeLessThanOrEqual(stream[0]!.ts + 5_000);
    expect(sent.map((m) => m.event.id)).toEqual(stream.slice(0, sent.length).map((e) => e.id));
  });

  it("forward seek delivers due events; same seek adds nothing", () => {
    const h = harness();
    const target = stream[0]!.ts + 10_000;
    h.transport.setClock(target);
    const due = stream.filter((e) => e.ts <= target).length;
    expect(h.messages().length).toBe(2 + due);
    h.transport.setClock(target);
    expect(h.messages().length).toBe(2 + due);
    expect(h.transport.clock()).toBe(target);
  });

  it("past-end seek sends everything once, then nothing more", () => {
    const h = harness();
    h.transport.setClock(stream.at(-1)!.ts + 1_000_000);
    expect(h.messages().length).toBe(2 + stream.length);
    h.advance(60_000);
    h.transport.setClock(stream.at(-1)!.ts + 2_000_000);
    expect(h.messages().length).toBe(2 + stream.length);
  });

  it("backward seek starts a new epoch with a snapshot and keeps playing", () => {
    const h = harness();
    h.transport.setClock(stream.at(-1)!.ts);
    const target = stream[0]!.ts + 20_000;
    const count = stream.filter((e) => e.ts <= target).length;
    const before = h.inputs.length;
    h.transport.setClock(target);
    const [hello, snapshot, ...rest] = h.messages().slice(before);
    expect(rest).toEqual([]);
    expect(hello).toMatchObject({ type: "hello", epoch: "mock-2" });
    expect(snapshot).toMatchObject({ type: "snapshot", epoch: "mock-2", seq: count });
    expect(snapshot.snapshot.recentIds).toEqual(
      stream.slice(Math.max(0, count - RECENT_IDS_CAP), count).map((e) => e.id),
    );
    h.advance(30_000);
    const events = h.messages().slice(before + 2);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ epoch: "mock-2", seq: count + 1 });
  });

  it("resync rebuilds at the current clock in a new epoch", () => {
    const h = harness();
    h.transport.setClock(stream[0]!.ts + 10_000);
    const count = stream.filter((e) => e.ts <= stream[0]!.ts + 10_000).length;
    const before = h.inputs.length;
    h.control.resync("gap");
    const [hello, snapshot] = h.messages().slice(before);
    expect(hello.epoch).toBe("mock-2");
    expect(snapshot).toMatchObject({ epoch: "mock-2", seq: count });
    h.control.snapshotAccepted();
  });

  it("through the client: a backward seek and a resync cause no order fault", () => {
    let wall = 0;
    const transport = mockTransport({
      ...OPTIONS,
      now: () => wall,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const warn = vi.fn();
    const client = createDataClient(transport, { log: { info() {}, warn, error() {} } });
    client.subscribe(
      () => {},
      () => {},
    );
    transport.setClock(stream.at(-1)!.ts);
    transport.setClock(stream[0]!.ts + 20_000);
    expect(client.stats().counters.resyncs).toBe(0);
    expect(client.status).toBe("open");
    expect(warn).not.toHaveBeenCalled();
    expect(client.stats().counters.reconnects).toBe(1);
    client.close();
  });

  // Value: protects=a subscriber that closes the client mid-batch stops delivery cleanly; fails_when=deliverDue keeps calling the cleared sink after stop(); why_new=no test closes during a multi-event tick; seam=none; no_claim=wall-clock playback speed
  it("closing the client during a batch of due events stops delivery without throwing", () => {
    const transport = mockTransport({
      ...OPTIONS,
      now: () => 0,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const errors: unknown[] = [];
    const client = createDataClient(transport, {
      log: { info() {}, warn() {}, error() {} },
      reportError: (e) => errors.push(e),
    });
    let seen = 0;
    client.subscribe(
      () => {},
      () => {
        seen += 1;
        client.close();
      },
    );
    expect(() => transport.setClock(stream.at(-1)!.ts)).not.toThrow();
    expect(seen).toBe(1);
    expect(errors).toEqual([]);
    expect(client.status).toBe("closed");
  });

  it("a rebuild requested during a rebuild is ignored", () => {
    let wall = 0;
    const transport = mockTransport({
      ...OPTIONS,
      now: () => wall,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const statuses: string[] = [];
    let control: ReturnType<typeof transport.start> | null = null;
    control = transport.start(
      () => {},
      (s) => {
        statuses.push(s);
        if (s === "connected" && statuses.length > 2) control?.resync("gap");
      },
    );
    transport.setClock(stream[0]!.ts + 5_000);
    transport.setClock(stream[0]!.ts + 1_000);
    expect(statuses).toEqual(["connecting", "connected", "disconnected", "connected"]);
  });

  it("stop clears the interval and stops sending", () => {
    const h = harness();
    h.control.stop();
    expect(h.wasCleared()).toBe(true);
    const before = h.inputs.length;
    h.transport.setClock(stream.at(-1)!.ts);
    expect(h.inputs.length).toBe(before);
  });

  it.each([Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY])(
    "setClock(%s) throws RangeError",
    (v) => {
      const h = harness();
      expect(() => h.transport.setClock(v)).toThrow(RangeError);
    },
  );

  it("through the client: after a seek back, replaying an id inside the snapshot changes nothing (R4)", () => {
    let wall = 0;
    const transport = mockTransport({
      ...OPTIONS,
      now: () => wall,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const client = createDataClient(transport, { log: { info() {}, warn() {}, error() {} } });
    client.subscribe(
      () => {},
      () => {},
    );
    transport.setClock(stream.at(-1)!.ts);
    const target = stream[0]!.ts + 30_000;
    transport.setClock(target);
    const tokens = stream.filter((e) => e.type === "tokens" && e.ts <= target).at(-1) as Event;
    expect(tokens).toBeDefined();
    const usageOf = () => {
      let usage: unknown;
      client.subscribe(
        (snapshot) => {
          usage = snapshot.usage;
        },
        () => {},
      )();
      return usage;
    };
    const before = client.stats();
    const usageBefore = usageOf();
    expect(usageBefore).toBeDefined();
    client.emit(tokens);
    client.emit(tokens);
    const after = client.stats();
    expect(usageOf()).toEqual(usageBefore);
    expect(after.counters.duplicates).toBe(before.counters.duplicates + 2);
    expect(after.lastEventId).toBe(before.lastEventId);
    expect(after.counts).toEqual(before.counts);
    client.close();
    void wall;
  });
});
