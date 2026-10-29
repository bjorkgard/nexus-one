import { describe, expect, it } from "vite-plus/test";
import { chroma, hexDeltaE, hexToLab } from "./color-metrics";
import { CSS_VAR_PREFIX, TOKENS, cssVarName, flattenTokens } from "./tokens";

const paints = Object.entries(TOKENS.paint);

describe("tokens", () => {
  it("every token is a 7-character hex colour", () => {
    const flat = flattenTokens(TOKENS);
    expect(flat.length).toBeGreaterThan(0);
    for (const [name, value] of flat) expect(value, name).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("names CSS variables from the dotted token name", () => {
    expect(CSS_VAR_PREFIX).toBe("--nx-");
    expect(cssVarName("bg.top")).toBe("--nx-bg-top");
    expect(cssVarName("danger")).toBe("--nx-danger");
    expect(cssVarName("paint.graphite")).toBe("--nx-paint-graphite");
  });

  it("has the 8 surface and 8 paint tokens", () => {
    expect(Object.keys(TOKENS.surface).sort()).toEqual(
      [
        "furniture",
        "floor",
        "glass",
        "panel",
        "screenActive",
        "screenIdle",
        "trimCyan",
        "trimWhite",
      ].sort(),
    );
    expect(Object.keys(TOKENS.paint)).toHaveLength(8);
    expect(new Set(Object.values(TOKENS.paint).map((v) => v.toLowerCase())).size).toBe(8);
  });

  it("dark ladder steps at least 6 L* between bg.top, floor, panel and graphite", () => {
    const ladder = [
      ["bg.top", TOKENS.bg.top],
      ["surface.floor", TOKENS.surface.floor],
      ["surface.panel", TOKENS.surface.panel],
      ["paint.graphite", TOKENS.paint.graphite],
    ] as const;
    for (let i = 1; i < ladder.length; i++) {
      const step = hexToLab(ladder[i]![1])[0] - hexToLab(ladder[i - 1]![1])[0];
      expect(step, `${ladder[i - 1]![0]} -> ${ladder[i]![0]}`).toBeGreaterThanOrEqual(6);
    }
  });

  it("every paint pair is at least 20 apart (dE2000) and 10 apart under deuteranopia and protanopia", () => {
    for (let i = 0; i < paints.length; i++) {
      for (let j = i + 1; j < paints.length; j++) {
        const [na, a] = paints[i]!;
        const [nb, b] = paints[j]!;
        const label = `${na} vs ${nb}`;
        expect(hexDeltaE(a, b), `${label} normal`).toBeGreaterThanOrEqual(20);
        expect(hexDeltaE(a, b, "deutan"), `${label} deutan`).toBeGreaterThanOrEqual(10);
        expect(hexDeltaE(a, b, "protan"), `${label} protan`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("every paint is muted (C* at most 45)", () => {
    for (const [name, hex] of paints) expect(chroma(hex), name).toBeLessThanOrEqual(45);
  });
});
