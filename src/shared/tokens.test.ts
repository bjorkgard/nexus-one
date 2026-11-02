import { describe, expect, it } from "vite-plus/test";
import { chroma, hexDeltaE, hexToLab, hexToLinear } from "./color-metrics";
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

  it("has the 12 surface and 8 paint tokens", () => {
    expect(Object.keys(TOKENS.surface).sort()).toEqual(
      [
        "chair",
        "furniture",
        "floor",
        "glass",
        "lampWarm",
        "panel",
        "plant",
        "screenActive",
        "screenIdle",
        "screenOff",
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

  it("has a floor tint for every room type, each within WCAG contrast 1.00-1.15 of slab.interiorTop", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = hexToLinear(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    // src/shared is a leaf module, so the room list is spelled out; interior.test.ts checks it against ROOM_TYPES.
    expect(Object.keys(TOKENS.room)).toHaveLength(10);
    for (const [name, hex] of Object.entries(TOKENS.room)) {
      const c = contrast(hex, TOKENS.slab.interiorTop);
      expect(c, name).toBeGreaterThanOrEqual(1);
      expect(c, name).toBeLessThanOrEqual(1.15);
    }
  });

  it("keeps every desk-kit token at WCAG contrast 1.1 or more against slab.interiorTop", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = hexToLinear(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const { chair, plant, lampWarm, screenOff } = TOKENS.surface;
    for (const [name, hex] of Object.entries({ chair, plant, lampWarm, screenOff })) {
      expect(contrast(hex, TOKENS.slab.interiorTop), name).toBeGreaterThanOrEqual(1.1);
    }
  });
});
