import { builtinModules } from "node:module";

// Build-only guards for the client bundle:
// 1. No importer may resolve a Node built-in (bare or `node:`-prefixed); Vite would ship a stub.
// 2. No output chunk may contain a dev-only marker (see DEV_MARKERS).

// Each dev-only marker and the source file that carries it. The build guard rejects the marker in any
// output chunk; the test asserts the source still contains it, so a rename cannot silently disarm the guard.
export const DEV_MARKERS = [
  { marker: "__nexus", source: "src/debug/nexus.ts" },
  { marker: "nexus-palette-board", source: "src/debug/PaletteBoard.tsx" },
  { marker: "nexus-perf-overlay", source: "src/debug/PerfPanel.tsx" },
  { marker: "nexus-probe", source: "src/debug/PerfStats.tsx" },
  { marker: "nexus-zone-overlay", source: "src/debug/ZoneOverlay.tsx" },
  { marker: "nexus.perfStats", source: "src/debug/perf.ts" },
];

// Allow-list of built-ins a package may import. Keep it empty: each entry needs a package and a reason.
const allowedBuiltins = new Set();

const builtins = new Set(builtinModules);

function isBuiltin(source) {
  const name = source.startsWith("node:") ? source.slice("node:".length) : source;
  return builtins.has(source) || builtins.has(name) || builtins.has(name.split("/")[0]);
}

export function buildGuards() {
  return {
    name: "build-guards",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer || source.startsWith("\0") || importer.startsWith("\0")) return null;
      if (isBuiltin(source) && !allowedBuiltins.has(source)) {
        this.error(`Node built-in "${source}" imported by ${importer}`);
      }
      return null;
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
      for (const { marker } of DEV_MARKERS) {
        const names = chunks
          .filter((output) => output.code.includes(marker))
          .map((o) => o.fileName);
        if (names.length > 0) this.error(`${marker} found in ${names.join(", ")}`);
      }
    },
  };
}
