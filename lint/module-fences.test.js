import childProcess, { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
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
// Resolution-gap fixtures: .js -> .ts swap, declaration files, package.json entry fields.
const swapJsLink = at("src/ui/__fence_swap_js.ts");
const swapMjsLink = at("src/ui/__fence_swap_mjs.mts");
const dtsLink = at("src/ui/__fence_dts.d.ts");
const dtsWinFile = at("src/ui/__fence_dts_win.ts");
const dtsWinLink = at("src/ui/__fence_dts_win.d.ts");
const pkgMainDir = at("src/ui/__fence_pkg_main");
const pkgExportsDir = at("src/ui/__fence_pkg_exports");
const pkgBrowserDir = at("src/ui/__fence_pkg_browser");
const pkgBadDir = at("src/ui/__fence_pkg_bad");
const pkgOkDir = at("src/ui/__fence_pkg_ok");
const pkgNestDir = at("src/ui/__fence_pkg_nest");
const pkgMapDir = at("src/ui/__fence_pkg_map");
const pkgCycleDir = at("src/ui/__fence_pkg_cycle");
const pkgExpStrDir = at("src/ui/__fence_pkg_expstr");
const pkgExpCondDir = at("src/ui/__fence_pkg_expcond");
const pkgModuleDir = at("src/ui/__fence_pkg_module");
const pkgTypesDir = at("src/ui/__fence_pkg_types");
const pkgTypingsDir = at("src/ui/__fence_pkg_typings");
const pkgBomDir = at("src/ui/__fence_pkg_bom");
const pkgBomOkDir = at("src/ui/__fence_pkg_bomok");
const pkgJsnextMainDir = at("src/ui/__fence_pkg_jsnextmain");
const pkgJsnextDir = at("src/ui/__fence_pkg_jsnext");
const swapJsxLink = at("src/ui/__fence_swap_jsx.tsx");
const swapCjsLink = at("src/ui/__fence_swap_cjs.cts");
const dmtsLink = at("src/ui/__fence_dmts.d.mts");
const dctsLink = at("src/ui/__fence_dcts.d.cts");
// the .js -> .ts swap wins over a file named x.js.ts
const swapRealFile = at("src/ui/__fence_swapreal.js.ts");
const swapRealLink = at("src/ui/__fence_swapreal.ts");
const swapOkFile = at("src/ui/__fence_swapok.ts");
const fenceScratch = [
  pkgNestDir,
  pkgMapDir,
  pkgCycleDir,
  pkgExpStrDir,
  pkgExpCondDir,
  pkgModuleDir,
  pkgTypesDir,
  pkgTypingsDir,
  pkgBomDir,
  pkgBomOkDir,
  pkgJsnextMainDir,
  pkgJsnextDir,
  swapJsxLink,
  swapCjsLink,
  dmtsLink,
  dctsLink,
  swapRealFile,
  swapRealLink,
  swapOkFile,
  swapJsLink,
  swapMjsLink,
  dtsLink,
  dtsWinFile,
  dtsWinLink,
  pkgMainDir,
  pkgExportsDir,
  pkgBrowserDir,
  pkgBadDir,
  pkgOkDir,
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
  // src/ui files that exist only as .ts/.mts/.d.ts links into collector/; the import names .js/.mjs or nothing
  fs.symlinkSync("../../collector/__fence_file_target__.ts", swapJsLink, "file");
  fs.symlinkSync("../../collector/__fence_file_target__.ts", swapMjsLink, "file");
  fs.symlinkSync("../../collector/__fence_file_target__.ts", dtsLink, "file");
  // a runtime file wins over the declaration file next to it
  fs.writeFileSync(dtsWinFile, "export const a = 1;\n");
  fs.symlinkSync("../../collector/__fence_file_target__.ts", dtsWinLink, "file");
  // folders whose package.json entry field leads out of src/
  const outEntry = "../../../collector/__fence_file_target__.ts";
  const writePackage = (dir, content) => {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "package.json"), content);
  };
  writePackage(pkgMainDir, JSON.stringify({ main: outEntry }));
  writePackage(pkgExportsDir, JSON.stringify({ exports: { ".": { import: outEntry } } }));
  writePackage(pkgBrowserDir, JSON.stringify({ main: "./a.ts", browser: outEntry }));
  writePackage(pkgBadDir, "{ not json");
  writePackage(pkgOkDir, JSON.stringify({ main: "./a.ts", module: "./a.ts" }));
  fs.writeFileSync(path.join(pkgOkDir, "a.ts"), "export const a = 1;\n");
  // R2: Vite tries the swap first, so x.js reaches the link x.ts although a real x.js.ts exists
  fs.writeFileSync(swapRealFile, "export const a = 1;\n");
  fs.symlinkSync("../../collector/__fence_file_target__.ts", swapRealLink, "file");
  fs.writeFileSync(swapOkFile, "export const a = 1;\n");
  // R4: main names a folder whose own package.json leads out of src/; a browser map; a self-referencing main
  writePackage(pkgNestDir, JSON.stringify({ main: "./inner" }));
  writePackage(path.join(pkgNestDir, "inner"), JSON.stringify({ main: `../${outEntry}` }));
  writePackage(pkgMapDir, JSON.stringify({ main: "./a.ts", browser: { "./a.ts": outEntry } }));
  writePackage(pkgCycleDir, JSON.stringify({ main: "." }));
  // Value: protects=exports given as a string or as top-level conditions, and the module field, are followed out of src/; fails_when=packageEntries reads only exports["."] or drops module; why_new=pkg_exports uses the "." map form only; seam=none; no_claim=Vite's real entry choice (superset)
  writePackage(pkgExpStrDir, JSON.stringify({ exports: outEntry }));
  writePackage(pkgExpCondDir, JSON.stringify({ exports: { import: outEntry } }));
  writePackage(pkgModuleDir, JSON.stringify({ module: outEntry }));
  // Value: protects=the types and typings fields are followed out of src/; fails_when=packageEntries drops types or typings; why_new=no other row has a package.json with only a types field; seam=none; no_claim=TypeScript's typesVersions
  writePackage(pkgTypesDir, JSON.stringify({ types: outEntry }));
  writePackage(pkgTypingsDir, JSON.stringify({ typings: outEntry }));
  // Value: protects=a package.json with a UTF-8 BOM is still read, and an unparsable one fails closed; fails_when=packageEntries lets JSON.parse throw into an empty entry list; why_new=Vite strips the BOM and follows main, but no row had one; seam=none; no_claim=other encodings
  writePackage(pkgBomDir, `\uFEFF${JSON.stringify({ main: outEntry })}`);
  writePackage(pkgBomOkDir, `\uFEFF${JSON.stringify({ main: "./a.ts" })}`);
  fs.writeFileSync(path.join(pkgBomOkDir, "a.ts"), "export const a = 1;\n");
  // Value: protects=the jsnext:main and jsnext fields (Vite mainFields) are followed out of src/; fails_when=packageEntries drops either field; why_new=no row has a package.json with only a jsnext field; seam=none; no_claim=Vite's real entry choice (superset)
  writePackage(pkgJsnextMainDir, JSON.stringify({ "jsnext:main": outEntry }));
  writePackage(pkgJsnextDir, JSON.stringify({ jsnext: outEntry }));
  // Value: protects=every SOURCE_SWAPS and DECLARATION_SWAPS entry reaches the file Vite picks; fails_when=a swap entry is missing or misspelled; why_new=only .js/.mjs -> .ts/.mts and .d.ts were covered; seam=none; no_claim=Vite's own resolver
  fs.symlinkSync("../../collector/__fence_file_target__.ts", swapJsxLink, "file");
  fs.symlinkSync("../../collector/__fence_file_target__.ts", swapCjsLink, "file");
  fs.symlinkSync("../../collector/__fence_file_target__.ts", dmtsLink, "file");
  fs.symlinkSync("../../collector/__fence_file_target__.ts", dctsLink, "file");
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
    // Value: protects=a `!` exclude holding `#` stays skipped; fails_when=the `#` check moves above the `!` skip; why_new=no row has `#` in an exclude; seam=none; no_claim=Vite's exclude semantics
    good(fromUi, 'const m = import.meta.glob(["./dir/*.ts", "!./a#/../x/*.ts"]);'),
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
    // resolution gaps: allowed targets stay allowed
    good(fromUi, `import x from "/@fs${at("src/ui/__fence_ok_dir/index.ts")}";`),
    good(fromUi, 'import x from "./__fence_ok_dir/index.js";'),
    good(fromUi, 'import x from "/%73rc/data/z";'),
    good(fromUi, 'import x from "/%E0%A4%A";'),
    good(fromUi, 'import type { T } from "./__fence_dts_win";'),
    good(fromUi, 'import x from "./__fence_pkg_ok";'),
    good(fromUi, 'import x from "./__fence_pkg_bomok";'),
    good(fromUi, 'new URL("./x.ts", import.meta?.url);'),
    good(fromUi, 'new URL("./b.ts", import.meta.url as string);'),
    good(fromUi, "(0, import.meta.resolve)(`./x.ts`);"),
    good(fromUi, 'const { env } = import.meta; const u = import.meta.resolve("./x.ts");'),
    good(fromUi, "const { url, env } = import.meta;"),
    // R1: plain member reads of import.meta stay allowed
    good(fromUi, "const u = import.meta.url; const d = import.meta.dirname;"),
    good(fromUi, "const m = import.meta.env.MODE; const e = import.meta.env;"),
    good(fromUi, "if (import.meta.hot) { import.meta.hot.accept(() => {}); }"),
    good(fromUi, "import.meta.hot?.dispose(() => {}); const t = typeof import.meta.env;"),
    good(fromUi, "import.meta.resolve?.('./x.ts'); (import.meta.resolve)('./x.ts');"),
    // R2: an in-zone x.js -> x.ts swap passes; R4: a self-referencing main does not loop
    good(fromUi, 'import x from "./__fence_swapok.js";'),
    good(fromUi, 'import x from "./__fence_pkg_cycle";'),
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
    // Value: protects=a `#` in an array element is reported; fails_when=the array loop skips the `#` check; why_new=the # rows are string-only; seam=none; no_claim=Vite's glob join
    bad(fromUi, 'const m = import.meta.glob(["./a/*.ts", "./b#/../../electron/*.ts"]);', GLOB),
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
    // G1: /@fs/ serves any absolute path, never public/
    bad(fromUi, `import x from "/@fs${at("collector/x")}";`, SRC),
    bad(fromUi, `import x from "/@fs${at("electron/x")}?raw";`, SRC),
    bad(fromUi, `import x from "/%40fs${at("collector/x")}";`, SRC),
    bad(fromUi, 'import x from "/@fs/etc/passwd";', SRC),
    // G2: Vite swaps .js/.jsx to .ts/.tsx and .mjs to .mts
    bad(fromUi, 'import x from "./__fence_swap_js.js";', SRC),
    bad(fromUi, 'import x from "./__fence_swap_mjs.mjs";', SRC),
    // G3: a folder's package.json entry field is followed
    bad(fromUi, 'import x from "./__fence_pkg_main";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_bad";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_bom";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_jsnextmain";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_jsnext";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_exports";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_browser";', SRC),
    // G4: declaration files are a fallback after the runtime extensions
    bad(fromUi, 'import type { T } from "./__fence_dts";', SRC),
    bad(fromUi, 'import type { T } from "./__fence_dts.js";', SRC),
    // G5: a percent-encoded first segment
    bad(fromUi, 'import x from "/%63ollector/x";', SRC),
    bad(fromUi, 'import x from "/%2e%2e/outside/x";', SRC),
    // G6: optional-chained import.meta base
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta?.url);', SRC),
    bad(fromUi, "new URL(name, import.meta?.url);", NON_STATIC),
    // G7: sequence-expression callee
    bad(fromUi, '(0, import.meta.resolve)("../../collector/x.ts");', SRC),
    bad(fromUi, "(0, import.meta.resolve)(name);", NON_STATIC),
    bad(fromUi, '(0, import.meta.glob)("../../collector/*.ts");', SRC),
    // G8: import.meta.resolve behind a destructuring or an alias cannot be read
    bad(fromUi, 'const { resolve } = import.meta; resolve("../../collector/x.ts");', NON_STATIC),
    bad(fromUi, 'const { resolve: r } = import.meta; r("./x.ts");', NON_STATIC),
    bad(fromUi, 'const { glob } = import.meta; glob("./*.ts");', NON_STATIC),
    bad(fromUi, 'const { ...rest } = import.meta; rest.resolve("./x.ts");', NON_STATIC),
    bad(fromUi, 'const { [key]: r } = import.meta; r("./x.ts");', NON_STATIC),
    bad(fromUi, 'const meta = import.meta; meta.resolve("./x.ts");', NON_STATIC),
    bad(fromUi, 'const r = import.meta.resolve; r("./x.ts");', NON_STATIC),
    bad(fromUi, 'let r; r = import.meta.resolve; r("./x.ts");', NON_STATIC),
    // R1 (D4): a resolve/glob reference that is not a direct callee, or a bare import.meta, is reported
    bad(fromUi, "function f({ resolve } = import.meta) {}", NON_STATIC),
    bad(fromUi, "function f(r = import.meta.resolve) {}", NON_STATIC),
    bad(fromUi, "function f(r = import.meta.glob) {}", NON_STATIC),
    bad(fromUi, "const { resolve } = import.meta ?? {};", NON_STATIC),
    bad(fromUi, "const { env } = import.meta || {};", NON_STATIC),
    bad(fromUi, "const a = [import.meta.resolve];", NON_STATIC),
    bad(fromUi, "const o = { r: import.meta.resolve };", NON_STATIC),
    bad(fromUi, "f(import.meta);", NON_STATIC),
    bad(fromUi, "f(import.meta.glob);", NON_STATIC),
    bad(fromUi, "class C { static r = import.meta.resolve; }", NON_STATIC),
    bad(fromUi, "for (const { resolve } of [import.meta]) {}", NON_STATIC),
    bad(fromUi, "const r = (import.meta.resolve ?? f); r('./x.ts');", NON_STATIC),
    bad(fromUi, "(import.meta.resolve || f)('./x.ts');", NON_STATIC),
    bad(fromUi, "const r = import.meta[key];", NON_STATIC),
    {
      filename: fromUi,
      code: 'import.meta.resolve.bind(import.meta)("./x.ts");',
      errors: [{ message: NON_STATIC }, { message: NON_STATIC }],
    },
    {
      filename: fromUi,
      code: 'import.meta.resolve.call(import.meta, "./x.ts");',
      errors: [{ message: NON_STATIC }, { message: NON_STATIC }],
    },
    // R2: the swap is tried before the plain extensions
    bad(fromUi, 'import x from "./__fence_swapreal.js";', SRC),
    // R4: a nested package.json, a browser map and a `?? ""` base
    bad(fromUi, 'import x from "./__fence_pkg_nest";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_map";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_expstr";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_expcond";', SRC),
    bad(fromUi, 'import x from "./__fence_pkg_module";', SRC),
    bad(fromUi, 'import type { x } from "./__fence_pkg_types";', SRC),
    bad(fromUi, 'import type { x } from "./__fence_pkg_typings";', SRC),
    bad(fromUi, 'import x from "./__fence_swap_jsx.jsx";', SRC),
    bad(fromUi, 'import x from "./__fence_swap_cjs.cjs";', SRC),
    bad(fromUi, 'import type { T } from "./__fence_dmts.mjs";', SRC),
    bad(fromUi, 'import type { T } from "./__fence_dcts.cjs";', SRC),
    // Value: protects=package.json entries are followed for /@fs/ and root-absolute folder specifiers; fails_when=packageTargets drops either branch; why_new=only the relative branch had a row; seam=none; no_claim=none
    bad(fromUi, `import x from "/@fs${at("src/ui/__fence_pkg_main")}";`, SRC),
    bad(fromUi, 'import x from "/src/ui/__fence_pkg_main";', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta.url ?? "");', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta.url || "");', SRC),
    bad(fromUi, 'new URL(name, import.meta.url ?? "");', NON_STATIC),
    bad(fromUi, 'new URL("../../collector/x.ts", "" || import.meta.url);', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta.url as string);', SRC),
    // Value: protects=a satisfies or non-null wrapper around import.meta.url still gives the importer URL; fails_when=hasImportMetaUrl stops unwrapping TSSatisfiesExpression or TSNonNullExpression; why_new=only the as wrapper had a row; seam=none; no_claim=none beyond protects
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta.url satisfies string);', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta.url!);', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", (import.meta.url ?? "") || "");', SRC),
    // Value: protects=an import.meta.url read anywhere in the new URL base still gives the importer URL; fails_when=hasImportMetaUrl goes back to unwrapping only listed wrappers; why_new=template, ternary, call and cast bases were unchecked; seam=none; no_claim=a base that reaches import.meta.url through a variable
    bad(fromUi, 'new URL("../../collector/x.ts", `${import.meta.url}`);', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", c ? import.meta.url : "");', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", String(import.meta.url));', SRC),
    bad(fromUi, 'new URL("../../collector/x.ts", <string>import.meta.url);', SRC),
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
  // `git diff --cached --raw -z` output: ":old new oldsha newsha STATUS\0path\0" (a rename lists two paths).
  const entry = (oldMode, newMode, status, ...paths) =>
    `:${oldMode} ${newMode} 1111111 2222222 ${status}\0${paths.join("\0")}\0`;
  let git;
  beforeEach(() => {
    git = vi.spyOn(childProcess, "execFileSync").mockReturnValue("");
  });
  afterEach(() => vi.restoreAllMocks());
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
  it("keeps the partial check for an ordinary modified file", () => {
    git.mockReturnValue(entry("100644", "100644", "M", "src/a.ts"));
    expect(staged([at("src/a.ts")])).toBe(`vp check --fix "${at("src/a.ts")}"`);
    expect(git.mock.calls[0].slice(0, 2)).toEqual([
      "git",
      [
        "diff",
        "--cached",
        "--raw",
        "-z",
        "-M",
        "--no-abbrev",
        "--no-relative",
        "--ignore-submodules=none",
      ],
    ]);
    expect(git.mock.calls[0][2].env).not.toHaveProperty("GIT_PRINT_SHA1_ELLIPSIS");
  });
  it.each([
    ["a deletion", entry("100644", "000000", "D", "src/a.ts")],
    ["a rename", entry("100644", "100644", "R100", "src/a.ts", "src/b.ts")],
    ["a new symlink", entry("000000", "120000", "A", "src/link")],
    ["a changed symlink", entry("120000", "120000", "M", "src/link")],
    ["a symlink turned into a file", entry("120000", "100644", "T", "src/link")],
    ["a new submodule", entry("000000", "160000", "A", "sub")],
    ["a changed submodule", entry("160000", "160000", "M", "sub")],
    ["a removed submodule", entry("160000", "000000", "D", "sub")],
    ["a file turned into a submodule", entry("100644", "160000", "T", "sub")],
    ["a type change between regular modes", entry("100644", "100755", "T", "src/a.ts")],
    [
      "a deletion after a modified file and a rename",
      entry("100644", "100644", "M", "src/m.ts") +
        entry("100644", "100644", "R090", "src/a.ts", "src/:b.ts") +
        entry("100644", "000000", "D", "src/gone.ts"),
    ],
  ])("runs the full check for %s", (_name, raw) => {
    git.mockReturnValue(raw);
    expect(staged([at("src/a.ts")])).toBe("vp check");
  });
  it("runs the full check when git fails", () => {
    git.mockImplementation(() => {
      throw new Error("git failed");
    });
    expect(staged([at("src/a.ts")])).toBe("vp check");
  });
});

// R3/H1: lint-staged lists only ACMR files and drops symlink and submodule entries, so a commit of only
// deletions, renames, type changes or symlinks would skip every task. The hook decides from git itself;
// a stub `vp` on PATH makes the choice observable.
// Value: protects=a commit with a staged deletion, rename, type change or symlink runs the full `vp check`, a plain edit stays partial; fails_when=the hook hands those commits to `vp staged`; why_new=the staged function tests never run the hook or lint-staged; seam=none; no_claim=this repo's real vite.config.ts under lint-staged
describe("pre-commit hook", () => {
  const hook = fs.readFileSync(at(".vite-hooks/pre-commit"), "utf8");
  // Commits `before`, applies `change` (a list of git args or functions), runs the hook, returns its output.
  // `stubGit` puts a `git` that exits 1 ahead of the real one for the hook only. `extra.config` is a list of
  // [key, value] repo settings made before staging, `extra.env` is added to the hook's environment,
  // `extra.afterAdd` edits the working tree after staging, `extra.status` is the expected exit status, and
  // `extra.vp` is appended to the stub `vp` script. The hook gets its own TMPDIR, which must be empty afterwards.
  function runHook(before, change, stubGit = false, extra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fence-hook-"));
    try {
      // No user or system git config, and every git call must succeed.
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      };
      const git = (...args) => {
        const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
        expect(result.status, `git ${args.join(" ")}: ${result.stderr}`).toBe(0);
      };
      git("init", "-q");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "t");
      for (const [key, value] of extra.config ?? []) git("config", key, value);
      before(dir);
      git("add", "-A");
      git("-c", "commit.gpgsign=false", "commit", "-qm", "init");
      change(dir, git);
      git("add", "-A");
      extra.afterAdd?.(dir);
      const bin = path.join(dir, "__bin");
      const tmp = path.join(dir, "__tmp");
      fs.mkdirSync(bin);
      fs.mkdirSync(tmp);
      fs.writeFileSync(path.join(bin, "vp"), `#!/bin/sh\necho "VP_RAN $*"\n${extra.vp ?? ""}`, {
        mode: 0o755,
      });
      if (stubGit) fs.writeFileSync(path.join(bin, "git"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      const run = spawnSync("sh", ["-c", hook], {
        cwd: dir,
        encoding: "utf8",
        env: { ...env, ...extra.env, TMPDIR: tmp, PATH: `${bin}:${process.env.PATH}` },
      });
      expect(run.status, run.stderr).toBe(extra.status ?? 0);
      expect(fs.readdirSync(tmp)).toEqual([]);
      return run.stdout.trim();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const write = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text);
  const link = (dir, name, target) => fs.symlinkSync(target, path.join(dir, name));
  const unlink = (dir, name) => fs.rmSync(path.join(dir, name));
  const base = (dir) => {
    write(dir, "a.txt", "x\n");
    write(dir, "gone.txt", "x\n");
  };

  it("runs the full check for a deletion-only commit", () => {
    expect(runHook(base, (dir) => unlink(dir, "gone.txt"))).toBe("VP_RAN check");
  });
  it("runs the full check for a rename-only commit", () => {
    const out = runHook(base, (dir) =>
      fs.renameSync(path.join(dir, "gone.txt"), path.join(dir, "moved.txt")),
    );
    expect(out).toBe("VP_RAN check");
  });
  it("runs the full check for a symlink add only", () => {
    expect(runHook(base, (dir) => link(dir, "l", "a.txt"))).toBe("VP_RAN check");
  });
  it("runs the full check for a symlink retarget only", () => {
    const before = (dir) => {
      base(dir);
      link(dir, "l", "a.txt");
    };
    const change = (dir) => {
      unlink(dir, "l");
      link(dir, "l", "gone.txt");
    };
    expect(runHook(before, change)).toBe("VP_RAN check");
  });
  it("runs the full check when a file becomes a symlink", () => {
    const change = (dir) => {
      unlink(dir, "gone.txt");
      link(dir, "gone.txt", "a.txt");
    };
    expect(runHook(base, change)).toBe("VP_RAN check");
  });
  it("runs the full check when a symlink becomes a file", () => {
    const before = (dir) => {
      base(dir);
      link(dir, "l", "a.txt");
    };
    const change = (dir) => {
      unlink(dir, "l");
      write(dir, "l", 'import "../../collector/x";\n');
    };
    expect(runHook(before, change)).toBe("VP_RAN check");
  });
  // `git add -A` stages a nested repository as a gitlink.
  const addGitlink = (dir, git) => {
    fs.mkdirSync(path.join(dir, "sub"));
    git("-C", "sub", "init", "-q");
    git(
      "-C",
      "sub",
      "-c",
      "user.email=t@example.com",
      "-c",
      "user.name=t",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "x",
    );
  };
  it("runs the full check for a staged submodule (gitlink)", () => {
    expect(runHook(base, addGitlink)).toBe("VP_RAN check");
  });
  it("runs the full check when git fails", () => {
    expect(runHook(base, (dir) => write(dir, "a.txt", "y\n"), true)).toBe("VP_RAN check");
  });
  it("runs the full check for a deletion with diff.ignoreSubmodules=all set", () => {
    const extra = { config: [["diff.ignoreSubmodules", "all"]] };
    expect(runHook(base, (dir) => unlink(dir, "gone.txt"), false, extra)).toBe("VP_RAN check");
  });
  it("runs the full check for a staged gitlink with diff.ignoreSubmodules=all set", () => {
    const extra = { config: [["diff.ignoreSubmodules", "all"]] };
    expect(runHook(base, addGitlink, false, extra)).toBe("VP_RAN check");
  });
  it("runs the full check for a staged gitlink with ignore = all in .gitmodules", () => {
    const change = (dir, git) => {
      write(dir, ".gitmodules", '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n\tignore = all\n');
      addGitlink(dir, git);
    };
    expect(runHook(base, change)).toBe("VP_RAN check");
  });
  it("runs the full check for a deletion with GIT_PRINT_SHA1_ELLIPSIS=yes", () => {
    const extra = { env: { GIT_PRINT_SHA1_ELLIPSIS: "yes" } };
    expect(runHook(base, (dir) => unlink(dir, "gone.txt"), false, extra)).toBe("VP_RAN check");
  });
  it("runs the full check for a rename with GIT_PRINT_SHA1_ELLIPSIS=yes", () => {
    const extra = { env: { GIT_PRINT_SHA1_ELLIPSIS: "yes" } };
    const change = (dir) => fs.renameSync(path.join(dir, "gone.txt"), path.join(dir, "moved.txt"));
    expect(runHook(base, change, false, extra)).toBe("VP_RAN check");
  });
  it("runs the full check for a deletion with core.abbrev=40 and diff.renames=false", () => {
    const extra = {
      config: [
        ["core.abbrev", "40"],
        ["diff.renames", "false"],
      ],
    };
    expect(runHook(base, (dir) => unlink(dir, "gone.txt"), false, extra)).toBe("VP_RAN check");
  });
  // #122: the full check must see the index. The stub `vp` fails when b.ts imports the deleted a.ts.
  const brokenImport = '[ ! -f a.ts ] && grep -q "./a" b.ts && { echo BROKEN; exit 1; }\nexit 0\n';
  const importer = (dir) => {
    write(dir, "a.ts", "export const a = 1;\n");
    write(dir, "b.ts", 'import { a } from "./a";\nexport const b = a;\n');
  };
  it("fails a staged deletion whose unstaged edit hides the broken import", () => {
    const extra = {
      vp: brokenImport,
      status: 1,
      afterAdd: (dir) => write(dir, "b.ts", "export const b = 1;\n"),
    };
    expect(runHook(importer, (dir) => unlink(dir, "a.ts"), false, extra)).toBe(
      "VP_RAN check\nBROKEN",
    );
  });
  it("passes a staged deletion when the import removal is staged too", () => {
    const change = (dir) => {
      unlink(dir, "a.ts");
      write(dir, "b.ts", "export const b = 1;\n");
    };
    expect(runHook(importer, change, false, { vp: brokenImport })).toBe("VP_RAN check");
  });
  it("checks a copy of the index, which holds no untracked file", () => {
    const extra = { afterAdd: (dir) => write(dir, "stray.ts", "export {};\n"), vp: "ls\n" };
    const out = runHook(base, (dir) => unlink(dir, "gone.txt"), false, extra);
    expect(out.split("\n")).not.toContain("stray.ts");
  });
  it("keeps the partial path for a modify-only commit", () => {
    expect(runHook(base, (dir) => write(dir, "a.txt", "y\n"))).toBe(
      "VP_RAN staged --diff-filter=ACDMR",
    );
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
