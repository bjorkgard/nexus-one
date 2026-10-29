import { describe, expect, it } from "vite-plus/test";
import { CSS_VAR_PREFIX, TOKENS, cssVarName, flattenTokens } from "./tokens";

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
  });
});
