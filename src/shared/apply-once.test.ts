import { describe, expect, it } from "vite-plus/test";
import { applyOnce, createRecentIds } from "./apply-once";
import { RECENT_IDS_CAP } from "./protocol";
import { emptyState, reduce } from "./reduce";
import events from "./fixtures/events.json";
import type { Event } from "./schema";

describe("createRecentIds", () => {
  it("evicts the oldest id at capacity + 1 (4,097)", () => {
    const ring = createRecentIds();
    for (let i = 1; i <= RECENT_IDS_CAP + 1; i++) ring.add(`id-${i}`);
    expect(ring.has("id-1")).toBe(false);
    expect(ring.has("id-2")).toBe(true);
    expect(ring.has(`id-${RECENT_IDS_CAP + 1}`)).toBe(true);
    expect(ring.toArray()).toHaveLength(RECENT_IDS_CAP);
  });

  it("keeps FIFO order, oldest first, after wrap-around", () => {
    const ring = createRecentIds(3);
    for (const id of ["a", "b", "c", "d", "e"]) ring.add(id);
    expect(ring.toArray()).toEqual(["c", "d", "e"]);
  });

  it("ignores a repeated id", () => {
    const ring = createRecentIds(2);
    ring.add("a");
    ring.add("a");
    ring.add("b");
    expect(ring.toArray()).toEqual(["a", "b"]);
  });

  it("seed replaces all contents and keeps the newest capacity ids", () => {
    const ring = createRecentIds(3);
    ring.add("old");
    ring.seed(["a", "b", "c", "d"]);
    expect(ring.has("old")).toBe(false);
    expect(ring.has("a")).toBe(false);
    expect(ring.toArray()).toEqual(["b", "c", "d"]);
    ring.add("e");
    expect(ring.toArray()).toEqual(["c", "d", "e"]);
  });

  it("handles __proto__ as an id", () => {
    const ring = createRecentIds();
    ring.add("__proto__");
    expect(ring.has("__proto__")).toBe(true);
  });
});

describe("applyOnce", () => {
  const start = events.session_start as Event;

  it("applies a new id and drops the same id again", () => {
    const ring = createRecentIds();
    const first = applyOnce(emptyState(), ring, start);
    expect(first.applied).toBe(true);
    expect(first.state.sessions.size).toBe(1);
    const second = applyOnce(first.state, ring, start);
    expect(second.applied).toBe(false);
    expect(second.state).toBe(first.state);
  });

  it("drops a duplicate id that arrives under a different seq (counts once)", () => {
    const ring = createRecentIds();
    let state = emptyState();
    let applied = 0;
    for (let i = 0; i < 3; i++) {
      const r = applyOnce(state, ring, start);
      state = r.state;
      if (r.applied) applied += 1;
    }
    expect(applied).toBe(1);
  });

  it("reports an inconsistent event as applied and inconsistent", () => {
    const ring = createRecentIds();
    const end = events.tool_call_end as Event;
    const r = applyOnce(emptyState(), ring, end);
    expect(r).toMatchObject({ applied: true, inconsistent: true });
    expect(reduce(emptyState(), end).inconsistent).toBe(true);
  });
});
