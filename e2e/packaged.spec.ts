import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";

const executablePath = "release/mac-arm64/Nexus One.app/Contents/MacOS/Nexus One";

let app: ElectronApplication | null = null;

test.afterEach(async () => {
  await app?.close();
  app = null;
});

test("packaged app boots, renders and survives a reload", async () => {
  app = await electron.launch({ executablePath });
  const errors: string[] = [];
  let stderr = "";
  app.context().on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  app.context().on("weberror", (webError) => {
    errors.push(`weberror: ${webError.error().message}`);
  });
  app.process().stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const page = await app.firstWindow();

  async function assertBooted() {
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByText("Nexus One").first()).toBeVisible();
    expect(page.url()).toBe("app://nexus/index.html");
    expect(errors, `console/web errors:\n${errors.join("\n")}`).toEqual([]);
    expect(stderr).not.toContain("failed to start");
    expect(stderr).not.toContain("[renderer]");
  }

  await assertBooted();
  await page.reload();
  await expect(page.locator("canvas")).toBeVisible();
  await assertBooted();
});
