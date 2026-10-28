import { PROTOCOL_VERSION, RECENT_IDS_CAP } from "../shared/protocol";
import { emptyState, reduce, toSnapshot } from "../shared/reduce";
import type { Event } from "../shared/schema";
import { createMockStream, type MockOptions } from "./mock";
import type { Transport, TransportInput } from "./source";

export type MockTransportOptions = MockOptions & {
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  tickMs?: number;
};
export type MockTransport = Transport & { setClock(ts: number): void; clock(): number };

// Plays the deterministic mock stream through the Transport contract. A clock (stream ts) starts
// at the first event and follows `now()`; setClock moves it. A backward seek rebuilds state in a
// new epoch and sends it as hello + snapshot.
export function mockTransport(options: MockTransportOptions = {}): MockTransport {
  const {
    now: nowOption,
    setInterval: setIntervalOption,
    clearInterval: clearIntervalOption,
    tickMs: tickOption,
    ...streamOptions
  } = options;
  const now = nowOption ?? (() => Date.now());
  const setTick = setIntervalOption ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTick =
    clearIntervalOption ?? ((handle) => globalThis.clearInterval(handle as number | undefined));
  const tickMs = tickOption ?? 100;

  let events: Event[] | null = null;
  const load = (): Event[] => {
    events ??= [...createMockStream(streamOptions)].sort((a, b) => a.ts - b.ts);
    return events;
  };

  let clockBase: number | null = null;
  let wallBase = 0;
  const clock = (): number => {
    if (clockBase === null) {
      clockBase = load()[0]?.ts ?? 0;
      wallBase = now();
    }
    return clockBase + Math.max(0, now() - wallBase);
  };
  const moveClock = (ts: number) => {
    clockBase = ts;
    wallBase = now();
  };

  let sink: ((input: TransportInput) => void) | null = null;
  let status: ((s: "connecting" | "connected" | "disconnected") => void) | null = null;
  let rebuilding = false;
  let timer: unknown = null;
  let epochCount = 0;
  let epoch = "";
  let next = 0; // index of the first event not yet sent

  const deliverDue = () => {
    if (!sink) return;
    const list = load();
    const at = clock();
    while (next < list.length && list[next]!.ts <= at) {
      const event = list[next]!;
      next += 1;
      sink({ kind: "frame", data: { type: "event", epoch, seq: next, event } });
    }
  };

  // Follows the live reconnect path: disconnected, connected, then hello + snapshot in a new epoch.
  // A rebuild requested while one is running is ignored.
  const rebuild = (target: number) => {
    if (!sink || !status || rebuilding) return;
    rebuilding = true;
    try {
      rebuildNow(target, sink, status);
    } finally {
      rebuilding = false;
    }
  };
  const rebuildNow = (
    target: number,
    send: (input: TransportInput) => void,
    onStatus: (s: "connecting" | "connected" | "disconnected") => void,
  ) => {
    const list = load();
    let count = 0;
    let state = emptyState();
    while (count < list.length && list[count]!.ts <= target) {
      state = reduce(state, list[count]!).state;
      count += 1;
    }
    epochCount += 1;
    epoch = `mock-${epochCount}`;
    next = count;
    const recentIds = list.slice(Math.max(0, count - RECENT_IDS_CAP), count).map((e) => e.id);
    onStatus("disconnected");
    onStatus("connected");
    send({ kind: "frame", data: { type: "hello", v: PROTOCOL_VERSION, epoch } });
    send({
      kind: "frame",
      data: { type: "snapshot", epoch, seq: count, snapshot: toSnapshot(state, recentIds) },
    });
  };

  return {
    kind: "mock",
    start(newSink, onStatus) {
      sink = newSink;
      status = onStatus;
      onStatus("connecting");
      onStatus("connected");
      epochCount += 1;
      epoch = `mock-${epochCount}`;
      next = 0;
      newSink({ kind: "frame", data: { type: "hello", v: PROTOCOL_VERSION, epoch } });
      newSink({
        kind: "frame",
        data: { type: "snapshot", epoch, seq: 0, snapshot: toSnapshot(emptyState(), []) },
      });
      clock();
      timer = setTick(deliverDue, tickMs);
      return {
        stop() {
          if (timer !== null) clearTick(timer);
          timer = null;
          sink = null;
          status = null;
        },
        resync() {
          rebuild(clock());
        },
        snapshotAccepted() {},
      };
    },
    clock,
    setClock(ts) {
      if (!Number.isInteger(ts) || ts < 0) {
        throw new RangeError(`setClock: expected a non-negative integer, got ${ts}`);
      }
      if (ts >= clock()) {
        moveClock(ts);
        deliverDue();
      } else {
        moveClock(ts);
        rebuild(ts);
      }
    },
  };
}
