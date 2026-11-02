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

  it("makes every third agent a subagent beside the one before", () => {
    const p = previewDesks(DEFAULT_FLOORS, 3);
    expect(p.report.seated).toBe(3);
    const [a, , c] = p.report.seats;
    expect(a!.floor).toBe(c!.floor);
  });

  it("zero agents is empty; the total covers every office seat", () => {
    expect(previewDesks(DEFAULT_FLOORS, 0).report.seats).toEqual([]);
    expect(deskTotal(DEFAULT_FLOORS)).toBeGreaterThan(8);
  });
});
