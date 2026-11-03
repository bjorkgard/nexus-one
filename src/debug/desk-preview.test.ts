import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_FLOORS } from "../world/zones";
import { deskTotal, previewDesks } from "./desk-preview";

describe("previewDesks", () => {
  it("seats N agents on the top office floor first", () => {
    const p = previewDesks(DEFAULT_FLOORS, 8);
    expect(p.report.seated).toBe(8);
    expect(p.report.unseated).toBe(0);
    expect(p.report.offstage).toBe(0);
    expect(p.occupied.size).toBe(8);
    expect(p.report.seats.every((s) => s.floor === p.report.floorsNeeded - 1)).toBe(true);
  });

  it("seats each subagent next to its parent, also when the parent sits below the top floor", () => {
    // 3 floors, 80 of 84 seats: the top office floor (2) is full, so many parents sit on floor 1.
    const { seats } = previewDesks(3, 80).report;
    expect(seats.filter((s, i) => i % 3 === 1 && s.floor < 2).length).toBeGreaterThan(0);
    // Within two pods (8 seats) of the parent; a hashed root seat lands up to 47 seats away (measured).
    for (let i = 2; i < seats.length; i += 3) {
      expect(seats[i]!.floor).toBe(seats[i - 1]!.floor);
      expect(Math.abs(seats[i]!.index - seats[i - 1]!.index)).toBeLessThanOrEqual(8);
    }
  });

  it("zero agents is empty; the total covers every office seat", () => {
    expect(previewDesks(DEFAULT_FLOORS, 0).report.seats).toEqual([]);
    expect(deskTotal(DEFAULT_FLOORS)).toBeGreaterThan(8);
  });

  // Value: protects=previewDesks rejects a negative or fractional agent count; fails_when=the integer/non-negative guard is removed or inverted; why_new=existing cases only pass valid counts; seam=none; no_claim=none beyond protects
  it("throws RangeError for a negative or non-integer count", () => {
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => previewDesks(DEFAULT_FLOORS, bad)).toThrow(RangeError);
    }
  });
});
