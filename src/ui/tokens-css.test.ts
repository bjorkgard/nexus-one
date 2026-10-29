import { describe, expect, it } from "vite-plus/test";
import { TOKENS, cssVarName, flattenTokens } from "../shared/tokens";
import css from "../style.css?raw";

// Lives in src/ui, not src/shared: the module fence keeps src/shared from importing ../style.css.
describe("style.css fallbacks", () => {
  it("equal tokens.ts for every token that style.css uses", () => {
    let checked = 0;
    for (const [name, value] of flattenTokens(TOKENS)) {
      const variable = cssVarName(name);
      const pattern = new RegExp(`var\\(${variable},\\s*(#[0-9a-fA-F]{6})\\)`, "g");
      for (const match of css.matchAll(pattern)) {
        expect(match[1]!.toLowerCase(), variable).toBe(value.toLowerCase());
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("has a fallback for every var() reference", () => {
    expect(css).not.toMatch(/var\(--nx-[a-z-]+\)/);
  });

  it("gives every var(--nx-*) a 7-char hex fallback and a name that tokens.ts defines", () => {
    const known = new Set(flattenTokens(TOKENS).map(([name]) => cssVarName(name)));
    const uses = [...css.matchAll(/var\((--nx-[a-z0-9-]+)\s*,\s*([^)]*)\)/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const [, variable, fallback] of uses) {
      expect(known.has(variable!), variable).toBe(true);
      expect(fallback!.trim(), variable).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect([...css.matchAll(/var\(--nx-/g)].length).toBe(uses.length);
  });

  it("uses the gradient tokens on html", () => {
    for (const name of ["bg.top", "bg.bottom"]) {
      expect(css, name).toContain(`var(${cssVarName(name)}, `);
    }
  });
});
