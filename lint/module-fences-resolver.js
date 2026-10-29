import os from "node:os";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { createServer } from "vite-plus";

// Worker for module-fences.js: runs Vite's own resolver (the project's vite.config.ts, client and ssr
// environments) so the rule fences the file Vite loads. The rule is synchronous; it posts a request,
// blocks on `signal` (Atomics.wait) and reads the answer from `port`. A worker or config failure is
// sent back as `{ error }`; the rule then reports the import (fail closed).
const { signal, port, root } = workerData;
const flag = new Int32Array(signal);

const started = createServer({
  root,
  configFile: path.join(root, "vite.config.ts"),
  logLevel: "silent",
  appType: "custom",
  // Resolve only: no dependency scan or pre-bundle, and a cache folder outside the repo, so lint
  // never writes to node_modules/.vite.
  cacheDir: path.join(os.tmpdir(), "module-fences-vite"),
  optimizeDeps: { noDiscovery: true, include: [], entries: [] },
  server: { middlewareMode: true, ws: false, watch: null },
});

parentPort.on("message", async ({ id, specifier, importer }) => {
  let answer;
  try {
    const server = await started;
    // package.json data is cached for the life of the server; a fixture or edit may have changed it
    server.config.packageCache?.clear();
    // A resolve that throws (a package.json Vite rejects) means Vite cannot load the file either:
    // that is "not resolved", and the rule's own resolution still judges the specifier.
    const resolved = await Promise.all(
      ["client", "ssr"].map((name) =>
        server.environments[name].pluginContainer.resolveId(specifier, importer).catch(() => null),
      ),
    );
    answer = { id, ids: resolved.map((result) => result?.id ?? null) };
  } catch (error) {
    answer = { id, error: String(error?.stack ?? error) };
  }
  port.postMessage(answer);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
