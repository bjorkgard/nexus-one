// The shared material palette: 10 materials built once, reused by every mesh in the scene.
//
// Palette materials are READ-ONLY. Never call `.color.set(...)`, assign `.opacity` or edit any other
// property on `palette.*` from a mesh or component: one edit recolours every object that shares it.
// To tint one object, use instance colour (`InstancedMesh.setColorAt`); vertex colours are allowed
// only when baked in at build time with the colour data in the geometry cache key (the slab pattern).
// A deliberate different material goes through `variant(name, overrides)`, which caches clones and
// counts them against MATERIAL_BUDGET. In dev, `color` and `emissive` throw on write (D11).
// `furniture`, `screen`, `paint` and `led` have a WHITE base: every mesh using them must set an instance
// colour (their token lives in `TOKENS`), or it renders white. `panel`, `floor`, `glass` and the trims carry
// their token colour in the material itself.
import { MeshBasicMaterial, MeshStandardMaterial } from "three";
import { canonicalKey, type GeometryParams } from "./geometry-cache";
import { TOKENS } from "../shared/tokens";
import { LOOK } from "./stage-look";

export const MATERIAL_BUDGET = 30;
// Materials created outside this file that count against the budget.
export const KNOWN_EXTERNAL: readonly string[] = ["drei Grid"];

const WHITE = "#ffffff";

export const palette = {
  // Top and side colours stay vertex colours baked into the slab geometry from TOKENS.slab.
  ground: new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  panel: new MeshStandardMaterial({
    color: TOKENS.surface.panel,
    roughness: 0.55,
    metalness: 0.1,
  }),
  // Above trimWhite (0.5), within LOOK.emissiveCeiling. AgX desaturates bright emissive, so the edge keeps the token hue but reads paler (HSV saturation > 0.3).
  trimCyan: new MeshStandardMaterial({
    color: TOKENS.surface.panel,
    emissive: TOKENS.surface.trimCyan,
    emissiveIntensity: 0.8,
  }),
  // Subordinate to trimCyan (Q5).
  trimWhite: new MeshStandardMaterial({
    color: TOKENS.surface.panel,
    emissive: TOKENS.surface.trimWhite,
    emissiveIntensity: 0.5,
  }),
  // No environment map until 6.1, so the pane tints itself a little to read at all (Q8).
  glass: new MeshStandardMaterial({
    color: TOKENS.surface.glass,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    roughness: 0.05,
    metalness: 0.1,
    emissive: TOKENS.surface.glass,
    emissiveIntensity: 0.05,
  }),
  floor: new MeshStandardMaterial({ color: TOKENS.surface.floor, roughness: 0.8 }),
  furniture: new MeshStandardMaterial({ color: WHITE, roughness: 0.7 }),
  // Unlit on purpose: instance colour multiplies only the diffuse colour, so a lit emissive could not glow per monitor.
  screen: new MeshBasicMaterial({ color: WHITE, toneMapped: false }),
  // Dielectric satin: without an environment map, high metalness renders dark (Q9). Revisit in 6.1.
  paint: new MeshStandardMaterial({ color: WHITE, roughness: 0.35, metalness: 0.15 }),
  led: new MeshBasicMaterial({ color: WHITE, toneMapped: false }),
};

export type PaletteName = keyof typeof palette;
type PaletteMaterial = (typeof palette)[PaletteName];

for (const [name, material] of Object.entries(palette)) material.name = name;

export interface VariantOverrides {
  color?: string;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  emissiveIntensity?: number;
}

const OVERRIDE_KEYS = ["color", "opacity", "roughness", "metalness", "emissiveIntensity"] as const;
const variants = new Map<string, PaletteMaterial>();

// Palette size + variants + external materials; the invariant is count < MATERIAL_BUDGET.
export function materialBudgetCount(): number {
  return Object.keys(palette).length + variants.size + KNOWN_EXTERNAL.length;
}

function hasEmissive(material: PaletteMaterial): material is MeshStandardMaterial {
  if (!(material instanceof MeshStandardMaterial)) return false;
  const { r, g, b } = material.emissive;
  return r + g + b > 0;
}

function checkOverrides(name: PaletteName, base: PaletteMaterial, overrides: VariantOverrides) {
  for (const key of Object.keys(overrides)) {
    if (!(OVERRIDE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`palette.variant("${name}"): unknown override key "${key}"`);
    }
  }
  const { color, opacity, roughness, metalness, emissiveIntensity } = overrides;
  if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error(`palette.variant("${name}"): color must be a 7-character hex, got ${color}`);
  }
  for (const key of ["opacity", "roughness", "metalness", "emissiveIntensity"] as const) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`palette.variant("${name}"): ${key} must be a finite number, got ${value}`);
    }
  }
  const ineffective = (key: string, why: string) =>
    new Error(`palette.variant("${name}"): "${key}" has no effect: ${why}`);
  if (opacity !== undefined && !base.transparent) {
    throw ineffective("opacity", "only transparent materials (glass) use it");
  }
  if (
    (roughness !== undefined || metalness !== undefined) &&
    !(base instanceof MeshStandardMaterial)
  ) {
    throw ineffective(roughness !== undefined ? "roughness" : "metalness", "material is unlit");
  }
  if (emissiveIntensity !== undefined) {
    if (!hasEmissive(base))
      throw ineffective("emissiveIntensity", "material has no emissive colour");
    if (emissiveIntensity > LOOK.emissiveCeiling) {
      throw new Error(
        `palette.variant("${name}"): emissiveIntensity ${emissiveIntensity} is above LOOK.emissiveCeiling ${LOOK.emissiveCeiling}`,
      );
    }
  }
}

export function variant(name: PaletteName, overrides: VariantOverrides = {}): PaletteMaterial {
  if (!Object.hasOwn(palette, name))
    throw new Error(`palette.variant: unknown palette material "${name}"`);
  const base = palette[name];
  checkOverrides(name, base, overrides);
  const params: GeometryParams = {};
  for (const [k, value] of Object.entries(overrides)) {
    if (value !== undefined) params[k] = typeof value === "string" ? value.toLowerCase() : value;
  }
  // One canonical key form for geometry and material caches (D13).
  const key = canonicalKey(name, params);
  const cached = variants.get(key);
  if (cached) return cached;
  const count = materialBudgetCount();
  if (count + 1 >= MATERIAL_BUDGET) {
    throw new Error(
      `palette.variant("${name}"): material budget ${MATERIAL_BUDGET} reached with ${count} in use (palette, variants and ${KNOWN_EXTERNAL.join(", ")})`,
    );
  }
  const clone = base.clone();
  clone.name = `${name}:variant`;
  if (overrides.color !== undefined) clone.color.set(overrides.color);
  if (overrides.opacity !== undefined) clone.opacity = overrides.opacity;
  if (clone instanceof MeshStandardMaterial) {
    if (overrides.roughness !== undefined) clone.roughness = overrides.roughness;
    if (overrides.metalness !== undefined) clone.metalness = overrides.metalness;
    if (overrides.emissiveIntensity !== undefined) {
      clone.emissiveIntensity = overrides.emissiveIntensity;
    }
  }
  guardColors(name, clone);
  variants.set(key, clone);
  return clone;
}

// Dev only: replace r/g/b on shared colours with accessors whose setters name the rule (D11).
// Runs after construction because three writes colours in the material constructor and in clone().
function guardColors(name: string, material: PaletteMaterial) {
  if (!import.meta.env.DEV) return;
  for (const prop of ["color", "emissive"] as const) {
    const target = (material as { [K in typeof prop]?: MeshBasicMaterial["color"] })[prop];
    if (!target) continue;
    for (const channel of ["r", "g", "b"] as const) {
      const value = target[channel];
      Object.defineProperty(target, channel, {
        enumerable: true,
        get: () => value,
        set: () => {
          throw new Error(
            `palette.${name}.${prop} is shared and read-only; tint per object with instance or vertex colour (src/world/palette.ts)`,
          );
        },
      });
    }
  }
}

for (const [name, material] of Object.entries(palette)) guardColors(name, material);

// Test only: drop cached variants so module state does not leak between tests.
export function __resetPaletteVariants() {
  for (const material of variants.values()) material.dispose();
  variants.clear();
}
