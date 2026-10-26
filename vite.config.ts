import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

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
    "*": "vp check --fix",
    // Function form: lint-staged would otherwise append the path and check only this file.
    "vite.config.ts": () => "vp check",
  },
  fmt: {},
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
