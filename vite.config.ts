import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const collectorModules = ["**/collector", "**/collector/**"];
const electronModules = ["electron", "electron/**", "**/electron", "**/electron/**"];
const browserLibs = [
  "react",
  "react/**",
  "react-dom",
  "react-dom/**",
  "three",
  "three/**",
  "@react-three/**",
];

const collectorMessage =
  "src/ runs in the browser; Node-only code lives in collector/. Share data through src/shared types.";
const electronMessage =
  "src/ runs in the browser; Electron main and preload code lives in electron/.";
const browserMessage =
  "collector/ and src/shared/ must load in plain Node; React and Three code belongs in src/ui, src/world or src/sim.";
const relativeMessage =
  "src/shared/ is a leaf module; it must not import from other src/ folders. Move the shared type into src/shared.";
const srcFromCollectorMessage =
  "collector/ may import src/ only through src/shared; other src/ code belongs to the browser.";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    plugins: ["typescript", "unicorn", "oxc", "import", "react"],
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ["src/**"],
        rules: {
          "import/no-nodejs-modules": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: collectorModules, message: collectorMessage },
                { group: electronModules, message: electronMessage },
              ],
            },
          ],
        },
      },
      {
        files: ["src/shared/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: collectorModules, message: collectorMessage },
                { group: electronModules, message: electronMessage },
                { group: browserLibs, message: browserMessage },
                { regex: "^\\.\\./", message: relativeMessage },
              ],
            },
          ],
        },
      },
      {
        files: ["collector/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                { group: browserLibs, message: browserMessage },
                { group: electronModules, message: electronMessage },
                { group: ["**/src/**", "!**/src/shared/**"], message: srcFromCollectorMessage },
              ],
            },
          ],
        },
      },
      {
        files: ["collector/**", "src/shared/**"],
        rules: { "react/jsx-filename-extension": ["error", { extensions: [".no-jsx"] }] },
      },
    ],
  },
});
