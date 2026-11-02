import { LAYOUT_SEED, buildLayout } from "../world/layout";
import { createDeskAllocator, seatsOf } from "../world/desks";

// What `__nexus.desks()` reports: the allocator's counters and the occupied seats of the current page.
export type DeskReport = {
  floorsNeeded: number;
  seated: number;
  unseated: number;
  offstage: number;
  seats: { index: number; floor: number }[];
};

// Seats in the layout at `floors`: the upper bound of `?agents=N`.
export function deskTotal(floors: number): number {
  return seatsOf(buildLayout({ floors, seed: LAYOUT_SEED })).length;
}

// `?agents=N`: agents agent-0..agent-(N-1) in spawn order, every third (index 2, 5, ...) a subagent of the one before.
export function previewDesks(
  floors: number,
  count: number,
): { occupied: ReadonlySet<number>; report: DeskReport } {
  const allocator = createDeskAllocator({ floors, seed: LAYOUT_SEED });
  const seats = [];
  for (let i = 0; i < count; i++) {
    const seat = allocator.allocate(`agent-${i}`, i % 3 === 2 ? `agent-${i - 1}` : undefined);
    if (seat) seats.push({ index: seat.index, floor: seat.floor });
  }
  return {
    occupied: new Set(seats.map((s) => s.index)),
    report: {
      floorsNeeded: allocator.floorsNeeded,
      seated: seats.length,
      unseated: allocator.unseated,
      offstage: allocator.offstage(floors),
      seats,
    },
  };
}
