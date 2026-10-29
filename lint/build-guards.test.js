import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEV_MARKERS, buildGuards } from "./build-guards.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const chunk = (fileName, code) => ({ type: "chunk", fileName, code });

function run(bundle) {
  const error = vi.fn();
  buildGuards().generateBundle.call({ error }, {}, bundle);
  return error;
}

describe("DEV_MARKERS", () => {
  it("lists the six dev-only markers", () => {
    expect(DEV_MARKERS.map((row) => row.marker).sort()).toEqual([
      "__nexus",
      "nexus-palette-board",
      "nexus-perf-overlay",
      "nexus-probe",
      "nexus-zone-overlay",
      "nexus.perfStats",
    ]);
  });

  it.each(DEV_MARKERS)("$source still contains $marker", ({ marker, source }) => {
    expect(fs.readFileSync(path.join(repoRoot, source), "utf8")).toContain(marker);
  });
});

describe("generateBundle", () => {
  it.each(DEV_MARKERS)("errors on a chunk containing $marker", ({ marker }) => {
    const error = run({ "a.js": chunk("a.js", `const x = "${marker}";`) });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain(marker);
    expect(error.mock.calls[0][0]).toContain("a.js");
  });

  it("accepts a clean bundle", () => {
    const error = run({
      "a.js": chunk("a.js", "console.log(1)"),
      "a.css": { type: "asset", fileName: "a.css", source: "__nexus" },
    });
    expect(error).not.toHaveBeenCalled();
  });
});
