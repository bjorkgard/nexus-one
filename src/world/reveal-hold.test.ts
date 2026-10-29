import { describe, expect, it, vi } from "vite-plus/test";
import { createRevealHold } from "./reveal-hold";

// Manual timer: `fire()` runs the pending callback as the timeout would.
function fakeTimer() {
  let callback: (() => void) | null = null;
  return {
    setTimer: (fn: () => void, ms: number) => {
      callback = fn;
      return ms as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      callback = null;
    },
    fire: () => callback?.(),
    armed: () => callback !== null,
  };
}

describe("createRevealHold", () => {
  it("holds = 0 is released immediately and arms no timer", () => {
    const timer = fakeTimer();
    const hold = createRevealHold({ holds: 0, ...timer });
    expect(hold.status).toBe("released");
    expect(timer.armed()).toBe(false);
  });

  it("is pending until released, and release before the timeout wins", () => {
    const timer = fakeTimer();
    const warn = vi.fn();
    const hold = createRevealHold({ holds: 1, ...timer, warn });
    hold.start();
    expect(hold.status).toBe("pending");
    hold.release();
    expect(hold.status).toBe("released");
    timer.fire();
    expect(hold.status).toBe("released");
    expect(warn).not.toHaveBeenCalled();
  });

  it("a second release is a no-op and notifies once", () => {
    const hold = createRevealHold({ holds: 1, ...fakeTimer() });
    const listener = vi.fn();
    hold.subscribe(listener);
    hold.release();
    hold.release();
    expect(hold.status).toBe("released");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribed listener is not notified", () => {
    // Value: protects=subscribe returns a working unsubscribe (useSyncExternalStore contract); fails_when=unsubscribe no longer removes the listener; why_new=no test calls the returned function; seam=none; no_claim=React re-render timing
    const hold = createRevealHold({ holds: 1, ...fakeTimer() });
    const gone = vi.fn();
    const kept = vi.fn();
    const unsubscribe = hold.subscribe(gone);
    hold.subscribe(kept);
    unsubscribe();
    hold.release();
    expect(gone).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("times out once, warns once, and notifies once", () => {
    const timer = fakeTimer();
    const warn = vi.fn();
    const hold = createRevealHold({ holds: 1, timeoutMs: 3000, ...timer, warn });
    hold.start();
    const listener = vi.fn();
    hold.subscribe(listener);
    timer.fire();
    timer.fire();
    expect(hold.status).toBe("timedOut");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("release after the timeout stays timedOut", () => {
    const timer = fakeTimer();
    const hold = createRevealHold({ holds: 1, ...timer, warn: vi.fn() });
    hold.start();
    timer.fire();
    hold.release();
    expect(hold.status).toBe("timedOut");
  });

  it("defaults the timeout to 3000 ms", () => {
    const seen: number[] = [];
    createRevealHold({
      holds: 1,
      setTimer: (_fn, ms) => {
        seen.push(ms);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {},
    }).start();
    expect(seen).toEqual([3000]);
  });

  it("dispose clears the timer and stops a later timeout", () => {
    const timer = fakeTimer();
    const warn = vi.fn();
    const hold = createRevealHold({ holds: 1, ...timer, warn });
    hold.start();
    hold.dispose();
    timer.fire();
    expect(timer.armed()).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("creating a hold without start() arms nothing", () => {
    const setTimer = vi.fn(() => 0 as unknown as ReturnType<typeof setTimeout>);
    createRevealHold({ holds: 1, setTimer, clearTimer: () => {} });
    expect(setTimer).not.toHaveBeenCalled();
  });

  it("start, dispose, start again (StrictMode) arms one live timer and warns once", () => {
    const callbacks: Array<(() => void) | null> = [];
    const warn = vi.fn();
    const hold = createRevealHold({
      holds: 1,
      setTimer: (fn) => {
        callbacks.push(fn);
        return (callbacks.length - 1) as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (id) => {
        callbacks[id as unknown as number] = null;
      },
      warn,
    });
    hold.start();
    hold.dispose();
    expect(hold.status).toBe("pending");
    hold.start();
    hold.start();
    expect(callbacks.filter((cb) => cb !== null)).toHaveLength(1);
    for (const cb of callbacks) cb?.();
    expect(hold.status).toBe("timedOut");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
