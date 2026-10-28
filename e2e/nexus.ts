import { errors, type Page } from "@playwright/test";
import type { NexusHooks } from "../src/debug/nexus";

export async function waitForHook(
  page: Page,
  name: keyof NexusHooks,
  timeout = 10_000,
): Promise<void> {
  try {
    await page.waitForFunction((n) => typeof window.__nexus?.[n] === "function", name, {
      timeout,
    });
  } catch (error) {
    if (!(error instanceof errors.TimeoutError)) throw error;
    throw new Error(`hook ${name} not registered within ${timeout / 1000}s`, { cause: error });
  }
}

export async function nexus<K extends keyof NexusHooks>(
  page: Page,
  name: K,
  ...args: Parameters<NexusHooks[K]>
): Promise<ReturnType<NexusHooks[K]>> {
  await waitForHook(page, name);
  return (await page.evaluate(
    ([n, a]) => (window.__nexus![n] as (...x: unknown[]) => unknown)(...a),
    [name, args] as const,
  )) as ReturnType<NexusHooks[K]>;
}
