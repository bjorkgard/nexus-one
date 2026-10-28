import { applyOnce, createRecentIds } from "../shared/apply-once";
import {
  DEFAULT_LIVE_PORT,
  MAX_LIVE_PORT,
  MIN_LIVE_PORT,
  PROTOCOL_VERSION,
  parseServerMessage,
  type ServerMessage,
  type Snapshot,
} from "../shared/protocol";
import { emptyState, fromSnapshot, toSnapshot, type NexusState } from "../shared/reduce";
import { parseEvent, type Event } from "../shared/schema";

export type SourceStatus =
  | "idle"
  | "connecting"
  | "syncing"
  | "open"
  | "reconnecting"
  | "incompatible"
  | "closed";

export interface DataSource {
  subscribe(onSnapshot: (s: Snapshot) => void, onEvent: (e: Event) => void): () => void;
  readonly status: SourceStatus;
}

export type ResyncReason = "gap" | "order" | "rejected" | "incompatible";
export type TransportInput =
  | { kind: "frame"; data: unknown }
  | { kind: "bad_frame"; code: "too_large" | "not_json" | "binary" };
export type TransportControl = {
  stop(): void;
  // Drop the connection and reconnect (the transport waits the max backoff for "incompatible").
  resync(reason: ResyncReason): void;
  // The client accepted a snapshot: the transport resets its backoff.
  snapshotAccepted(): void;
};
export type Transport = {
  readonly kind: "mock" | "live";
  start(
    sink: (input: TransportInput) => void,
    onStatus: (s: "connecting" | "connected" | "disconnected") => void,
  ): TransportControl;
};

export type DataStats = {
  status: SourceStatus;
  lastEventId: string | null;
  counts: { projects: number; sessions: number; agents: number };
  counters: {
    rejected: number;
    duplicates: number;
    inconsistent: number;
    resyncs: number;
    reconnects: number;
  };
};

type Log = {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
};
export type DataClientOptions = { log?: Log; reportError?: (e: unknown) => void };
export type DataClient = DataSource & {
  emit(input: unknown): void;
  stats(): DataStats;
  close(): void;
};

// The gate: one owner of the epoch, the seq cursor and the apply-once ring.
//
//   hello{v,epoch} -> snapshot{epoch,seq} -> event{epoch,seq+1} -> event{epoch,seq+2} ...
//        |                  |                      |
//     epoch = e         state = snapshot       seq <= cursor        : duplicate, drop
//                       cursor = seq           seq >  cursor + 1    : gap, resync
//                       ring.seed(recentIds)   seq == cursor + 1    : cursor = seq, then
//                                                applyOnce (ring drops a replayed id; the
//                                                cursor still advances)
//
//   first message not hello, epoch != hello epoch, event before snapshot : resync("order")
//   not JSON / binary / too large / not a server message                 : resync("rejected")
//   hello with v != PROTOCOL_VERSION                                     : resync("incompatible")
//   after any resync every frame is ignored until the next hello.
export function createDataClient(
  transport: Transport,
  options: DataClientOptions = {},
): DataClient {
  const rawLog: Log = options.log ?? console;
  const rawReport =
    options.reportError ??
    ((e: unknown) => {
      if (typeof globalThis.reportError === "function") globalThis.reportError(e);
      else console.error(e);
    });
  // Injected callbacks never throw into the client's own actions.
  const reportError = (e: unknown) => {
    try {
      rawReport(e);
    } catch {
      try {
        console.error(e);
      } catch {
        // nothing left to try
      }
    }
  };
  const guardLog =
    (level: keyof Log) =>
    (...a: unknown[]) => {
      try {
        rawLog[level](...a);
      } catch (error) {
        reportError(error);
      }
    };
  const log: Log = { info: guardLog("info"), warn: guardLog("warn"), error: guardLog("error") };

  type Entry = {
    onSnapshot: (s: Snapshot) => void;
    onEvent: (e: Event) => void;
    active: boolean;
  };
  const entries: Entry[] = [];
  const ring = createRecentIds();
  const counters = { rejected: 0, duplicates: 0, inconsistent: 0, resyncs: 0, reconnects: 0 };
  const warned = new Set<string>();

  let status: SourceStatus = "idle";
  let state: NexusState = emptyState();
  let hasSnapshot = false;
  let lastEventId: string | null = null;
  let control: TransportControl | null = null;
  let closed = false;
  // Per-connection gate state.
  let epoch: string | null = null;
  let snapshotSeen = false;
  let cursor = 0;
  let ignoring = false;

  const setStatus = (next: SourceStatus) => {
    if (status === next) return;
    status = next;
    log.info(`[nexus] data source ${transport.kind}: ${next}`);
  };

  const warnOnce = (kind: string, detail: string) => {
    if (warned.has(kind)) return;
    warned.add(kind);
    log.warn(`[nexus] ${kind}${detail}`);
  };

  const fanOut = (call: (entry: Entry) => void) => {
    for (const entry of entries.slice()) {
      if (!entry.active) continue;
      try {
        call(entry);
      } catch (error) {
        reportError(error);
      }
    }
  };

  // Inputs (frames and status changes) arriving during a fan-out, or inside transport.start, wait
  // in one FIFO so every subscriber sees the same order and `control` exists before they run.
  const queue: (() => void)[] = [];
  let running = false;
  let starting = false;
  const drain = () => {
    if (running || starting) return;
    running = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          next();
        } catch (error) {
          reportError(error);
        }
      }
    } finally {
      running = false;
    }
  };
  const enqueue = (task: () => void) => {
    queue.push(task);
    drain();
  };

  const resync = (reason: ResyncReason) => {
    counters.resyncs += 1;
    ignoring = true;
    epoch = null;
    snapshotSeen = false;
    try {
      control?.resync(reason);
    } catch (error) {
      reportError(error);
    }
  };

  const applyEvent = (event: Event) => {
    const result = applyOnce(state, ring, event);
    if (!result.applied) {
      counters.duplicates += 1;
      return;
    }
    state = result.state;
    lastEventId = event.id;
    if (result.inconsistent) counters.inconsistent += 1;
    fanOut((entry) => entry.onEvent(event));
  };

  const handleMessage = (message: ServerMessage) => {
    if (message.type === "hello") {
      if (epoch !== null) {
        warnOnce("order", " kind=order extra hello");
        resync("order");
        return;
      }
      if (message.v !== PROTOCOL_VERSION) {
        setStatus("incompatible");
        log.error(`[nexus] unsupported protocol version ${message.v}`);
        resync("incompatible");
        return;
      }
      epoch = message.epoch;
      return;
    }
    if (epoch === null || message.epoch !== epoch) {
      warnOnce("order", ` kind=order type=${message.type} seq=${message.seq}`);
      resync("order");
      return;
    }
    if (message.type === "snapshot") {
      state = fromSnapshot(message.snapshot);
      hasSnapshot = true;
      snapshotSeen = true;
      cursor = message.seq;
      ring.seed(message.snapshot.recentIds);
      lastEventId = message.snapshot.recentIds.at(-1) ?? null;
      setStatus("open");
      try {
        control?.snapshotAccepted();
      } catch (error) {
        reportError(error);
      }
      fanOut((entry) => entry.onSnapshot(message.snapshot));
      return;
    }
    if (!snapshotSeen) {
      warnOnce("order", ` kind=order type=event seq=${message.seq}`);
      resync("order");
      return;
    }
    if (message.seq <= cursor) {
      counters.duplicates += 1;
      return;
    }
    if (message.seq > cursor + 1) {
      warnOnce("gap", ` kind=gap seq=${message.seq} cursor=${cursor}`);
      resync("gap");
      return;
    }
    cursor = message.seq;
    applyEvent(message.event);
  };

  const reject = (kind: string, detail: string) => {
    counters.rejected += 1;
    warnOnce(kind, detail);
    resync("rejected");
  };

  const handleInput = (input: TransportInput) => {
    if (closed) return;
    if (input.kind === "bad_frame") {
      if (ignoring) return;
      reject(input.code, ` kind=${input.code}`);
      return;
    }
    const parsed = parseServerMessage(input.data);
    if (ignoring) {
      if (!parsed.ok || parsed.message.type !== "hello") return;
      ignoring = false;
    }
    if (!parsed.ok) {
      const issues = parsed.issues.map((i) => `${i.path || "(root)"}:${i.code}`).join(",");
      reject("invalid_message", ` kind=invalid_message issues=${issues}`);
      return;
    }
    handleMessage(parsed.message);
  };

  const handleStatus = (next: "connecting" | "connected" | "disconnected") => {
    if (closed) return;
    if (next === "connecting") {
      setStatus("connecting");
    } else if (next === "connected") {
      warned.clear();
      epoch = null;
      snapshotSeen = false;
      setStatus("syncing");
    } else {
      counters.reconnects += 1;
      setStatus("reconnecting");
    }
  };

  const stopTransport = () => {
    const current = control;
    control = null;
    try {
      current?.stop();
    } catch (error) {
      reportError(error);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    for (const entry of entries) entry.active = false;
    entries.length = 0;
    stopTransport();
    status = "closed";
    log.info(`[nexus] data source ${transport.kind}: closed`);
  };

  return {
    get status() {
      return status;
    },
    subscribe(onSnapshot, onEvent) {
      if (closed) throw new Error("data source is closed");
      if (control === null) {
        // A throwing start leaves status idle and no subscriber behind.
        starting = true;
        try {
          const started = transport.start(
            (input) => enqueue(() => handleInput(input)),
            (status) => enqueue(() => handleStatus(status)),
          );
          if (closed) {
            // close() ran inside start: nothing owned the handle yet.
            try {
              started.stop();
            } catch (error) {
              reportError(error);
            }
          } else {
            control = started;
          }
        } catch (error) {
          queue.length = 0;
          throw error;
        } finally {
          starting = false;
        }
        drain();
        if (closed) throw new Error("data source is closed");
      }
      const entry: Entry = { onSnapshot, onEvent, active: true };
      entries.push(entry);
      if (hasSnapshot) {
        try {
          onSnapshot(toSnapshot(state, ring.toArray()));
        } catch (error) {
          reportError(error);
        }
      }
      return () => {
        if (!entry.active) return;
        entry.active = false;
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
        if (entries.length === 0) close();
      };
    },
    emit(input) {
      if (closed) throw new Error("data source is closed");
      const parsed = parseEvent(input);
      if (!parsed.ok) {
        const issues = parsed.issues.map((i) => `${i.path || "(root)"}:${i.code}`).join(", ");
        throw new Error(`invalid event: ${issues}`);
      }
      enqueue(() => {
        if (!closed) applyEvent(parsed.event);
      });
    },
    stats() {
      return {
        status,
        lastEventId,
        counts: {
          projects: state.projects.size,
          sessions: state.sessions.size,
          agents: state.agents.size,
        },
        counters: { ...counters },
      };
    },
    close,
  };
}

export type SourceSelection = { kind: "mock" | "live"; port: number; warnings: string[] };

// `?source=mock|live` (exact, lower case; the first value wins) and `?port=` (integer 1024-65535).
export function selectSource(search: string): SourceSelection {
  const params = new URLSearchParams(search);
  const warnings: string[] = [];
  const source = params.get("source");
  let kind: "mock" | "live" = "mock";
  if (source === "live") {
    kind = "live";
  } else if (source !== null && source !== "mock") {
    warnings.push(`unknown source "${source}", using mock`);
  }
  let port = DEFAULT_LIVE_PORT;
  const rawPort = params.get("port");
  if (rawPort !== null) {
    const n = /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
    if (Number.isInteger(n) && n >= MIN_LIVE_PORT && n <= MAX_LIVE_PORT) {
      port = n;
    } else {
      warnings.push(`bad port "${rawPort}", using ${DEFAULT_LIVE_PORT}`);
    }
  }
  return { kind, port, warnings };
}
