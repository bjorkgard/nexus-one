import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_FLOORS,
  FLOOR_HEIGHT,
  ZoneError,
  createZoneRegistry,
  validateZones,
  type Vec3,
  type Zone,
} from "./zones";

const registry = createZoneRegistry({ floors: DEFAULT_FLOORS });

function zone(id: string, patch: Partial<Zone> = {}): Zone {
  return {
    id,
    name: id,
    kind: "floor",
    floor: 0,
    parentId: "campus",
    box: { min: [0, 0, 0], max: [10, 4, 10] },
    ...patch,
  };
}

const campus = zone("campus", {
  kind: "site",
  parentId: null,
  box: { min: [-100, 0, -100], max: [100, 40, 100] },
});

function box(min: Vec3, max: Vec3) {
  return { min, max };
}

describe("createZoneRegistry lookups", () => {
  it("byId returns every zone and undefined for an unknown id", () => {
    for (const z of registry.zones) expect(registry.byId(z.id)).toBe(z);
    expect(registry.byId("nope")).toBeUndefined();
  });

  it("builds exactly 6 level zones below the roof for floors = 6", () => {
    const levels = registry.zones.filter((z) => z.parentId === "campus" && z.id !== "roof");
    const tower = levels.filter((z) => z.id === "lobby" || z.id.startsWith("floor-"));
    expect(tower.map((z) => z.id)).toEqual([
      "lobby",
      "floor-1",
      "floor-2",
      "floor-3",
      "floor-4",
      "floor-5",
    ]);
    expect(registry.byId("roof")?.floor).toBe(6);
  });

  it("at resolves the lobby, garage, rooms, floors and roof", () => {
    expect(registry.at([0, 1, 0])?.id).toBe("lobby");
    expect(registry.at([30, 1, -10])?.id).toBe("garage");
    expect(registry.at([-40, 1, -5])?.id).toBe("loading-bay");
    expect(registry.at([-8, FLOOR_HEIGHT + 1, 9])?.id).toBe("break-room");
    expect(registry.at([0, FLOOR_HEIGHT + 1, 0])?.id).toBe("floor-1");
    expect(registry.at([8, 5 * FLOOR_HEIGHT + 1, -9])?.id).toBe("server-room");
    expect(registry.at([0, 6 * FLOOR_HEIGHT + 1, 0])?.id).toBe("roof");
    expect(registry.at([-55, 1, 55])?.id).toBe("campus");
  });

  it("resolves a shared face between floors to the upper floor", () => {
    expect(registry.at([0, FLOOR_HEIGHT, 0])?.id).toBe("floor-1");
    expect(registry.at([0, 0, 0])?.id).toBe("lobby");
  });

  it("returns undefined outside the campus", () => {
    expect(registry.at([60, 1, 0])).toBeUndefined();
    expect(registry.at([0, -0.5, 0])).toBeUndefined();
    expect(registry.at([0, 7 * FLOOR_HEIGHT, 0])).toBeUndefined();
  });

  it("throws TypeError for a non-finite coordinate", () => {
    expect(() => registry.at([Number.NaN, 0, 0])).toThrow(TypeError);
    expect(() => registry.at([0, Infinity, 0])).toThrow(TypeError);
  });
});

describe("createZoneRegistry input", () => {
  it.each([1, 41, 2.5, Number.NaN])("rejects floors = %s with RangeError", (floors) => {
    expect(() => createZoneRegistry({ floors })).toThrow(RangeError);
  });

  it.each([2, 40])("builds a valid registry for floors = %s", (floors) => {
    const r = createZoneRegistry({ floors });
    expect(() => validateZones(r.zones)).not.toThrow();
    expect(r.byId("roof")?.floor).toBe(floors);
  });

  it("keeps the break room and moves the server room and roof when a floor is added", () => {
    const six = createZoneRegistry({ floors: 6 });
    const seven = createZoneRegistry({ floors: 7 });
    expect(seven.byId("break-room")?.box).toEqual(six.byId("break-room")?.box);
    const s6 = six.byId("server-room")?.box;
    const s7 = seven.byId("server-room")?.box;
    expect(s7?.min[1]).toBe((s6?.min[1] ?? 0) + FLOOR_HEIGHT);
    expect(seven.byId("roof")?.box.min[1]).toBe(7 * FLOOR_HEIGHT);
    expect(seven.byId("campus")?.box.max[1]).toBe(8 * FLOOR_HEIGHT);
  });

  it("freezes zones: a write throws and byId still returns the validated box", () => {
    const z = registry.byId("lobby")!;
    expect(() => {
      (z.box.min as unknown as number[])[0] = 99;
    }).toThrow(TypeError);
    expect(() => {
      (z as { name: string }).name = "x";
    }).toThrow(TypeError);
    expect(registry.byId("lobby")?.box.min[0]).toBe(-15);
    expect(Object.isFrozen(z.box)).toBe(true);
  });
});

describe("validateZones", () => {
  it("accepts a valid table", () => {
    expect(() => validateZones([campus, zone("a")])).not.toThrow();
  });

  it("rejects a duplicate id naming it", () => {
    expect(() => validateZones([campus, zone("a"), zone("a")])).toThrow(ZoneError);
    expect(() => validateZones([campus, zone("a"), zone("a")])).toThrow(/"a"/);
  });

  it("rejects a missing parent", () => {
    expect(() => validateZones([campus, zone("a", { parentId: "ghost" })])).toThrow(/ghost/);
  });

  it("rejects a cycle", () => {
    const a = zone("a", { parentId: "b" });
    const b = zone("b", { parentId: "a" });
    expect(() => validateZones([campus, a, b])).toThrow(/cycle/);
  });

  it("rejects an inverted box and a non-finite number", () => {
    expect(() => validateZones([campus, zone("a", { box: box([5, 0, 0], [5, 4, 10]) })])).toThrow(
      ZoneError,
    );
    expect(() =>
      validateZones([campus, zone("a", { box: box([0, 0, 0], [Number.NaN, 4, 10]) })]),
    ).toThrow(ZoneError);
  });

  it("rejects a child outside its parent", () => {
    const out = zone("a", { box: box([95, 0, 0], [105, 4, 10]) });
    expect(() => validateZones([campus, out])).toThrow(/campus/);
  });

  it("rejects a box outside its floor band", () => {
    const wrong = zone("a", { floor: 1 });
    expect(() => validateZones([campus, wrong])).toThrow(/floor band/);
  });

  it("rejects siblings that overlap on one floor naming both ids", () => {
    const a = zone("a");
    const b = zone("b", { box: box([5, 0, 5], [15, 4, 15]) });
    expect(() => validateZones([campus, a, b])).toThrow(/"a".*"b"/);
  });

  it("accepts siblings that overlap in x/z on different floors", () => {
    const a = zone("a");
    const b = zone("b", { floor: 1, box: box([0, 4, 0], [10, 8, 10]) });
    expect(() => validateZones([campus, a, b])).not.toThrow();
  });
});
