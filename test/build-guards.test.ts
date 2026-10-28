import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let work = "";

// lint/module-fences.test.js creates these while it runs; do not copy them.
const skip = (source: string) => {
  const name = path.basename(source);
  return name === "__fence_link__" || name.startsWith("__wiring_");
};

function build() {
  const result = spawnSync("npx", ["vp", "build"], {
    cwd: work,
    encoding: "utf8",
    // Vitest sets NODE_ENV=test; a child build would keep DEV code.
    env: { ...process.env, NODE_ENV: "production" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function resetSrc() {
  fs.rmSync(path.join(work, "src"), { recursive: true, force: true });
  fs.cpSync(path.join(repoRoot, "src"), path.join(work, "src"), {
    recursive: true,
    filter: (source) => !skip(source),
  });
}

function leakFrom(file: string, body: string) {
  fs.writeFileSync(path.join(work, "src", file), body);
  const main = path.join(work, "src", "main.tsx");
  const name = file.replace(/\.ts$/, "");
  fs.writeFileSync(
    main,
    `${fs.readFileSync(main, "utf8")}\nimport { leak } from "./${name}";\nconsole.log(leak);\n`,
  );
}

describe("build guards", { timeout: 120_000 }, () => {
  beforeAll(() => {
    work = fs.mkdtempSync(`${os.tmpdir()}/nexus-guards-`);
    for (const file of ["index.html", "package.json", "tsconfig.json", "vite.config.ts"]) {
      fs.copyFileSync(path.join(repoRoot, file), path.join(work, file));
    }
    fs.cpSync(path.join(repoRoot, "lint"), path.join(work, "lint"), {
      recursive: true,
      filter: (source) => !skip(source),
    });
    resetSrc();
    fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(work, "node_modules"));
  });

  afterAll(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("builds a clean copy", () => {
    const { status, output } = build();
    expect(status, output).toBe(0);
  });

  it("fails when __nexus reaches a chunk", () => {
    resetSrc();
    leakFrom("__leak_nexus.ts", 'export const leak = "__nexus";\n');
    const { status, output } = build();
    expect(status).not.toBe(0);
    expect(output).toContain("__nexus found");
  });

  it("fails on a node: built-in import", () => {
    resetSrc();
    leakFrom(
      "__leak_fs.ts",
      'import { readFileSync } from "node:fs";\nexport const leak = readFileSync;\n',
    );
    const { status, output } = build();
    expect(status).not.toBe(0);
    expect(output).toContain("node:fs");
    expect(output).toContain("__leak_fs");
  });

  it("fails on a prefix-only built-in import", () => {
    resetSrc();
    leakFrom(
      "__leak_sqlite.ts",
      'import { DatabaseSync } from "node:sqlite";\nexport const leak = DatabaseSync;\n',
    );
    const { status, output } = build();
    expect(status).not.toBe(0);
    expect(output).toContain("node:sqlite");
  });

  it("fails on a bare built-in import", () => {
    resetSrc();
    leakFrom("__leak_path.ts", 'import path from "path";\nexport const leak = path.sep;\n');
    const { status, output } = build();
    expect(status).not.toBe(0);
    expect(output).toContain('"path"');
  });
});
