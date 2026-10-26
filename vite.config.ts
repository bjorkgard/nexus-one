import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const electronModules = ["electron", "electron/**", "**/electron", "**/electron/**"];
const electronPackage = ["electron", "electron/**"];
const collectorFolder = "(?i)^(\\./)?(\\.\\./)+collector(/|$)";
const electronFolder = "(?i)^(\\./)?(\\.\\./)+electron(/|$)";
// A `..` after a src/ segment, e.g. ../src/shared/../ui; must precede the negated src group.
const collectorEscape = "(^|/)src/(.*/)?\\.\\.(/|$)";
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
  "three-stdlib",
  "three-stdlib/**",
];

const collectorMessage =
  "src/ runs in the browser; Node-only code lives in collector/. Share data through src/shared types.";
const electronMessage =
  "src/ runs in the browser; Electron main and preload code lives in electron/.";
const collectorElectronMessage =
  "collector/ must load in plain Node (vp run dev) as well as Electron; keep Electron APIs in electron/.";
const browserMessage =
  "collector/ and src/shared/ must load in plain Node; React and Three code belongs in src/ui, src/world or src/sim.";
const relativeMessage =
  "src/shared/ is a flat leaf module: no `..` imports. Import siblings with `./`; move shared types into src/shared/.";
const srcFromCollectorMessage =
  "collector/ may import src/ only through src/shared; other src/ code belongs to the browser.";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  staged: {
    "*": "vp check --fix",
    // Function form: lint-staged would otherwise append the path and check only this file.
    "vite.config.ts": () => "vp check",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
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
              patterns: [
                { regex: collectorFolder, message: collectorMessage },
                { regex: electronFolder, message: electronMessage },
                { group: electronPackage, message: electronMessage },
              ],
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
                { regex: collectorFolder, message: collectorMessage },
                { regex: electronFolder, message: electronMessage },
                { group: electronPackage, message: electronMessage },
                { group: browserLibs, message: browserMessage },
                { regex: "(^|/)\\.\\.(/|$)", message: relativeMessage },
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
                { regex: collectorEscape, message: srcFromCollectorMessage },
                { group: browserLibs, message: browserMessage },
                { group: electronModules, message: collectorElectronMessage },
                {
                  group: ["**/src", "**/src/**", "!**/src/shared", "!**/src/shared/**"],
                  message: srcFromCollectorMessage,
                },
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
