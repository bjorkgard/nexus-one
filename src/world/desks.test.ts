import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createDeskAllocator, DESK_STREAM, seatsOf, type Seat } from "./desks";
import { buildLayout, LAYOUT_SEED } from "./layout";
import { floorTopY } from "./tower";
import { MAX_FLOORS } from "./zones";

const make = (floors: number) => createDeskAllocator({ floors, seed: LAYOUT_SEED });
const key = (s: Seat) => `${s.floor}:${s.slot}:${s.seat}`;
// Seats 1..n as agent ids "a1".."an"; throws if the allocator returns null.
const fill = (alloc: ReturnType<typeof make>, n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => alloc.allocate(`a${from + i}`)!);

afterEach(() => vi.restoreAllMocks());

describe("seatsOf", () => {
  const layout = buildLayout({ floors: 6, seed: LAYOUT_SEED });
  const seats = seatsOf(layout);

  it("lists 4 seats per desk slot in floor, slot, seat order with running indices", () => {
    expect(seats).toHaveLength(layout.deskTotal);
    expect(seats.map((s) => s.index)).toEqual(seats.map((_, i) => i));
    const order = seats.map((s) => [s.floor, s.slot, s.seat]);
    expect(order).toEqual(
      [...order].sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!),
    );
    expect(new Set(seats.map(key)).size).toBe(seats.length);
  });

  it("puts seats at +-0.8 m inside the cluster, door side first", () => {
    const slot = layout.levels[5]!.deskSlots[0]!;
    const cx = (slot.min[0] + slot.max[0]) / 2;
    const cz = (slot.min[1] + slot.max[1]) / 2;
    const four = seats.filter((s) => s.floor === 5 && s.slot === 0);
    expect(four.map((s) => s.seat)).toEqual([0, 1, 2, 3]);
    for (const s of four) {
      expect(Math.abs(s.x - cx)).toBeCloseTo(0.8, 6);
      expect(Math.abs(s.z - cz)).toBeCloseTo(0.8, 6);
      expect(s.mount[0]).toBe(s.x);
      expect(s.mount[2]).toBe(s.z);
      expect(s.mount[1]).toBeCloseTo(floorTopY(5) + 2.4, 6);
    }
    // Door side is the `facing` side: seats 0 and 1 are nearer the door than 2 and 3.
    const axis = slot.facing[1] === "z" ? 1 : 0;
    const sign = slot.facing[0] === "+" ? 1 : -1;
    const centre = axis === 1 ? cz : cx;
    const depth = (s: Seat) => ((axis === 1 ? s.z : s.x) - centre) * sign;
    expect(depth(four[0]!)).toBeGreaterThan(0);
    expect(depth(four[1]!)).toBeGreaterThan(0);
    expect(depth(four[2]!)).toBeLessThan(0);
    expect(depth(four[3]!)).toBeLessThan(0);
    const run = (s: Seat) => (axis === 1 ? s.x - cx : s.z - cz);
    expect(run(four[0]!)).toBeLessThan(run(four[1]!));
    expect(run(four[2]!)).toBeLessThan(run(four[3]!));
  });

  it("has no seats on the lobby or the roof", () => {
    expect(seats.some((s) => s.floor === 0 || s.floor === 6)).toBe(false);
  });
});

describe("createDeskAllocator", () => {
  it("exports the desk stream constant", () => {
    expect(DESK_STREAM).toBe(0x4445534b);
  });

  it("gives 200 agents 200 unique desks at floors 6", () => {
    const alloc = make(6);
    const seats = fill(alloc, 200);
    expect(new Set(seats.map(key)).size).toBe(200);
    expect(alloc.floorsNeeded).toBe(6);
    expect(alloc.unseated).toBe(0);
  });

  it("gives two allocators the same desks for the same sequence", () => {
    const a = make(6);
    const b = make(6);
    expect(fill(a, 60)).toEqual(fill(b, 60));
    expect(a.allocate("sub", "a5")).toEqual(b.allocate("sub", "a5"));
  });

  it("returns the same desk for the same id twice", () => {
    const alloc = make(6);
    const first = alloc.allocate("x")!;
    expect(alloc.allocate("x")).toEqual(first);
    expect(alloc.deskOf("x")).toEqual(first);
    expect(alloc.allocate("y")).not.toEqual(first);
  });

  it("fills the top office floor first for the first 44 root agents", () => {
    const seats = fill(make(6), 44);
    expect(seats.every((s) => s.floor === 5)).toBe(true);
    expect(new Set(seats.map(key)).size).toBe(44);
    expect(fill(make(6), 45)[44]!.floor).toBe(4);
  });

  it("seats subagents in the parent's pod while the pod has a free seat", () => {
    const alloc = make(6);
    const parent = alloc.allocate("p")!;
    const pod = [0, 1, 2].map((i) => alloc.allocate(`c${i}`, "p")!);
    for (const c of pod) {
      expect(c.floor).toBe(parent.floor);
      expect(c.slot).toBe(parent.slot);
    }
    expect(new Set([parent, ...pod].map(key)).size).toBe(4);
  });

  it("seats a subagent on the parent's floor, nearest first, when the pod is full", () => {
    const alloc = make(6);
    const parent = alloc.allocate("p")!;
    for (let i = 0; i < 3; i++) alloc.allocate(`c${i}`, "p");
    const next = alloc.allocate("c3", "p")!;
    expect(next.floor).toBe(parent.floor);
    expect(next.slot).not.toBe(parent.slot);
    expect(Math.abs(next.index - parent.index)).toBeLessThanOrEqual(4);
  });

  it("falls back to the root rule when the parent's floor is full", () => {
    const alloc = make(6);
    const first = alloc.allocate("p")!;
    // Fill the rest of floor 5 (44 seats) with roots, then a subagent of "p".
    fill(alloc, 43, 100);
    expect(alloc.deskOf("a100")!.floor).toBe(5);
    const child = alloc.allocate("c", "p")!;
    expect(first.floor).toBe(5);
    expect(child.floor).toBe(4);
  });

  it("treats a self-parent as a root", () => {
    const a = make(6);
    const b = make(6);
    expect(a.allocate("x", "x")).toEqual(b.allocate("x"));
  });

  it("treats an unknown or released parent as a root", () => {
    const a = make(6);
    const b = make(6);
    expect(a.allocate("x", "ghost")).toEqual(b.allocate("x"));
    a.allocate("p");
    a.release("p");
    expect(a.allocate("y", "p")).toEqual(b.allocate("y"));
  });

  it("reuses a released seat before growing", () => {
    const alloc = make(2);
    const seats = fill(alloc, 32);
    expect(alloc.floorsNeeded).toBe(2);
    alloc.release("a7");
    const again = alloc.allocate("late")!;
    expect(key(again)).toBe(key(seats[6]!));
    expect(alloc.floorsNeeded).toBe(2);
  });

  it("grows to 7 floors with agent 201 seated on floor 6", () => {
    const alloc = make(6);
    fill(alloc, 200);
    const next = alloc.allocate("a201")!;
    expect(alloc.floorsNeeded).toBe(7);
    expect(next.floor).toBe(6);
    expect(alloc.deskOf("a201")).toEqual(next);
    // Seats already handed out do not move.
    expect(alloc.deskOf("a1")!.floor).toBe(5);
  });

  it("never shrinks floorsNeeded after release", () => {
    const alloc = make(6);
    fill(alloc, 201);
    for (let i = 1; i <= 201; i++) alloc.release(`a${i}`);
    expect(alloc.floorsNeeded).toBe(7);
    expect(alloc.allocate("fresh")!.floor).toBe(6);
  });

  it("grows correctly from floors 2 (32 seats)", () => {
    const alloc = make(2);
    fill(alloc, 32);
    expect(alloc.floorsNeeded).toBe(2);
    const next = alloc.allocate("a33")!;
    expect(alloc.floorsNeeded).toBe(3);
    expect(next.floor).toBe(2);
    const rest = fill(alloc, 100, 34);
    expect(rest.every((s) => s.floor >= 1)).toBe(true);
    expect(new Set([...fill(alloc, 0), next, ...rest].map(key)).size).toBe(101);
  });

  it("returns null at the 40-floor ceiling, counts it once per id and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const alloc = make(MAX_FLOORS);
    const total = seatsOf(buildLayout({ floors: MAX_FLOORS, seed: LAYOUT_SEED })).length;
    const seats = fill(alloc, total);
    expect(new Set(seats.map(key)).size).toBe(total);
    expect(alloc.floorsNeeded).toBe(MAX_FLOORS);
    expect(alloc.unseated).toBe(0);
    expect(alloc.allocate("over")).toBeNull();
    expect(alloc.unseated).toBe(1);
    expect(alloc.allocate("over")).toBeNull();
    expect(alloc.unseated).toBe(1);
    expect(alloc.allocate("over2")).toBeNull();
    expect(alloc.unseated).toBe(2);
    expect(alloc.deskOf("over")).toBeUndefined();
    expect(alloc.floorsNeeded).toBe(MAX_FLOORS);
    expect(warn).toHaveBeenCalledTimes(1);
    alloc.release("over");
    expect(alloc.unseated).toBe(1);
  });

  it("throws RangeError for an empty id", () => {
    expect(() => make(6).allocate("")).toThrow(RangeError);
  });

  it("throws for floors outside the layout range", () => {
    expect(() => make(1)).toThrow();
    expect(() => make(MAX_FLOORS + 1)).toThrow();
  });

  it("ignores release of an unknown id", () => {
    const alloc = make(6);
    alloc.allocate("x");
    alloc.release("nobody");
    expect(alloc.deskOf("x")).toBeDefined();
    expect(alloc.deskOf("nobody")).toBeUndefined();
  });

  it("counts seated agents on floors the renderer has not drawn as offstage", () => {
    const alloc = make(6);
    fill(alloc, 201);
    expect(alloc.offstage(6)).toBe(1);
    expect(alloc.offstage(7)).toBe(0);
    expect(alloc.offstage(5)).toBe(1 + 44);
    alloc.release("a201");
    expect(alloc.offstage(6)).toBe(0);
  });
});
