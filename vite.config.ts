import childProcess from "node:child_process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
import { buildGuards } from "./lint/build-guards.js";
import { configDefaults } from "vite-plus/test/config";

const electronPackage = ["electron", "electron/**"];
const browserLibs = [
  "react",
  "react/**",
  "react-dom",
  "react-dom/**",
  "three",
  "three/**",
  "@react-three/**",
  "zustand",
  "zustand/react",
  "zustand/react/**",
  "zustand/traditional",
  "zustand/traditional/**",
  "zustand/shallow",
  "zustand/shallow/**",
  "three-stdlib",
  "three-stdlib/**",
];

// A staged deletion, rename, type change, symlink (new or old mode 120000) or submodule (mode 160000
// on either side) can change what unstaged files resolve to, so the partial check is not enough. Keep
// in step with .vite-hooks/pre-commit. `git diff --cached --raw -z` entries look like
// ":oldmode newmode oldsha newsha STATUS\0path\0" (a rename or copy lists two paths). A git failure counts.
function needsFullCheck(): boolean {
  try {
    const raw = childProcess.execFileSync("git", ["diff", "--cached", "--raw", "-z", "-M"], {
      encoding: "utf8",
    });
    const tokens = raw.split("\0");
    for (let i = 0; i < tokens.length && tokens[i] !== "";) {
      const [oldMode, newMode, , , status] = tokens[i].split(" ");
      if (
        oldMode === ":120000" ||
        oldMode === ":160000" ||
        newMode === "120000" ||
        newMode === "160000" ||
        "DRT".includes(status[0])
      ) {
        return true;
      }
      i += 1 + (status[0] === "R" || status[0] === "C" ? 2 : 1);
    }
    return false;
  } catch {
    return true;
  }
}

const electronMessage =
  "src/ runs in the browser; Electron main and preload code lives in electron/.";
const collectorElectronMessage =
  "collector/ must load in plain Node (vp run dev) as well as Electron; keep Electron APIs in electron/.";
const electronBrowserMessage =
  "electron/ runs in the main process; React and Three code belongs in src/ui, src/world or src/sim.";
const browserMessage =
  "collector/ and src/shared/ must load in plain Node; React and Three code belongs in src/ui, src/world or src/sim.";

export default defineConfig({
  plugins: [react(), tailwindcss(), buildGuards()],
  staged: {
    // One entry, so the tasks never run concurrently. Function form: lint-staged would otherwise
    // append the paths and check only those files. Staging the config, the fence plugin or a tsconfig.json
    // or package.json changes what every file is checked against, so those run the full check; so does
    // a staged deletion, rename or symlink, which can change what other files resolve to.
    "*": (files) => {
      // Paths are absolute; a same-named nested file only costs an unneeded full check.
      const fullCheck = files.some((file) =>
        ["/vite.config.ts", "/lint/module-fences.js", "/tsconfig.json", "/package.json"].some(
          (suffix) => file.endsWith(suffix),
        ),
      );
      // No shell runs this: lint-staged splits it with string-argv, which has no escapes inside
      // quotes. Double-quote each path; a path holding `"` cannot be quoted, so check everything.
      if (fullCheck || files.some((file) => file.includes('"')) || needsFullCheck())
        return "vp check";
      return `vp check --fix ${files.map((file) => `"${file}"`).join(" ")}`;
    },
  },
  fmt: {},
  pack: {
    entry: "electron/main.ts",
    outDir: "dist-electron",
    deps: { neverBundle: ["electron"] },
    format: "esm",
    platform: "node",
    // platform "node" otherwise forces .mjs; package.json "main" names main.js.
    fixedExtension: false,
  },
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
  lint: {
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      "./lint/module-fences.js",
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "module-fences/no-cross-zone": "error",
    },
    plugins: ["typescript", "unicorn", "oxc", "import", "react"],
    options: { typeAware: true, typeCheck: true },
    // A later override for the same rule replaces earlier options, so each override lists all its patterns.
    overrides: [
      {
        files: ["src/**"],
        rules: {
          "import/no-nodejs-modules": "error",
          "typescript/triple-slash-reference": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: electronPackage, message: electronMessage },
                {
                  group: ["zod", "zod/**"],
                  message:
                    "Event shapes live in src/shared/schema.ts; import its schemas instead of zod.",
                },
              ],
            },
          ],
        },
      },
      {
        files: ["src/shared/**"],
        rules: {
          "import/no-commonjs": "error",
          "typescript/triple-slash-reference": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: electronPackage, message: electronMessage },
                { group: browserLibs, message: browserMessage },
              ],
            },
          ],
        },
      },
      {
        files: ["collector/**"],
        rules: {
          "import/no-commonjs": "error",
          "typescript/triple-slash-reference": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: browserLibs, message: browserMessage },
                { group: electronPackage, message: collectorElectronMessage },
              ],
            },
          ],
        },
      },
      {
        files: ["electron/**"],
        rules: {
          "import/no-commonjs": "error",
          "no-restricted-imports": [
            "error",
            { patterns: [{ group: browserLibs, message: electronBrowserMessage }] },
          ],
        },
      },
      // The mock must replay identically for a seed, so wall-clock and unseeded randomness are banned in it.
      {
        files: ["src/data/mock.ts", "src/data/mock.test.ts", "src/data/mock__wiring_*.ts"],
        rules: {
          "no-restricted-globals": [
            "error",
            {
              name: "Date",
              message:
                "The mock must stay deterministic; use the sim-time `ts` instead of Date (wall-clock time).",
            },
            {
              name: "crypto",
              message:
                "The mock must stay deterministic; crypto draws OS randomness, derive ids and values from the seeded PRNG.",
            },
          ],
          "no-restricted-properties": [
            "error",
            {
              object: "Math",
              property: "random",
              message:
                "The mock must stay deterministic; use the seeded PRNG instead of Math.random.",
            },
            {
              object: "performance",
              property: "now",
              message:
                "The mock must stay deterministic; performance.now reads wall-clock time, use the sim-time `ts`.",
            },
            {
              object: "performance",
              property: "timeOrigin",
              message:
                "The mock must stay deterministic; performance.timeOrigin reads wall-clock time, use the sim-time `ts`.",
            },
          ],
        },
      },
      // The .no-jsx sentinel extension makes every JSX-bearing file an error, keeping collector/ and src/shared/ JSX-free.
      {
        files: ["collector/**", "src/shared/**"],
        rules: { "react/jsx-filename-extension": ["error", { extensions: [".no-jsx"] }] },
      },
    ],
  },
});
