import { createContext, useContext } from "react";

export type RevealHoldStatus = "pending" | "released" | "timedOut";

export type RevealHold = {
  readonly status: RevealHoldStatus;
  release: () => void;
  start: () => void;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

type Timer = ReturnType<typeof setTimeout>;

// Holds the stage reveal until `release()` (pending -> released) or the timeout (pending -> timedOut).
// Both exits are terminal: a release after the timeout does not undo it.
// The timer is armed by `start()` (from an effect), not at creation, so a discarded render arms nothing.
export function createRevealHold({
  holds,
  timeoutMs = 3000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  warn = console.warn,
}: {
  holds: number;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  warn?: (message: string) => void;
}): RevealHold {
  let status: RevealHoldStatus = holds > 0 ? "pending" : "released";
  let timer: Timer | null = null;
  const listeners = new Set<() => void>();

  const settle = (next: RevealHoldStatus) => {
    if (status !== "pending") return;
    status = next;
    if (timer !== null) clearTimer(timer);
    timer = null;
    for (const listener of listeners) listener();
  };

  const start = () => {
    if (status !== "pending" || timer !== null) return;
    timer = setTimer(() => {
      if (status !== "pending") return;
      warn(
        `Stage reveal hold timed out after ${timeoutMs} ms; revealing without the palette board`,
      );
      settle("timedOut");
    }, timeoutMs);
  };

  return {
    get status() {
      return status;
    },
    release: () => settle("released"),
    start,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

export const RevealHoldContext = createContext<RevealHold | null>(null);

export function useRevealHold(): RevealHold {
  const hold = useContext(RevealHoldContext);
  if (!hold) throw new Error("useRevealHold must be used inside <Stage>");
  return hold;
}
