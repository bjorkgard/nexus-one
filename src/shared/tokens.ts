// Colour tokens as data only: src/shared has no DOM lib, so applyCssTokens lives in src/ui.
export const TOKENS = {
  bg: { top: "#0b1220", bottom: "#05070c" },
  slab: { top: "#021520", side: "#8a7a6e" },
  grid: { cell: "#1e2a3a", section: "#2b6f8a" },
  text: { brand: "#9fb0c8", body: "#c7d2e0", muted: "#7d8ba1" },
  danger: "#e2725b",
  zone: { site: "#6b7a90", floor: "#2b6f8a", room: "#c9a227" },
} as const;

export const CSS_VAR_PREFIX = "--nx-";

type TokenTree = { readonly [key: string]: string | TokenTree };

// Dotted token name and value pairs, e.g. ["bg.top", "#0b1220"].
export function flattenTokens(tree: TokenTree = TOKENS, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string"
      ? [[`${prefix}${key}`, value] as [string, string]]
      : flattenTokens(value, `${prefix}${key}.`),
  );
}

// "bg.top" -> "--nx-bg-top"
export function cssVarName(name: string): string {
  return CSS_VAR_PREFIX + name.replaceAll(".", "-");
}
