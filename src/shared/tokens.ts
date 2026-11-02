// Colour tokens as data only: src/shared has no DOM lib, so applyCssTokens lives in src/ui.
export const TOKENS = {
  bg: { top: "#0b1220", bottom: "#05070c" },
  // frame: tower frame (slab ring and sides, roof deck, columns, parapet, AC), dark like the reference. interiorTop: tower slab tops inside the glass line, lighter than the frame ring so the floor reads through the glass.
  slab: { top: "#021520", side: "#8a7a6e", interiorTop: "#2a3646", frame: "#121925" },
  grid: { cell: "#1e2a3a", section: "#2b6f8a" },
  text: { brand: "#9fb0c8", body: "#c7d2e0", muted: "#7d8ba1" },
  danger: "#e2725b",
  zone: { site: "#6b7a90", floor: "#2b6f8a", room: "#c9a227" },
  // Material colours (task 2.2). Dark ladder bg.top < floor < panel < paint.graphite is tested in tokens.test.ts.
  surface: {
    panel: "#253145",
    trimCyan: "#36d6f5",
    trimWhite: "#e6f2ff",
    glass: "#497895",
    floor: "#18222f",
    furniture: "#c9c4bc",
    screenIdle: "#2a6f7c",
    screenActive: "#5fe3ff",
    // Desk kit (task 2.5): chair and plant are instance colours on furniture, screenOff is an empty desk's screen, lampWarm is the lamp colour before LOOK.interior.desk.lampGain. Each is at least 1.1 WCAG contrast from slab.interiorTop (tested).
    chair: "#3a3f47",
    plant: "#4f7a5a",
    lampWarm: "#ffd9a0",
    screenOff: "#121820",
  },
  // Floor tints per room type (task 2.4), diffuse vertex colours on the ground material. Each is within WCAG contrast 1.00-1.15 of slab.interiorTop (tested in tokens.test.ts); corridor is the slab colour itself, so it reads as untinted. Keys are the layout's RoomType names.
  room: {
    core: "#253145",
    corridor: "#2a3646",
    office: "#2c3a4e",
    meeting: "#27403f",
    restroom: "#332f45",
    reception: "#3a3a3c",
    waiting: "#3a3a3c",
    escalator: "#3a3a3c",
    "break-room": "#45392c",
    "server-room": "#22344a",
  },
  // Vehicle paints: muted (C* <= 45) and separable for colour-vision deficiency, both tested.
  paint: {
    red: "#b07c77",
    amber: "#664321",
    ochre: "#ac9243",
    green: "#95d096",
    blue: "#5ba2cb",
    violet: "#596798",
    silver: "#d9d9d9",
    graphite: "#3b3e46",
  },
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
