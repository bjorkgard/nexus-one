import { MeshBasicMaterial, MeshStandardMaterial } from "three";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { TOKENS } from "../shared/tokens";
import {
  KNOWN_EXTERNAL,
  MATERIAL_BUDGET,
  __resetPaletteVariants,
  materialBudgetCount,
  palette,
  variant,
} from "./palette";
import { LOOK } from "./stage-look";

beforeEach(() => {
  __resetPaletteVariants();
});

describe("palette", () => {
  it("has 10 distinct materials", () => {
    const all = Object.values(palette);
    expect(Object.keys(palette).sort()).toEqual(
      [
        "ground",
        "panel",
        "trimCyan",
        "trimWhite",
        "glass",
        "floor",
        "furniture",
        "screen",
        "paint",
        "led",
      ].sort(),
    );
    expect(new Set(all).size).toBe(10);
  });

  it("stays under the material budget with the external materials counted", () => {
    expect(KNOWN_EXTERNAL).toEqual(["drei Grid"]);
    expect(MATERIAL_BUDGET).toBe(30);
    expect(materialBudgetCount()).toBe(11);
    expect(materialBudgetCount()).toBeLessThan(MATERIAL_BUDGET);
  });

  it("glass is transparent without writing depth, tinted at opacity 0.25", () => {
    expect(palette.glass.transparent).toBe(true);
    expect(palette.glass.depthWrite).toBe(false);
    expect(palette.glass.opacity).toBe(0.25);
    expect(palette.glass.emissiveIntensity).toBe(0.05);
    expect(palette.glass.emissive.getHexString()).toBe(palette.glass.color.getHexString());
  });

  it("screen and led are unlit and skip tone mapping", () => {
    for (const material of [palette.screen, palette.led]) {
      expect(material).toBeInstanceOf(MeshBasicMaterial);
      expect(material.toneMapped).toBe(false);
      expect(material.color.getHexString()).toBe("ffffff");
    }
  });

  it("follows the Q5, Q9, Q10 numbers", () => {
    expect(palette.trimWhite.emissiveIntensity).toBe(0.5);
    expect(palette.trimWhite.emissiveIntensity).toBeLessThan(palette.trimCyan.emissiveIntensity);
    expect(palette.paint.metalness).toBe(0.15);
    expect(palette.panel.metalness).toBe(0.1);
    expect(palette.ground.vertexColors).toBe(true);
    expect(palette.ground.roughness).toBe(0.9);
  });

  it("takes surface colours from the tokens", () => {
    expect(`#${palette.panel.color.getHexString()}`).toBe(TOKENS.surface.panel);
    expect(`#${palette.trimCyan.emissive.getHexString()}`).toBe(TOKENS.surface.trimCyan);
    expect(`#${palette.floor.color.getHexString()}`).toBe(TOKENS.surface.floor);
  });

  it("keeps every emissiveIntensity at or below the ceiling", () => {
    for (const material of Object.values(palette)) {
      if (material instanceof MeshStandardMaterial) {
        expect(material.emissiveIntensity).toBeLessThanOrEqual(LOOK.emissiveCeiling);
      }
    }
  });
});

describe("palette.variant", () => {
  it("returns the same instance for the same overrides, key order aside", () => {
    const a = variant("panel", { color: "#112233", roughness: 0.3 });
    const b = variant("panel", { roughness: 0.3, color: "#112233" });
    expect(a).toBe(b);
    expect(a).not.toBe(palette.panel);
    expect(a.color.getHexString()).toBe("112233");
    expect((a as MeshStandardMaterial).roughness).toBe(0.3);
    expect(variant("panel", { roughness: 0.4 })).not.toBe(a);
    expect(materialBudgetCount()).toBe(13);
  });

  it("treats hex case as one colour, so it costs one budget slot", () => {
    // Value: protects=variant cache key lowercases colour; fails_when=toLowerCase is dropped and "#ABCDEF" clones a second material; why_new=existing cache test uses lowercase only; seam=none; no_claim=none beyond protects
    const upper = variant("paint", { color: "#ABCDEF" });
    expect(variant("paint", { color: "#abcdef" })).toBe(upper);
    expect(materialBudgetCount()).toBe(12);
  });

  it("does not touch the palette material", () => {
    variant("panel", { color: "#112233" });
    expect(`#${palette.panel.color.getHexString()}`).toBe(TOKENS.surface.panel);
  });

  it("throws on an unknown name", () => {
    expect(() => variant("nope" as never, {})).toThrow(/unknown palette material "nope"/);
    for (const inherited of ["constructor", "toString"]) {
      expect(() => variant(inherited as never, {})).toThrow(
        new RegExp(`unknown palette material "${inherited}"`),
      );
    }
  });

  it("throws on an unknown override key", () => {
    expect(() => variant("panel", { wireframe: true } as never)).toThrow(/unknown override key/);
  });

  it("throws on a non-hex colour and non-finite numbers", () => {
    expect(() => variant("panel", { color: "red" })).toThrow(/hex/);
    expect(() => variant("panel", { color: "#fff" })).toThrow(/hex/);
    expect(() => variant("panel", { roughness: Number.NaN })).toThrow(/finite/);
    expect(() => variant("glass", { opacity: Number.POSITIVE_INFINITY })).toThrow(/finite/);
  });

  it("throws on overrides that cannot take effect (X4)", () => {
    expect(() => variant("panel", { opacity: 0.5 })).toThrow(/opacity/);
    expect(() => variant("led", { roughness: 0.5 })).toThrow(/roughness/);
    expect(() => variant("screen", { metalness: 0.5 })).toThrow(/metalness/);
    expect(() => variant("panel", { emissiveIntensity: 0.5 })).toThrow(/emissiveIntensity/);
    expect(() => variant("led", { emissiveIntensity: 0.5 })).toThrow(/emissiveIntensity/);
    expect(variant("glass", { opacity: 0.4 }).opacity).toBe(0.4);
    expect(
      (variant("trimCyan", { emissiveIntensity: 0.8 }) as MeshStandardMaterial).emissiveIntensity,
    ).toBe(0.8);
  });

  it("throws on emissiveIntensity above the ceiling", () => {
    // Value: protects=ceiling is inclusive (exactly LOOK.emissiveCeiling is allowed); fails_when=the check becomes >=; why_new=only ceiling + 0.1 was tested; seam=none; no_claim=AgX rendering at the ceiling
    expect(() => variant("trimCyan", { emissiveIntensity: LOOK.emissiveCeiling + 0.1 })).toThrow(
      /emissiveCeiling/,
    );
    expect(
      (variant("trimCyan", { emissiveIntensity: LOOK.emissiveCeiling }) as MeshStandardMaterial)
        .emissiveIntensity,
    ).toBe(LOOK.emissiveCeiling);
  });

  it("throws at the budget, naming the budget and the count", () => {
    const room = MATERIAL_BUDGET - 1 - materialBudgetCount();
    for (let i = 0; i < room; i++) variant("floor", { roughness: i / 100 });
    expect(materialBudgetCount()).toBe(MATERIAL_BUDGET - 1);
    expect(() => variant("floor", { roughness: 0.99 })).toThrow(
      new RegExp(`budget ${MATERIAL_BUDGET} reached with ${MATERIAL_BUDGET - 1} in use`),
    );
    // A cached variant still resolves at the limit.
    expect(variant("floor", { roughness: 0 })).toBe(variant("floor", { roughness: 0 }));
  });
});

describe("dev guard", () => {
  it("is on under test", () => {
    expect(import.meta.env.DEV).toBe(true);
  });

  it("makes palette colour writes throw with the rule, and reads still work", () => {
    expect(() => palette.panel.color.set("#ff0000")).toThrow(
      "palette.panel.color is shared and read-only; tint per object with instance or vertex colour (src/world/palette.ts)",
    );
    expect(() => {
      palette.panel.color.r = 1;
    }).toThrow(/read-only/);
    expect(palette.panel.color.r).toBeGreaterThan(0);
    expect(`#${palette.panel.color.getHexString()}`).toBe(TOKENS.surface.panel);
  });

  it("guards emissive too", () => {
    expect(() => palette.trimCyan.emissive.setRGB(0, 0, 0)).toThrow(
      "palette.trimCyan.emissive is shared and read-only",
    );
  });

  it("guards the unlit materials", () => {
    expect(() => palette.screen.color.set("#000000")).toThrow(/palette\.screen\.color/);
  });

  it("guards variant colours the same way", () => {
    const v = variant("paint", { color: "#445566" });
    expect(() => v.color.set("#000000")).toThrow(/palette\.paint\.color is shared and read-only/);
    expect(v.color.getHexString()).toBe("445566");
  });

  it("lets three clone a guarded material", () => {
    const copy = palette.panel.clone();
    expect(copy.color.getHexString()).toBe(palette.panel.color.getHexString());
    expect(() => copy.color.set("#000000")).not.toThrow();
  });
});
