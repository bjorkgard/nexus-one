import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, it } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";
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

const bad = (filename, code) => ({ filename, code, errors: [{ messageId: "fence" }] });
const good = (filename, code) => ({ filename, code });

tester.run("no-cross-zone", plugin.rules["no-cross-zone"], {
  valid: [
    good(fromUi, 'import x from "../shared/x";'),
    good(fromUi, 'import x from "./y";'),
    good(fromUi, 'import x from "react";'),
    good(fromUi, 'import fs from "node:fs";'),
    good(at("src/shared/sub/a.ts"), 'import x from "../x";'),
    good(fromCollector, 'import x from "../src/shared/x";'),
    good(fromCollector, 'import x from "../src/shared";'),
    good(fromCollector, 'import x from "./a/../helper";'),
    good(at("src/data/a.ts"), 'import x from "./collector";'),
    good(fromUi, "import(name);"),
    good(fromUi, "const m = import.meta.glob(pattern);"),
    good(fromUi, 'new URL("./x.ts", import.meta.url);'),
    good(fromUi, 'const m = import.meta.glob("./*.ts");'),
    good(at("vite.config.ts"), 'import x from "./collector/x";'),
    good(at("vite.config.ts"), 'import x from "./src/ui/x";'),
  ],
  invalid: [
    bad(fromUi, 'import x from "../../collector/x";'),
    bad(fromUi, 'import x from "../.././collector/x";'),
    bad(fromUi, 'import x from "..//../collector/x";'),
    bad(fromUi, 'import x from "../../src/../collector/x";'),
    bad(fromUi, 'import x from "../../Collector/x";'),
    bad(fromUi, 'import x from "../../electron/x";'),
    bad(fromUi, 'export * from "../../collector/x";'),
    bad(fromUi, 'export { a } from "../../collector/x";'),
    bad(fromUi, 'import("../../collector/x");'),
    bad(fromUi, "import(`../../collector/x`);"),
    bad(fromUi, 'require("../../collector/x");'),
    bad(fromUi, 'export type T = typeof import("../../collector/x");'),
    bad(fromUi, 'const m = import.meta.glob("../../collector/*.ts");'),
    bad(fromUi, 'const m = import.meta.glob(["../../collector/a.ts"]);'),
    bad(fromUi, 'const m = import.meta.glob(["./ok.ts", "!../../collector/**"]);'),
    bad(fromUi, 'new URL("../../collector/x.ts", import.meta.url);'),
    bad(fromShared, 'import x from "../ui/x";'),
    bad(fromShared, 'import x from "./../ui/x";'),
    bad(fromShared, 'import x from "../App";'),
    bad(fromCollector, 'import x from "../src/ui/x";'),
    bad(fromCollector, 'import x from "../src/shared/../ui/x";'),
    bad(fromCollector, 'import x from "../Src/shared/../ui/x";'),
    bad(fromCollector, 'import x from "../src";'),
    bad(fromCollector, 'import x from "../src/App";'),
    bad(fromUi, 'import x from "../../../../outside/x";'),
    bad(fromCollector, 'import x from "../../outside/x";'),
    bad(fromShared, 'import x from "../../../outside/x";'),
  ],
});
