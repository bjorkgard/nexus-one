// Frame budget from docs/PLAN.md:25: under 300 draw calls at 60 fps.
export const PERF_BUDGET = { drawCalls: 300, fps: 60 } as const;

const WARN_FROM = 240;

export type DrawCallLevel = "ok" | "warn" | "over";

// "Under 300" is the budget, so 300 itself is already over.
export function drawCallLevel(calls: number): DrawCallLevel {
  if (calls >= PERF_BUDGET.drawCalls) return "over";
  if (calls >= WARN_FROM) return "warn";
  return "ok";
}
