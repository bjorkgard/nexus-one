import { describe, expect, it } from "vite-plus/test";
import { chroma, deltaE2000, hexDeltaE, hexToLab, simulateLinear, type Lab } from "./color-metrics";

// Pairs from Sharma, Wu, Dalal 2005, "The CIEDE2000 colour-difference formula" (supplementary test data).
const SHARMA: [Lab, Lab, number][] = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1],
  [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1],
  [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, -1, 2], [50, 0, 0], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  [[50, 2.49, -0.001], [50, -2.49, 0.001], 7.1792],
  [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
  [[50, 2.49, -0.001], [50, -2.49, 0.0012], 7.2195],
  [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
  [[50, -0.001, 2.49], [50, 0.001, -2.49], 4.8045],
  [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
  [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[50, 2.5, 0], [61, -5, 29], 22.8977],
  [[50, 2.5, 0], [56, -27, -3], 31.903],
  [[50, 2.5, 0], [58, 24, 15], 19.4535],
  [[50, 2.5, 0], [50, 3.1736, 0.5854], 1],
  [[50, 2.5, 0], [50, 3.2972, 0], 1],
  [[50, 2.5, 0], [50, 1.8634, 0.5757], 1],
  [[50, 2.5, 0], [50, 3.2592, 0.335], 1],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
  [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
  [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
];

describe("color-metrics", () => {
  it.each(SHARMA.map((row, i) => [i + 1, ...row] as const))(
    "deltaE2000 matches Sharma pair %i",
    (_i, a, b, expected) => {
      expect(Math.abs(deltaE2000(a, b) - expected)).toBeLessThan(1e-4);
      expect(Math.abs(deltaE2000(b, a) - expected)).toBeLessThan(1e-4);
    },
  );

  it("converts known sRGB colours to CIELAB (D65)", () => {
    const [lw, aw, bw] = hexToLab("#ffffff");
    expect(lw).toBeCloseTo(100, 2);
    expect(Math.abs(aw)).toBeLessThan(0.01);
    expect(Math.abs(bw)).toBeLessThan(0.01);
    expect(hexToLab("#000000")[0]).toBe(0);
    const red = hexToLab("#ff0000");
    expect(red[0]).toBeCloseTo(53.24, 1);
    expect(red[1]).toBeCloseTo(80.09, 1);
    expect(red[2]).toBeCloseTo(67.2, 1);
  });

  it("chroma is zero for greys and matches C* for red", () => {
    expect(chroma("#808080")).toBeLessThan(0.01);
    expect(chroma("#ff0000")).toBeCloseTo(104.55, 1);
  });

  it("rejects a malformed hex", () => {
    expect(() => hexToLab("#fff")).toThrow(/hex/);
  });

  it("simulation keeps greys and collapses red/green under deuteranopia", () => {
    const [r, g, b] = simulateLinear("#808080", "deutan");
    for (const c of [r, g, b]) expect(c).toBeCloseTo(0.2159, 3);
    expect(hexDeltaE("#808080", "#808080", "protan")).toBeCloseTo(0, 3);
    const normal = hexDeltaE("#c04040", "#40a040");
    const deutan = hexDeltaE("#c04040", "#40a040", "deutan");
    expect(deutan).toBeLessThan(normal);
  });

  // Machado 2009 severity 1.0 on linear sRGB. Pure red is the first matrix column, pure green the second,
  // each clamped to 0..1. Deutan red: [0.367322, 0.280085, -0.01182 -> 0]; green: [0.860646, 0.672501, 0.04294].
  // Protan red: [0.152286, 0.114503, -0.003882 -> 0]; green: [1.052583 -> 1, 0.786281, -0.048116 -> 0].
  it.each([
    ["deutan", "#ff0000", [0.367322, 0.280085, 0]],
    ["deutan", "#00ff00", [0.860646, 0.672501, 0.04294]],
    ["protan", "#ff0000", [0.152286, 0.114503, 0]],
    ["protan", "#00ff00", [1, 0.786281, 0]],
  ] as const)("simulateLinear %s of %s uses the Machado matrix", (kind, hex, expected) => {
    const out = simulateLinear(hex, kind);
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(expected[i]!, 5);
  });
});
