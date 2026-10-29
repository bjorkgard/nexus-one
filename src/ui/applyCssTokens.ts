import { TOKENS, cssVarName, flattenTokens } from "../shared/tokens";

export function applyCssTokens(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of flattenTokens(TOKENS)) {
    root.style.setProperty(cssVarName(name), value);
  }
}
