import { MAX_FRAME_BYTES } from "../shared/protocol";
import type { ResyncReason, Transport, TransportControl, TransportInput } from "./source";

// The LiveSource state machine (the client's gate in source.ts owns epoch, cursor and dedup):
//
//   idle --subscribe--> connecting --open--> syncing --hello ok + snapshot ok--> open
//                          ^                    |  \                               |
//                          |      5 s deadline, |   hello.v unsupported            | close / gap / order fault /
//                          |      bad snapshot, |   -> incompatible --(2 s)--+     | rejected event
//                          |      order fault   v                            |     v
//                          +------timer------ reconnecting <-----------------+-----+
//   any state --unsubscribe--> closed (terminal; timers cleared; no transition out)
//
// Backoff: 250, 500, 1000, 2000, 2000, ... ms, each times a jitter factor in [0.8, 1.2]; the
// attempt counter resets when the client accepts a snapshot.
const BACKOFF_MS = [250, 500, 1000, 2000];
const INCOMPATIBLE_WAIT_MS = 2000;
const SNAPSHOT_DEADLINE_MS = 5000;

type SocketLike = {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  close(): void;
};

export type LiveDeps = {
  WebSocket?: new (url: string) => SocketLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  random?: () => number;
};

const encoder = new TextEncoder();

function toInput(data: unknown): TransportInput {
  if (typeof data !== "string") return { kind: "bad_frame", code: "binary" };
  // A string is at least `length` and at most 3 * `length` UTF-8 bytes.
  if (data.length > MAX_FRAME_BYTES) return { kind: "bad_frame", code: "too_large" };
  if (data.length * 3 > MAX_FRAME_BYTES && encoder.encode(data).length > MAX_FRAME_BYTES) {
    return { kind: "bad_frame", code: "too_large" };
  }
  try {
    return { kind: "frame", data: JSON.parse(data) };
  } catch {
    return { kind: "bad_frame", code: "not_json" };
  }
}

export function liveTransport(port: number, deps: LiveDeps = {}): Transport {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new RangeError(`liveTransport: expected an integer port in 1024-65535, got ${port}`);
  }
  const url = `ws://127.0.0.1:${port}`;
  const setTimer = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as number | undefined));
  const random = deps.random ?? Math.random;

  return {
    kind: "live",
    start(sink, onStatus) {
      let stopped = false;
      let socket: SocketLike | null = null;
      let reconnectTimer: unknown = null;
      let deadlineTimer: unknown = null;
      let attempt = 0;

      const clearReconnect = () => {
        if (reconnectTimer !== null) clearTimer(reconnectTimer);
        reconnectTimer = null;
      };
      const clearDeadline = () => {
        if (deadlineTimer !== null) clearTimer(deadlineTimer);
        deadlineTimer = null;
      };
      const jitter = (ms: number) => ms * (0.8 + 0.4 * random());

      // Detach the current socket: later events from it hit the stale-socket guard.
      const drop = () => {
        const old = socket;
        socket = null;
        clearDeadline();
        if (old) {
          try {
            old.close();
          } catch {
            // already closed
          }
        }
      };

      const schedule = (ms: number) => {
        clearReconnect();
        reconnectTimer = setTimer(() => {
          reconnectTimer = null;
          connect();
        }, ms);
      };
      const nextBackoff = () => jitter(BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]!);

      const lost = () => {
        drop();
        onStatus("disconnected");
        schedule(nextBackoff());
      };

      const connect = () => {
        if (stopped) return;
        onStatus("connecting");
        if (stopped) return;
        let created: SocketLike;
        try {
          const Ctor =
            deps.WebSocket ?? (globalThis.WebSocket as unknown as new (u: string) => SocketLike);
          created = new Ctor(url);
        } catch {
          onStatus("disconnected");
          schedule(nextBackoff());
          return;
        }
        socket = created;
        const current = () => !stopped && socket === created;
        created.onopen = () => {
          if (!current()) return;
          onStatus("connected");
          if (!current()) return;
          clearDeadline();
          deadlineTimer = setTimer(() => {
            deadlineTimer = null;
            if (current()) lost();
          }, SNAPSHOT_DEADLINE_MS);
        };
        created.onmessage = (event) => {
          if (!current()) return;
          sink(toInput(event.data));
        };
        created.onerror = () => {
          if (current()) lost();
        };
        created.onclose = () => {
          if (current()) lost();
        };
      };

      connect();

      const control: TransportControl = {
        stop() {
          if (stopped) return;
          stopped = true;
          drop();
          clearReconnect();
        },
        resync(reason: ResyncReason) {
          if (stopped) return;
          drop();
          clearReconnect();
          if (reason === "incompatible") {
            schedule(jitter(INCOMPATIBLE_WAIT_MS));
          } else {
            onStatus("disconnected");
            if (stopped) return;
            schedule(nextBackoff());
          }
        },
        snapshotAccepted() {
          if (stopped) return;
          clearDeadline();
          attempt = 0;
        },
      };
      return control;
    },
  };
}
