import { RECENT_IDS_CAP } from "./protocol";
import { reduce, type NexusState } from "./reduce";
import type { Event } from "./schema";

export type RecentIds = {
  has(id: string): boolean;
  add(id: string): void;
  // Replaces all contents; keeps the newest `capacity` ids.
  seed(ids: readonly string[]): void;
  // Oldest first, newest last.
  toArray(): string[];
};

// Mutable FIFO ring of recently applied event ids. Adding an id past capacity evicts the oldest.
export function createRecentIds(capacity: number = RECENT_IDS_CAP): RecentIds {
  let buffer: string[] = [];
  let ids = new Set<string>();
  let head = 0; // index of the oldest id once the buffer is full

  const add = (id: string) => {
    if (ids.has(id)) return;
    if (buffer.length < capacity) {
      buffer.push(id);
    } else {
      ids.delete(buffer[head]!);
      buffer[head] = id;
      head = (head + 1) % capacity;
    }
    ids.add(id);
  };

  return {
    has: (id) => ids.has(id),
    add,
    seed(seedIds) {
      buffer = [];
      ids = new Set();
      head = 0;
      for (const id of seedIds.slice(-capacity)) add(id);
    },
    toArray: () => [...buffer.slice(head), ...buffer.slice(0, head)],
  };
}

// The one entry point for applying an event: the collector (4.4) must use it too, so client and
// server drop a replayed id the same way.
export function applyOnce(
  state: NexusState,
  ring: RecentIds,
  event: Event,
): { state: NexusState; applied: boolean; inconsistent: boolean } {
  if (ring.has(event.id)) return { state, applied: false, inconsistent: false };
  ring.add(event.id);
  const result = reduce(state, event);
  return { state: result.state, applied: true, inconsistent: result.inconsistent };
}
