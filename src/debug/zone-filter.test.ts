import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_FLOORS, createZoneRegistry, type Zone } from "../world/zones";
import { floorTopY } from "../world/tower";
import { overlayZones, roomLabelAnchor } from "./zone-filter";

const registry = createZoneRegistry({ floors: DEFAULT_FLOORS });
const rooms = registry.zones.filter((z) => z.kind === "room");
const others = registry.zones.filter((z) => z.kind !== "room");

describe("overlayZones", () => {
  it("plain (-1) shows site and floor zones and no rooms", () => {
    const { edges, labels } = overlayZones(registry.zones, -1);
    expect(edges).toEqual(others);
    expect(labels).toEqual(others);
    expect(rooms.length).toBeGreaterThan(0);
  });

  for (const floor of [0, 1, DEFAULT_FLOORS]) {
    it(`floor ${floor} adds only that floor's rooms, one corridor label`, () => {
      const onFloor = rooms.filter((z) => z.floor === floor);
      const { edges, labels } = overlayZones(registry.zones, floor);
      expect(edges.filter((z) => z.kind === "room")).toEqual(onFloor);
      const labelled = labels.filter((z) => z.kind === "room");
      const corridors = onFloor.filter((z) => z.kind === "room" && z.roomType === "corridor");
      expect(labelled.filter((z) => z.kind === "room" && z.roomType === "corridor")).toHaveLength(
        corridors.length > 0 ? 1 : 0,
      );
      const rest = onFloor.filter((z) => z.kind === "room" && z.roomType !== "corridor");
      expect(labelled).toEqual(expect.arrayContaining(rest));
      expect(labelled).toHaveLength(rest.length + (corridors.length > 0 ? 1 : 0));
    });
  }

  it("labels the longest corridor piece", () => {
    const span = (z: Zone) => Math.max(z.box.max[0] - z.box.min[0], z.box.max[2] - z.box.min[2]);
    const corridors = rooms.filter(
      (z) => z.kind === "room" && z.roomType === "corridor" && z.floor === 1,
    );
    expect(corridors.length).toBeGreaterThan(1);
    const { labels } = overlayZones(registry.zones, 1);
    const label = labels.find((z) => z.kind === "room" && z.roomType === "corridor")!;
    expect(span(label)).toBe(Math.max(...corridors.map(span)));
  });

  it("the roof floor shows the server room", () => {
    const { labels } = overlayZones(registry.zones, DEFAULT_FLOORS);
    expect(labels.some((z) => z.kind === "room" && z.roomType === "server-room")).toBe(true);
  });

  it("hides other floors' level labels, keeps own level, site, garage, bay, roof", () => {
    const levelIds = (floor: number) =>
      overlayZones(registry.zones, floor)
        .labels.filter((z) => z.kind !== "room")
        .map((z) => z.id);
    const keep = ["campus", "garage", "loading-bay", "roof"];
    expect(levelIds(0).toSorted()).toEqual([...keep, "lobby"].toSorted());
    expect(levelIds(1).toSorted()).toEqual([...keep, "floor-1"].toSorted());
    expect(levelIds(DEFAULT_FLOORS).toSorted()).toEqual(keep.toSorted());
    // Plain keeps every level label.
    expect(levelIds(-1)).toContain("lobby");
    expect(levelIds(-1)).toContain("floor-2");
    // Edges stay for all non-room zones.
    expect(overlayZones(registry.zones, 1).edges.filter((z) => z.kind !== "room")).toEqual(others);
  });
});

describe("roomLabelAnchor", () => {
  it("is each room's x/z centre just above its floor's slab top", () => {
    for (const z of rooms) {
      if (z.kind !== "room") continue;
      const [x, y, zz] = roomLabelAnchor(z);
      expect(x).toBeCloseTo((z.box.min[0] + z.box.max[0]) / 2, 9);
      expect(zz).toBeCloseTo((z.box.min[2] + z.box.max[2]) / 2, 9);
      expect(y).toBeGreaterThan(floorTopY(z.floor));
      expect(y - floorTopY(z.floor)).toBeLessThan(0.6);
    }
  });

  it("puts the server room on the roof deck", () => {
    const server = rooms.find((z) => z.kind === "room" && z.roomType === "server-room")!;
    if (server.kind !== "room") throw new Error("unreachable");
    expect(server.floor).toBe(DEFAULT_FLOORS);
    expect(roomLabelAnchor(server)[1]).toBeGreaterThan(floorTopY(DEFAULT_FLOORS));
  });
});
