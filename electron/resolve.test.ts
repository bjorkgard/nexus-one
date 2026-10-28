import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { APP_ORIGIN, APP_SCHEME, createAppHandler } from "./resolve.ts";

let tmp = "";
let root = "";

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-resolve-"));
  root = path.join(tmp, "root");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<html></html>");
  fs.writeFileSync(path.join(root, "assets", "a.js"), "a");
  fs.writeFileSync(path.join(root, "..foo"), "foo");
  fs.writeFileSync(path.join(tmp, "outside.txt"), "outside");
  fs.symlinkSync("../../outside.txt", path.join(root, "assets", "link"));
});
afterAll(() => fs.rmSync(tmp, { force: true, recursive: true }));

// Drives the handler with a recording fetch stub; `fetched` is the path passed to it, or null.
async function run(url: string) {
  const calls: string[] = [];
  const logs: unknown[][] = [];
  const handler = createAppHandler(
    root,
    async (file) => {
      calls.push(file);
      return new Response("body", { status: 200 });
    },
    (...args) => logs.push(args),
  );
  const response = await handler(new Request(url));
  return { status: response.status, fetched: calls.length === 0 ? null : calls, logs };
}

describe("exports", () => {
  it("names the scheme and origin", () => {
    expect(APP_SCHEME).toBe("app");
    expect(APP_ORIGIN).toBe("app://nexus");
  });
});

describe("createAppHandler resolution", () => {
  it("serves / as index.html", async () => {
    expect(await run("app://nexus/")).toMatchObject({
      status: 200,
      fetched: [path.join(root, "index.html")],
    });
  });

  it("serves an existing file", async () => {
    expect(await run("app://nexus/assets/a.js")).toMatchObject({
      status: 200,
      fetched: [path.join(root, "assets", "a.js")],
    });
  });

  it("allows a file named ..foo", async () => {
    expect(await run("app://nexus/..foo")).toMatchObject({
      status: 200,
      fetched: [path.join(root, "..foo")],
    });
  });

  // 404 and no fetch for each request below
  it.each([
    ["other host", "app://other/index.html"],
    ["dot-dot (URL parsing strips it)", "app://nexus/../outside.txt"],
    ["encoded dot-dot (URL parsing strips it)", "app://nexus/%2e%2e/outside.txt"],
    ["encoded slash traversal (guard)", "app://nexus/a%2F..%2F..%2Foutside.txt"],
    ["decode error", "app://nexus/%E0%A4%A"],
    ["NUL byte", "app://nexus/%00x"],
    ["double slash absolute", "app://nexus//etc/passwd"],
    ["missing file", "app://nexus/nope.js"],
    ["directory", "app://nexus/assets"],
    ["symlink out of root", "app://nexus/assets/link"],
  ])("404 without fetching: %s", async (_name, url) => {
    expect(await run(url)).toMatchObject({ status: 404, fetched: null, logs: [] });
  });
});

describe("createAppHandler errors", () => {
  it("passes the fetch response through", async () => {
    const handler = createAppHandler(
      root,
      async () => new Response("x", { status: 206 }),
      () => {},
    );
    expect((await handler(new Request("app://nexus/"))).status).toBe(206);
  });

  it("logs the path and error and returns 500 when fetch rejects", async () => {
    const logs: unknown[][] = [];
    const boom = new Error("boom");
    const handler = createAppHandler(
      root,
      async () => {
        throw boom;
      },
      (...args) => logs.push(args),
    );
    const response = await handler(new Request("app://nexus/assets/a.js"));
    expect(response.status).toBe(500);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain(path.join(root, "assets", "a.js"));
    expect(logs[0]).toContain(boom);
  });
});
