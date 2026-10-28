import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";
import config from "../vite.config.ts";
import plugin from "./module-fences.js";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (relative) => path.join(repoRoot, relative);

const tester = new RuleTester({
  languageOptions: { sourceType: "module", parserOptions: { lang: "ts" } },
});

const fromUi = at("src/ui/a.ts");
const fromShared = at("src/shared/a.ts");
const fromCollector = at("collector/a.ts");

// Must match the messages in module-fences.js.
const SHARED = "src/shared/ is a leaf module: it may import only other src/shared/ files.";
const SRC =
  "src/ may import only other src/ files; Node-only code belongs in collector/ and Electron code in electron/.";
const COLLECTOR =
  "collector/ may import only collector/ and src/shared/ files; other src/ code belongs to the browser.";
const NON_STATIC =
  "Non-static import in a fenced zone; use a string literal so the module fence can check it.";
const GLOB =
  "import.meta.glob in a fenced zone must use relative or root-absolute patterns and no `base` option.";
const GLOB_OPTIONS = "glob options must be a literal object without `base`.";
const CREATE_REQUIRE = "createRequire is banned in collector/; it would bypass the module fence.";

const bad = (filename, code, message) => ({ filename, code, errors: [{ message }] });
const good = (filename, code) => ({ filename, code });

// A symlink inside src/ that points at collector/: the realpath check must see through it.
const linkPath = at("src/ui/__fence_link__");
const cleanup = (...paths) => {
  for (const p of paths) fs.rmSync(p, { force: true, recursive: true });
};
beforeAll(() => {
  cleanup(linkPath);
  fs.symlinkSync("../../collector", linkPath, "dir");
});
afterAll(() => cleanup(linkPath));

tester.run("no-cross-zone", plugin.rules["no-cross-zone"], {
  valid: [
    // src/ui, src/data and the rest of src/
    good(fromUi, 'import x from "../shared/x";'),
    good(fromUi, 'import x from "./y";'),
    good(fromUi, 'import x from "../../src/data/z";'),
    good(fromUi, 'import x from "react";'),
    // root package.json is JSON only, allowed from every zone
    good(fromUi, 'import pkg from "../../package.json";'),
    good(fromShared, 'import pkg from "../../package.json";'),
    good(fromCollector, 'import pkg from "../package.json";'),
    good(fromUi, 'import fs from "node:fs";'),
    good(fromUi, "export const a = 1;"),
    good(fromUi, "const a = 1; export { a };"),
    good(fromUi, 'new URL("./x.ts", import.meta.url);'),
    good(fromUi, 'new URL("https://example.com/x", import.meta.url);'),
    good(fromUi, "new URL(name);"),
    good(fromUi, 'const m = import.meta.glob("./*.ts");'),
    good(fromUi, 'const m = import.meta.glob("./*.ts", { eager: true });'),
    good(fromUi, 'const m = import.meta.glob("../shared/*.ts");'),
    good(fromUi, 'const m = import.meta.glob("/src/ui/*.ts");'),
    good(fromUi, 'const m = import.meta.glob(["./a/*.ts", "!./b/**"]);'),
    good(fromUi, 'import x from "/src/data/z";'),
    // `!` excludes cannot add files; root-absolute `/x` is served from public/
    good(fromUi, 'const m = import.meta.glob(["./dir/*.ts", "!**/bar.ts"]);'),
    good(fromUi, 'const m = import.meta.glob(["./dir/*.ts", "!../../collector/**"]);'),
    good(fromUi, 'import logo from "/logo.svg";'),
    good(fromUi, 'import x from "/assets/x.png";'),
    good(fromUi, 'import x from "/assets/x.png?url";'),
    good(at("src/data/a.ts"), 'import x from "./collector";'),
    // src/shared
    good(at("src/shared/sub/a.ts"), 'import x from "../x";'),
    good(fromShared, 'import x from "./y";'),
    // collector
    good(fromCollector, 'import x from "../src/shared/x";'),
    good(fromCollector, 'import x from "../src/shared";'),
    good(fromCollector, 'import x from "./a/../helper";'),
    good(fromCollector, 'import fs from "node:fs";'),
    good(fromCollector, 'import { createHash } from "node:crypto";'),
    // outside zones: unchecked
    good(at("electron/a.ts"), 'import x from "../collector/x";'),
    good(at("electron/a.ts"), 'import x from "../src/ui/x";'),
    good(at("electron/a.ts"), "import(name);"),
    good(at("vite.config.ts"), 'import x from "./collector/x";'),
    good(at("vite.config.ts"), 'import x from "./src/ui/x";'),
    good(at("lint/a.js"), 'import x from "../src/ui/x";'),
  ],
  invalid: [
    // allow-list: src/ may import only src/
    bad(fromUi, 'import x from "../../collector/x";', SRC),
    bad(fromUi, 'import x from "../.././collector/x";', SRC),
    bad(fromUi, 'import x from "..//../collector/x";', SRC),
    bad(fromUi, 'import x from "../../src/../collector/x";', SRC),
    bad(fromUi, 'import x from "../../Collector/x";', SRC),
    bad(fromUi, 'import x from "../../electron/x";', SRC),
    bad(fromUi, 'export * from "../../collector/x";', SRC),
    bad(fromUi, 'export { a } from "../../collector/x";', SRC),
    bad(fromUi, 'import("../../collector/x");', SRC),
    bad(fromUi, "import(`../../collector/x`);", SRC),
    bad(fromUi, 'require("../../collector/x");', SRC),
    bad(fromUi, 'export type T = typeof import("../../collector/x");', SRC),
    bad(fromUi, 'import x from "../../lint/x";', SRC),
    bad(fromUi, 'import x from "../../collector-utils/x";', SRC),
    bad(fromUi, 'import x from "../../../../outside/x";', SRC),
    bad(fromUi, 'import x from "/collector/x";', SRC),
    // bypass 1: query suffix
    bad(fromUi, 'import W from "../../collector?worker&inline";', SRC),
    bad(fromUi, 'import W from "../../collector/x.ts?worker&inline";', SRC),
    bad(fromUi, 'import W from "../../collector/x.ts?/../../src/ui/y?worker";', SRC),
    bad(fromUi, 'import W from "../../collector/x.ts#/../../src/ui/y";', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts?/../../src/ui/y", import.meta.url);', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta.url);', SRC),
    // bypass 2: laundering through a root file
    bad(fromUi, 'import x from "../../launder";', SRC),
    bad(fromUi, 'import x from "../../vite.config";', SRC),
    bad(fromUi, 'import x from "../../package.json.bak";', SRC),
    // bypass 3: glob prefix above the zone
    bad(fromUi, 'const m = import.meta.glob("../../*/x.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("../../{collector,x}/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("../../**/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("../../collector/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob(["../../collector/a.ts"]);', SRC),
    bad(fromUi, 'const m = import.meta.glob("./**/../../../collector/*.ts");', GLOB),
    // bypass 4: glob base option, root-absolute glob
    bad(fromUi, 'const m = import.meta.glob("./*.ts", { base: "../../collector" });', GLOB),
    bad(fromUi, 'const m = import.meta.glob("./*.ts", { "base": "../../collector" });', GLOB),
    bad(fromUi, 'const m = import.meta.glob("./*.ts", { ...opts });', GLOB_OPTIONS),
    bad(fromUi, 'const m = import.meta.glob("./*.ts", opts);', GLOB_OPTIONS),
    bad(fromUi, 'const m = import.meta.glob("!./*.ts", { base: "../../collector" });', GLOB),
    bad(fromUi, 'import x from "/public/../collector/x";', SRC),
    bad(fromUi, 'const m = import.meta.glob("/collector/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("*.ts");', GLOB),
    bad(fromUi, 'const m = import.meta.glob("react/*.ts");', GLOB),
    // bypass 6: non-static specifiers
    bad(fromUi, 'import("../../collector/x" + ".ts");', NON_STATIC),
    bad(fromUi, 'import(import.meta.resolve("../../collector/x.ts"));', NON_STATIC),
    bad(fromUi, "import(name);", NON_STATIC),
    bad(fromUi, "import(`./${name}`);", NON_STATIC),
    bad(fromUi, "require(name);", NON_STATIC),
    bad(fromUi, "const m = import.meta.glob(pattern);", NON_STATIC),
    bad(fromUi, 'const m = import.meta.glob(["./a/*.ts", pattern]);', NON_STATIC),
    bad(fromUi, "new URL(name, import.meta.url);", NON_STATIC),
    bad(fromCollector, "import(name);", NON_STATIC),
    bad(fromShared, "import(name);", NON_STATIC),
    // allow-list: src/shared may import only src/shared
    bad(fromShared, 'import x from "../ui/x";', SHARED),
    bad(fromShared, 'import x from "./../ui/x";', SHARED),
    bad(fromShared, 'import x from "../App";', SHARED),
    bad(fromShared, 'import x from "../../../outside/x";', SHARED),
    bad(fromShared, 'import x from "../../collector/x";', SHARED),
    bad(fromShared, 'import x from "../shared-utils/x";', SHARED),
    // allow-list: collector may import collector and src/shared
    bad(fromCollector, 'import x from "../src/ui/x";', COLLECTOR),
    bad(fromCollector, 'import x from "../src/shared/../ui/x";', COLLECTOR),
    bad(fromCollector, 'import x from "../Src/shared/../ui/x";', COLLECTOR),
    bad(fromCollector, 'import x from "../src";', COLLECTOR),
    bad(fromCollector, 'import x from "../src/App";', COLLECTOR),
    bad(fromCollector, 'import x from "../../outside/x";', COLLECTOR),
    // bypass 5: collector reaching electron/ (and other root folders)
    bad(fromCollector, 'export * from "../electron/x";', COLLECTOR),
    bad(fromCollector, 'import x from "../electron/x";', COLLECTOR),
    bad(fromCollector, 'import x from "../lint/x";', COLLECTOR),
    // bypass 7: createRequire in collector
    bad(
      fromCollector,
      'import { createRequire } from "node:module"; export const r = createRequire(import.meta.url);',
      CREATE_REQUIRE,
    ),
    bad(
      fromCollector,
      'import { createRequire as cr } from "module"; export const r = cr(import.meta.url);',
      CREATE_REQUIRE,
    ),
    bad(
      fromCollector,
      'import * as m from "node:module"; export const r = m.createRequire(import.meta.url);',
      CREATE_REQUIRE,
    ),
    // symlink inside src/ pointing at collector/
    bad(fromUi, 'import x from "./__fence_link__/x";', SRC),
  ],
});

// Runs the real linter with this repo's config. Fixtures live as .txt under lint/fixtures/
// (out of `vp check` scope); each is copied into a zone path for the run and removed after.
describe("module-fences wiring", () => {
  const configRows = [
    ["shared-react.txt", "src/shared/__wiring_react.ts", "eslint(no-restricted-imports)"],
    [
      "collector-electron.txt",
      "collector/__wiring_electron.ts",
      "eslint(no-restricted-imports)",
      "collector/ must load in plain Node",
    ],
    ["ui-node-fs.txt", "src/ui/__wiring_node_fs.ts", "import(no-nodejs-modules)"],
    ["collector-require.txt", "collector/__wiring_require.ts", "import(no-commonjs)"],
    ["shared-jsx.txt", "src/shared/__wiring_jsx.tsx", "react(jsx-filename-extension)"],
    ["ui-triple-slash.txt", "src/ui/__wiring_triple.ts", "typescript(triple-slash-reference)"],
    [
      "ui-zod.txt",
      "src/ui/__wiring_zod.ts",
      "eslint(no-restricted-imports)",
      "Event shapes live in src/shared/schema.ts",
    ],
  ];
  const copies = [
    at("src/ui/__wiring_bad.ts"),
    at("src/ui/__wiring_clean.ts"),
    ...configRows.map(([, zonePath]) => at(zonePath)),
  ];
  beforeAll(() => cleanup(...copies));
  const lint = (fixture, zonePath) => {
    const target = at(zonePath);
    fs.copyFileSync(path.join(repoRoot, "lint/fixtures", fixture), target);
    const result = spawnSync(path.join(repoRoot, "node_modules/.bin/vp"), ["lint", target], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 55_000,
    });
    // A null status means the run timed out or never started.
    if (result.status === null) {
      throw new Error(`vp lint did not finish: ${result.error ?? ""}${result.stderr}`);
    }
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };
  afterAll(() => cleanup(...copies));

  it("reports module-fences(no-cross-zone) for a cross-zone import", () => {
    const { status, output } = lint("cross-zone.txt", "src/ui/__wiring_bad.ts");
    expect(output).toContain("module-fences(no-cross-zone)");
    expect(status).not.toBe(0);
  }, 60_000);

  it("exits 0 for a clean file", () => {
    const { status, output } = lint("clean.txt", "src/ui/__wiring_clean.ts");
    expect(output).not.toContain("module-fences");
    expect(status).toBe(0);
  }, 60_000);

  // Value: protects=vite.config.ts fence overrides stay wired to their zones; fails_when=a rule, its zone glob or its message is removed or misrouted; why_new=RuleTester covers only the module-fences plugin; seam=none; no_claim=rule behaviour beyond one violating fixture per rule
  it.each(configRows)(
    "reports %s -> %s",
    (fixture, zonePath, ruleId, message) => {
      const { status, output } = lint(fixture, zonePath);
      expect(output).toContain(ruleId);
      if (message) expect(output).toContain(message);
      expect(status).not.toBe(0);
    },
    60_000,
  );
});

// Copied from string-argv 0.3.2, as inlined in node_modules/vite-plus/dist/staged/bin.js
// (parseArgsStringToArgv). lint-staged 17 splits function-returned commands with it, with no shell.
function parseArgsStringToArgv(value) {
  const myRegexp = /([^\s'"]([^\s'"]*(['"])([^\3]*?)\3)+[^\s'"]*)|[^\s'"]+|(['"])([^\5]*?)\5/gi;
  const result = [];
  let match;
  do {
    match = myRegexp.exec(value);
    if (match !== null)
      result.push([match[1], match[6], match[0]].find((a) => typeof a === "string"));
  } while (match !== null);
  return result;
}

// Value: protects=pre-commit runs the full check when the config or fence plugin is staged, and quotes paths safely; fails_when=the staged function stops escalating or stops escaping quotes; why_new=staged function had no test; seam=none; no_claim=lint-staged invocation itself
describe("staged function", () => {
  const staged = config.staged["*"];
  it("runs the full check when vite.config.ts is staged", () => {
    expect(staged([at("src/a.ts"), at("vite.config.ts")])).toBe("vp check");
  });
  it("runs the full check when lint/module-fences.js is staged", () => {
    expect(staged([at("lint/module-fences.js")])).toBe("vp check");
  });
  it("double-quotes each path so lint-staged's string-argv gives back the original paths", () => {
    const paths = [at("src/a.ts"), at("src/with space.ts"), at("src/it's.ts")];
    expect(parseArgsStringToArgv(staged(paths))).toEqual(["vp", "check", "--fix", ...paths]);
  });
  it("falls back to the full check for a path with a double quote", () => {
    expect(staged([at("src/a.ts"), at('src/say"hi.ts')])).toBe("vp check");
  });
});
