import { app, BrowserWindow, dialog, net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { APP_ORIGIN, APP_SCHEME, createAppHandler } from "./resolve.ts";

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function log(message: string, error: unknown): void {
  console.error(message, error);
}

let failed = false;

function fail(error: unknown): void {
  // did-fail-load and the loadURL rejection report the same failure; show one dialog.
  if (failed) return;
  failed = true;
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error("Nexus One failed to start:", error);
  dialog.showErrorBox("Nexus One failed to start", message);
  app.exit(1);
}

async function start(): Promise<void> {
  await app.whenReady();
  protocol.handle(
    APP_SCHEME,
    createAppHandler(
      path.join(app.getAppPath(), "dist"),
      (file) => net.fetch(pathToFileURL(file).toString()),
      log,
    ),
  );
  const win = new BrowserWindow({ width: 1280, height: 800 });
  // Registered before loadURL so first-load renderer errors reach stderr (D16).
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(`[renderer] ${event.message}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer] render process gone: ${details.reason}`);
  });
  // A missing dist/index.html is a 404 response, not a load failure, so check the status (D8).
  win.webContents.on("did-navigate", (_event, url, httpResponseCode) => {
    if (httpResponseCode >= 400) fail(new Error(`${url} returned HTTP ${httpResponseCode}`));
  });
  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) fail(new Error(`${url} failed to load: ${description} (${code})`));
  });
  try {
    await win.loadURL(`${APP_ORIGIN}/index.html`);
  } catch (error) {
    // A reload during the first load aborts it with ERR_ABORTED (-3); that is not a failure.
    if ((error as { errno?: number }).errno !== -3) throw error;
  }
}

app.on("window-all-closed", () => app.quit());
start().catch(fail);
