import { builtinModules } from "node:module";

// Build-only guards for the client bundle:
// 1. No importer may resolve a Node built-in (bare or `node:`-prefixed); Vite would ship a stub.
// 2. No output chunk may contain `__nexus`, the debug API's global.

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
      const names = Object.values(bundle)
        .filter((output) => output.type === "chunk" && output.code.includes("__nexus"))
        .map((output) => output.fileName);
      if (names.length > 0) this.error(`__nexus found in ${names.join(", ")}`);
    },
  };
}
