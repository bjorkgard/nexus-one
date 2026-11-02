import { LOOK } from "./stage-look";

// Shared by zones, layout and tower so none of them imports another at runtime. Depends only on
// stage-look.ts (no imports there).
export class ZoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZoneError";
  }
}

// Half the tower footprint in metres: the slab edge.
export const TOWER_HALF = 15;
// The glass hull sits `glassInset` inside the slab edge (LOOK.tower.glassInset).
export const GLASS_HALF = TOWER_HALF - LOOK.tower.glassInset;
