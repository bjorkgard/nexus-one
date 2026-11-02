import { floorTopY } from "../world/tower";
import type { RoomZone, Zone } from "../world/zones";

// A room label floats this far above its floor's slab top, so the pill clears the tint and the partitions.
const ROOM_LABEL_LIFT = 0.3;

const length = (z: Zone) => Math.max(z.box.max[0] - z.box.min[0], z.box.max[2] - z.box.min[2]);

// A level label (`lobby`, `floor-K`) that `?floor=N` hides: every level but floor N's own. Site, garage, loading
// bay and roof labels stay.
const hiddenLevel = (z: Zone, floor: number) =>
  floor >= 0 &&
  z.kind === "floor" &&
  (z.id === "lobby" || z.id.startsWith("floor-")) &&
  z.floor !== floor;

// Where a room label sits in the `?floor=N` view: the room's x/z centre, just above its floor's slab top (the
// roof deck for the server room).
export function roomLabelAnchor(z: RoomZone): readonly [number, number, number] {
  return [
    (z.box.min[0] + z.box.max[0]) / 2,
    floorTopY(z.floor) + ROOM_LABEL_LIFT,
    (z.box.min[2] + z.box.max[2]) / 2,
  ];
}

// What the zone overlay draws. Site and floor zones always show. Room zones only show for `?floor=N`
// (`floor` >= 0), and only that floor's rooms; a floor's corridor pieces all keep their edges but only the
// longest one carries the label. `floor` -1 is no filter: no rooms at all. With a floor set, the other floors'
// level labels hide.
export function overlayZones(
  zones: readonly Zone[],
  floor: number,
): { edges: readonly Zone[]; labels: readonly Zone[] } {
  const edges: Zone[] = [];
  const labels: Zone[] = [];
  let corridor: Zone | null = null;
  for (const z of zones) {
    if (z.kind !== "room") {
      edges.push(z);
      if (!hiddenLevel(z, floor)) labels.push(z);
      continue;
    }
    if (z.floor !== floor) continue;
    edges.push(z);
    if (z.roomType === "corridor") {
      if (!corridor || length(z) > length(corridor)) corridor = z;
    } else {
      labels.push(z);
    }
  }
  if (corridor) labels.push(corridor);
  return { edges, labels };
}
