import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";
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

const electronMessage =
  "src/ runs in the browser; Electron main and preload code lives in electron/.";
const collectorElectronMessage =
  "collector/ must load in plain Node (vp run dev) as well as Electron; keep Electron APIs in electron/.";
const browserMessage =
  "collector/ and src/shared/ must load in plain Node; React and Three code belongs in src/ui, src/world or src/sim.";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  staged: {
    // One entry, so the tasks never run concurrently. Function form: lint-staged would otherwise
    // append the paths and check only those files. Staging the config or the fence plugin changes
    // what every file is checked against, so those run the full check.
    "*": (files) => {
      // Paths are absolute; a same-named nested file only costs an unneeded full check.
      const fullCheck = files.some((file) =>
        ["/vite.config.ts", "/lint/module-fences.js"].some((suffix) => file.endsWith(suffix)),
      );
      // No shell runs this: lint-staged splits it with string-argv, which has no escapes inside
      // quotes. Double-quote each path; a path holding `"` cannot be quoted, so check everything.
      if (fullCheck || files.some((file) => file.includes('"'))) return "vp check";
      return `vp check --fix ${files.map((file) => `"${file}"`).join(" ")}`;
    },
  },
  fmt: {},
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
              patterns: [{ group: electronPackage, message: electronMessage }],
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
      // The .no-jsx sentinel extension makes every JSX-bearing file an error, keeping collector/ and src/shared/ JSX-free.
      {
        files: ["collector/**", "src/shared/**"],
        rules: { "react/jsx-filename-extension": ["error", { extensions: [".no-jsx"] }] },
      },
    ],
  },
});
