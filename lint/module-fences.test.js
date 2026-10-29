import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";
import config from "../vite.config.ts";
import plugin, { ROOT_ENTRIES } from "./module-fences.js";

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
const fromElectron = at("electron/a.ts");

// Must match the messages in module-fences.js.
const SHARED = "src/shared/ is a leaf module: it may import only other src/shared/ files.";
const SRC =
  "src/ may import only other src/ files; Node-only code belongs in collector/ and Electron code in electron/.";
const COLLECTOR =
  "collector/ may import only collector/ and src/shared/ files; other src/ code belongs to the browser.";
const ELECTRON =
  "electron/ may import only electron/ and src/shared/; renderer code stays in src/.";
const NON_STATIC =
  "Non-static import in a fenced zone; use a string literal so the module fence can check it.";
const GLOB =
  "import.meta.glob in a fenced zone must use relative or root-absolute patterns without `#`, and no `base` option.";
const GLOB_OPTIONS = "glob options must be a literal object without `base`.";
const CREATE_REQUIRE = "createRequire is banned in collector/; it would bypass the module fence.";
const ELECTRON_CREATE_REQUIRE =
  "createRequire is banned in electron/; it would bypass the module fence.";
const outsideRepo = (file) =>
  `${file} is outside the repo root, so the module fence cannot place it in a zone.`;

const bad = (filename, code, message) => ({ filename, code, errors: [{ message }] });
const good = (filename, code) => ({ filename, code });

// Symlinks the realpath check must see through; all are removed again after the run.
const linkPath = at("src/ui/__fence_link__");
const outLinkPath = at("src/ui/__fence_out_link__");
const fileLinkPath = at("src/ui/__fence_file_link__.ts");
const dirLinkPath = at("collector/__fence_dir_link__");
const fileLinkTarget = at("collector/__fence_file_target__.ts");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fence-out-"));
const cleanup = (...paths) => {
  for (const p of paths) fs.rmSync(p, { force: true, recursive: true });
};
const idxDir = at("src/ui/__fence_idx_dir");
const sibDir = at("src/ui/__fence_sib_dir");
const sibLink = at("src/ui/__fence_sib_dir.ts");
const okDir = at("src/ui/__fence_ok_dir");
const nfDir = at("src/ui/__fence_nf.mjs");
const nfLink = at("src/ui/__fence_nf.ts");
const nfiDir = at("src/ui/__fence_nfi");
const globIdxDir = at("collector/__fence_glob_idx");
const globSibDir = at("collector/__fence_glob_sib");
const globSibLink = at("collector/__fence_glob_sib.ts");
const globInIdx = at("src/ui/__fence_glob_in_idx");
const globInAny = at("src/ui/__fence_glob_in_any");
const globMixDir = at("src/ui/__fence_glob_mix");
const globWalkDir = at("src/ui/__fence_glob_walk");
const fenceScratch = [
  globMixDir,
  globWalkDir,
  globInIdx,
  globInAny,
  globIdxDir,
  globSibDir,
  globSibLink,
  nfDir,
  nfLink,
  nfiDir,
  linkPath,
  outLinkPath,
  fileLinkPath,
  dirLinkPath,
  fileLinkTarget,
  idxDir,
  sibDir,
  sibLink,
  okDir,
];
beforeAll(() => {
  cleanup(...fenceScratch);
  fs.symlinkSync("../../collector", linkPath, "dir");
  fs.symlinkSync(outDir, outLinkPath, "dir");
  fs.writeFileSync(fileLinkTarget, "export const a = 1;\n");
  fs.symlinkSync("../../collector/__fence_file_target__.ts", fileLinkPath, "file");
  fs.symlinkSync("../src/ui", dirLinkPath, "dir");
  // real directories whose index file, or sibling file, is a symlink into collector/
  fs.mkdirSync(idxDir);
  fs.symlinkSync(
    "../../../collector/__fence_file_target__.ts",
    path.join(idxDir, "index.ts"),
    "file",
  );
  fs.mkdirSync(sibDir);
  fs.symlinkSync("../../collector/__fence_file_target__.ts", sibLink, "file");
  // directories named like probe candidates: not files, so the symlink behind them still wins
  fs.mkdirSync(nfDir);
  fs.symlinkSync("../../collector/__fence_file_target__.ts", nfLink, "file");
  fs.mkdirSync(path.join(nfiDir, "index.js"), { recursive: true });
  fs.symlinkSync(
    "../../../collector/__fence_file_target__.ts",
    path.join(nfiDir, "index.ts"),
    "file",
  );
  fs.mkdirSync(okDir);
  fs.writeFileSync(path.join(okDir, "index.ts"), "export const a = 1;\n");
  // collector/ directories whose index file, or sibling file, is a symlink into src/shared/
  fs.mkdirSync(globIdxDir);
  fs.writeFileSync(path.join(globIdxDir, "a.ts"), "export const a = 1;\n");
  fs.symlinkSync("../../src/shared/schema.ts", path.join(globIdxDir, "index.ts"), "file");
  fs.mkdirSync(globSibDir);
  fs.writeFileSync(path.join(globSibDir, "a.ts"), "export const a = 1;\n");
  fs.symlinkSync("../src/shared/schema.ts", globSibLink, "file");
  // src/ directories a glob searches, holding a file symlink into collector/
  fs.mkdirSync(globInIdx);
  fs.symlinkSync(
    "../../../collector/__fence_file_target__.ts",
    path.join(globInIdx, "index.ts"),
    "file",
  );
  fs.mkdirSync(globInAny);
  fs.writeFileSync(path.join(globInAny, "a.ts"), "export const a = 1;\n");
  fs.symlinkSync(
    "../../../collector/__fence_file_target__.ts",
    path.join(globInAny, "c.ts"),
    "file",
  );
  // Value: protects=a glob match is fenced only when it is a regular file; fails_when=a directory link or dangling link match is reported, or a link inside a searched folder is missed; why_new=the in_idx/in_any rows only cover file symlinks matched directly; seam=none; no_claim=Vite's own glob walk (checked against node:fs globSync only)
  fs.mkdirSync(globMixDir);
  fs.writeFileSync(path.join(globMixDir, "a.ts"), "export const a = 1;\n");
  fs.symlinkSync("../../../collector", path.join(globMixDir, "linkdir"), "dir");
  fs.symlinkSync("./__fence_nowhere__.ts", path.join(globMixDir, "dead.ts"), "file");
  fs.mkdirSync(globWalkDir);
  fs.symlinkSync("../../../collector", path.join(globWalkDir, "linkdir"), "dir");
});
afterAll(() => {
  cleanup(...fenceScratch);
  cleanup(outDir);
});

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
    // src/ui/ holds this suite's collector/ symlinks and every match is fenced, so globs search a clean folder
    good(fromUi, 'const m = import.meta.glob("./__fence_ok_dir/*.ts");'),
    good(fromUi, 'const m = import.meta.glob("./__fence_ok_dir/*.ts", { eager: true });'),
    good(fromUi, 'const m = import.meta.glob("../shared/*.ts");'),
    good(fromUi, 'const m = import.meta.glob("/src/ui/__fence_ok_dir/*.ts");'),
    good(fromUi, 'const m = import.meta.glob(["./a/*.ts", "!./b/**"]);'),
    good(fromUi, 'import x from "/src/data/z";'),
    // `!` excludes cannot add files; root-absolute `/x` is served from public/
    good(fromUi, 'const m = import.meta.glob(["./dir/*.ts", "!**/bar.ts"]);'),
    good(fromUi, 'const m = import.meta.glob(["./dir/*.ts", "!../../collector/**"]);'),
    good(fromUi, 'import logo from "/logo.svg";'),
    // a directory match and a dangling link are not files, so a glob does not fence them
    good(fromUi, 'const m = import.meta.glob("./__fence_glob_mix/linkd*");'),
    good(fromUi, 'const m = import.meta.glob("./__fence_glob_mix/dead.*");'),
    // a root-absolute glob under no root entry is a public/ URL pattern, never read from disk
    good(fromUi, 'const m = import.meta.glob("/assets/*.png");'),
    good(fromUi, 'import x from "/assets/x.png";'),
    good(fromUi, 'import x from "/assets/x.png?url";'),
    // a real directory with a same-zone index still passes
    good(fromUi, 'import x from "./__fence_ok_dir";'),
    // symlinked importer directory: relative specifiers resolve from the real directory
    good(at("collector/__fence_dir_link__/a.ts"), 'import x from "../shared/x";'),
    // import.meta bracket forms and resolve
    good(fromUi, 'new URL("./x.ts", import.meta["url"]);'),
    good(fromUi, 'import.meta.resolve("./x.ts");'),
    good(fromUi, 'import.meta["resolve"]("./x.ts");'),
    good(fromUi, 'import.meta["glob"]("./__fence_ok_dir/*.ts");'),
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
    // electron
    good(fromElectron, 'import x from "./y";'),
    good(fromElectron, 'import x from "../src/shared/x";'),
    good(fromElectron, 'import pkg from "../package.json";'),
    good(fromElectron, 'import { app } from "electron";'),
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
    // root-absolute: fixed root entries (case-insensitive), entry stems, `/`, and escapes
    bad(fromUi, 'import x from "/dist/x";', SRC),
    bad(fromUi, 'import x from "/Collector/x";', SRC),
    bad(fromUi, 'import x from "/vite.config";', SRC),
    bad(fromUi, 'import x from "/playwright.config";', SRC),
    bad(fromUi, 'import x from "/";', SRC),
    bad(fromUi, 'import x from "/index";', SRC),
    bad(fromUi, 'import x from "/readme";', SRC),
    bad(fromUi, 'import x from "/.claude/worktrees/x/collector/x";', SRC),
    bad(fromUi, 'import x from "/.git/x";', SRC),
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
    // Vite keeps `#` in a glob and joins it raw, so `a#/..` climbs where the fence cannot follow
    bad(fromUi, 'const m = import.meta.glob("./a#/../../electron/*.ts");', GLOB),
    bad(fromUi, 'const m = import.meta.glob("./__fence_ok_dir/*.ts#x");', GLOB),
    // bypass 4: glob base option, root-absolute glob
    bad(
      fromUi,
      'const m = import.meta.glob("./__fence_ok_dir/*.ts", { base: "../../collector" });',
      GLOB,
    ),
    bad(
      fromUi,
      'const m = import.meta.glob("./__fence_ok_dir/*.ts", { "base": "../../collector" });',
      GLOB,
    ),
    bad(fromUi, 'const m = import.meta.glob("./__fence_ok_dir/*.ts", { ...opts });', GLOB_OPTIONS),
    bad(fromUi, 'const m = import.meta.glob("./__fence_ok_dir/*.ts", opts);', GLOB_OPTIONS),
    bad(fromUi, 'const m = import.meta.glob("!./*.ts", { base: "../../collector" });', GLOB),
    bad(fromUi, 'import x from "/public/../collector/x";', SRC),
    bad(fromUi, 'const m = import.meta.glob("/collector/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("*.ts");', GLOB),
    bad(fromUi, 'const m = import.meta.glob("react/*.ts");', GLOB),
    // bypass 6: non-static specifiers
    bad(fromUi, 'import("../../collector/x" + ".ts");', NON_STATIC),
    {
      filename: fromUi,
      code: 'import(import.meta.resolve("../../collector/x.ts"));',
      errors: [{ message: NON_STATIC }, { message: SRC }],
    },
    bad(fromUi, 'import.meta.resolve("../../collector/x.ts");', SRC),
    bad(fromUi, "import.meta.resolve(name);", NON_STATIC),
    bad(fromUi, 'import.meta["resolve"]("../../collector/x.ts");', SRC),
    bad(fromUi, 'import.meta["resolve"](name);', NON_STATIC),
    bad(fromUi, 'import.meta["glob"]("../../collector/*.ts");', SRC),
    bad(fromUi, 'import.meta["glob"]("*.ts");', GLOB),
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta["url"]);', SRC),
    bad(fromUi, 'import.meta[key]("./x.ts");', NON_STATIC),
    bad(fromUi, 'new URL("./x.ts", import.meta[key]);', NON_STATIC),
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
    // allow-list: electron may import electron and src/shared
    bad(fromElectron, 'import x from "../src/ui/x";', ELECTRON),
    bad(fromElectron, 'import x from "../collector/x";', ELECTRON),
    bad(fromElectron, 'import x from "../src/shared/../ui/x";', ELECTRON),
    bad(fromElectron, "import(name);", NON_STATIC),
    // createRequire in electron
    bad(
      fromElectron,
      'import { createRequire } from "node:module"; export const r = createRequire(import.meta.url);',
      ELECTRON_CREATE_REQUIRE,
    ),
    bad(
      fromElectron,
      'import * as m from "node:module"; export const r = m.createRequire(import.meta.url);',
      ELECTRON_CREATE_REQUIRE,
    ),
    // symlink inside src/ pointing at collector/
    bad(fromUi, 'import x from "./__fence_link__/x";', SRC),
    // root-absolute import through a symlink that leaves the repo
    bad(fromUi, 'import x from "/src/ui/__fence_out_link__/x";', SRC),
    // extensionless import of a file symlink: probes .ts and resolves through the link
    bad(fromUi, 'import x from "./__fence_file_link__";', SRC),
    // existing directory whose index file is a symlink into collector/
    bad(fromUi, 'import x from "./__fence_idx_dir";', SRC),
    // existing directory with a sibling file symlink: the file wins over the directory
    bad(fromUi, 'import x from "./__fence_sib_dir";', SRC),
    // a directory named like a probe candidate is skipped; the later file symlink resolves
    bad(fromUi, 'import x from "./__fence_nf";', SRC),
    bad(fromUi, 'import x from "./__fence_nfi";', SRC),
    // a glob prefix is the directory searched, never probed to its index or sibling file
    bad(fromUi, 'const m = import.meta.glob("../../collector/__fence_glob_idx/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("../../collector/__fence_glob_sib/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("/collector/__fence_glob_idx/*.ts");', SRC),
    // a file the glob matches is fenced by its real path, whatever its name
    bad(fromUi, 'const m = import.meta.glob("./__fence_glob_in_idx/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("./__fence_glob_in_any/*.ts");', SRC),
    bad(fromUi, 'const m = import.meta.glob("/src/ui/__fence_glob_in_any/**/*.ts");', SRC),
    // a directory link inside the searched folder leads the walk into collector/
    bad(fromUi, 'const m = import.meta.glob("./__fence_glob_walk/**/*.ts");', SRC),
    // symlinked importer directory: the real directory is src/ui
    bad(at("collector/__fence_dir_link__/a.ts"), 'import x from "../../collector/x";', SRC),
    // importer outside the repo root
    {
      filename: path.join(repoRoot, "..", "fence-outside.ts"),
      code: "export const a = 1;",
      errors: [{ message: outsideRepo(path.join(repoRoot, "..", "fence-outside.ts")) }],
    },
  ],
});

// Runs the real linter with this repo's config. Fixtures live as .txt under lint/fixtures/
// (out of `vp check` scope); each is copied into a zone path for the run and removed after.
describe("module-fences wiring", () => {
  const configRows = [
    ["shared-react.txt", "src/shared/__wiring_react.ts", "eslint(no-restricted-imports)"],
    [
      "shared-react.txt",
      "collector/__wiring_react.ts",
      "eslint(no-restricted-imports)",
      "collector/ and src/shared/ must load in plain Node",
    ],
    [
      "collector-electron.txt",
      "src/ui/__wiring_electron.ts",
      "eslint(no-restricted-imports)",
      "src/ runs in the browser",
    ],
    [
      "shared-react-type.txt",
      "src/shared/__wiring_react_type.ts",
      "eslint(no-restricted-imports)",
      "collector/ and src/shared/ must load in plain Node",
    ],
    [
      "shared-react-jsx-runtime.txt",
      "src/shared/__wiring_react_jsx_runtime.ts",
      "eslint(no-restricted-imports)",
      "collector/ and src/shared/ must load in plain Node",
    ],
    [
      "collector-electron.txt",
      "collector/__wiring_electron.ts",
      "eslint(no-restricted-imports)",
      "collector/ must load in plain Node",
    ],
    [
      "electron-react.txt",
      "electron/__wiring_react.ts",
      "eslint(no-restricted-imports)",
      "electron/ runs in the main process",
    ],
    ["electron-require.txt", "electron/__wiring_require.ts", "import(no-commonjs)"],
    [
      "electron-ui.txt",
      "electron/__wiring_ui.ts",
      "module-fences(no-cross-zone)",
      "electron/ may import only electron/ and src/shared/",
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
    [
      "ui-zod-subpath.txt",
      "src/ui/__wiring_zod_subpath.ts",
      "eslint(no-restricted-imports)",
      "Event shapes live in src/shared/schema.ts",
    ],
    [
      "mock-nondeterminism.txt",
      "src/data/mock__wiring_date.ts",
      "eslint(no-restricted-globals)",
      "The mock must stay deterministic; use the sim-time `ts`",
    ],
    [
      "mock-nondeterminism.txt",
      "src/data/mock__wiring_random.ts",
      "eslint(no-restricted-properties)",
      "The mock must stay deterministic; use the seeded PRNG",
    ],
    [
      "mock-nondeterminism.txt",
      "src/data/mock__wiring_perf.ts",
      "eslint(no-restricted-properties)",
      "performance.now reads wall-clock time",
    ],
    [
      "mock-nondeterminism.txt",
      "src/data/mock__wiring_crypto.ts",
      "eslint(no-restricted-globals)",
      "crypto draws OS randomness",
    ],
    [
      "mock-nondeterminism.txt",
      "src/data/mock__wiring_time_origin.ts",
      "eslint(no-restricted-properties)",
      "performance.timeOrigin reads wall-clock time",
    ],
  ];
  // Pinned semantics: a bare `import("react")` type query is not matched by no-restricted-imports.
  const importTypePath = "src/shared/__wiring_react_import_type.ts";
  const copies = [
    at("src/ui/__wiring_bad.ts"),
    at("src/ui/__wiring_clean.ts"),
    at(importTypePath),
    ...configRows.map(([, zonePath]) => at(zonePath)),
  ];
  beforeAll(() => cleanup(...copies));
  const lint = (fixture, zonePath) => {
    const target = at(zonePath);
    fs.copyFileSync(path.join(repoRoot, "lint/fixtures", fixture), target);
    // Pin the format: on GitHub Actions the linter switches to `github`, which drops custom messages.
    const result = spawnSync(
      path.join(repoRoot, "node_modules/.bin/vp"),
      ["lint", "--format=default", target],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 55_000,
      },
    );
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

  it('does not report an import("react") type query in src/shared (pinned semantics)', () => {
    const { status, output } = lint("shared-react-import-type.txt", importTypePath);
    expect(output).not.toContain("no-restricted-imports");
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
  it.each(["tsconfig.json", "collector/tsconfig.json", "package.json"])(
    "runs the full check when %s is staged",
    (file) => {
      expect(staged([at("src/a.ts"), at(file)])).toBe("vp check");
    },
  );
  it("double-quotes each path so lint-staged's string-argv gives back the original paths", () => {
    const paths = [at("src/a.ts"), at("src/with space.ts"), at("src/it's.ts")];
    expect(parseArgsStringToArgv(staged(paths))).toEqual(["vp", "check", "--fix", ...paths]);
  });
  it("falls back to the full check for a path with a double quote", () => {
    expect(staged([at("src/a.ts"), at('src/say"hi.ts')])).toBe("vp check");
  });
});

// Every root entry, and its name without the last extension, is fenced as a root-absolute first segment;
// `src` itself is the importer's own zone, so `/src/x` is allowed.
tester.run("no-cross-zone root entries", plugin.rules["no-cross-zone"], {
  valid: [],
  invalid: [
    ...new Set(
      [...ROOT_ENTRIES]
        .filter((entry) => entry !== "src")
        .flatMap((entry) => [`/${entry}/x`, `/${path.parse(entry).name}/x`]),
    ),
  ].map((specifier) => bad(fromUi, `import x from "${specifier}";`, SRC)),
});

// Value: protects=ROOT_ENTRIES covers every tracked root entry, so a new root folder cannot be reached by a root-absolute import; fails_when=a root entry is added to git without being added to ROOT_ENTRIES; why_new=the set is a fixed list that does not read the disk; seam=none; no_claim=untracked root entries
describe("ROOT_ENTRIES", () => {
  it("holds every git ls-files root entry, lower-cased", () => {
    const result = spawnSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ls-files failed (${result.status}): ${result.stderr}`);
    }
    const entries = new Set(
      result.stdout
        .split("\n")
        .filter(Boolean)
        .map((f) => f.split("/")[0]),
    );
    expect(entries.size).toBeGreaterThan(0);
    const missing = [...entries].filter((entry) => !ROOT_ENTRIES.has(entry.toLowerCase()));
    expect(missing).toEqual([]);
  });
});

// Value: protects=scratch copies and fence links under src/ stay out of tsc (`vp run build`); fails_when=a copy path is no longer matched by a tsconfig exclude; why_new=a leftover copy only breaks the build, not pre-commit; seam=none; no_claim=tsc behaviour itself
describe("tsconfig exclude", () => {
  const parsed = ts.parseConfigFileTextToJson(
    "tsconfig.json",
    fs.readFileSync(at("tsconfig.json"), "utf8"),
  );
  const exclude = parsed.config.exclude;
  const scratch = [
    "src/ui/__wiring_bad.ts",
    "src/ui/__wiring_clean.ts",
    "src/shared/__wiring_react_import_type.ts",
    "src/data/mock__wiring_date.ts",
    "src/ui/__fence_link__",
    "src/ui/__fence_out_link__",
    "src/ui/__fence_file_link__.ts",
  ];
  it("parses with an exclude list", () => {
    expect(parsed.error).toBeUndefined();
    expect(Array.isArray(exclude)).toBe(true);
  });
  it.each(scratch)("excludes %s", (file) => {
    expect(exclude.some((pattern) => path.matchesGlob(file, pattern))).toBe(true);
  });
  it("excludes every wiring copy path under src/", () => {
    const wiringText = fs.readFileSync(new URL(import.meta.url), "utf8");
    const paths = [...wiringText.matchAll(/"(src\/[\w/]*__wiring_\w+\.tsx?)"/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(5);
    for (const file of paths) {
      expect(
        exclude.some((pattern) => path.matchesGlob(file, pattern)),
        file,
      ).toBe(true);
    }
  });
});
